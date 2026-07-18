import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ContentProfileLoader } from "./contracts.js";
import type { ContentDocument, ContentLoadResult, ContentWarning } from "./types.js";
import { normalizeMarkdown } from "./hashing.js";
import { loadContentManifest } from "./manifest.js";

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function findMarkdownFiles(directory: string, prefix = "english"): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries.sort((left, right) => compareNames(left.name, right.name))) {
    const relative = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      results.push(...(await findMarkdownFiles(path.join(directory, entry.name), relative)));
    } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".md") {
      results.push(relative);
    }
  }
  return results;
}

export class FileContentLoader implements ContentProfileLoader {
  async load(profileDirectory: string): Promise<readonly ContentDocument[]> {
    return (await this.loadProfile(profileDirectory)).documents;
  }

  async loadProfile(profileDirectory: string): Promise<ContentLoadResult> {
    const profileKey = path.basename(profileDirectory);
    const { manifest, hash: manifestHash } = await loadContentManifest(profileDirectory);
    const contentDirectory = path.join(profileDirectory, "content");
    const enabled = manifest.documents
      .filter((document) => document.enabled)
      .sort((left, right) => left.order - right.order || compareNames(String(left.id), String(right.id)));
    const documents = await Promise.all(
      enabled.map(async (entry): Promise<ContentDocument> => {
        const sourcePath = path.join(contentDirectory, ...entry.file.split("/"));
        return {
          profileKey,
          key: entry.id,
          language: manifest.sourceLanguage,
          sourcePath,
          sourceFile: entry.file,
          requestedLanguages: entry.languages,
          targetChannel: entry.targetChannel,
          order: entry.order,
          pinned: entry.pinned,
          enabled: entry.enabled,
          markdown: normalizeMarkdown(await readFile(sourcePath, "utf8")),
        };
      }),
    );

    const declaredFiles = new Set(manifest.documents.map((document) => document.file.toLowerCase()));
    const undeclared = await findMarkdownFiles(path.join(contentDirectory, "english"));
    const warnings: ContentWarning[] = undeclared
      .filter((file) => !declaredFiles.has(file.toLowerCase()))
      .map((file) => ({
        code: "undeclared-markdown",
        message: `Markdown file ${file} is not declared in content.json and will not be planned.`,
      }));

    return { manifest, manifestHash, documents, warnings };
  }
}
