import type { ContentDiffEngine } from "./contracts.js";
import type {
  ContentDocumentChange,
  ContentTargetResolution,
  ContentWarning,
  DocumentTargetResolution,
  ContentRegistryFile,
  ParsedContent,
} from "./types.js";
import { CONTENT_CONFIGURATION } from "./config.js";

function compareDocuments(left: ParsedContent, right: ParsedContent): number {
  if (left.order !== right.order) return left.order - right.order;
  return left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
}

function warningForResolution(
  documentId: ParsedContent["key"],
  resolution: ContentTargetResolution,
): ContentWarning[] {
  switch (resolution.status) {
    case "resolved":
      return [];
    case "not-configured":
      return [{
        code: "missing-target-channel",
        documentId,
        message: "Target channel has not been configured.",
      }];
    case "unresolved":
      return [{
        code: "unresolved-target-channel",
        documentId,
        message: `No matching channel for ${JSON.stringify(resolution.requested)} in the selected profile.`,
      }];
    case "ambiguous":
      return [{
        code: "ambiguous-target-channel",
        documentId,
        message: `Target ${JSON.stringify(resolution.requested)} matches multiple channels.`,
      }];
    case "invalid-target-type":
      return [{
        code: "invalid-target-type",
        documentId,
        message: `Target ${JSON.stringify(resolution.requested)} has an unsupported destination type.`,
      }];
  }
}

export class OfflineContentDiffEngine implements ContentDiffEngine {
  async diff(
    profileKey: string,
    documents: readonly ParsedContent[],
    registry: ContentRegistryFile,
    targetResolutions: readonly DocumentTargetResolution[] = [],
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
    const resolutions = new Map(
      targetResolutions.map((entry) => [String(entry.documentId), entry.resolution]),
    );

    return [...documents].sort(compareDocuments).map((document) => {
      const registryDocument = current.get(`${document.language}:${document.key}`);
      const targetResolution = resolutions.get(String(document.key)) ??
        (document.targetChannel === null
          ? { requested: null, status: "not-configured" as const }
          : { requested: document.targetChannel, status: "unresolved" as const });
      const warnings = warningForResolution(document.key, targetResolution);
      return {
        action: registryDocument
          ? registryDocument.hash === document.documentHash
            ? "unchanged"
            : "update"
          : "create",
        document: document.key,
        sourceFile: document.sourceFile,
        sourceLanguage: CONTENT_CONFIGURATION.sourceLanguage,
        requestedLanguages: document.requestedLanguages,
        targetChannel: document.targetChannel,
        order: document.order,
        pinned: document.pinned,
        enabled: document.enabled,
        language: document.language,
        currentHash: registryDocument?.hash ?? null,
        desiredHash: document.documentHash,
        blockCount: document.blocks.length,
        blocks: document.blocks,
        warnings,
        targetResolution,
      };
    });
  }
}
