import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FileContentLoader } from "./loader.js";
import { DeterministicMarkdownParser } from "./markdownParser.js";
import { OfflineContentDiffEngine } from "./diffEngine.js";
import { OfflineContentPlanner } from "./planner.js";
import { FileContentRegistry, registryFromDocuments } from "./registry.js";
import { formatContentPlan } from "./formatter.js";
import type { ContentDocument, ContentRegistryFile } from "./types.js";

const markdown = [
  "# Rules",
  "",
  "A paragraph with **formatting**.",
  "It continues here.",
  "",
  "- First",
  "- Second",
  "",
  "> Keep this quote.",
  "> On two lines.",
  "",
  "---",
  "",
  "```ts",
  "const preserved = true;",
  "```",
  "",
].join("\n");

function sourceDocument(value = markdown): ContentDocument {
  return {
    profileKey: "test-profile",
    key: "rules",
    language: "en",
    sourcePath: "rules.md",
    sourceFile: "english/rules.md",
    requestedLanguages: ["en"],
    targetChannel: "rules",
    order: 10,
    pinned: true,
    enabled: true,
    markdown: value,
  };
}

test("Markdown parsing preserves constructs with stable block IDs", async () => {
  const parser = new DeterministicMarkdownParser();
  const first = await parser.parse(sourceDocument());
  const second = await parser.parse(sourceDocument());

  assert.deepEqual(first, second);
  assert.deepEqual(
    first.blocks.map((block) => block.key),
    ["block-1", "block-2", "block-3", "block-4", "block-5", "block-6"],
  );
  assert.deepEqual(
    first.blocks.map((block) => block.kind),
    ["heading", "paragraph", "list", "quote", "horizontal-rule", "code"],
  );
  assert.equal(first.blocks[1]?.markdown, "A paragraph with **formatting**.\nIt continues here.");
  assert.equal(first.blocks[5]?.markdown, "```ts\nconst preserved = true;\n```");
});

test("block and document hashes are deterministic SHA256 values", async () => {
  const parser = new DeterministicMarkdownParser();
  const parsed = await parser.parse(sourceDocument());
  const expectedDocumentHash = createHash("sha256").update(markdown).digest("hex");
  const expectedBlockHash = createHash("sha256").update("# Rules").digest("hex");

  assert.equal(parsed.documentHash, expectedDocumentHash);
  assert.equal(parsed.blocks[0]?.hash, expectedBlockHash);
  assert.equal(parsed.documentHash.length, 64);
  assert.notEqual(
    parsed.documentHash,
    (await parser.parse(sourceDocument(`${markdown}Changed\n`))).documentHash,
  );
});

test("content loader loads declared English Markdown files in deterministic order", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "discord-iac-content-loader-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const english = path.join(directory, "content", "english");
  await mkdir(english, { recursive: true });
  await writeFile(path.join(english, "welcome.md"), "Welcome\r\n", "utf8");
  await writeFile(path.join(english, "faq.md"), "FAQ\n", "utf8");
  await writeFile(path.join(english, "ignored.txt"), "Ignored", "utf8");
  await writeFile(
    path.join(directory, "content", "content.json"),
    JSON.stringify({
      version: 1,
      sourceLanguage: "en",
      documents: [
        {
          id: "faq",
          file: "english/faq.md",
          targetChannel: "faq",
          order: 10,
          enabled: true,
          pinned: false,
          languages: ["en"],
        },
        {
          id: "welcome",
          file: "english/welcome.md",
          targetChannel: null,
          order: 20,
          enabled: true,
          pinned: false,
          languages: ["en"],
        },
      ],
    }),
    "utf8",
  );

  const documents = await new FileContentLoader().load(directory);
  assert.deepEqual(documents.map((document) => document.key), ["faq", "welcome"]);
  assert.equal(documents[1]?.markdown, "Welcome\n");
});

test("planner reports create, update, and unchanged documents from local state", async () => {
  const parser = new DeterministicMarkdownParser();
  const parsed = await parser.parse(sourceDocument());
  const planner = new OfflineContentPlanner();
  const empty: ContentRegistryFile = {
    schemaVersion: 1,
    profile: "test-profile",
    documents: [],
  };
  const createPlan = await planner.plan("test-profile", [parsed], empty);
  assert.deepEqual(createPlan.summary, {
    documents: 1,
    blocks: 6,
    create: 1,
    update: 0,
    unchanged: 0,
    warnings: 1,
    resolvedTargets: 0,
    unresolvedTargets: 1,
    notConfigured: 0,
    ambiguousTargets: 0,
    invalidTargets: 0,
  });

  const matching = registryFromDocuments("test-profile", [parsed]);
  const unchangedPlan = await planner.plan("test-profile", [parsed], matching);
  assert.equal(unchangedPlan.documents[0]?.action, "unchanged");

  const stale: ContentRegistryFile = {
    ...matching,
    documents: matching.documents.map((document) => ({ ...document, hash: "stale" })),
  };
  const updatePlan = await planner.plan("test-profile", [parsed], stale);
  assert.equal(updatePlan.documents[0]?.action, "update");
});

test("diff compares desired document hashes with the local registry", async () => {
  const parser = new DeterministicMarkdownParser();
  const current = await parser.parse(sourceDocument());
  const changed = await parser.parse(sourceDocument(`${markdown}Changed\n`));
  const registry = registryFromDocuments("test-profile", [current]);
  const diff = new OfflineContentDiffEngine();

  assert.equal((await diff.diff("test-profile", [current], registry))[0]?.action, "unchanged");
  assert.equal((await diff.diff("test-profile", [changed], registry))[0]?.action, "update");
  assert.equal(
    (
      await diff.diff("test-profile", [current], {
        schemaVersion: 1,
        profile: "test-profile",
        documents: [],
      })
    )[0]?.action,
    "create",
  );
});

test("local registry round-trips deterministically without Discord message IDs", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "discord-iac-content-registry-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const parsed = await new DeterministicMarkdownParser().parse(sourceDocument());
  const registryValue = registryFromDocuments("test-profile", [parsed]);
  const registry = new FileContentRegistry(directory);

  assert.deepEqual(await registry.load("test-profile"), {
    schemaVersion: 1,
    profile: "test-profile",
    documents: [],
  });
  await registry.save(registryValue);
  const firstWrite = await readFile(registry.filePath, "utf8");
  await registry.save(registryValue);
  const secondWrite = await readFile(registry.filePath, "utf8");

  assert.equal(firstWrite, secondWrite);
  assert.deepEqual(await registry.load("test-profile"), registryValue);
  assert.doesNotMatch(firstWrite, /messageId|channelId/);
});

test("planning and formatting are repeatable", async () => {
  const parsed = await new DeterministicMarkdownParser().parse(sourceDocument());
  const registry: ContentRegistryFile = {
    schemaVersion: 1,
    profile: "test-profile",
    documents: [],
  };
  const planner = new OfflineContentPlanner();
  const first = await planner.plan("test-profile", [parsed], registry);
  const second = await planner.plan("test-profile", [parsed], registry);

  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(
    formatContentPlan(first, "Test Profile", "plan"),
    formatContentPlan(second, "Test Profile", "plan"),
  );
});
