import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { CONTENT_CONFIGURATION } from "./config.js";
import type {
  ContentLanguage,
  ContentManifest,
  ContentManifestDocument,
} from "./types.js";
import { canonicalHash } from "../utils/canonicalJson.js";

export const CONTENT_MANIFEST_FILENAME = "content.json";

const supportedLanguages = new Set<ContentLanguage>([
  CONTENT_CONFIGURATION.sourceLanguage,
  ...CONTENT_CONFIGURATION.translationLanguages,
]);

export class ContentManifestValidationError extends Error {
  constructor(
    readonly profileKey: string,
    readonly validationErrors: readonly string[],
  ) {
    super(
      `Content manifest validation failed for profile ${JSON.stringify(profileKey)}:\n${validationErrors
        .map((error) => `- ${error}`)
        .join("\n")}`,
    );
    this.name = "ContentManifestValidationError";
  }
}

function issue(documentId: string, field: string, reason: string): string {
  return `document ${JSON.stringify(documentId)}, field ${JSON.stringify(field)}: ${reason}`;
}

function safeFileSegments(file: unknown): string[] | null {
  if (typeof file !== "string" || !file.trim()) return null;
  if (file.includes("\\") || path.posix.isAbsolute(file)) return null;
  const segments = file.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
  if (segments[0] !== "english" || path.posix.extname(file).toLowerCase() !== ".md") return null;
  return segments;
}

function validateDocumentShape(
  value: unknown,
  index: number,
  errors: string[],
): ContentManifestDocument | null {
  const candidate = value && typeof value === "object"
    ? (value as Partial<ContentManifestDocument>)
    : {};
  const documentId = typeof candidate.id === "string" && candidate.id
    ? candidate.id
    : `<index:${index}>`;

  if (typeof candidate.id !== "string" || !/^[a-z0-9][a-z0-9_-]*$/.test(candidate.id)) {
    errors.push(issue(documentId, "id", "must be a non-empty lowercase logical ID."));
  }
  if (!safeFileSegments(candidate.file)) {
    errors.push(
      issue(
        documentId,
        "file",
        "must be a traversal-free relative Markdown path beneath english/ using forward slashes.",
      ),
    );
  }
  if (!Number.isInteger(candidate.order)) {
    errors.push(issue(documentId, "order", "must be an integer."));
  }
  if (typeof candidate.enabled !== "boolean") {
    errors.push(issue(documentId, "enabled", "must be a boolean."));
  }
  if (typeof candidate.pinned !== "boolean") {
    errors.push(issue(documentId, "pinned", "must be a boolean."));
  }
  if (
    candidate.targetChannel !== null &&
    (typeof candidate.targetChannel !== "string" || !candidate.targetChannel.trim())
  ) {
    errors.push(issue(documentId, "targetChannel", "must be a non-empty string or null."));
  }
  if (!Array.isArray(candidate.languages) || candidate.languages.length === 0) {
    errors.push(issue(documentId, "languages", "must contain at least one supported language code."));
  } else {
    const seenLanguages = new Set<string>();
    for (const language of candidate.languages) {
      if (typeof language !== "string" || !supportedLanguages.has(language as ContentLanguage)) {
        errors.push(issue(documentId, "languages", `unsupported language ${JSON.stringify(language)}.`));
      } else if (seenLanguages.has(language)) {
        errors.push(issue(documentId, "languages", `contains duplicate language ${JSON.stringify(language)}.`));
      }
      if (typeof language === "string") seenLanguages.add(language);
    }
    if (!candidate.languages.includes(CONTENT_CONFIGURATION.sourceLanguage)) {
      errors.push(
        issue(
          documentId,
          "languages",
          `must include source language ${JSON.stringify(CONTENT_CONFIGURATION.sourceLanguage)}.`,
        ),
      );
    }
  }

  return candidate as ContentManifestDocument;
}

