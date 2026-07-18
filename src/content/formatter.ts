import type { ContentPlan } from "./types.js";

export function formatContentPlan(plan: ContentPlan, profileName: string, mode: "plan" | "diff"): string {
  const title = mode === "plan" ? "Content plan" : "Content diff";
  const lines = [
    `${title} for: ${profileName}`,
    "",
    "Documents",
    "",
    ...plan.documents.map(
      (document) => `[${document.action.toUpperCase()}] ${document.document}`,
    ),
    "",
    "Summary",
    "",
    `documents: ${plan.summary.documents}`,
    `blocks: ${plan.summary.blocks}`,
    `create: ${plan.summary.create}`,
    `update: ${plan.summary.update}`,
    `unchanged: ${plan.summary.unchanged}`,
    "",
    "No Discord changes were made.",
  ];
  return `${lines.join("\n")}\n`;
}
