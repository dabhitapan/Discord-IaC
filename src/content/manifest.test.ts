import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { FileContentLoader } from "./loader.js";
import { loadContentManifest } from "./manifest.js";
import { DeterministicMarkdownParser } from "./markdownParser.js";
import { OfflineContentPlanner } from "./planner.js";
import { registryFromDocuments } from "./registry.js";
import { buildContentPlan } from "./pipeline.js";
import {
  calculateContentPlanHash,
  createContentPlanArtifact,
  serializeContentPlanArtifact,
} from "./planArtifact.js";
import type { ContentManifestDocument, ContentRegistryFile } from "./types.js";

function manifestDocument(
  overrides: Partial<ContentManifestDocument> = {},
): ContentManifestDocument {
  return {
    id: "rules",
    file: "english/rules.md",
    targetChannel: "rules",
    order: 10,
    enabled: true,
    pinned: true,
    languages: ["en"],
    ...overrides,
  };
}

async function createProfile(
  context: TestContext,
  documents: readonly unknown[] = [manifestDocument()],
): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "discord-iac-manifest-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const profileDirectory = path.join(root, "test-profile");
  const english = path.join(profileDirectory, "content", "english");
  await mkdir(english, { recursive: true });
  await writeFile(path.join(english, "rules.md"), "# Rules\n\nBe kind.\n", "utf8");
  await writeFile(path.join(english, "faq.md"), "# FAQ\n", "utf8");
  await writeFile(path.join(english, "welcome.md"), "# Welcome\n", "utf8");
  await writeFile(
    path.join(profileDirectory, "profile.json"),
    JSON.stringify({ key: "test-profile", name: "Test Profile", version: 1 }),
    "utf8",
  );
  await writeFile(path.join(profileDirectory, "roles.json"), "[]", "utf8");
  await writeFile(
    path.join(profileDirectory, "categories.json"),
    JSON.stringify([{ key: "information", name: "Information" }]),
    "utf8",
  );
  await writeFile(
    path.join(profileDirectory, "channels.json"),
    JSON.stringify([
      {
        key: "rules",
        name: "rules",
        type: "GuildText",
        categoryKey: "information",
      },
    ]),
    "utf8",
  );
  await writeFile(path.join(profileDirectory, "permission-rules.json"), "[]", "utf8");
  await writeFile(
    path.join(profileDirectory, "content", "content.json"),
    JSON.stringify({ version: 1, sourceLanguage: "en", documents }, null, 2),
    "utf8",
  );
  return profileDirectory;
}

async function rewriteManifest(profileDirectory: string, value: unknown): Promise<void> {
  await writeFile(
    path.join(profileDirectory, "content", "content.json"),
    JSON.stringify(value, null, 2),
    "utf8",
  );
}

test("valid manifest loads enabled documents and produces a deterministic hash", async (context) => {
  const profile = await createProfile(context);
  const first = await loadContentManifest(profile);
  const second = await loadContentManifest(profile);
  const loaded = await new FileContentLoader().loadProfile(profile);

  assert.equal(first.hash, second.hash);
  assert.equal(first.hash.length, 64);
  assert.equal(loaded.documents.length, 1);
  assert.equal(loaded.documents[0]?.sourceFile, "english/rules.md");
});

test("manifest rejects duplicate document IDs and duplicate files", async (context) => {
  const profile = await createProfile(context, [
    manifestDocument(),
    manifestDocument({ id: "rules", file: "english/faq.md", order: 20 }),
    manifestDocument({ id: "faq", order: 30 }),
  ]);
  await assert.rejects(
    loadContentManifest(profile),
    (error: Error) => /field "id": duplicates document/.test(error.message) &&
      /field "file": duplicates file/.test(error.message),
  );
});

test("manifest rejects duplicate order values", async (context) => {
  const profile = await createProfile(context, [
    manifestDocument(),
    manifestDocument({ id: "faq", file: "english/faq.md" }),
  ]);
  await assert.rejects(loadContentManifest(profile), /field "order": duplicates order/);
});

test("manifest rejects unsupported languages", async (context) => {
  const profile = await createProfile(context, [
    manifestDocument({ languages: ["en", "xx" as "en"] }),
  ]);
  await assert.rejects(loadContentManifest(profile), /unsupported language "xx"/);
});

test("manifest rejects missing Markdown files", async (context) => {
  const profile = await createProfile(context, [
    manifestDocument({ file: "english/missing.md" }),
  ]);
  await assert.rejects(loadContentManifest(profile), /referenced Markdown file does not exist/);
});

test("manifest rejects path traversal", async (context) => {
  const profile = await createProfile(context, [
    manifestDocument({ file: "english/../outside.md" }),
  ]);
  await assert.rejects(loadContentManifest(profile), /traversal-free relative Markdown path/);
});

