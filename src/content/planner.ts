import type { Planner } from "./contracts.js";
import type { ContentPlan, ContentRegistryFile, ParsedContent } from "./types.js";
import { OfflineContentDiffEngine } from "./diffEngine.js";

export class OfflineContentPlanner implements Planner {
  constructor(private readonly diffEngine = new OfflineContentDiffEngine()) {}

  async plan(
    profileKey: string,
    documents: readonly ParsedContent[],
    registry: ContentRegistryFile,
  ): Promise<ContentPlan> {
    const changes = await this.diffEngine.diff(profileKey, documents, registry);
    return {
      schemaVersion: 1,
      profileKey,
      documents: changes,
      summary: {
        documents: changes.length,
        blocks: changes.reduce((total, document) => total + document.blocks.length, 0),
        create: changes.filter((document) => document.action === "create").length,
        update: changes.filter((document) => document.action === "update").length,
        unchanged: changes.filter((document) => document.action === "unchanged").length,
      },
    };
  }
}
