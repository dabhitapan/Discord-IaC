import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalHash, prettyCanonicalJson } from "../utils/canonicalJson.js";
import type {
  ContentVerificationArtifact,
  ContentVerificationReport,
} from "./verificationTypes.js";

export function calculateContentVerificationHash(
  report: ContentVerificationReport | ContentVerificationArtifact,
): string {
  const {
    verificationHash: _ignoredHash,
    generatedAt: _ignoredTimestamp,
    ...meaningfulReport
  } = report as ContentVerificationArtifact;
  return canonicalHash(meaningfulReport);
}

export function createContentVerificationArtifact(
  report: ContentVerificationReport,
  generatedAt = new Date(),
): ContentVerificationArtifact {
  return { ...report, generatedAt: generatedAt.toISOString() };
}

export function serializeContentVerificationArtifact(
  artifact: ContentVerificationArtifact,
): string {
  return prettyCanonicalJson(artifact);
}

export async function writeContentVerificationArtifact(
  outputPath: string,
  artifact: ContentVerificationArtifact,
): Promise<string> {
  const resolvedPath = path.resolve(outputPath);
  await mkdir(path.dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, serializeContentVerificationArtifact(artifact), "utf8");
  return resolvedPath;
}
