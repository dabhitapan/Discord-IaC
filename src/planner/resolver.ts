import type {
  FieldChange,
  PermissionOverwriteState,
  ResourceIdentity,
  ResourceType,
  StructuredOperation,
  SynchronizationDetails,
} from "./diffTypes.js";
import {
  createOperation,
  diffPermissions,
  fieldChange,
  hasPermissionChanges,
  valuesEqual,
} from "./diffEngine.js";
import type {
  DesiredCategory,
  DesiredChannel,
  DesiredProfile,
  LiveCategory,
  LiveChannel,
  LiveRole,
  LiveSnapshot,
  PlanAction,
  PlanResult,
} from "./types.js";

interface Resolution<T> {
  match?: T;
  ambiguous: boolean;
}

function resolveUnique<T>(candidates: T[]): Resolution<T> {
  return {
    match: candidates.length === 1 ? candidates[0] : undefined,
    ambiguous: candidates.length > 1,
  };
}

export function resolveRole(name: string, roles: LiveRole[]): Resolution<LiveRole> {
  return resolveUnique(roles.filter((role) => role.name === name));
}

export function resolveCategory(
  name: string,
  categories: LiveCategory[],
): Resolution<LiveCategory> {
  return resolveUnique(categories.filter((category) => category.name === name));
}

export function resolveChannel(
  desired: DesiredChannel,
  desiredCategory: DesiredCategory,
  snapshot: LiveSnapshot,
): Resolution<LiveChannel> {
  const parent = resolveCategory(desiredCategory.name, snapshot.categories);
  if (!parent.match || parent.ambiguous) return { ambiguous: parent.ambiguous };

  return resolveUnique(
    snapshot.channels.filter(
      (channel) =>
        channel.name === desired.name && channel.parentId === parent.match?.id,
    ),
  );
}

function sameSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

function action(
  kind: PlanAction["action"],
  label: string,
  detail: string,
  options: {
    resourceType?: ResourceType;
    identity?: ResourceIdentity;
    fieldChanges?: FieldChange[];
    currentState?: Record<string, unknown> | null;
    desiredState?: Record<string, unknown> | null;
    dependencies?: string[];
    sortKey?: string;
    supported?: boolean;
    ambiguous?: boolean;
    permissionChanges?: StructuredOperation["permissionChanges"];
    permissionOverwrite?: StructuredOperation["permissionOverwrite"];
    synchronization?: SynchronizationDetails;
  } = {},
): PlanAction {
  return createOperation(
    options.resourceType ?? "unmanaged-resource",
    kind,
    options.identity ?? { name: label },
    label,
    detail,
    options,
  );
}

function optionalFieldChanges(
  current: Record<string, unknown>,
  desired: Record<string, unknown>,
  fields: string[],
): FieldChange[] {
  return fields
    .filter(
      (field) => desired[field] !== undefined && !valuesEqual(current[field], desired[field]),
    )
    .map((field) => fieldChange(field, current[field], desired[field]));
}

function calculateRoleOrderMismatches(
  profile: DesiredProfile,
  snapshot: LiveSnapshot,
): Set<string> {
  const desiredMatched = profile.roles
    .map((role) => ({ role, live: resolveRole(role.name, snapshot.roles).match }))
    .filter(
      (item): item is { role: (typeof profile.roles)[number]; live: LiveRole } =>
        item.live !== undefined && !item.live.managed,
    );
  const actualKeys = [...desiredMatched]
    .sort((a, b) => b.live.position - a.live.position)
    .map((item) => item.role.key);
  const desiredKeys = desiredMatched.map((item) => item.role.key);

  return new Set(
    desiredKeys.filter((key, index) => actualKeys[index] !== key),
  );
}

