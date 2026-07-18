import type {
  ContentApplyResult,
  ContentDocument,
  ContentMessageIdentity,
  ContentOperation,
  ContentPlan,
  ContentVerificationResult,
  MessageRegistryEntry,
  ParsedContent,
  TranslationRequest,
} from "./types.js";

export interface ContentLoader {
  load(profileDirectory: string): Promise<readonly ContentDocument[]>;
}

export interface MarkdownParser {
  parse(document: ContentDocument): Promise<ParsedContent>;
}

export interface TranslationProvider {
  translate(request: TranslationRequest): Promise<ContentDocument>;
}

export interface MessageRegistry {
  get(identity: ContentMessageIdentity): Promise<MessageRegistryEntry | null>;
  list(profileKey: string): Promise<readonly MessageRegistryEntry[]>;
  save(entry: MessageRegistryEntry): Promise<void>;
}

export interface DiscordContentWriter {
  create(operation: ContentOperation): Promise<MessageRegistryEntry>;
  update(operation: ContentOperation): Promise<MessageRegistryEntry>;
}

export interface Planner {
  plan(
    profileKey: string,
    documents: readonly ParsedContent[],
    registryEntries: readonly MessageRegistryEntry[],
  ): Promise<ContentPlan>;
}

export interface Verifier {
  verify(plan: ContentPlan): Promise<ContentVerificationResult>;
}

export interface ContentDiffEngine {
  diff(
    profileKey: string,
    documents: readonly ParsedContent[],
    registryEntries: readonly MessageRegistryEntry[],
  ): Promise<readonly ContentOperation[]>;
}

export interface ContentApplyEngine {
  apply(plan: ContentPlan): Promise<ContentApplyResult>;
}
