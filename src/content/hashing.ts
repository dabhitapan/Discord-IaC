import { createHash } from "node:crypto";

export function normalizeMarkdown(markdown: string): string {
  return markdown.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

export function contentHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
