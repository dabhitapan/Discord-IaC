export interface ServerExport {
  id: string;
  name: string;
  description: string | null;
  verificationLevel: number;
  explicitContentFilter: number;
  defaultMessageNotifications: number;
  preferredLocale: string;
  features: string[];
}

export interface PermissionOverwriteExport {
  channelId: string;
  channelName: string;
  targetId: string;
  targetType: "role" | "member";
  allow: string[];
  deny: string[];
}

export interface CategoryExport {
  id: string;
  name: string;
  position: number;
  permissionOverwrites: Omit<
    PermissionOverwriteExport,
    "channelId" | "channelName"
  >[];
}

export interface ForumTagExport {
  id: string;
  name: string;
  moderated: boolean;
  emoji: { id: string | null; name: string | null } | null;
}

export interface ChannelExport {
  id: string;
  name: string;
  type: string;
  parentId: string | null;
  position: number;
  permissionsLocked: boolean | null;
  topic?: string | null;
  nsfw?: boolean;
  rateLimitPerUser?: number | null;
  bitrate?: number;
  userLimit?: number | null;
  availableTags?: ForumTagExport[];
  defaultReactionEmoji?: { id: string | null; name: string | null } | null;
}

export interface RoleExport {
  id: string;
  name: string;
  color: number;
  position: number;
  hoist: boolean;
  mentionable: boolean;
  managed: boolean;
  permissions: string[];
}

export interface ExportSummary {
  outputDirectory: string;
  roles: number;
  categories: number;
  channels: number;
  permissionOverwrites: number;
}
