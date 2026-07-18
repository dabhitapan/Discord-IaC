import path from "node:path";
import { loadSnapshot } from "./snapshotLoader.js";
import type { LivePermissionOverwrite } from "./types.js";
import { reportCliError } from "../utils/cliError.js";

function overwriteSignature(overwrite: LivePermissionOverwrite): string {
  return [
    overwrite.targetType,
    overwrite.targetId,
    [...overwrite.allow].sort().join(","),
    [...overwrite.deny].sort().join(","),
  ].join("|");
}

function sameOverwrites(
  left: LivePermissionOverwrite[],
  right: LivePermissionOverwrite[],
): boolean {
  const leftSignatures = left.map(overwriteSignature).sort();
  const rightSignatures = right.map(overwriteSignature).sort();
  return (
    leftSignatures.length === rightSignatures.length &&
    leftSignatures.every((value, index) => value === rightSignatures[index])
  );
}

async function main(): Promise<void> {
  const exportsDirectory = process.argv[2] ?? "exports";
  const snapshot = await loadSnapshot(exportsDirectory);
  const categoriesById = new Map(
    snapshot.categories.map((category) => [category.id, category]),
  );
  const roleIds = new Set(snapshot.roles.map((role) => role.id));
  const locked = snapshot.channels.filter(
    (channel) => channel.permissionsLocked === true,
  );
  const unlocked = snapshot.channels.filter(
    (channel) => channel.permissionsLocked === false,
  );
  const unknown = snapshot.channels.filter(
    (channel) => channel.permissionsLocked !== true && channel.permissionsLocked !== false,
  );
  const orphanParents = snapshot.channels.filter(
    (channel) => channel.parentId !== null && !categoriesById.has(channel.parentId),
  );
  const differingFromParent = snapshot.channels.filter((channel) => {
    if (!channel.parentId || !categoriesById.has(channel.parentId)) return false;
    return !sameOverwrites(
      snapshot.permissionOverwrites.filter(
        (overwrite) => overwrite.channelId === channel.id,
      ),
      snapshot.permissionOverwrites.filter(
        (overwrite) => overwrite.channelId === channel.parentId,
      ),
    );
  });

  const duplicateGroups = new Map<string, typeof snapshot.channels>();
  for (const channel of snapshot.channels) {
    const key = `${channel.parentId ?? "<none>"}\u0000${channel.name}`;
    duplicateGroups.set(key, [...(duplicateGroups.get(key) ?? []), channel]);
  }
  const duplicates = [...duplicateGroups.values()].filter((group) => group.length > 1);
  const unknownTargets = snapshot.permissionOverwrites.filter(
    (overwrite) => overwrite.targetType !== "role" || !roleIds.has(overwrite.targetId),
  );

  console.log(`Offline snapshot audit: ${path.resolve(exportsDirectory)}`);
  console.log(`permissionsLocked true: ${locked.length}`);
  console.log(`permissionsLocked false: ${unlocked.length}`);
  console.log(`permissionsLocked unknown: ${unknown.length}`);

  console.log(`\nChild channels differing from parent category: ${differingFromParent.length}`);
  for (const channel of differingFromParent) {
    const parent = channel.parentId ? categoriesById.get(channel.parentId) : undefined;
    console.log(`  - ${parent?.name ?? "unknown parent"} / ${channel.name}`);
  }

  console.log(`\nOrphan parent IDs: ${orphanParents.length}`);
  for (const channel of orphanParents) {
    console.log(`  - ${channel.name}: ${channel.parentId}`);
  }

  console.log(`\nDuplicate channel matches (same name and parent): ${duplicates.length}`);
  for (const group of duplicates) {
    console.log(
      `  - ${group[0].name} under ${group[0].parentId ?? "<uncategorized>"}: ${group.length} matches`,
    );
  }

  console.log(`\nUnmapped permission overwrite targets: ${unknownTargets.length}`);
  for (const overwrite of unknownTargets) {
    console.log(
      `  - ${overwrite.channelName}: ${overwrite.targetType} ${overwrite.targetId}`,
    );
  }

  if (unknown.length > 0) {
    console.log(
      "\nWARNING: This snapshot does not expose synchronization state for some channels.",
    );
  }
  console.log("No Discord changes were made.");
}

main().catch((error: unknown) => {
  reportCliError(error);
  console.error("No Discord changes were made.");
  process.exitCode = 1;
});
