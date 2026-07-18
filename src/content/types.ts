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
  markdown: string;
}

export interface ParsedContent {
  profileKey: string;
  key: ContentKey;
  language: ContentLanguage;
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
  profileKey: string;
  documents: readonly ContentDocumentChange[];
  summary: ContentPlanSummary;
}

export interface ContentDocumentChange {
  action: ContentAction;
  document: ContentKey;
  language: ContentLanguage;
  currentHash: string | null;
  desiredHash: string;
  blocks: readonly ContentBlock[];
}

export interface ContentPlanSummary {
  documents: number;
  blocks: number;
  create: number;
  update: number;
  unchanged: number;
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