test("disabled documents are ignored and enabled documents follow manifest order", async (context) => {
  const profile = await createProfile(context, [
    manifestDocument({ id: "welcome", file: "english/welcome.md", order: 30 }),
    manifestDocument({ id: "rules", order: 20 }),
    manifestDocument({ id: "faq", file: "english/faq.md", order: 10, enabled: false }),
  ]);
  const loaded = await new FileContentLoader().loadProfile(profile);
  assert.deepEqual(loaded.documents.map((document) => document.key), ["rules", "welcome"]);
});

test("undeclared Markdown files produce warnings and are not planned", async (context) => {
  const profile = await createProfile(context);
  const loaded = await new FileContentLoader().loadProfile(profile);
  assert.deepEqual(loaded.documents.map((document) => document.key), ["rules"]);
  assert.deepEqual(
    loaded.warnings.map((warning) => warning.code),
    ["undeclared-markdown", "undeclared-markdown"],
  );
});

test("missing targets and orphaned registry entries produce non-destructive warnings", async (context) => {
  const profile = await createProfile(context, [manifestDocument({ targetChannel: null })]);
  const loaded = await new FileContentLoader().loadProfile(profile);
  const parser = new DeterministicMarkdownParser();
  const parsed = await Promise.all(loaded.documents.map((document) => parser.parse(document)));
  const registry = registryFromDocuments("test-profile", parsed);
  const orphaned: ContentRegistryFile = {
    ...registry,
    documents: [
      ...registry.documents,
      { document: "old-guide", language: "en", hash: "old", blocks: [] },
    ],
  };
  const plan = await new OfflineContentPlanner().plan("test-profile", parsed, orphaned, {
    profileName: "Test Profile",
    manifestHash: loaded.manifestHash,
    warnings: loaded.warnings,
    declaredDocumentIds: loaded.manifest.documents.map((document) => document.id),
  });

  assert.ok(plan.warnings.some((warning) => warning.code === "missing-target-channel"));
  assert.ok(plan.warnings.some((warning) => warning.code === "orphaned-registry-entry"));
  assert.equal(plan.documents.length, 1);
});

test("plan hashes and artifact serialization are deterministic and exclude timestamps", async (context) => {
  const profile = await createProfile(context);
  const firstPlan = await buildContentPlan(profile, "test-profile", "Test Profile");
  const secondPlan = await buildContentPlan(profile, "test-profile", "Test Profile");
  assert.deepEqual(firstPlan, secondPlan);
  assert.equal(firstPlan.planHash, secondPlan.planHash);

  const firstArtifact = createContentPlanArtifact(firstPlan, new Date("2026-01-01T00:00:00.000Z"));
  const secondArtifact = createContentPlanArtifact(firstPlan, new Date("2026-02-01T00:00:00.000Z"));
  assert.notEqual(firstArtifact.generatedAt, secondArtifact.generatedAt);
  assert.equal(calculateContentPlanHash(firstArtifact), calculateContentPlanHash(secondArtifact));
  assert.equal(calculateContentPlanHash(firstArtifact), firstPlan.planHash);
  assert.equal(serializeContentPlanArtifact(firstArtifact), serializeContentPlanArtifact(firstArtifact));
  const serialized = JSON.parse(serializeContentPlanArtifact(firstArtifact)) as Record<string, unknown>;
  assert.equal(serialized.planHash, firstPlan.planHash);
  assert.equal(serialized.safetyStatement, "No Discord changes were made.");
});

test("manifest hash ignores JSON formatting and object key order", async (context) => {
  const profile = await createProfile(context);
  const firstHash = (await loadContentManifest(profile)).hash;
  await rewriteManifest(profile, {
    documents: [
      {
        languages: ["en"],
        pinned: true,
        enabled: true,
        order: 10,
        targetChannel: "rules",
        file: "english/rules.md",
        id: "rules",
      },
    ],
    sourceLanguage: "en",
    version: 1,
  });
  assert.equal((await loadContentManifest(profile)).hash, firstHash);
});

test("Windows and Unix line endings produce identical content hashes", async () => {
  const parser = new DeterministicMarkdownParser();
  const base = {
    profileKey: "test-profile",
    key: "rules" as const,
    language: "en" as const,
    sourcePath: "rules.md",
    sourceFile: "english/rules.md",
    requestedLanguages: ["en" as const],
    targetChannel: "rules",
    order: 10,
    pinned: true,
    enabled: true,
  };
  const unix = await parser.parse({ ...base, markdown: "# Rules\n\nBe kind.\n" });
  const windows = await parser.parse({ ...base, markdown: "# Rules\r\n\r\nBe kind.\r\n" });
  assert.equal(unix.documentHash, windows.documentHash);
  assert.deepEqual(unix.blocks, windows.blocks);
});
