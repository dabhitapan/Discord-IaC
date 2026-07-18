export type SourceLanguage = "en";

export type TranslationLanguage =
  | "fr"
  | "de"
  | "es"
  | "pt"
  | "tr"
  | "ru"
  | "zh";

export type ContentLanguage = SourceLanguage | TranslationLanguage;

export type ContentKey =
  | "rules"
  | "faq"
  | "welcome"
  | "beginner-guide"
  | "events"
  | (string & {});

export interface ContentConfiguration {
  schemaVersion: 1;
  sourceLanguage: SourceLanguage;
  translationLanguages: readonly TranslationLanguage[];
  sourceDirectory: string;
  translationsDirectory: string;
}

export interface ContentDocument {
  profileKey: string;
  key: ContentKey;
  language: ContentLanguage;
  sourcePath: string;
  sourceFile: string;
  requestedLanguages: readonly ContentLanguage[];
  targetChannel: string | null;
  order: number;
  pinned: boolean;
  enabled: boolean;
  markdown: string;
}

export interface ParsedContent {
  profileKey: string;
  key: ContentKey;
  language: ContentLanguage;
  sourceFile: string;
  requestedLanguages: readonly ContentLanguage[];
  targetChannel: string | null;
  order: number;
  pinned: boolean;
  enabled: boolean;
  documentHash: string;
  blocks: readonly ContentBlock[];
}

export interface ContentBlock {
  key: string;
  kind: ContentBlockKind;
  markdown: string;
  hash: string;
}

export type ContentBlockKind =
  | "heading"
  | "paragraph"
  | "list"
  | "code"
  | "quote"
  | "horizontal-rule";

export interface TranslationRequest {
  document: ContentDocument;
  targetLanguage: TranslationLanguage;
}

export interface ContentMessageIdentity {
  profileKey: string;
  contentKey: ContentKey;
  blockKey: string;
  language: ContentLanguage;
}

export interface MessageRegistryEntry extends ContentMessageIdentity {
  channelId: string;
  messageId: string;
  contentHash: string;
}

export interface ContentRegistryBlock {
  id: string;
  hash: string;
}

export interface ContentRegistryDocument {
  document: ContentKey;
  language: ContentLanguage;
  hash: string;
  blocks: readonly ContentRegistryBlock[];
}

export interface ContentRegistryFile {
  schemaVersion: 1;
  profile: string;
  documents: readonly ContentRegistryDocument[];
}

export interface ContentManifestDocument {
  id: ContentKey;
  file: string;
  targetChannel: string | null;
  order: number;
  enabled: boolean;
  pinned: boolean;
  languages: readonly ContentLanguage[];
}

export interface ContentManifest {
  version: 1;
  sourceLanguage: SourceLanguage;
  documents: readonly ContentManifestDocument[];
}

export type ContentWarningCode =
  | "missing-target-channel"
  | "unresolved-target-channel"
  | "ambiguous-target-channel"
  | "invalid-target-type"
  | "undeclared-markdown"
  | "orphaned-registry-entry";

export interface ContentWarning {
  code: ContentWarningCode;
  documentId?: ContentKey;
  message: string;
}

export interface ContentLoadResult {
  manifest: ContentManifest;
  manifestHash: string;
  documents: readonly ContentDocument[];
  warnings: readonly ContentWarning[];
}

export interface ContentRegistryState {
  registry: ContentRegistryFile;
  hash: string | null;
}

export type ContentTargetResolutionStatus =
  | "resolved"
  | "unresolved"
  | "ambiguous"
  | "invalid-target-type"
  | "not-configured";

export type ContentDestinationType =
  | "text"
  | "announcement"
  | "forum"
  | "voice"
  | "category";

export interface ContentTargetCandidate {
  channelKey?: string;
  channelName?: string;
  channelType: ContentDestinationType;
  categoryKey?: string;
  categoryName?: string;
}

export interface ContentTargetResolution {
  requested: string | null;
  status: ContentTargetResolutionStatus;
  channelKey?: string;
  channelName?: string;
  channelType?: ContentDestinationType;
  categoryKey?: string;
  categoryName?: string;
  candidates?: readonly ContentTargetCandidate[];
}

export interface DocumentTargetResolution {
  documentId: ContentKey;
  resolution: ContentTargetResolution;
}

export type ContentAction = "create" | "update" | "unchanged";

export interface ContentOperation {
  action: ContentAction;
  identity: ContentMessageIdentity;
  channelId: string;
  currentMessageId: string | null;
  currentContentHash: string | null;
  desiredContentHash: string;
  desiredMarkdown: string;
}

export interface ContentPlan {
  schemaVersion: 1;
  profile: {
    key: string;
    name: string;
  };
  manifestHash: string;
  registryHash: string | null;
  documents: readonly ContentDocumentChange[];
  summary: ContentPlanSummary;
  warnings: readonly ContentWarning[];
  safetyStatement: "No Discord changes were made.";
  planHash: string;
}

export interface ContentDocumentChange {
  action: ContentAction;
  document: ContentKey;
  sourceFile: string;
  sourceLanguage: SourceLanguage;
  requestedLanguages: readonly ContentLanguage[];
  targetChannel: string | null;
  order: number;
  pinned: boolean;
  enabled: boolean;
  language: ContentLanguage;
  currentHash: string | null;
  desiredHash: string;
  blockCount: number;
  blocks: readonly ContentBlock[];
  warnings: readonly ContentWarning[];
  targetResolution: ContentTargetResolution;
}

export interface ContentPlanSummary {
  documents: number;
  blocks: number;
  create: number;
  update: number;
  unchanged: number;
  warnings: number;
  resolvedTargets: number;
  unresolvedTargets: number;
  notConfigured: number;
  ambiguousTargets: number;
  invalidTargets: number;
}

export interface ContentPlanningContext {
  profileName?: string;
  manifestHash?: string;
  registryHash?: string | null;
  warnings?: readonly ContentWarning[];
  declaredDocumentIds?: readonly ContentKey[];
  targetResolutions?: readonly DocumentTargetResolution[];
}

export interface ContentPlanArtifact extends ContentPlan {
  generatedAt: string;
}

export interface ContentVerificationResult {
  valid: boolean;
  messages: readonly string[];
}

export interface ContentApplyResult {
  applied: number;
  unchanged: number;
  registryEntries: readonly MessageRegistryEntry[];
}
