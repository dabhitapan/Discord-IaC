export type DesiredChannelType =
  | "GuildText"
  | "GuildNews"
  | "GuildForum"
  | "GuildVoice";

export interface ProfileMetadata {
  key: string;
  name: string;
  version: number;
}

export interface DesiredRole {
  key: string;
  name: string;
  permissions: string[];
  deniedPermissions: string[];
  color?: number;
  hoist?: boolean;
  mentionable?: boolean;
}

export interface DesiredCategory {
  key: string;
  name: string;
}

export interface DesiredChannel {
  key: string;
  name: string;
  type: DesiredChannelType;
  categoryKey: string;
  permissionMode?: "inherit";
  topic?: string | null;
  nsfw?: boolean;
  rateLimitPerUser?: number | null;
  bitrate?: number;
  userLimit?: number | null;
  availableTags?: unknown[];
  defaultReactionEmoji?: { id: string | null; name: string | null } | null;
}

export interface PermissionRule {
  key: string;
  scope: { type: "category" | "channel"; key: string };
  target:
    | { type: "everyone" }
    | { type: "role"; roleKey: string };
  allow: string[];
  deny: string[];
}

export interface DesiredProfile {
  metadata: ProfileMetadata;
  roles: DesiredRole[];
  categories: DesiredCategory[];
  channels: DesiredChannel[];
  permissionRules: PermissionRule[];
}

export interface LiveRole {
  id: string;
  name: string;
  position: number;
  managed: boolean;
  permissions: string[];
  color: number;
  hoist: boolean;
  mentionable: boolean;
}

export interface LiveCategory {
  id: string;
  name: string;
  position: number;
  permissionOverwrites?: Array<{
    targetId: string;
    targetType: "role" | "member";
    allow: string[];
    deny: string[];
  }>;
}

export interface LiveChannel {
  id: string;
  name: string;
  type: string;
  parentId: string | null;
  position: number;
  permissionsLocked?: boolean | null;
  topic?: string | null;
  nsfw?: boolean;
  rateLimitPerUser?: number | null;
  bitrate?: number;
  userLimit?: number | null;
  availableTags?: unknown[];
  defaultReactionEmoji?: { id: string | null; name: string | null } | null;
}

export interface LivePermissionOverwrite {
  channelId: string;
  channelName: string;
  targetId: string;
  targetType: "role" | "member";
  allow: string[];
  deny: string[];
}

export interface LiveSnapshot {
  server: {
    id: string;
    name: string;
    description?: string | null;
    verificationLevel?: number;
    explicitContentFilter?: number;
    defaultMessageNotifications?: number;
    preferredLocale?: string;
    features?: string[];
  };
  roles: LiveRole[];
  categories: LiveCategory[];
  channels: LiveChannel[];
  permissionOverwrites: LivePermissionOverwrite[];
}

import type { StructuredOperation } from "./diffTypes.js";

export type PlanAction = StructuredOperation;

export interface PlanResult {
  roles: PlanAction[];
  categories: PlanAction[];
  channels: PlanAction[];
  permissions: {
    categoryOverwrites: PlanAction[];
    channelOverwrites: PlanAction[];
    synchronization: PlanAction[];
  };
  unmanaged: PlanAction[];
}