function calculateCategoryOrderMismatches(
  profile: DesiredProfile,
  snapshot: LiveSnapshot,
): Set<string> {
  const desiredMatched = profile.categories
    .map((category) => ({
      category,
      live: resolveCategory(category.name, snapshot.categories).match,
    }))
    .filter(
      (item): item is {
        category: (typeof profile.categories)[number];
        live: LiveCategory;
      } => item.live !== undefined,
    );
  const actualKeys = [...desiredMatched]
    .sort((a, b) => a.live.position - b.live.position)
    .map((item) => item.category.key);
  const desiredKeys = desiredMatched.map((item) => item.category.key);

  return new Set(
    desiredKeys.filter((key, index) => actualKeys[index] !== key),
  );
}

function calculateChannelOrderMismatches(
  profile: DesiredProfile,
  snapshot: LiveSnapshot,
): Set<string> {
  const mismatches = new Set<string>();

  for (const category of profile.categories) {
    const desiredChannels = profile.channels.filter(
      (channel) => channel.categoryKey === category.key,
    );
    const matched = desiredChannels
      .map((channel) => ({
        channel,
        live: resolveChannel(channel, category, snapshot).match,
      }))
      .filter(
        (item): item is { channel: DesiredChannel; live: LiveChannel } =>
          item.live !== undefined,
      );
    const actualKeys = [...matched]
      .sort((a, b) => a.live.position - b.live.position)
      .map((item) => item.channel.key);
    const desiredKeys = matched.map((item) => item.channel.key);
    desiredKeys.forEach((key, index) => {
      if (actualKeys[index] !== key) mismatches.add(key);
    });
  }

  return mismatches;
}

