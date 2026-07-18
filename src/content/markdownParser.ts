import type { MarkdownParser } from "./contracts.js";
import { contentHash, normalizeMarkdown } from "./hashing.js";
import type {
  ContentBlock,
  ContentBlockKind,
  ContentDocument,
  ParsedContent,
} from "./types.js";

const headingPattern = /^ {0,3}#{1,6}(?:\s+|$)/;
const listPattern = /^\s*(?:[-+*]|\d+[.)])\s+/;
const quotePattern = /^ {0,3}>/;
const horizontalRulePattern = /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;
const fencePattern = /^ {0,3}(`{3,}|~{3,})/;

function lineKind(line: string): ContentBlockKind | null {
  if (headingPattern.test(line)) return "heading";
  if (horizontalRulePattern.test(line)) return "horizontal-rule";
  if (fencePattern.test(line)) return "code";
  if (quotePattern.test(line)) return "quote";
  if (listPattern.test(line)) return "list";
  return null;
}

function isBlank(line: string): boolean {
  return /^\s*$/.test(line);
}

function isFenceClose(line: string, marker: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.length >= marker.length &&
    [...trimmed].every((character) => character === marker[0])
  );
}

function parseBlocks(markdown: string): ContentBlock[] {
  const lines = markdown.split("\n");
  const rawBlocks: Array<{ kind: ContentBlockKind; markdown: string }> = [];
  let index = 0;

  while (index < lines.length) {
    if (isBlank(lines[index] ?? "")) {
      index += 1;
      continue;
    }

    const firstLine = lines[index] ?? "";
    const detectedKind = lineKind(firstLine);
    const kind = detectedKind ?? "paragraph";
    const blockLines = [firstLine];
    index += 1;

    if (kind === "code") {
      const marker = fencePattern.exec(firstLine)?.[1] ?? "```";
      while (index < lines.length) {
        const line = lines[index] ?? "";
        blockLines.push(line);
        index += 1;
        if (isFenceClose(line, marker)) break;
      }
    } else if (kind === "heading" || kind === "horizontal-rule") {
      // These Markdown constructs are always standalone blocks.
    } else {
      while (index < lines.length) {
        const line = lines[index] ?? "";
        if (isBlank(line)) break;
        const nextKind = lineKind(line);
        if (nextKind && nextKind !== kind) break;
        if (kind === "paragraph" && nextKind) break;
        blockLines.push(line);
        index += 1;
      }
    }

    rawBlocks.push({ kind, markdown: blockLines.join("\n") });
  }

  return rawBlocks.map((block, blockIndex) => ({
    key: `block-${blockIndex + 1}`,
    kind: block.kind,
    markdown: block.markdown,
    hash: contentHash(block.markdown),
  }));
}

export class DeterministicMarkdownParser implements MarkdownParser {
  async parse(document: ContentDocument): Promise<ParsedContent> {
    const markdown = normalizeMarkdown(document.markdown);
    return {
      profileKey: document.profileKey,
      key: document.key,
      language: document.language,
      sourceFile: document.sourceFile,
      requestedLanguages: document.requestedLanguages,
      targetChannel: document.targetChannel,
      order: document.order,
      pinned: document.pinned,
      enabled: document.enabled,
      documentHash: contentHash(markdown),
      blocks: parseBlocks(markdown),
    };
  }
}
