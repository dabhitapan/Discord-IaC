import type { LogicalChannelResolver } from "./contracts.js";
import type {
  ContentDestinationType,
  ContentDocument,
  ContentTargetCandidate,
  ContentTargetResolution,
  ContentWarning,
  DocumentTargetResolution,
} from "./types.js";
import type {
  DesiredCategory,
  DesiredChannel,
  DesiredChannelType,
  DesiredProfile,
} from "../planner/types.js";

export function normalizeLogicalChannelReference(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "-");
}

function destinationType(type: DesiredChannelType): ContentDestinationType {
  switch (type) {
    case "GuildText":
      return "text";
    case "GuildNews":
      return "announcement";
    case "GuildForum":
      return "forum";
    case "GuildVoice":
      return "voice";
  }
}

function compareCandidates(left: ContentTargetCandidate, right: ContentTargetCandidate): number {
  const leftKey = `${left.channelKey ?? left.categoryKey}:${left.channelName ?? left.categoryName}:${left.channelType}`;
  const rightKey = `${right.channelKey ?? right.categoryKey}:${right.channelName ?? right.categoryName}:${right.channelType}`;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function channelCandidate(
  channel: DesiredChannel,
  categories: ReadonlyMap<string, DesiredCategory>,
): ContentTargetCandidate {
  const category = categories.get(channel.categoryKey);
  return {
    channelKey: channel.key,
    channelName: channel.name,
    channelType: destinationType(channel.type),
    categoryKey: channel.categoryKey,
    ...(category ? { categoryName: category.name } : {}),
  };
}

function categoryCandidate(category: DesiredCategory): ContentTargetCandidate {
  return {
    channelType: "category",
    categoryKey: category.key,
    categoryName: category.name,
  };
}

function resolutionFromCandidates(
  requested: string,
  candidates: readonly ContentTargetCandidate[],
): ContentTargetResolution {
  const ordered = [...candidates].sort(compareCandidates);
  const supported = ordered.filter(
    (candidate) => candidate.channelType === "text" || candidate.channelType === "announcement",
  );
  if (supported.length === 1) {
    return { requested, status: "resolved", ...supported[0] };
  }
  if (supported.length > 1) {
    return { requested, status: "ambiguous", candidates: supported };
  }
  if (ordered.length === 1) {
    return { requested, status: "invalid-target-type", ...ordered[0] };
  }
  if (ordered.length > 1) {
    return { requested, status: "invalid-target-type", candidates: ordered };
  }
  return { requested, status: "unresolved" };
}

export class OfflineLogicalChannelResolver implements LogicalChannelResolver {
  resolve(requested: string | null, profile: DesiredProfile): ContentTargetResolution {
    if (requested === null) return { requested: null, status: "not-configured" };

    const categories = new Map(profile.categories.map((category) => [category.key, category]));
    const exactChannels = profile.channels.filter((channel) => channel.key === requested);
    if (exactChannels.length > 0) {
      return resolutionFromCandidates(
        requested,
        exactChannels.map((channel) => channelCandidate(channel, categories)),
      );
    }
    const exactCategories = profile.categories.filter((category) => category.key === requested);
    if (exactCategories.length > 0) {
      return resolutionFromCandidates(requested, exactCategories.map(categoryCandidate));
    }

    const normalized = normalizeLogicalChannelReference(requested);
    const normalizedChannels = profile.channels.filter(
      (channel) =>
        normalizeLogicalChannelReference(channel.key) === normalized ||
        normalizeLogicalChannelReference(channel.name) === normalized,
    );
    if (normalizedChannels.length > 0) {
      return resolutionFromCandidates(
        requested,
        normalizedChannels.map((channel) => channelCandidate(channel, categories)),
      );
    }
    const normalizedCategories = profile.categories.filter(
      (category) =>
        normalizeLogicalChannelReference(category.key) === normalized ||
        normalizeLogicalChannelReference(category.name) === normalized,
    );
    return resolutionFromCandidates(requested, normalizedCategories.map(categoryCandidate));
  }
}

export class ContentTargetValidationError extends Error {
  constructor(
    readonly profileKey: string,
    readonly validationErrors: readonly string[],
  ) {
    super(
      `Content target validation failed for profile ${JSON.stringify(profileKey)}:\n${validationErrors
        .map((error) => `- ${error}`)
        .join("\n")}`,
    );
    this.name = "ContentTargetValidationError";
  }
}

export function resolveDocumentTargets(
  documents: readonly ContentDocument[],
  profile: DesiredProfile,
  resolver: LogicalChannelResolver = new OfflineLogicalChannelResolver(),
): DocumentTargetResolution[] {
  return documents.map((document) => ({
    documentId: document.key,
    resolution: resolver.resolve(document.targetChannel, profile),
  }));
}

export function validateDocumentTargetResolutions(
  profileKey: string,
  resolutions: readonly DocumentTargetResolution[],
): ContentWarning[] {
  const errors: string[] = [];
  const warnings: ContentWarning[] = [];
  for (const { documentId, resolution } of resolutions) {
    switch (resolution.status) {
      case "resolved":
        break;
      case "not-configured":
        warnings.push({
          code: "missing-target-channel",
          documentId,
          message: "Target channel has not been configured.",
        });
        break;
      case "unresolved":
        warnings.push({
          code: "unresolved-target-channel",
          documentId,
          message: `No matching channel for ${JSON.stringify(resolution.requested)} in the selected profile.`,
        });
        break;
      case "ambiguous":
        errors.push(
          `document ${JSON.stringify(documentId)}, field "targetChannel": ${JSON.stringify(
            resolution.requested,
          )} matches multiple supported channels.`,
        );
        break;
      case "invalid-target-type": {
        const types = resolution.channelType
          ? [resolution.channelType]
          : [...new Set(resolution.candidates?.map((candidate) => candidate.channelType) ?? [])];
        errors.push(
          `document ${JSON.stringify(documentId)}, field "targetChannel": ${JSON.stringify(
            resolution.requested,
          )} resolves to unsupported destination type ${types.join(", ") || "unknown"}.`,
        );
        break;
      }
    }
  }
  if (errors.length > 0) throw new ContentTargetValidationError(profileKey, errors);
  return warnings;
}
