import type {
  ContentDocumentVerification,
  ContentVerificationReport,
  LiveChannelIdentity,
} from "./verificationTypes.js";

function destination(identity: {
  channelName?: string;
  channelKey?: string;
  categoryName?: string;
  categoryKey?: string;
}): string {
  const channel = identity.channelName ?? identity.channelKey ?? "unknown";
  const category = identity.categoryName ?? identity.categoryKey;
  return `#${channel}${category ? ` in ${category}` : ""}`;
}

function liveDestination(identity: LiveChannelIdentity): string {
  return `#${identity.name}${identity.categoryName ? ` in ${identity.categoryName}` : ""}`;
}

function statusLabel(document: ContentDocumentVerification): string {
  if (document.status === "verified") return "VERIFIED";
  if (document.status === "not-configured") return "NOT CONFIGURED";
  if (document.status === "skipped") return "SKIPPED";
  if (document.status === "guild-mismatch" || document.status === "inaccessible") {
    return "ERROR";
  }
  return "DRIFT";
}

export function formatContentVerification(report: ContentVerificationReport): string {
  const documentLines = report.documents.flatMap((document) => {
    const lines = [`[${statusLabel(document)}] ${document.document}`];
    if (document.desired.status === "resolved") {
      lines.push(`  desired: ${destination(document.desired)}`);
    } else if (document.desired.status === "not-configured") {
      lines.push("  desired: not configured");
    } else {
      lines.push(`  desired: ${document.desired.status}`);
    }
    if (document.live) {
      lines.push(`  live: ${liveDestination(document.live)}`);
      lines.push(`  type: ${document.live.type}`);
    }
    if (document.candidates) {
      lines.push(
        `  candidates: ${document.candidates.map((candidate) => liveDestination(candidate)).join(", ")}`,
      );
    }
    if (document.issue) lines.push(`  issue: ${document.issue}`);
    lines.push("");
    return lines;
  });
  return `${[
    `Content verification for: ${report.profile.name}`,
    "",
    "Guild",
    `  configured ID: ${report.configuredGuildId}`,
    `  live ID: ${report.liveGuild?.id ?? "unavailable"}`,
    `  live name: ${report.liveGuild?.name ?? "unavailable"}`,
    `  status: ${report.guildStatus}`,
    "",
    "Documents",
    "",
    ...documentLines,
    "Summary",
    "",
    `documents: ${report.summary.documents}`,
    `verified: ${report.summary.verified}`,
    `not configured: ${report.summary.notConfigured}`,
    `missing: ${report.summary.missing}`,
    `type mismatches: ${report.summary.typeMismatches}`,
    `category mismatches: ${report.summary.categoryMismatches}`,
    `ambiguous: ${report.summary.ambiguous}`,
    `skipped: ${report.summary.skipped}`,
    `errors: ${report.summary.errors}`,
    "",
    `Verification hash: ${report.verificationHash}`,
    "",
    report.safetyStatement,
  ].join("\n")}\n`;
}
