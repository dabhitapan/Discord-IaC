import type { ContentPlan, ContentTargetResolution } from "./types.js";
import { normalizeLogicalChannelReference } from "./channelResolver.js";
import { canonicalHash } from "../utils/canonicalJson.js";
import type {
  ContentDocumentVerification,
  ContentVerificationReport,
  ContentVerificationStatus,
  LiveChannelIdentity,
  ReadOnlyDiscordGateway,
  ReadOnlyLiveGuild,
} from "./verificationTypes.js";

export interface ContentVerificationRequest {
  gateway: ReadOnlyDiscordGateway;
  configuredGuildId: string;
  plan: ContentPlan;
}

function liveIdentities(guild: ReadOnlyLiveGuild): LiveChannelIdentity[] {
  const categories = new Map(guild.categories.map((category) => [category.id, category.name]));
  return guild.channels
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      type: channel.type,
      categoryId: channel.parentId,
      categoryName: channel.parentId ? (categories.get(channel.parentId) ?? null) : null,
    }))
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

function skippedVerification(
  document: ContentPlan["documents"][number],
  status: ContentVerificationStatus,
  issue: string,
): ContentDocumentVerification {
  return {
    document: document.document,
    status,
    desired: document.targetResolution,
    issue,
  };
}

function verifyResolvedTarget(
  document: ContentPlan["documents"][number],
  liveChannels: readonly LiveChannelIdentity[],
): ContentDocumentVerification {
  const desired = document.targetResolution;
  const desiredName = desired.channelName ?? desired.channelKey ?? desired.requested;
  if (!desiredName) {
    return skippedVerification(document, "skipped", "The local resolution has no channel identity.");
  }
  const normalizedName = normalizeLogicalChannelReference(desiredName);
  const nameMatches = liveChannels.filter(
    (channel) => normalizeLogicalChannelReference(channel.name) === normalizedName,
  );
  if (nameMatches.length === 0) {
    return skippedVerification(document, "live-channel-missing", "No live channel matches the resolved local name.");
  }

  const expectedCategory = desired.categoryName ?? desired.categoryKey;
  let candidates = nameMatches;
  if (expectedCategory) {
    const normalizedCategory = normalizeLogicalChannelReference(expectedCategory);
    const categoryMatches = nameMatches.filter(
      (channel) =>
        channel.categoryName !== null &&
        normalizeLogicalChannelReference(channel.categoryName) === normalizedCategory,
    );
    if (categoryMatches.length === 1) {
      candidates = categoryMatches;
    } else if (categoryMatches.length > 1) {
      return {
        document: document.document,
        status: "live-channel-ambiguous",
        desired,
        candidates: categoryMatches,
        issue: "Multiple live channels match the desired name and category.",
      };
    } else if (nameMatches.length === 1) {
      return {
        document: document.document,
        status: "live-category-mismatch",
        desired,
        live: nameMatches[0],
        issue: "The live channel is under a different category.",
      };
    } else {
      return {
        document: document.document,
        status: "live-channel-ambiguous",
        desired,
        candidates: nameMatches,
        issue: "Multiple live channels match the desired name, but none matches the expected category.",
      };
    }
  } else if (nameMatches.length > 1) {
    return {
      document: document.document,
      status: "live-channel-ambiguous",
      desired,
      candidates: nameMatches,
      issue: "Multiple live channels match the desired name.",
    };
  }

  const live = candidates[0];
  if (!live) {
    return skippedVerification(document, "live-channel-missing", "No live channel candidate remains.");
  }
  if (live.type !== desired.channelType) {
    return {
      document: document.document,
      status: "live-channel-type-mismatch",
      desired,
      live,
      issue: `Expected ${desired.channelType ?? "unknown"}, found ${live.type}.`,
    };
  }
  return { document: document.document, status: "verified", desired, live };
}

function verifyDocument(
  document: ContentPlan["documents"][number],
  liveChannels: readonly LiveChannelIdentity[],
): ContentDocumentVerification {
  const resolution: ContentTargetResolution = document.targetResolution;
  switch (resolution.status) {
    case "not-configured":
      return skippedVerification(
        document,
        "not-configured",
        `No logical target is configured in the ${document.document} manifest entry.`,
      );
    case "resolved":
      return verifyResolvedTarget(document, liveChannels);
    case "unresolved":
      return skippedVerification(
        document,
        "skipped",
        "The configured logical target is unresolved in the selected desired profile.",
      );
    case "ambiguous":
      return skippedVerification(
        document,
        "skipped",
        "The configured logical target is ambiguous in the selected desired profile.",
      );
    case "invalid-target-type":
      return skippedVerification(
        document,
        "skipped",
        "The configured logical target has an unsupported local destination type.",
      );
  }
}

