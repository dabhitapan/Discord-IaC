import type { ContentPlan } from "./types.js";

function formatResolution(
  resolution: ContentPlan["documents"][number]["targetResolution"],
): string {
  switch (resolution.status) {
    case "resolved":
      return `#${resolution.channelName ?? resolution.channelKey}${
        resolution.categoryName || resolution.categoryKey
          ? ` in ${resolution.categoryName ?? resolution.categoryKey}`
          : ""
      }`;
    case "not-configured":
      return "not configured";
    case "unresolved":
      return "no matching channel in selected profile";
    case "ambiguous":
      return "multiple matching channels in selected profile";
    case "invalid-target-type":
      return `unsupported ${resolution.channelType ?? "channel"} destination`;
  }
}

export function formatContentPlan(plan: ContentPlan, profileName: string, mode: "plan" | "diff"): string {
  const title = mode === "plan" ? "Content plan" : "Content diff";
  const documentLines = plan.documents.flatMap((document) => {
    const hasWarning = document.warnings.length > 0;
    const lines = [
      `[${hasWarning ? "WARNING" : document.action.toUpperCase()}] ${document.document}`,
      ...(hasWarning ? [`  action: ${document.action}`] : []),
      `  file: ${document.sourceFile}`,
      `  channel: ${document.targetChannel ?? "not configured"}`,
      `  resolution: ${formatResolution(document.targetResolution)}`,
      `  pinned: ${document.pinned ? "yes" : "no"}`,
      `  languages: ${document.requestedLanguages.join(", ")}`,
      `  blocks: ${document.blockCount}`,
      ...document.warnings.map((warning) => `  warning: ${warning.message}`),
      "",
    ];
    return lines;
  });
  const generalWarnings = plan.warnings.filter(
    (warning) => warning.code !== "missing-target-channel",
  );
  const lines = [
    `${title} for: ${profileName}`,
    "",
    "Documents",
    "",
    ...documentLines,
    ...(generalWarnings.length > 0
      ? [
          "Warnings",
          "",
          ...generalWarnings.map((warning) => `[WARNING] ${warning.message}`),
          "",
        ]
      : []),
    "Summary",
    "",
    `documents: ${plan.summary.documents}`,
    `blocks: ${plan.summary.blocks}`,
    `resolved targets: ${plan.summary.resolvedTargets}`,
    `unresolved targets: ${plan.summary.unresolvedTargets}`,
    `not configured: ${plan.summary.notConfigured}`,
    `ambiguous targets: ${plan.summary.ambiguousTargets}`,
    `invalid targets: ${plan.summary.invalidTargets}`,
    `create: ${plan.summary.create}`,
    `update: ${plan.summary.update}`,
    `unchanged: ${plan.summary.unchanged}`,
    `warnings: ${plan.summary.warnings}`,
    "",
    `Plan hash: ${plan.planHash}`,
    "",
    plan.safetyStatement,
  ];
  return `${lines.join("\n")}\n`;
}
