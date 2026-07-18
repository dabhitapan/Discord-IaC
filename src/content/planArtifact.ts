import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ContentPlan, ContentPlanArtifact } from "./types.js";
import { canonicalHash, prettyCanonicalJson } from "../utils/canonicalJson.js";

export function calculateContentPlanHash(
  plan: Omit<ContentPlan, "planHash"> | ContentPlan | ContentPlanArtifact,
): string {
  const {
    planHash: _ignoredHash,
    generatedAt: _ignoredTimestamp,
    ...meaningfulPlan
  } = plan as ContentPlanArtifact;
  return canonicalHash(meaningfulPlan);
}

export function createContentPlanArtifact(
  plan: ContentPlan,
  generatedAt = new Date(),
): ContentPlanArtifact {
  return { ...plan, generatedAt: generatedAt.toISOString() };
}

export function serializeContentPlanArtifact(artifact: ContentPlanArtifact): string {
  return prettyCanonicalJson(artifact);
}

export async function writeContentPlanArtifact(
  outputPath: string,
  artifact: ContentPlanArtifact,
): Promise<string> {
  const resolvedPath = path.resolve(outputPath);
  await mkdir(path.dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, serializeContentPlanArtifact(artifact), "utf8");
  return resolvedPath;
}
