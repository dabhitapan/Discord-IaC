import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import type { DesiredChannel, DesiredProfile } from "../planner/types.js";
import {
  normalizeLogicalChannelReference,
  OfflineLogicalChannelResolver,
  resolveDocumentTargets,
  validateDocumentTargetResolutions,
} from "./channelResolver.js";
import type { ContentDocument, ContentRegistryFile } from "./types.js";
import { DeterministicMarkdownParser } from "./markdownParser.js";
import { OfflineContentPlanner } from "./planner.js";
import { loadValidatedContentProfile, buildContentPlan } from "./pipeline.js";
import {
  createContentPlanArtifact,
  serializeContentPlanArtifact,
} from "./planArtifact.js";

function desiredProfile(channels: DesiredChannel[]): DesiredProfile {
  return {
    metadata: { key: "test-profile", name: "Test Profile", version: 1 },
    roles: [],
    categories: [
      { key: "information", name: "Information" },
      { key: "voice", name: "Voice" },
    ],
    channels,
    permissionRules: [],
  };
}

function channel(
  key: string,
  name: string,
  type: DesiredChannel["type"] = "GuildText",
  categoryKey = "information",
): DesiredChannel {
  return { key, name, type, categoryKey };
}

function document(targetChannel: string | null): ContentDocument {
  return {
    profileKey: "test-profile",
    key: "rules",
    language: "en",
    sourcePath: "rules.md",
    sourceFile: "english/rules.md",
    requestedLanguages: ["en"],
    targetChannel,
    order: 10,
    pinned: true,
    enabled: true,
    markdown: "# Rules\n",
  };
}

test("resolver prefers exact logical channel keys", () => {
  const resolution = new OfflineLogicalChannelResolver().resolve(
    "rules",
    desiredProfile([channel("rules", "community-rules")]),
  );
  assert.deepEqual(resolution, {
    requested: "rules",
    status: "resolved",
    channelKey: "rules",
    channelName: "community-rules",
    channelType: "text",
    categoryKey: "information",
    categoryName: "Information",
  });
});

test("resolver normalizes case, whitespace, repeated spaces, and hyphens", () => {
  assert.equal(normalizeLogicalChannelReference("  Server   Guide "), "server-guide");
  const resolution = new OfflineLogicalChannelResolver().resolve(
    "  Server   Guide ",
    desiredProfile([channel("guide", "server-guide")]),
  );
  assert.equal(resolution.status, "resolved");
  assert.equal(resolution.channelKey, "guide");
});

test("resolver reports unresolved and null targets", () => {
  const resolver = new OfflineLogicalChannelResolver();
  const profile = desiredProfile([]);
  assert.deepEqual(resolver.resolve("missing", profile), {
    requested: "missing",
    status: "unresolved",
  });
  assert.deepEqual(resolver.resolve(null, profile), {
    requested: null,
    status: "not-configured",
  });
});

test("resolver reports deterministic ambiguity for multiple supported name matches", () => {
  const resolution = new OfflineLogicalChannelResolver().resolve(
    "server guide",
    desiredProfile([
      channel("second", "server-guide"),
      channel("first", "Server Guide"),
    ]),
  );
  assert.equal(resolution.status, "ambiguous");
  assert.deepEqual(resolution.candidates?.map((candidate) => candidate.channelKey), ["first", "second"]);
  assert.throws(
    () => validateDocumentTargetResolutions("test-profile", [
      { documentId: "rules", resolution },
    ]),
    /matches multiple supported channels/,
  );
});

test("voice, category, and forum targets are rejected", () => {
  const resolver = new OfflineLogicalChannelResolver();
  const profile = desiredProfile([
    channel("lobby", "Lobby", "GuildVoice", "voice"),
    channel("faq", "faq", "GuildForum"),
  ]);
  const resolutions = [
    resolver.resolve("lobby", profile),
    resolver.resolve("information", profile),
    resolver.resolve("faq", profile),
  ];
  assert.deepEqual(resolutions.map((resolution) => resolution.channelType), ["voice", "category", "forum"]);
  assert.ok(resolutions.every((resolution) => resolution.status === "invalid-target-type"));
  assert.throws(
    () => validateDocumentTargetResolutions(
      "test-profile",
      resolutions.map((resolution, index) => ({ documentId: `doc-${index}`, resolution })),
    ),
    /unsupported destination type/,
  );
});

