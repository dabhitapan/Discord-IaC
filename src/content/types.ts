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
  key: ContentKey;
  language: ContentLanguage;
  blocks: readonly ContentBlock[];
}

export interface ContentBlock {
  key: string;
  markdown: string;
}

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
  operations: readonly ContentOperation[];
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
