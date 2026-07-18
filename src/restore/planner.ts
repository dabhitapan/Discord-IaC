import type { LiveSnapshot } from "../planner/types.js";
import type {
  PermissionOverwriteState,
  StructuredOperation,
} from "../planner/diffTypes.js";
import {
  createOperation,
  diffPermissions,
  fieldChange,
  hasPermissionChanges,
  valuesEqual,
} from "../planner/diffEngine.js";

export function buildRestoreOperations(
  backup: LiveSnapshot,
  current: LiveSnapshot,
): StructuredOperation[] {
  if (backup.server.id !== current.server.id) throw new Error("Restore guild mismatch.");
  const operations: StructuredOperation[] = [];
  const currentRoles = new Map(current.roles.map((role) => [role.id, role]));

  for (const desired of backup.roles) {
    if (desired.id === backup.server.id || desired.name === "@everyone" || desired.managed) {
      continue;
    }
    const live = currentRoles.get(desired.id);
    if (!live) {
      operations.push(
        createOperation(
          "unmanaged-resource",
          "warning",
          { discordId: desired.id, name: desired.name },
          `Missing role: ${desired.name}`,
          "Restore never recreates missing roles.",
          { ambiguous: true },
        ),
      );
      continue;
    }
    if (live.managed || live.name !== desired.name) {
      operations.push(
        createOperation(
          "unmanaged-resource",
          "warning",
          { discordId: live.id, name: live.name },
          `Protected or mismatched role: ${desired.name}`,
          "Restore aborted for this protected identity.",
          { ambiguous: true },
        ),
      );
      continue;
    }
    const permissionChanges = diffPermissions(live.permissions, desired.permissions);
    const changes = ["color", "hoist", "mentionable", "permissions"]
      .filter((field) => !valuesEqual(live[field as keyof typeof live], desired[field as keyof typeof desired]))
      .map((field) =>
        fieldChange(
          field,
          live[field as keyof typeof live],
          desired[field as keyof typeof desired],
        ),
      );
    if (changes.length > 0) {
      operations.push(
        createOperation(
          "role",
          "update",
          { discordId: live.id, name: live.name },
          `Restore role: ${live.name}`,
          "Restore existing role properties by verified ID and name.",
          {
            currentState: live as unknown as Record<string, unknown>,
            desiredState: desired as unknown as Record<string, unknown>,
            fieldChanges: changes,
            permissionChanges,
          },
        ),
      );
    }
  }

  const scopes = new Map([
    ...current.categories.map((scope) => [scope.id, scope.name] as const),
    ...current.channels.map((scope) => [scope.id, scope.name] as const),
  ]);
  const roleNames = new Map(current.roles.map((role) => [role.id, role.name]));
  for (const desired of backup.permissionOverwrites) {
    const scopeName = scopes.get(desired.channelId);
    if (!scopeName || (desired.targetType === "role" && !roleNames.has(desired.targetId))) {
      operations.push(
        createOperation(
          "unmanaged-resource",
          "warning",
          { discordId: desired.channelId, name: desired.channelName },
          `Missing overwrite identity: ${desired.channelName}`,
          "Restore never recreates missing resources.",
          { ambiguous: true },
        ),
      );
      continue;
    }
    const live = current.permissionOverwrites.find(
      (overwrite) =>
        overwrite.channelId === desired.channelId &&
        overwrite.targetId === desired.targetId &&
        overwrite.targetType === desired.targetType,
    );
    const changes = diffPermissions(
      live?.allow ?? [],
      desired.allow,
      live?.deny ?? [],
      desired.deny,
    );
    if (!hasPermissionChanges(changes)) continue;
    const target = {
      discordId: desired.targetId,
      name: roleNames.get(desired.targetId) ?? desired.targetId,
    };
    const desiredState: PermissionOverwriteState = {
      target,
      targetType: desired.targetType,
      allow: desired.allow,
      deny: desired.deny,
    };
    operations.push(
      createOperation(
        "permission-overwrite",
        live ? "update" : "create",
        {
          discordId: `${desired.channelId}:${desired.targetId}`,
          name: `${scopeName} → ${target.name}`,
        },
        `Restore overwrite: ${scopeName} → ${target.name}`,
        "Restore saved overwrite without deleting any newer overwrites.",
        {
          permissionChanges: changes,
          permissionOverwrite: {
            scopeType: current.categories.some((item) => item.id === desired.channelId)
              ? "category"
              : "channel",
            scope: { discordId: desired.channelId, name: scopeName },
            target,
            targetType: desired.targetType,
            current: live
              ? { target, targetType: live.targetType, allow: live.allow, deny: live.deny }
              : null,
            desired: desiredState,
          },
          currentState: live as unknown as Record<string, unknown> | undefined,
          desiredState: desiredState as unknown as Record<string, unknown>,
        },
      ),
    );
  }

  const currentChannels = new Map(current.channels.map((channel) => [channel.id, channel]));
  for (const desired of backup.channels.filter(
    (channel) => channel.permissionsLocked === true,
  )) {
    const live = currentChannels.get(desired.id);
    if (
      !live ||
      live.name !== desired.name ||
      live.parentId !== desired.parentId ||
      live.permissionsLocked !== false ||
      !desired.parentId
    ) {
      continue;
    }
    const parent = current.categories.find((category) => category.id === desired.parentId);
    if (!parent) continue;
    operations.push(
      createOperation(
        "permission-sync",
        "sync-permissions",
        {
          discordId: live.id,
          name: live.name,
          parent: { discordId: parent.id, name: parent.name },
        },
        `Restore permission inheritance: ${parent.name} / ${live.name}`,
        "Backup records this existing channel as permission-synchronized.",
        {
          synchronization: {
            currentMode: "custom-overwrites",
            desiredMode: "inherit",
            permissionsLocked: false,
            currentParent: { discordId: parent.id, name: parent.name },
            desiredParent: { discordId: parent.id, name: parent.name },
            currentOverwrites: [],
            desiredParentOverwrites: [],
            overwritesDiffer: true,
            overwriteDifferences: [],
            reasons: ["backup records inherited category permissions"],
            action: "synchronize channel permissions with the parent category",
          },
        },
      ),
    );
  }

  return operations.sort((left, right) => left.sortKey.localeCompare(right.sortKey));
}
