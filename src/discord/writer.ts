import type { Guild, PermissionOverwriteOptions } from "discord.js";
import type { StructuredOperation } from "../planner/diffTypes.js";
import { SafetyError } from "../engine/planSafety.js";

function sameSet(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((permission) => right.includes(permission))
  );
}

export class DiscordWriter {
  constructor(private readonly guild: Guild) {}

  async execute(operation: StructuredOperation): Promise<void> {
    if (!operation.supported) throw new SafetyError(`Unsupported: ${operation.label}`);
    if (operation.resourceType === "role" && operation.action === "update") {
      await this.updateRole(operation);
      return;
    }
    if (
      operation.resourceType === "permission-overwrite" &&
      (operation.action === "create" || operation.action === "update")
    ) {
      await this.writeOverwrite(operation);
      return;
    }
    if (
      operation.resourceType === "permission-sync" &&
      operation.action === "sync-permissions"
    ) {
      await this.syncPermissions(operation);
      return;
    }
    throw new SafetyError(`Writer does not support operation: ${operation.label}`);
  }

  private async updateRole(operation: StructuredOperation): Promise<void> {
    const id = operation.identity.discordId;
    if (!id || id === this.guild.id) throw new SafetyError("Protected or missing role ID.");
    const role = await this.guild.roles.fetch(id);
    if (!role || role.managed || role.name === "@everyone") {
      throw new SafetyError(`Protected or missing role: ${operation.identity.name}`);
    }
    const desired = operation.desiredState;
    if (!desired) throw new SafetyError("Role desired state is unresolved.");
    const permissions = desired?.permissions;
    if (!Array.isArray(permissions)) throw new SafetyError("Role permissions are unresolved.");
    const updated = await role.edit({
      name: typeof desired.name === "string" ? desired.name : role.name,
      color: typeof desired.color === "number" ? desired.color : role.color,
      hoist: typeof desired.hoist === "boolean" ? desired.hoist : role.hoist,
      mentionable:
        typeof desired.mentionable === "boolean" ? desired.mentionable : role.mentionable,
      permissions: permissions as never,
      reason: "Discord IaC guarded apply",
    });
    if (!sameSet(updated.permissions.toArray(), permissions as string[])) {
      throw new Error(`Role verification failed: ${operation.label}`);
    }
  }

  private async writeOverwrite(operation: StructuredOperation): Promise<void> {
    const details = operation.permissionOverwrite;
    const channelId = details?.scope.discordId;
    const targetId = details?.target.discordId;
    if (!details || !channelId || !targetId) {
      throw new SafetyError(`Unresolved overwrite identity: ${operation.label}`);
    }
    const channel = await this.guild.channels.fetch(channelId);
    if (!channel || channel.isThread() || !("permissionOverwrites" in channel)) {
      throw new SafetyError(`Overwrite scope is unavailable: ${operation.label}`);
    }
    const options: Record<string, boolean | null> = {};
    for (const permission of [
      ...(details.current?.allow ?? []),
      ...(details.current?.deny ?? []),
      ...details.desired.allow,
      ...details.desired.deny,
    ]) {
      options[permission] = null;
    }
    for (const permission of details.desired.allow) options[permission] = true;
    for (const permission of details.desired.deny) options[permission] = false;
    const updatedChannel = await channel.permissionOverwrites.edit(
      targetId,
      options as PermissionOverwriteOptions,
      { reason: "Discord IaC guarded apply" },
    );
    const updated = updatedChannel.permissionOverwrites.cache.get(targetId);
    if (
      !updated ||
      !sameSet(updated.allow.toArray(), details.desired.allow) ||
      !sameSet(updated.deny.toArray(), details.desired.deny)
    ) {
      throw new Error(`Overwrite verification failed: ${operation.label}`);
    }
  }

  private async syncPermissions(operation: StructuredOperation): Promise<void> {
    const channelId = operation.identity.discordId;
    if (!channelId) throw new SafetyError(`Missing channel ID: ${operation.label}`);
    const channel = await this.guild.channels.fetch(channelId);
    if (!channel || channel.isThread() || !("lockPermissions" in channel)) {
      throw new SafetyError(`Channel cannot synchronize permissions: ${operation.label}`);
    }
    const updated = await channel.lockPermissions();
    if (updated.permissionsLocked !== true) {
      throw new Error(`Permission synchronization verification failed: ${operation.label}`);
    }
  }
}
