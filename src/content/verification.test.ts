import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import type { ContentDocumentChange, ContentPlan, ContentTargetResolution } from "./types.js";
import type {
  ReadOnlyDiscordGateway,
  ReadOnlyLiveGuild,
} from "./verificationTypes.js";
import {
  contentVerificationFailed,
  verifyContentDestinations,
} from "./verificationEngine.js";
import {
  calculateContentVerificationHash,
  createContentVerificationArtifact,
  serializeContentVerificationArtifact,
} from "./verificationArtifact.js";
import {
  ContentVerificationConfigurationError,
  getContentVerificationEnvironment,
} from "./verificationConfig.js";
import { DiscordJsReadOnlyContentGateway } from "./readOnlyDiscordGateway.js";
import { buildContentPlan } from "./pipeline.js";

class FakeReadOnlyGateway implements ReadOnlyDiscordGateway {
  calls = 0;

  constructor(
    private readonly guild: ReadOnlyLiveGuild | Error,
  ) {}

  async fetchGuild(_guildId: string): Promise<ReadOnlyLiveGuild> {
    this.calls += 1;
    if (this.guild instanceof Error) throw this.guild;
    return this.guild;
  }
}

function resolved(
  overrides: Partial<ContentTargetResolution> = {},
): ContentTargetResolution {
  return {
    requested: "rules",
    status: "resolved",
    channelKey: "rules",
    channelName: "rules",
    channelType: "text",
    categoryKey: "information",
    categoryName: "Information",
    ...overrides,
  };
}

function documentPlan(
  document: string,
  targetResolution: ContentTargetResolution,
  order = 10,
): ContentDocumentChange {
  return {
    action: "create",
    document,
    sourceFile: `english/${document}.md`,
    sourceLanguage: "en",
    requestedLanguages: ["en"],
    targetChannel: targetResolution.requested,
    order,
    pinned: false,
    enabled: true,
    language: "en",
    currentHash: null,
    desiredHash: "hash",
    blockCount: 1,
    blocks: [{ key: "block-1", kind: "heading", markdown: "# Test", hash: "hash" }],
    warnings: [],
    targetResolution,
  };
}

function plan(
  documents: readonly ContentDocumentChange[] = [documentPlan("rules", resolved())],
  profile = { key: "test-profile", name: "Test Guild" },
): ContentPlan {
  return {
    schemaVersion: 1,
    profile,
    manifestHash: "manifest",
    registryHash: null,
    documents,
    summary: {
      documents: documents.length,
      blocks: documents.length,
      create: documents.length,
      update: 0,
      unchanged: 0,
      warnings: 0,
      resolvedTargets: documents.filter((entry) => entry.targetResolution.status === "resolved").length,
      unresolvedTargets: 0,
      notConfigured: documents.filter((entry) => entry.targetResolution.status === "not-configured").length,
      ambiguousTargets: 0,
      invalidTargets: 0,
    },
    warnings: [],
    safetyStatement: "No Discord changes were made.",
    planHash: "plan",
  };
}

function guild(
  channels: ReadOnlyLiveGuild["channels"] = [
    { id: "channel-1", name: "rules", type: "text", parentId: "category-1" },
  ],
  overrides: Partial<ReadOnlyLiveGuild> = {},
): ReadOnlyLiveGuild {
  return {
    id: "guild-1",
    name: "Test Guild",
    categories: [{ id: "category-1", name: "Information" }],
    channels,
    ...overrides,
  };
}

async function verify(
  contentPlan = plan(),
  liveGuild: ReadOnlyLiveGuild | Error = guild(),
) {
  const gateway = new FakeReadOnlyGateway(liveGuild);
  const report = await verifyContentDestinations({
    gateway,
    configuredGuildId: "guild-1",
    plan: contentPlan,
  });
  return { report, gateway };
}

test("verification configuration reports missing token and guild ID", () => {
  assert.throws(
    () => getContentVerificationEnvironment({}),
    (error: Error) => error instanceof ContentVerificationConfigurationError &&
      /DISCORD_TOKEN and GUILD_ID/.test(error.message),
  );
  assert.throws(
    () => getContentVerificationEnvironment({ GUILD_ID: "guild-1" }),
    /requires DISCORD_TOKEN/,
  );
  assert.throws(
    () => getContentVerificationEnvironment({ DISCORD_TOKEN: "secret" }),
    /requires GUILD_ID/,
  );
});

