import type { Planner } from "./contracts.js";
import type {
  ContentPlan,
  ContentPlanningContext,
  ContentRegistryFile,
  ContentWarning,
  ParsedContent,
} from "./types.js";
import { OfflineContentDiffEngine } from "./diffEngine.js";
import { canonicalHash } from "../utils/canonicalJson.js";
import { calculateContentPlanHash } from "./planArtifact.js";

export class OfflineContentPlanner implements Planner {
  constructor(private readonly diffEngine = new OfflineContentDiffEngine()) {}

  async plan(
    profileKey: string,
    documents: readonly ParsedContent[],
    registry: ContentRegistryFile,
    context: ContentPlanningContext = {},
  ): Promise<ContentPlan> {
    const changes = await this.diffEngine.diff(
      profileKey,
      documents,
      registry,
      context.targetResolutions,
    );
    const declaredDocumentIds = new Set(
      (context.declaredDocumentIds ?? documents.map((document) => document.key)).map(String),
    );
    const orphanWarnings: ContentWarning[] = registry.documents
      .filter((document) => !declaredDocumentIds.has(String(document.document)))
      .map((document) => ({
        code: "orphaned-registry-entry",
        documentId: document.document,
        message: `Registry entry ${document.document} is not declared in content.json and will not be changed.`,
      }));
    const warnings = [
      ...(context.warnings ?? []),
      ...changes.flatMap((document) => document.warnings),
      ...orphanWarnings,
    ];
    const planWithoutHash: Omit<ContentPlan, "planHash"> = {
      schemaVersion: 1,
      profile: { key: profileKey, name: context.profileName ?? profileKey },
      manifestHash: context.manifestHash ?? canonicalHash(documents),
      registryHash:
        context.registryHash !== undefined
          ? context.registryHash
          : registry.documents.length > 0
            ? canonicalHash(registry)
            : null,
      documents: changes,
      summary: {
        documents: changes.length,
        blocks: changes.reduce((total, document) => total + document.blocks.length, 0),
        create: changes.filter((document) => document.action === "create").length,
        update: changes.filter((document) => document.action === "update").length,
        unchanged: changes.filter((document) => document.action === "unchanged").length,
        warnings: warnings.length,
        resolvedTargets: changes.filter(
          (document) => document.targetResolution.status === "resolved",
        ).length,
        unresolvedTargets: changes.filter(
          (document) => document.targetResolution.status === "unresolved",
        ).length,
        notConfigured: changes.filter(
          (document) => document.targetResolution.status === "not-configured",
        ).length,
        ambiguousTargets: changes.filter(
          (document) => document.targetResolution.status === "ambiguous",
        ).length,
        invalidTargets: changes.filter(
          (document) => document.targetResolution.status === "invalid-target-type",
        ).length,
      },
      warnings,
      safetyStatement: "No Discord changes were made.",
    };
    return { ...planWithoutHash, planHash: calculateContentPlanHash(planWithoutHash) };
  }
}
