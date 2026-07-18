import type {
  ContentDestinationType,
  ContentKey,
  ContentTargetResolution,
} from "./types.js";

export type LiveContentChannelType = ContentDestinationType | "other";

export interface ReadOnlyLiveCategory {
  id: string;
  name: string;
}

export interface ReadOnlyLiveChannel {
  id: string;
  name: string;
  type: LiveContentChannelType;
  parentId: string | null;
}

export interface ReadOnlyLiveGuild {
  id: string;
  name: string;
  categories: readonly ReadOnlyLiveCategory[];
  channels: readonly ReadOnlyLiveChannel[];
}

export interface ReadOnlyDiscordGateway {
  fetchGuild(guildId: string): Promise<ReadOnlyLiveGuild>;
}

export type ContentVerificationStatus =
  | "verified"
  | "not-configured"
  | "live-channel-missing"
  | "live-channel-type-mismatch"
  | "live-category-mismatch"
  | "live-channel-ambiguous"
  | "guild-mismatch"
  | "inaccessible"
  | "skipped";

export interface LiveChannelIdentity {
  id: string;
  name: string;
  type: LiveContentChannelType;
  categoryId: string | null;
  categoryName: string | null;
}

export interface ContentDocumentVerification {
  document: ContentKey;
  status: ContentVerificationStatus;
  desired: ContentTargetResolution;
  live?: LiveChannelIdentity;
  candidates?: readonly LiveChannelIdentity[];
  issue?: string;
}

export interface ContentVerificationSummary {
  documents: number;
  verified: number;
  notConfigured: number;
  missing: number;
  typeMismatches: number;
  categoryMismatches: number;
  ambiguous: number;
  skipped: number;
  errors: number;
}

export interface ContentVerificationReport {
  schemaVersion: 1;
  profile: { key: string; name: string };
  configuredGuildId: string;
  liveGuild: { id: string; name: string } | null;
  guildStatus: "verified" | "guild-mismatch" | "inaccessible";
  documents: readonly ContentDocumentVerification[];
  summary: ContentVerificationSummary;
  warnings: readonly string[];
  errors: readonly string[];
  safetyStatement: "Verification was read-only. No Discord changes were made.";
  verificationHash: string;
}

export interface ContentVerificationArtifact extends ContentVerificationReport {
  generatedAt: string;
}
