import { FileContentLoader } from "./loader.js";
import { DeterministicMarkdownParser } from "./markdownParser.js";
import { OfflineContentPlanner } from "./planner.js";
import { FileContentRegistry } from "./registry.js";
import type { ContentPlan } from "./types.js";
import { loadProfile } from "../config/profileLoader.js";
import {
  resolveDocumentTargets,
  validateDocumentTargetResolutions,
} from "./channelResolver.js";

export async function loadValidatedContentProfile(profileDirectory: string) {
  const loader = new FileContentLoader();
  const [loaded, desiredProfile] = await Promise.all([
    loader.loadProfile(profileDirectory),
    loadProfile(profileDirectory),
  ]);
  const targetResolutions = resolveDocumentTargets(loaded.documents, desiredProfile);
  const targetWarnings = validateDocumentTargetResolutions(
    desiredProfile.metadata.key,
    targetResolutions,
  );
  return { loaded, desiredProfile, targetResolutions, targetWarnings };
}

export async function buildContentPlan(
  profileDirectory: string,
  profileKey: string,
  profileName = profileKey,
): Promise<ContentPlan> {
  const parser = new DeterministicMarkdownParser();
  const registry = new FileContentRegistry(profileDirectory);
  const planner = new OfflineContentPlanner();

  const { loaded, targetResolutions } = await loadValidatedContentProfile(profileDirectory);
  const parsedDocuments = await Promise.all(
    loaded.documents.map((document) => parser.parse(document)),
  );
  const registryState = await registry.loadState(profileKey);
  return planner.plan(profileKey, parsedDocuments, registryState.registry, {
    profileName,
    manifestHash: loaded.manifestHash,
    registryHash: registryState.hash,
    warnings: loaded.warnings,
    declaredDocumentIds: loaded.manifest.documents.map((document) => document.id),
    targetResolutions,
  });
}