async function validateFiles(
  profileKey: string,
  contentDirectory: string,
  documents: readonly ContentManifestDocument[],
  errors: string[],
): Promise<void> {
  let resolvedContentDirectory: string;
  try {
    resolvedContentDirectory = await realpath(contentDirectory);
  } catch (error) {
    throw new Error(`Could not resolve content directory for profile ${JSON.stringify(profileKey)}.`, {
      cause: error,
    });
  }

  await Promise.all(
    documents.map(async (document) => {
      const segments = safeFileSegments(document.file);
      if (!segments) return;
      const filePath = path.join(contentDirectory, ...segments);
      try {
        const fileStats = await stat(filePath);
        if (!fileStats.isFile()) {
          errors.push(issue(document.id, "file", `${JSON.stringify(document.file)} is not a file.`));
          return;
        }
        const resolvedFile = await realpath(filePath);
        const relative = path.relative(resolvedContentDirectory, resolvedFile);
        if (relative.startsWith("..") || path.isAbsolute(relative)) {
          errors.push(issue(document.id, "file", "resolved path escapes the profile content directory."));
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          errors.push(
            issue(document.id, "file", `referenced Markdown file does not exist: ${document.file}.`),
          );
          return;
        }
        errors.push(issue(document.id, "file", `could not inspect ${document.file}.`));
      }
    }),
  );
}

export async function loadContentManifest(profileDirectory: string): Promise<{
  manifest: ContentManifest;
  hash: string;
}> {
  const profileKey = path.basename(profileDirectory);
  const contentDirectory = path.join(profileDirectory, "content");
  const manifestPath = path.join(contentDirectory, CONTENT_MANIFEST_FILENAME);
  let value: unknown;
  try {
    value = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Could not load content manifest for profile ${JSON.stringify(profileKey)} from ${manifestPath}.`,
      { cause: error },
    );
  }

  const errors: string[] = [];
  const candidate = value && typeof value === "object"
    ? (value as Partial<ContentManifest>)
    : {};
  if (candidate.version !== 1) {
    errors.push('document "<manifest>", field "version": must be 1.');
  }
  if (candidate.sourceLanguage !== CONTENT_CONFIGURATION.sourceLanguage) {
    errors.push(
      `document "<manifest>", field "sourceLanguage": must be ${JSON.stringify(
        CONTENT_CONFIGURATION.sourceLanguage,
      )}.`,
    );
  }
  if (!Array.isArray(candidate.documents)) {
    errors.push('document "<manifest>", field "documents": must be an array.');
  }

  const documents = Array.isArray(candidate.documents)
    ? candidate.documents
        .map((document, index) => validateDocumentShape(document, index, errors))
        .filter((document): document is ContentManifestDocument => document !== null)
    : [];
  const seenIds = new Map<string, string>();
  const seenFiles = new Map<string, string>();
  const seenOrders = new Map<number, string>();
  for (const document of documents) {
    const normalizedId = String(document.id).toLowerCase();
    if (seenIds.has(normalizedId)) {
      errors.push(issue(String(document.id), "id", `duplicates document ${JSON.stringify(seenIds.get(normalizedId))}.`));
    } else {
      seenIds.set(normalizedId, String(document.id));
    }
    if (typeof document.file === "string") {
      const normalizedFile = document.file.toLowerCase();
      if (seenFiles.has(normalizedFile)) {
        errors.push(
          issue(String(document.id), "file", `duplicates file used by ${JSON.stringify(seenFiles.get(normalizedFile))}.`),
        );
      } else {
        seenFiles.set(normalizedFile, String(document.id));
      }
    }
    if (Number.isInteger(document.order)) {
      if (seenOrders.has(document.order)) {
        errors.push(
          issue(String(document.id), "order", `duplicates order used by ${JSON.stringify(seenOrders.get(document.order))}.`),
        );
      } else {
        seenOrders.set(document.order, String(document.id));
      }
    }
  }
  if (!documents.some((document) => document.enabled === true)) {
    errors.push('document "<manifest>", field "documents": at least one document must be enabled.');
  }

  await validateFiles(profileKey, contentDirectory, documents, errors);
  if (errors.length > 0) throw new ContentManifestValidationError(profileKey, errors);

  const manifest = candidate as ContentManifest;
  return { manifest, hash: canonicalHash(manifest) };
}
