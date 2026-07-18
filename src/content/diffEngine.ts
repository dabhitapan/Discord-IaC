import type { ContentDiffEngine } from "./contracts.js";
import type {
  ContentDocumentChange,
  ContentRegistryFile,
  ParsedContent,
} from "./types.js";

function compareDocuments(left: ParsedContent, right: ParsedContent): number {
  const leftKey = `${left.language}:${left.key}`;
  const rightKey = `${right.language}:${right.key}`;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

export class OfflineContentDiffEngine implements ContentDiffEngine {
  async diff(
    profileKey: string,
    documents: readonly ParsedContent[],
    registry: ContentRegistryFile,
  ): Promise<readonly ContentDocumentChange[]> {
    if (registry.profile !== profileKey) {
      throw new Error(
        `Registry profile ${JSON.stringify(registry.profile)} does not match ${JSON.stringify(profileKey)}.`,
      );
    }

    const current = new Map(
      registry.documents.map((document) => [
        `${document.language}:${document.document}`,
        document,
      ]),
    );

    return [...documents].sort(compareDocuments).map((document) => {
      const registryDocument = current.get(`${document.language}:${document.key}`);
      return {
        action: registryDocument
          ? registryDocument.hash === document.documentHash
            ? "unchanged"
            : "update"
          : "create",
        document: document.key,
        language: document.language,
        currentHash: registryDocument?.hash ?? null,
        desiredHash: document.documentHash,
        blocks: document.blocks,
      };
    });
  }
}