test("inaccessible guild produces a deterministic failure report", async () => {
  const { report, gateway } = await verify(plan(), new Error("access denied"));
  assert.equal(gateway.calls, 1);
  assert.equal(report.guildStatus, "inaccessible");
  assert.equal(report.documents[0]?.status, "inaccessible");
  assert.equal(contentVerificationFailed(report), true);
});

test("correct guild and text channel verify", async () => {
  const { report } = await verify();
  assert.equal(report.guildStatus, "verified");
  assert.equal(report.documents[0]?.status, "verified");
  assert.equal(report.summary.verified, 1);
  assert.equal(contentVerificationFailed(report), false);
});

test("guild ID or selected-profile name mismatch fails verification", async () => {
  const idMismatch = await verify(plan(), guild([], { id: "different" }));
  assert.equal(idMismatch.report.guildStatus, "guild-mismatch");
  const profileMismatch = await verify(
    plan(undefined, { key: "other", name: "Other Guild" }),
    guild(),
  );
  assert.equal(profileMismatch.report.guildStatus, "guild-mismatch");
});

test("announcement channels verify with the expected type", async () => {
  const announcementPlan = plan([
    documentPlan("announcements", resolved({
      requested: "announcements",
      channelKey: "announcements",
      channelName: "announcements",
      channelType: "announcement",
    })),
  ]);
  const { report } = await verify(
    announcementPlan,
    guild([{ id: "news", name: "announcements", type: "announcement", parentId: "category-1" }]),
  );
  assert.equal(report.documents[0]?.status, "verified");
});

test("missing live channel is reported as drift", async () => {
  const { report } = await verify(plan(), guild([]));
  assert.equal(report.documents[0]?.status, "live-channel-missing");
  assert.equal(report.summary.missing, 1);
  assert.equal(contentVerificationFailed(report), true);
});

test("live channel type mismatch is reported as drift", async () => {
  const { report } = await verify(
    plan(),
    guild([{ id: "channel-1", name: "rules", type: "forum", parentId: "category-1" }]),
  );
  assert.equal(report.documents[0]?.status, "live-channel-type-mismatch");
  assert.equal(report.summary.typeMismatches, 1);
});

test("live category mismatch is reported as drift", async () => {
  const { report } = await verify(
    plan(),
    guild(
      [{ id: "channel-1", name: "rules", type: "text", parentId: "category-2" }],
      { categories: [{ id: "category-2", name: "General" }] },
    ),
  );
  assert.equal(report.documents[0]?.status, "live-category-mismatch");
  assert.equal(report.summary.categoryMismatches, 1);
});

test("multiple live channels without a unique category match are ambiguous", async () => {
  const { report } = await verify(
    plan(),
    guild([
      { id: "one", name: "rules", type: "text", parentId: null },
      { id: "two", name: "Rules", type: "text", parentId: null },
    ]),
  );
  assert.equal(report.documents[0]?.status, "live-channel-ambiguous");
  assert.deepEqual(report.documents[0]?.candidates?.map((candidate) => candidate.id), ["one", "two"]);
});

test("null targets are warnings and do not fail an otherwise valid verification", async () => {
  const notConfigured = plan([
    documentPlan("welcome", { requested: null, status: "not-configured" }),
  ]);
  const { report } = await verify(notConfigured, guild([]));
  assert.equal(report.documents[0]?.status, "not-configured");
  assert.equal(report.summary.notConfigured, 1);
  assert.equal(contentVerificationFailed(report), false);
});

test("unresolved local targets are explicitly skipped and fail verification", async () => {
  const unresolved = plan([
    documentPlan("rules", { requested: "rules", status: "unresolved" }),
  ]);
  const { report } = await verify(unresolved);
  assert.equal(report.documents[0]?.status, "skipped");
  assert.match(report.documents[0]?.issue ?? "", /unresolved/);
  assert.equal(contentVerificationFailed(report), true);
});