export function buildPlan(
  profile: DesiredProfile,
  snapshot: LiveSnapshot,
): PlanResult {
  const result: PlanResult = {
    roles: [],
    categories: [],
    channels: [],
    permissions: {
      categoryOverwrites: [],
      channelOverwrites: [],
      synchronization: [],
    },
    unmanaged: [],
  };
  const matchedRoleIds = new Set<string>();
  const matchedCategoryIds = new Set<string>();
  const matchedChannelIds = new Set<string>();
  const roleOrderMismatches = calculateRoleOrderMismatches(profile, snapshot);
  const categoryOrderMismatches = calculateCategoryOrderMismatches(profile, snapshot);
  const channelOrderMismatches = calculateChannelOrderMismatches(profile, snapshot);

  for (const desired of profile.roles) {
    const resolution = resolveRole(desired.name, snapshot.roles);
    const desiredIdentity: ResourceIdentity = {
      profileKey: desired.key,
      name: desired.name,
    };
    if (resolution.ambiguous) {
      result.roles.push(
        action("warning", desired.name, "Ambiguous exact-name role match.", {
          resourceType: "role",
          identity: desiredIdentity,
        }),
      );
    } else if (!resolution.match) {
      result.roles.push(
        action("create", desired.name, "Role does not exist.", {
          resourceType: "role",
          identity: desiredIdentity,
          fieldChanges: [
            fieldChange("name", undefined, desired.name),
            fieldChange("permissions", [], desired.permissions),
            fieldChange(
              "order",
              undefined,
              profile.roles.findIndex((role) => role.key === desired.key),
            ),
            ...(desired.color === undefined
              ? []
              : [fieldChange("color", undefined, desired.color)]),
            ...(desired.hoist === undefined
              ? []
              : [fieldChange("hoist", undefined, desired.hoist)]),
            ...(desired.mentionable === undefined
              ? []
              : [fieldChange("mentionable", undefined, desired.mentionable)]),
          ],
          permissionChanges: diffPermissions([], desired.permissions),
          desiredState: {
            name: desired.name,
            permissions: desired.permissions,
            color: desired.color,
            hoist: desired.hoist,
            mentionable: desired.mentionable,
          },
        }),
      );
    } else {
      const live = resolution.match;
      matchedRoleIds.add(live.id);
      const identity = { ...desiredIdentity, discordId: live.id };
      const permissionChanges = diffPermissions(live.permissions, desired.permissions);
      const presentationChanges = optionalFieldChanges(
        live as unknown as Record<string, unknown>,
        desired as unknown as Record<string, unknown>,
        ["color", "hoist", "mentionable"],
      );
      if (live.managed) {
        result.roles.push(
          action("warning", desired.name, "Managed roles must never be modified.", {
            resourceType: "role",
            identity,
          }),
        );
      } else if (hasPermissionChanges(permissionChanges) || presentationChanges.length > 0) {
        result.roles.push(
          action("update", desired.name, "Role fields differ.", {
            resourceType: "role",
            identity,
            fieldChanges: [
              ...presentationChanges,
              ...(hasPermissionChanges(permissionChanges)
                ? [fieldChange("permissions", live.permissions, desired.permissions)]
                : []),
            ],
            permissionChanges,
            currentState: {
              name: live.name,
              permissions: live.permissions,
              color: live.color,
              hoist: live.hoist,
              mentionable: live.mentionable,
              managed: live.managed,
            },
            desiredState: {
              name: desired.name,
              permissions: desired.permissions,
              color: desired.color ?? live.color,
              hoist: desired.hoist ?? live.hoist,
              mentionable: desired.mentionable ?? live.mentionable,
            },
          }),
        );
      } else if (roleOrderMismatches.has(desired.key)) {
        result.roles.push(
          action("reorder", desired.name, "Role order differs.", {
            resourceType: "role",
            identity,
            fieldChanges: [
              fieldChange(
                "order",
                live.position,
                profile.roles.findIndex((role) => role.key === desired.key),
              ),
            ],
          }),
        );
      } else {
        result.roles.push(
          action("unchanged", desired.name, "Matches desired role.", {
            resourceType: "role",
            identity,
          }),
        );
      }
    }
  }

  for (const desired of profile.categories) {
    const resolution = resolveCategory(desired.name, snapshot.categories);
    const desiredIdentity: ResourceIdentity = {
      profileKey: desired.key,
      name: desired.name,
    };
    if (resolution.ambiguous) {
      result.categories.push(
        action("warning", desired.name, "Ambiguous exact-name category match.", {
          resourceType: "category",
          identity: desiredIdentity,
        }),
      );
    } else if (!resolution.match) {
      result.categories.push(
        action("create", desired.name, "Category does not exist.", {
          resourceType: "category",
          identity: desiredIdentity,
          fieldChanges: [
            fieldChange("name", undefined, desired.name),
            fieldChange(
              "order",
              undefined,
              profile.categories.findIndex(
                (category) => category.key === desired.key,
              ),
            ),
          ],
        }),
      );
    } else {
      matchedCategoryIds.add(resolution.match.id);
      const identity = { ...desiredIdentity, discordId: resolution.match.id };
      result.categories.push(
        categoryOrderMismatches.has(desired.key)
          ? action("reorder", desired.name, "Category order differs.", {
              resourceType: "category",
              identity,
              fieldChanges: [
                fieldChange(
                  "order",
                  resolution.match.position,
                  profile.categories.findIndex(
                    (category) => category.key === desired.key,
                  ),
                ),
              ],
            })
          : action("unchanged", desired.name, "Matches desired category.", {
              resourceType: "category",
              identity,
            }),
      );
    }
  }

  const categoriesByKey = new Map(
    profile.categories.map((category) => [category.key, category]),
  );
  const liveChannelByDesiredKey = new Map<string, LiveChannel>();
  for (const desired of profile.channels) {
    const desiredCategory = categoriesByKey.get(desired.categoryKey);
    if (!desiredCategory) continue;
    const resolution = resolveChannel(desired, desiredCategory, snapshot);
    const label = `${desiredCategory.name} / ${desired.name}`;
    const parentResolution = resolveCategory(desiredCategory.name, snapshot.categories);
    const desiredIdentity: ResourceIdentity = {
      profileKey: desired.key,
      name: desired.name,
      parent: {
        profileKey: desiredCategory.key,
        discordId: parentResolution.match?.id,
        name: desiredCategory.name,
      },
    };
    if (resolution.ambiguous) {
      result.channels.push(
        action("warning", label, "Ambiguous exact-name and parent match.", {
          resourceType: "channel",
          identity: desiredIdentity,
        }),
      );
    } else if (!resolution.match) {
      result.channels.push(
        action("create", label, "Channel does not exist under the desired category.", {
          resourceType: "channel",
          identity: desiredIdentity,
          fieldChanges: [
            fieldChange("name", undefined, desired.name),
            fieldChange("type", undefined, desired.type),
            fieldChange("parent", undefined, desiredCategory.name),
            fieldChange(
              "order",
              undefined,
              profile.channels
                .filter((channel) => channel.categoryKey === desired.categoryKey)
                .findIndex((channel) => channel.key === desired.key),
            ),
            ...[
              "topic",
              "nsfw",
              "rateLimitPerUser",
              "bitrate",
              "userLimit",
              "availableTags",
              "defaultReactionEmoji",
            ].flatMap((field) => {
              const value = (desired as unknown as Record<string, unknown>)[field];
              return value === undefined ? [] : [fieldChange(field, undefined, value)];
            }),
          ],
        }),
      );
    } else {
      const live = resolution.match;
      matchedChannelIds.add(live.id);
      liveChannelByDesiredKey.set(desired.key, live);
      const identity = { ...desiredIdentity, discordId: live.id };
      const channelFieldChanges = [
        ...(live.type === desired.type
          ? []
          : [fieldChange("type", live.type, desired.type)]),
        ...optionalFieldChanges(
          live as unknown as Record<string, unknown>,
          desired as unknown as Record<string, unknown>,
          [
            "topic",
            "nsfw",
            "rateLimitPerUser",
            "bitrate",
            "userLimit",
            "availableTags",
            "defaultReactionEmoji",
          ],
        ),
      ];
      if (channelFieldChanges.length > 0) {
        result.channels.push(
          action("update", label, "Channel fields differ.", {
            resourceType: "channel",
            identity,
            fieldChanges: channelFieldChanges,
          }),
        );
      } else if (channelOrderMismatches.has(desired.key)) {
        result.channels.push(
          action("reorder", label, "Channel order differs.", {
            resourceType: "channel",
            identity,
            fieldChanges: [
              fieldChange(
                "order",
                live.position,
                profile.channels
                  .filter((channel) => channel.categoryKey === desired.categoryKey)
                  .findIndex((channel) => channel.key === desired.key),
              ),
            ],
          }),
        );
      } else {
        result.channels.push(
          action("unchanged", label, "Matches desired channel.", {
            resourceType: "channel",
            identity,
          }),
        );
      }
    }
  }

  const desiredRolesByKey = new Map(profile.roles.map((role) => [role.key, role]));
  for (const rule of profile.permissionRules) {
    const permissionActions =
      rule.scope.type === "category"
        ? result.permissions.categoryOverwrites
        : result.permissions.channelOverwrites;
    const scope =
      rule.scope.type === "category"
        ? resolveCategory(
            categoriesByKey.get(rule.scope.key)?.name ?? "",
            snapshot.categories,
          ).match
        : liveChannelByDesiredKey.get(rule.scope.key);
    const desiredRole =
      rule.target.type === "role"
        ? desiredRolesByKey.get(rule.target.roleKey)
        : undefined;
    const target =
      rule.target.type === "everyone"
        ? resolveRole("@everyone", snapshot.roles).match
        : desiredRole
          ? resolveRole(desiredRole.name, snapshot.roles).match
          : undefined;
    const targetLabel =
      rule.target.type === "everyone" ? "@everyone" : (desiredRole?.name ?? "unknown role");
    const label = `${rule.scope.type} ${rule.scope.key} → ${targetLabel}`;
    const scopeName =
      rule.scope.type === "category"
        ? (categoriesByKey.get(rule.scope.key)?.name ?? rule.scope.key)
        : (profile.channels.find((channel) => channel.key === rule.scope.key)?.name ??
          rule.scope.key);
    const identity: ResourceIdentity = {
      profileKey: rule.key,
      discordId: scope && target ? `${scope.id}:${target.id}` : undefined,
      name: label,
      parent: {
        profileKey: rule.scope.key,
        discordId: scope?.id,
        name: scopeName,
      },
    };
    const desiredOverwrite: PermissionOverwriteState = {
      target: {
        profileKey: rule.target.type === "role" ? rule.target.roleKey : undefined,
        discordId: target?.id,
        name: targetLabel,
      },
      targetType: "role",
      allow: [...rule.allow].sort((a, b) => a.localeCompare(b)),
      deny: [...rule.deny].sort((a, b) => a.localeCompare(b)),
    };

    if (!scope || !target) {
      permissionActions.push(
        action("create", label, "Scope or target will need a new overwrite.", {
          resourceType: "permission-overwrite",
          identity,
          permissionChanges: diffPermissions([], rule.allow, [], rule.deny),
          permissionOverwrite: {
            scopeType: rule.scope.type,
            scope: { profileKey: rule.scope.key, name: scopeName },
            target: desiredOverwrite.target,
            targetType: "role",
            current: null,
            desired: desiredOverwrite,
          },
          desiredState: desiredOverwrite as unknown as Record<string, unknown>,
        }),
      );
      continue;
    }

    const overwrites = snapshot.permissionOverwrites.filter(
      (overwrite) =>
        overwrite.channelId === scope.id &&
        overwrite.targetType === "role" &&
        overwrite.targetId === target.id,
    );
    if (overwrites.length > 1) {
      permissionActions.push(
        action("warning", label, "Ambiguous permission overwrite match.", {
          resourceType: "permission-overwrite",
          identity,
        }),
      );
    } else if (overwrites.length === 0) {
      permissionActions.push(
        action("create", label, "Permission overwrite is missing.", {
          resourceType: "permission-overwrite",
          identity,
          permissionChanges: diffPermissions([], rule.allow, [], rule.deny),
          permissionOverwrite: {
            scopeType: rule.scope.type,
            scope: {
              profileKey: rule.scope.key,
              discordId: scope.id,
              name: scopeName,
            },
            target: desiredOverwrite.target,
            targetType: "role",
            current: null,
            desired: desiredOverwrite,
          },
          desiredState: desiredOverwrite as unknown as Record<string, unknown>,
        }),
      );
    } else if (
      !sameSet(rule.allow, overwrites[0].allow) ||
      !sameSet(rule.deny, overwrites[0].deny)
    ) {
      const currentOverwrite: PermissionOverwriteState = {
        target: {
          discordId: target.id,
          name: targetLabel,
        },
        targetType: overwrites[0].targetType,
        allow: [...overwrites[0].allow].sort((a, b) => a.localeCompare(b)),
        deny: [...overwrites[0].deny].sort((a, b) => a.localeCompare(b)),
      };
      permissionActions.push(
        action("update", label, "Allow or deny permissions differ.", {
          resourceType: "permission-overwrite",
          identity,
          permissionChanges: diffPermissions(
            overwrites[0].allow,
            rule.allow,
            overwrites[0].deny,
            rule.deny,
          ),
          permissionOverwrite: {
            scopeType: rule.scope.type,
            scope: {
              profileKey: rule.scope.key,
              discordId: scope.id,
              name: scopeName,
            },
            target: desiredOverwrite.target,
            targetType: "role",
            current: currentOverwrite,
            desired: desiredOverwrite,
          },
          currentState: currentOverwrite as unknown as Record<string, unknown>,
          desiredState: desiredOverwrite as unknown as Record<string, unknown>,
        }),
      );
    } else {
      permissionActions.push(
        action("unchanged", label, "Matches desired permission overwrite.", {
          resourceType: "permission-overwrite",
          identity,
        }),
      );
    }
  }

  for (const desired of profile.channels.filter(
    (channel) => channel.permissionMode === "inherit",
  )) {
    const category = categoriesByKey.get(desired.categoryKey);
    if (!category) continue;
    const live = liveChannelByDesiredKey.get(desired.key);
    const label = `${category.name} / ${desired.name}`;
    const parentLive = resolveCategory(category.name, snapshot.categories).match;
    const identity: ResourceIdentity = {
      profileKey: desired.key,
      discordId: live?.id,
      name: desired.name,
      parent: {
        profileKey: category.key,
        discordId: parentLive?.id,
        name: category.name,
      },
    };
    if (!live) {
      result.permissions.synchronization.push(
        action(
          "sync-permissions",
          label,
          "New or ambiguous channel must inherit its parent category overwrites.",
          {
            resourceType: "permission-sync",
            identity,
          },
        ),
      );
      continue;
    }

    const desiredParentOverwrites = profile.permissionRules
      .filter(
        (rule) =>
          rule.scope.type === "category" && rule.scope.key === desired.categoryKey,
      )
      .map((rule) => {
        const desiredTargetRole =
          rule.target.type === "role"
            ? desiredRolesByKey.get(rule.target.roleKey)
            : undefined;
        const liveTarget =
          rule.target.type === "everyone"
            ? resolveRole("@everyone", snapshot.roles).match
            : desiredTargetRole
              ? resolveRole(desiredTargetRole.name, snapshot.roles).match
              : undefined;
        return liveTarget
          ? {
              channelId: live.parentId ?? "",
              channelName: category.name,
              targetId: liveTarget.id,
              targetType: "role" as const,
              allow: rule.allow,
              deny: rule.deny,
            }
          : undefined;
      })
      .filter(
        (overwrite): overwrite is NonNullable<typeof overwrite> =>
          overwrite !== undefined,
      );
    const currentChannelOverwrites = snapshot.permissionOverwrites.filter(
      (overwrite) => overwrite.channelId === live.id,
    );
    const contentsMatch =
      desiredParentOverwrites.length ===
        profile.permissionRules.filter(
          (rule) =>
            rule.scope.type === "category" &&
            rule.scope.key === desired.categoryKey,
        ).length &&
      desiredParentOverwrites.length === currentChannelOverwrites.length &&
      desiredParentOverwrites.every((expected) =>
        currentChannelOverwrites.some(
          (current) =>
            current.targetType === expected.targetType &&
            current.targetId === expected.targetId &&
            sameSet(current.allow, expected.allow) &&
            sameSet(current.deny, expected.deny),
        ),
      );
    const synchronizationUnknown =
      live.permissionsLocked !== true && live.permissionsLocked !== false;
    const roleById = new Map(snapshot.roles.map((role) => [role.id, role]));
    const toOverwriteState = (
      overwrite: (typeof currentChannelOverwrites)[number],
    ): PermissionOverwriteState => ({
      target: {
        discordId: overwrite.targetId,
        name: roleById.get(overwrite.targetId)?.name ?? overwrite.targetId,
      },
      targetType: overwrite.targetType,
      allow: [...overwrite.allow].sort((a, b) => a.localeCompare(b)),
      deny: [...overwrite.deny].sort((a, b) => a.localeCompare(b)),
    });
    const currentStates = currentChannelOverwrites.map(toOverwriteState);
    const desiredStates = desiredParentOverwrites.map(toOverwriteState);
    const currentByTarget = new Map(
      currentStates.map((overwrite) => [overwrite.target.discordId, overwrite]),
    );
    const desiredByTarget = new Map(
      desiredStates.map((overwrite) => [overwrite.target.discordId, overwrite]),
    );
    const targetIds = [...new Set([...currentByTarget.keys(), ...desiredByTarget.keys()])]
      .filter((targetId): targetId is string => targetId !== undefined)
      .sort((a, b) => {
        const aName = roleById.get(a)?.name ?? a;
        const bName = roleById.get(b)?.name ?? b;
        return aName.localeCompare(bName);
      });
    const overwriteDifferences = targetIds
      .map((targetId) => {
        const current = currentByTarget.get(targetId);
        const desiredState = desiredByTarget.get(targetId);
        return {
          target: desiredState?.target ?? current?.target ?? { discordId: targetId, name: targetId },
          changes: diffPermissions(
            current?.allow ?? [],
            desiredState?.allow ?? [],
            current?.deny ?? [],
            desiredState?.deny ?? [],
          ),
        };
      })
      .filter((difference) => hasPermissionChanges(difference.changes));
    const reasons: string[] = [];
    if (!contentsMatch) reasons.push("channel overwrites differ from the desired parent");
    if (live.permissionsLocked === false) reasons.push("permissionsLocked is false");
    const synchronization: SynchronizationDetails = {
      currentMode:
        live.permissionsLocked === true
          ? "inherited"
          : live.permissionsLocked === false
            ? "custom-overwrites"
            : "unknown",
      desiredMode: "inherit",
      permissionsLocked: live.permissionsLocked ?? null,
      currentParent: live.parentId
        ? {
            discordId: live.parentId,
            name:
              snapshot.categories.find((item) => item.id === live.parentId)?.name ??
              live.parentId,
          }
        : null,
      desiredParent: {
        profileKey: category.key,
        discordId: parentLive?.id,
        name: category.name,
      },
      currentOverwrites: currentStates,
      desiredParentOverwrites: desiredStates,
      overwritesDiffer: !contentsMatch,
      overwriteDifferences,
      reasons,
      action: "synchronize channel permissions with the parent category",
    };

    if (!contentsMatch || live.permissionsLocked === false) {
      result.permissions.synchronization.push(
        action("sync-permissions", label, `${reasons.join(" and ")}.`, {
          resourceType: "permission-sync",
          identity,
          synchronization,
          currentState: {
            permissionsLocked: synchronization.permissionsLocked,
            overwrites: synchronization.currentOverwrites,
          },
          desiredState: {
            permissionMode: "inherit",
            parent: synchronization.desiredParent,
            overwrites: synchronization.desiredParentOverwrites,
          },
          dependencies: profile.permissionRules
            .filter(
              (rule) =>
                rule.scope.type === "category" &&
                rule.scope.key === desired.categoryKey,
            )
            .map((rule) => rule.key),
        }),
      );
    } else {
      result.permissions.synchronization.push(
        action(
          "unchanged",
          label,
          live.permissionsLocked === true
            ? "Permissions are locked and match the desired parent overwrites."
            : "Overwrite contents match the desired parent; lock state is unknown.",
          {
            resourceType: "permission-sync",
            identity,
            synchronization,
          },
        ),
      );
    }

    if (synchronizationUnknown) {
      result.permissions.synchronization.push(
        action(
          "warning",
          label,
          "Snapshot does not expose permissionsLocked; synchronization state is unknown.",
          {
            resourceType: "permission-sync",
            identity,
            synchronization,
          },
        ),
      );
    }
  }

  for (const role of snapshot.roles.filter((item) => !matchedRoleIds.has(item.id))) {
    const detail = role.managed
      ? "Managed role excluded from the profile; it will never be modified."
      : "System or out-of-profile role; no action is planned.";
    result.unmanaged.push(action("warning", `Role: ${role.name}`, detail));
  }
  for (const category of snapshot.categories.filter(
    (item) => !matchedCategoryIds.has(item.id),
  )) {
    result.unmanaged.push(
      action(
        "warning",
        `Category: ${category.name}`,
        "Unmanaged existing category; deletion is not supported.",
      ),
    );
  }
  for (const channel of snapshot.channels.filter(
    (item) => !matchedChannelIds.has(item.id),
  )) {
    const parent = snapshot.categories.find((category) => category.id === channel.parentId);
    result.unmanaged.push(
      action(
        "warning",
        `Channel: ${parent ? `${parent.name} / ` : "uncategorized / "}${channel.name}`,
        "Unmanaged existing channel; deletion is not supported.",
      ),
    );
  }
  result.unmanaged.push(
    action(
      "warning",
      "Community-designated channels",
      "Require manual verification before any future deletion.",
    ),
  );

  return result;
}