function summary(
  documents: readonly ContentDocumentVerification[],
  errors: readonly string[],
): ContentVerificationReport["summary"] {
  return {
    documents: documents.length,
    verified: documents.filter((document) => document.status === "verified").length,
    notConfigured: documents.filter((document) => document.status === "not-configured").length,
    missing: documents.filter((document) => document.status === "live-channel-missing").length,
    typeMismatches: documents.filter(
      (document) => document.status === "live-channel-type-mismatch",
    ).length,
    categoryMismatches: documents.filter(
      (document) => document.status === "live-category-mismatch",
    ).length,
    ambiguous: documents.filter(
      (document) => document.status === "live-channel-ambiguous",
    ).length,
    skipped: documents.filter((document) => document.status === "skipped").length,
    errors: errors.length,
  };
}

function finalizeReport(
  report: Omit<ContentVerificationReport, "verificationHash" | "summary"> & {
    summary?: ContentVerificationReport["summary"];
  },
): ContentVerificationReport {
  const withSummary = {
    ...report,
    summary: report.summary ?? summary(report.documents, report.errors),
  };
  return { ...withSummary, verificationHash: canonicalHash(withSummary) };
}

function unavailableDocuments(
  plan: ContentPlan,
  status: "guild-mismatch" | "inaccessible",
  issue: string,
): ContentDocumentVerification[] {
  return plan.documents.map((document) =>
    document.targetResolution.status === "not-configured"
      ? skippedVerification(document, "not-configured", "No logical target is configured.")
      : skippedVerification(document, status, issue),
  );
}

export async function verifyContentDestinations(
  request: ContentVerificationRequest,
): Promise<ContentVerificationReport> {
  const safetyStatement = "Verification was read-only. No Discord changes were made." as const;
  let guild: ReadOnlyLiveGuild;
  try {
    guild = await request.gateway.fetchGuild(request.configuredGuildId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const errors = [`Guild is inaccessible: ${message}`];
    return finalizeReport({
      schemaVersion: 1,
      profile: request.plan.profile,
      configuredGuildId: request.configuredGuildId,
      liveGuild: null,
      guildStatus: "inaccessible",
      documents: unavailableDocuments(request.plan, "inaccessible", "Guild access failed."),
      warnings: request.plan.documents
        .filter((document) => document.targetResolution.status === "not-configured")
        .map((document) => `${document.document}: target is not configured.`),
      errors,
      safetyStatement,
    });
  }

  const guildMatches =
    guild.id === request.configuredGuildId &&
    normalizeLogicalChannelReference(guild.name) ===
      normalizeLogicalChannelReference(request.plan.profile.name);
  if (!guildMatches) {
    const errors = [
      `Live guild ${JSON.stringify(guild.name)} (${guild.id}) does not match configured guild ${
        request.configuredGuildId
      } and profile ${JSON.stringify(request.plan.profile.name)}.`,
    ];
    return finalizeReport({
      schemaVersion: 1,
      profile: request.plan.profile,
      configuredGuildId: request.configuredGuildId,
      liveGuild: { id: guild.id, name: guild.name },
      guildStatus: "guild-mismatch",
      documents: unavailableDocuments(request.plan, "guild-mismatch", "Guild identity mismatch."),
      warnings: request.plan.documents
        .filter((document) => document.targetResolution.status === "not-configured")
        .map((document) => `${document.document}: target is not configured.`),
      errors,
      safetyStatement,
    });
  }

  const documents = request.plan.documents.map((document) =>
    verifyDocument(document, liveIdentities(guild)),
  );
  const warnings = documents
    .filter((document) => document.status === "not-configured")
    .map((document) => `${document.document}: target is not configured.`);
  const errors = documents
    .filter(
      (document) => document.status !== "verified" && document.status !== "not-configured",
    )
    .map((document) => `${document.document}: ${document.issue ?? document.status}`);
  return finalizeReport({
    schemaVersion: 1,
    profile: request.plan.profile,
    configuredGuildId: request.configuredGuildId,
    liveGuild: { id: guild.id, name: guild.name },
    guildStatus: "verified",
    documents,
    warnings,
    errors,
    safetyStatement,
  });
}

export function contentVerificationFailed(report: ContentVerificationReport): boolean {
  return report.guildStatus !== "verified" || report.errors.length > 0;
}