test("announcement channels are supported destinations", () => {
  const resolution = new OfflineLogicalChannelResolver().resolve(
    "announcements",
    desiredProfile([channel("announcements", "announcements", "GuildNews")]),
  );
  assert.equal(resolution.status, "resolved");
  assert.equal(resolution.channelType, "announcement");
});

test("resolution preserves deterministic document order", () => {
  const documents = [
    { ...document("rules"), key: "rules" as const, order: 10 },
    { ...document(null), key: "welcome" as const, order: 20 },
  ];
  const resolutions = resolveDocumentTargets(
    documents,
    desiredProfile([channel("rules", "rules")]),
  );
  assert.deepEqual(resolutions.map((entry) => entry.documentId), ["rules", "welcome"]);
});

test("resolution is isolated to the selected desired profile", () => {
  const resolver = new OfflineLogicalChannelResolver();
  assert.equal(
    resolver.resolve("rules", desiredProfile([channel("rules", "rules")])).status,
    "resolved",
  );
  assert.equal(resolver.resolve("rules", desiredProfile([])).status, "unresolved");
});

test("WAO and Titanz manifests validate against only their local profiles", async () => {
  const wao = await loadValidatedContentProfile(path.resolve("profiles", "wao-noobs"));
  const titanz = await loadValidatedContentProfile(path.resolve("profiles", "titanz"));
  assert.deepEqual(
    wao.targetResolutions.map((entry) => entry.resolution.status),
    ["resolved", "not-configured", "not-configured", "not-configured", "resolved"],
  );
  assert.equal(wao.targetWarnings.length, 3);
  assert.ok(titanz.targetResolutions.every((entry) => entry.resolution.status === "not-configured"));
  assert.equal(titanz.targetWarnings.length, 5);
});

test("resolution data changes the deterministic plan hash", async () => {
  const parsed = await new DeterministicMarkdownParser().parse(document("rules"));
  const registry: ContentRegistryFile = {
    schemaVersion: 1,
    profile: "test-profile",
    documents: [],
  };
  const planner = new OfflineContentPlanner();
  const resolved = await planner.plan("test-profile", [parsed], registry, {
    manifestHash: "manifest",
    targetResolutions: [{
      documentId: "rules",
      resolution: new OfflineLogicalChannelResolver().resolve(
        "rules",
        desiredProfile([channel("rules", "rules")]),
      ),
    }],
  });
  const unresolved = await planner.plan("test-profile", [parsed], registry, {
    manifestHash: "manifest",
    targetResolutions: [{
      documentId: "rules",
      resolution: { requested: "rules", status: "unresolved" },
    }],
  });
  assert.notEqual(resolved.planHash, unresolved.planHash);
});

test("JSON artifacts contain resolution but no absolute paths or Discord dependencies", async () => {
  const plan = await buildContentPlan(
    path.resolve("profiles", "titanz"),
    "titanz",
    "Titanz",
  );
  const serialized = serializeContentPlanArtifact(
    createContentPlanArtifact(plan, new Date("2026-01-01T00:00:00.000Z")),
  );
  assert.match(serialized, /"targetResolution"/);
  assert.doesNotMatch(serialized, new RegExp(process.cwd().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));

  for (const source of ["channelResolver.ts", "pipeline.ts", "loader.ts", "planner.ts"]) {
    const implementation = await readFile(path.join(__dirname, source), "utf8");
    assert.doesNotMatch(
      implementation,
      /from ["']discord\.js|createDiscordClient|DISCORD_TOKEN|GUILD_ID|\.login\(/,
    );
  }
});
