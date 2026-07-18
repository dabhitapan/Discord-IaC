import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ContentRegistry } from "./contracts.js";
import type {
  ContentRegistryDocument,
  ContentRegistryFile,
  ContentRegistryState,
  ParsedContent,
} from "./types.js";
import { canonicalHash, prettyCanonicalJson } from "../utils/canonicalJson.js";

export const CONTENT_REGISTRY_FILENAME = ".content-registry.json";

function emptyRegistry(profileKey: string): ContentRegistryFile {
  return { schemaVersion: 1, profile: profileKey, documents: [] };
}

function validateRegistry(value: unknown, profileKey: string): ContentRegistryFile {
  if (!value || typeof value !== "object") throw new Error("Registry must be an object.");
  const candidate = value as Partial<ContentRegistryFile>;
  if (candidate.schemaVersion !== 1) throw new Error("Registry schemaVersion must be 1.");
  if (candidate.profile !== profileKey) {
    throw new Error(
      `Registry profile ${JSON.stringify(candidate.profile)} does not match ${JSON.stringify(profileKey)}.`,
    );
  }
  if (!Array.isArray(candidate.documents)) throw new Error("Registry documents must be an array.");

  const seenDocuments = new Set<string>();
  for (const document of candidate.documents) {
    if (!document || typeof document !== "object") throw new Error("Invalid registry document.");
    const key = `${document.language}:${document.document}`;
    if (!document.document || !document.language || !document.hash || !Array.isArray(document.blocks)) {
      throw new Error(`Invalid registry document ${JSON.stringify(document.document)}.`);
    }
    if (seenDocuments.has(key)) throw new Error(`Duplicate registry document ${JSON.stringify(key)}.`);
    seenDocuments.add(key);
    const seenBlocks = new Set<string>();
    for (const block of document.blocks) {
      if (!block?.id || !block.hash) throw new Error(`Invalid block in registry document ${key}.`);
      if (seenBlocks.has(block.id)) throw new Error(`Duplicate block ${block.id} in ${key}.`);
      seenBlocks.add(block.id);
    }
  }
  return candidate as ContentRegistryFile;
}

export function registryFromDocuments(
  profileKey: string,
  documents: readonly ParsedContent[],
): ContentRegistryFile {
  const registryDocuments: ContentRegistryDocument[] = documents
    .map((document) => ({
      document: document.key,
      language: document.language,
      hash: document.documentHash,
      blocks: document.blocks.map((block) => ({ id: block.key, hash: block.hash })),
    }))
    .sort((left, right) => {
      const leftKey = `${left.language}:${left.document}`;
      const rightKey = `${right.language}:${right.document}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
  return { schemaVersion: 1, profile: profileKey, documents: registryDocuments };
}

export class FileContentRegistry implements ContentRegistry {
  readonly filePath: string;

  constructor(profileDirectory: string) {
    this.filePath = path.join(profileDirectory, "content", CONTENT_REGISTRY_FILENAME);
  }

  async load(profileKey: string): Promise<ContentRegistryFile> {
    return (await this.loadState(profileKey)).registry;
  }

  async loadState(profileKey: string): Promise<ContentRegistryState> {
    try {
      const value: unknown = JSON.parse(await readFile(this.filePath, "utf8"));
      const registry = validateRegistry(value, profileKey);
      return { registry, hash: canonicalHash(registry) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { registry: emptyRegistry(profileKey), hash: null };
      }
      throw new Error(`Could not load content registry from ${this.filePath}.`, { cause: error });
    }
  }

  async save(registry: ContentRegistryFile): Promise<void> {
    const validated = validateRegistry(registry, registry.profile);
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    try {
      await writeFile(temporaryPath, prettyCanonicalJson(validated), "utf8");
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      throw new Error(`Could not save content registry to ${this.filePath}.`, { cause: error });
    }
  }
}
