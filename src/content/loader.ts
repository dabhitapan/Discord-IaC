import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ContentLoader } from "./contracts.js";
import type { ContentDocument } from "./types.js";
import { CONTENT_CONFIGURATION } from "./config.js";
import { normalizeMarkdown } from "./hashing.js";

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export class FileContentLoader implements ContentLoader {
  async load(profileDirectory: string): Promise<readonly ContentDocument[]> {
    const sourceDirectory = path.join(
      profileDirectory,
      CONTENT_CONFIGURATION.sourceDirectory,
    );
    let entries;
    try {
      entries = await readdir(sourceDirectory, { withFileTypes: true });
    } catch (error) {
      throw new Error(`Could not load English content from ${sourceDirectory}.`, {
        cause: error,
      });
    }

    const profileKey = path.basename(profileDirectory);
    const filenames = entries
      .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".md")
      .map((entry) => entry.name)
      .sort(compareNames);

    return Promise.all(
      filenames.map(async (filename): Promise<ContentDocument> => {
        const sourcePath = path.join(sourceDirectory, filename);
        return {
          profileKey,
          key: path.basename(filename, path.extname(filename)),
          language: CONTENT_CONFIGURATION.sourceLanguage,
          sourcePath,
          markdown: normalizeMarkdown(await readFile(sourcePath, "utf8")),
        };
      }),
    );
  }
}
