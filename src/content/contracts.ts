import type {
  ContentApplyResult,
  ContentDocument,
  ContentDocumentChange,
  DocumentTargetResolution,
  ContentLoadResult,
  ContentMessageIdentity,
  ContentOperation,
  ContentPlan,
  ContentPlanningContext,
  ContentRegistryFile,
  ContentTargetResolution,
  ContentVerificationResult,
  MessageRegistryEntry,
  ParsedContent,
  TranslationRequest,
} from "./types.js";
import type { DesiredProfile } from "../planner/types.js";

export interface ContentLoader {
  load(profileDirectory: string): Promise<readonly ContentDocument[]>;
}

export interface ContentProfileLoader extends ContentLoader {
  loadProfile(profileDirectory: string): Promise<ContentLoadResult>;
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

export interface ContentRegistry {
  load(profileKey: string): Promise<ContentRegistryFile>;
  save(registry: ContentRegistryFile): Promise<void>;
}

export interface DiscordContentWriter {
  create(operation: ContentOperation): Promise<MessageRegistryEntry>;
  update(operation: ContentOperation): Promise<MessageRegistryEntry>;
}

export interface Planner {
  plan(
    profileKey: string,
    documents: readonly ParsedContent[],
    registry: ContentRegistryFile,
    context?: ContentPlanningContext,
  ): Promise<ContentPlan>;
}

export interface Verifier {
  verify(plan: ContentPlan): Promise<ContentVerificationResult>;
}

export interface ContentDiffEngine {
  diff(
    profileKey: string,
    documents: readonly ParsedContent[],
    registry: ContentRegistryFile,
    targetResolutions?: readonly DocumentTargetResolution[],
  ): Promise<readonly ContentDocumentChange[]>;
}

export interface LogicalChannelResolver {
  resolve(requested: string | null, profile: DesiredProfile): ContentTargetResolution;
}

export interface ContentApplyEngine {
  apply(plan: ContentPlan): Promise<ContentApplyResult>;
}
