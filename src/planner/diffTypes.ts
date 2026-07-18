export type ResourceType =
  | "role"
  | "category"
  | "channel"
  | "permission-overwrite"
  | "permission-sync"
  | "unmanaged-resource";

export type OperationAction =
  | "create"
  | "update"
  | "reorder"
  | "sync-permissions"
  | "unchanged"
  | "warning";

export interface ResourceReference {
  profileKey?: string;
  discordId?: string;
  name: string;
}

export interface ResourceIdentity extends ResourceReference {
  parent?: ResourceReference;
}

export interface FieldChange {
  field: string;
  before?: unknown;
  after?: unknown;
  added?: unknown[];
  removed?: unknown[];
}

export interface PermissionChanges {
  allowAdded: string[];
  allowRemoved: string[];
  denyAdded: string[];
  denyRemoved: string[];
}

export interface PermissionOverwriteState {
  target: ResourceReference;
  targetType: "role" | "member";
  allow: string[];
  deny: string[];
}

export interface PermissionOverwriteDetails {
  scopeType: "category" | "channel";
  scope: ResourceReference;
  target: ResourceReference;
  targetType: "role" | "member";
  current: PermissionOverwriteState | null;
  desired: PermissionOverwriteState;
}

export interface TargetOverwriteDifference {
  target: ResourceReference;
  changes: PermissionChanges;
}

export interface SynchronizationDetails {
  currentMode: "inherited" | "custom-overwrites" | "unknown";
  desiredMode: "inherit";
  permissionsLocked: boolean | null;
  currentParent: ResourceReference | null;
  desiredParent: ResourceReference;
  currentOverwrites: PermissionOverwriteState[];
  desiredParentOverwrites: PermissionOverwriteState[];
  overwritesDiffer: boolean;
  overwriteDifferences: TargetOverwriteDifference[];
  reasons: string[];
  action: "synchronize channel permissions with the parent category";
}

export interface StructuredOperation {
  resourceType: ResourceType;
  action: OperationAction;
  identity: ResourceIdentity;
  label: string;
  detail: string;
  reason: string;
  currentState: Record<string, unknown> | null;
  desiredState: Record<string, unknown> | null;
  fieldChanges: FieldChange[];
  dependencies: string[];
  sortKey: string;
  supported: boolean;
  ambiguous: boolean;
  permissionChanges?: PermissionChanges;
  permissionOverwrite?: PermissionOverwriteDetails;
  synchronization?: SynchronizationDetails;
}

export interface OperationSummary {
  create: number;
  update: number;
  reorder: number;
  "sync-permissions": number;
  unchanged: number;
  warning: number;
}

export interface PlanDocument {
  schemaVersion: 1;
  profile: { key: string; name: string };
  snapshotGuild: { id: string; name: string };
  hashes: {
    snapshot: string;
    profile: string;
  };
  summary: OperationSummary;
  operations: StructuredOperation[];
  warnings: StructuredOperation[];
  unsupportedOperationCount: number;
  ambiguityCount: number;
  missingRequiredIdCount: number;
  executable: boolean;
}
