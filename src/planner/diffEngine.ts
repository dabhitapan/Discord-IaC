import type {
  FieldChange,
  OperationAction,
  OperationSummary,
  PermissionChanges,
  PlanDocument,
  ResourceIdentity,
  ResourceType,
  StructuredOperation,
} from "./diffTypes.js";
import type { DesiredProfile, LiveSnapshot, PlanResult } from "./types.js";
import { canonicalHash } from "../utils/canonicalJson.js";

export function sortedDifference(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((value) => !rightSet.has(value)).sort((a, b) => a.localeCompare(b));
}

export function diffPermissions(
  currentAllow: string[],
  desiredAllow: string[],
  currentDeny: string[] = [],
  desiredDeny: string[] = [],
): PermissionChanges {
  return {
    allowAdded: sortedDifference(desiredAllow, currentAllow),
    allowRemoved: sortedDifference(currentAllow, desiredAllow),
    denyAdded: sortedDifference(desiredDeny, currentDeny),
    denyRemoved: sortedDifference(currentDeny, desiredDeny),
  };
}

export function hasPermissionChanges(changes: PermissionChanges): boolean {
  return Object.values(changes).some((values) => values.length > 0);
}

export function fieldChange(field: string, before: unknown, after: unknown): FieldChange {
  const change: FieldChange = { field, before, after };
  if (Array.isArray(before) && Array.isArray(after)) {
    change.added = after.filter((value) => !before.includes(value));
    change.removed = before.filter((value) => !after.includes(value));
  }
  return change;
}

export function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createOperation(
  resourceType: ResourceType,
  action: OperationAction,
  identity: ResourceIdentity,
  label: string,
  detail: string,
  extra: Partial<Omit<StructuredOperation, "resourceType" | "action" | "identity" | "label" | "detail">> = {},
): StructuredOperation {
  const defaultSupported =
    action === "unchanged" ||
    action === "warning" ||
    (resourceType === "role" && action === "update") ||
    (resourceType === "permission-overwrite" &&
      (action === "create" || action === "update")) ||
    (resourceType === "permission-sync" && action === "sync-permissions");
  return {
    resourceType,
    action,
    identity,
    label,
    detail,
    reason: extra.reason ?? detail,
    currentState: extra.currentState ?? null,
    desiredState: extra.desiredState ?? null,
    fieldChanges: extra.fieldChanges ?? [],
    dependencies: [...(extra.dependencies ?? [])].sort((a, b) => a.localeCompare(b)),
    sortKey:
      extra.sortKey ??
      `${resourceType}|${identity.parent?.profileKey ?? identity.parent?.discordId ?? ""}|${identity.profileKey ?? identity.discordId ?? identity.name}|${action}`,
    supported: extra.supported ?? defaultSupported,
    ambiguous:
      extra.ambiguous ??
      (action === "warning" && detail.toLowerCase().includes("ambiguous")),
    ...(extra.permissionChanges ? { permissionChanges: extra.permissionChanges } : {}),
    ...(extra.permissionOverwrite
      ? { permissionOverwrite: extra.permissionOverwrite }
      : {}),
    ...(extra.synchronization ? { synchronization: extra.synchronization } : {}),
  };
}

export function flattenPlan(plan: PlanResult): StructuredOperation[] {
  return [
    ...plan.roles,
    ...plan.categories,
    ...plan.channels,
    ...plan.permissions.categoryOverwrites,
    ...plan.permissions.channelOverwrites,
    ...plan.permissions.synchronization,
    ...plan.unmanaged,
  ];
}

export function summarizeOperations(operations: StructuredOperation[]): OperationSummary {
  return {
    create: operations.filter((item) => item.action === "create").length,
    move: operations.filter((item) => item.action === "move").length,
    "move-and-update": operations.filter(
      (item) => item.action === "move-and-update",
    ).length,
    update: operations.filter((item) => item.action === "update").length,
    reorder: operations.filter((item) => item.action === "reorder").length,
    "sync-permissions": operations.filter(
      (item) => item.action === "sync-permissions",
    ).length,
    unchanged: operations.filter((item) => item.action === "unchanged").length,
    warning: operations.filter((item) => item.action === "warning").length,
  };
}

export function createPlanDocument(
  profile: DesiredProfile,
  snapshot: LiveSnapshot,
  plan: PlanResult,
): PlanDocument {
  const operations = [...flattenPlan(plan)].sort((left, right) =>
    left.sortKey.localeCompare(right.sortKey),
  );
  const actionable = operations.filter(
    (operation) =>
      operation.action !== "unchanged" && operation.action !== "warning",
  );
  const unsupportedOperationCount = actionable.filter(
    (operation) => !operation.supported,
  ).length;
  const ambiguityCount = operations.filter((operation) => operation.ambiguous).length;
  const missingRequiredIdCount = actionable.filter((operation) => {
    if (!operation.identity.discordId) return true;
    if (operation.resourceType === "permission-overwrite") {
      return (
        !operation.permissionOverwrite?.scope.discordId ||
        !operation.permissionOverwrite.target.discordId
      );
    }
    if (operation.resourceType === "permission-sync") {
      return !operation.identity.parent?.discordId;
    }
    return false;
  }).length;
  return {
    schemaVersion: 1,
    profile: { key: profile.metadata.key, name: profile.metadata.name },
    snapshotGuild: { id: snapshot.server.id, name: snapshot.server.name },
    hashes: {
      snapshot: canonicalHash(snapshot),
      profile: canonicalHash(profile),
    },
    summary: summarizeOperations(operations),
    operations,
    warnings: operations.filter((operation) => operation.action === "warning"),
    unsupportedOperationCount,
    ambiguityCount,
    missingRequiredIdCount,
    executable:
      Boolean(snapshot.server.id && snapshot.server.name) &&
      unsupportedOperationCount === 0 &&
      ambiguityCount === 0 &&
      missingRequiredIdCount === 0,
  };
}

export function hashPlanDocument(document: PlanDocument): string {
  return canonicalHash(document);
}
