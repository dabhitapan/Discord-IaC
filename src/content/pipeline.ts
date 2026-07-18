import { FileContentLoader } from "./loader.js";
import { DeterministicMarkdownParser } from "./markdownParser.js";
import { OfflineContentPlanner } from "./planner.js";
import { FileContentRegistry } from "./registry.js";
import type { ContentPlan } from "./types.js";

export async function buildContentPlan(
  profileDirectory: string,
  profileKey: string,
): Promise<ContentPlan> {
  const loader = new FileContentLoader();
  const parser = new DeterministicMarkdownParser();
  const registry = new FileContentRegistry(profileDirectory);
  const planner = new OfflineContentPlanner();

  const documents = await loader.load(profileDirectory);
  const parsedDocuments = await Promise.all(
    documents.map((document) => parser.parse(document)),
  );
  const currentRegistry = await registry.load(profileKey);
  return planner.plan(profileKey, parsedDocuments, currentRegistry);
}