test("live matching is normalized but never fuzzy", async () => {
  const normalized = await verify(
    plan([documentPlan("rules", resolved({ channelName: "Server Guide" }))]),
    guild([{ id: "guide", name: " server-guide ", type: "text", parentId: "category-1" }]),
  );
  assert.equal(normalized.report.documents[0]?.status, "verified");

  const fuzzy = await verify(
    plan([documentPlan("rules", resolved({ channelName: "guide" }))]),
    guild([{ id: "guide", name: "beginner-guide", type: "text", parentId: "category-1" }]),
  );
  assert.equal(fuzzy.report.documents[0]?.status, "live-channel-missing");
});

test("document result ordering follows the selected profile plan", async () => {
  const orderedPlan = plan([
    documentPlan("events", resolved({ requested: "events", channelName: "events" }), 10),
    documentPlan("welcome", { requested: null, status: "not-configured" }, 20),
  ]);
  const { report } = await verify(
    orderedPlan,
    guild([{ id: "events", name: "events", type: "text", parentId: "category-1" }]),
  );
  assert.deepEqual(report.documents.map((document) => document.document), ["events", "welcome"]);
});

test("verification hash is deterministic and excludes artifact timestamps", async () => {
  const first = (await verify()).report;
  const second = (await verify()).report;
  assert.equal(first.verificationHash, second.verificationHash);
  const january = createContentVerificationArtifact(first, new Date("2026-01-01T00:00:00.000Z"));
  const february = createContentVerificationArtifact(first, new Date("2026-02-01T00:00:00.000Z"));
  assert.notEqual(january.generatedAt, february.generatedAt);
  assert.equal(calculateContentVerificationHash(january), calculateContentVerificationHash(february));
  assert.equal(calculateContentVerificationHash(january), first.verificationHash);
});

test("reports contain no token or absolute paths", async () => {
  const secret = "never-serialize-this-token";
  getContentVerificationEnvironment({ DISCORD_TOKEN: secret, GUILD_ID: "guild-1" });
  const artifact = createContentVerificationArtifact((await verify()).report);
  const serialized = serializeContentVerificationArtifact(artifact);
  assert.doesNotMatch(serialized, new RegExp(secret));
  assert.doesNotMatch(serialized, /[A-Z]:[\\/]/i);
  assert.doesNotMatch(serialized, /\\\\[^\\]+\\/);
  assert.doesNotMatch(
    serialized,
    new RegExp(process.cwd().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
  );
});

test("verification has no registry, profile, or manifest write path", async () => {
  for (const source of [
    "verificationEngine.ts",
    "verificationCommand.ts",
    "readOnlyDiscordGateway.ts",
  ]) {
    const implementation = await readFile(path.join(__dirname, source), "utf8");
    assert.doesNotMatch(
      implementation,
      /writeFile|rename|\.save\(|profiles?[\\/].*content|content-registry/,
    );
  }
});

test("gateway surface exposes no Discord write methods", () => {
  const methods = Object.getOwnPropertyNames(DiscordJsReadOnlyContentGateway.prototype).sort();
  assert.deepEqual(methods, ["connect", "constructor", "disconnect", "fetchGuild"]);
  assert.ok(
    methods.every((method) => !/create|edit|delete|send|pin|react|position|parent|permission|thread/i.test(method)),
  );
});

test("offline content planning requires no Discord credentials", async () => {
  const previousToken = process.env.DISCORD_TOKEN;
  const previousGuild = process.env.GUILD_ID;
  try {
    delete process.env.DISCORD_TOKEN;
    delete process.env.GUILD_ID;
    const offlinePlan = await buildContentPlan(
      path.resolve("profiles", "titanz"),
      "titanz",
      "Titanz",
    );
    assert.equal(offlinePlan.documents.length, 5);
  } finally {
    if (previousToken === undefined) delete process.env.DISCORD_TOKEN;
    else process.env.DISCORD_TOKEN = previousToken;
    if (previousGuild === undefined) delete process.env.GUILD_ID;
    else process.env.GUILD_ID = previousGuild;
  }
});
