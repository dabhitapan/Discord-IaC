import assert from "node:assert/strict";
import test from "node:test";
import { createPlanDocument, diffPermissions, flattenPlan } from "./diffEngine.js";
import { buildPlan, resolveChannel } from "./resolver.js";
import { validatePlanSafety } from "../engine/planSafety.js";
import type { DesiredProfile, LiveSnapshot } from "./types.js";

function profile(overrides: Partial<DesiredProfile> = {}): DesiredProfile {
  return {
    metadata: { key: "test", name: "Test Guild", version: 1 },
    roles: [
      {
        key: "staff",
        name: "Staff",
        permissions: ["ViewChannel"],
        deniedPermissions: [],
      },
    ],
    categories: [
      { key: "alpha", name: "Alpha" },
      { key: "beta", name: "Beta" },
    ],
    channels: [
      {
        key: "alpha-general",
        name: "general",
        type: "GuildText",
        categoryKey: "alpha",
      },
      {
        key: "beta-general",
        name: "general",
        type: "GuildText",
        categoryKey: "beta",
      },
    ],
    permissionRules: [],
    ...overrides,
  };
}

function snapshot(overrides: Partial<LiveSnapshot> = {}): LiveSnapshot {
  return {
    server: { id: "guild-1", name: "Test Guild" },
    roles: [
      {
        id: "role-staff",
        name: "Staff",
        position: 1,
        managed: false,
        permissions: ["ViewChannel"],
        color: 0,
        hoist: false,
        mentionable: false,
      },
    ],
    categories: [
      { id: "category-alpha", name: "Alpha", position: 0 },
      { id: "category-beta", name: "Beta", position: 1 },
    ],
    channels: [
      {
        id: "channel-alpha",
        name: "general",
        type: "GuildText",
        parentId: "category-alpha",
        position: 0,
        permissionsLocked: true,
      },
      {
        id: "channel-beta",
        name: "general",
        type: "GuildText",
        parentId: "category-beta",
        position: 0,
        permissionsLocked: true,
      },
    ],
    permissionOverwrites: [],
    ...overrides,
  };
}

test("role permission additions and removals are exact and sorted", () => {
  assert.deepEqual(
    diffPermissions(
      ["ViewChannel", "MentionEveryone"],
      ["BanMembers", "KickMembers", "ViewChannel"],
    ),
    {
      allowAdded: ["BanMembers", "KickMembers"],
      allowRemoved: ["MentionEveryone"],
      denyAdded: [],
      denyRemoved: [],
    },
  );
});

test("permission overwrite allow and deny changes are separated", () => {
  assert.deepEqual(
    diffPermissions(["Connect"], ["ViewChannel"], ["SendMessages"], []),
    {
      allowAdded: ["ViewChannel"],
      allowRemoved: ["Connect"],
      denyAdded: [],
      denyRemoved: ["SendMessages"],
    },
  );
});

test("missing overwrite produces a complete create operation", () => {
  const desired = profile({
    permissionRules: [
      {
        key: "alpha-staff",
        scope: { type: "category", key: "alpha" },
        target: { type: "role", roleKey: "staff" },
        allow: ["ViewChannel"],
        deny: [],
      },
    ],
  });
  const operation = buildPlan(desired, snapshot()).permissions.categoryOverwrites[0];
  assert.equal(operation.action, "create");
  assert.equal(operation.permissionOverwrite?.current, null);
  assert.deepEqual(operation.permissionChanges?.allowAdded, ["ViewChannel"]);
});

test("channel field changes include only specified differing fields", () => {
  const desired = profile({
    channels: [
      {
        key: "alpha-general",
        name: "general",
        type: "GuildText",
        categoryKey: "alpha",
        topic: "desired topic",
      },
    ],
  });
  const live = snapshot({
    channels: [
      {
        id: "channel-alpha",
        name: "general",
        type: "GuildText",
        parentId: "category-alpha",
        position: 0,
        topic: "old topic",
      },
    ],
  });
  const operation = buildPlan(desired, live).channels[0];
  assert.equal(operation.action, "update");
  assert.deepEqual(operation.fieldChanges, [
    { field: "topic", before: "old topic", after: "desired topic" },
  ]);
});

test("role presentation properties produce field-level changes", () => {
  const desired = profile({
    roles: [
      {
        key: "staff",
        name: "Staff",
        permissions: ["ViewChannel"],
        deniedPermissions: [],
        color: 123,
        hoist: true,
        mentionable: true,
      },
    ],
  });
  const operation = buildPlan(desired, snapshot()).roles[0];
  assert.equal(operation.action, "update");
  assert.deepEqual(operation.fieldChanges.map((change) => change.field), [
    "color",
    "hoist",
    "mentionable",
  ]);
});

test("category order changes produce a structured reorder", () => {
  const live = snapshot({
    categories: [
      { id: "category-alpha", name: "Alpha", position: 1 },
      { id: "category-beta", name: "Beta", position: 0 },
    ],
  });
  const plan = buildPlan(profile(), live);
  assert.equal(plan.categories[0].action, "reorder");
  assert.equal(plan.categories[0].fieldChanges[0].field, "order");
  assert.equal(plan.categories[0].supported, false);
});

test("inheritance differences produce structured synchronization details", () => {
  const desired = profile({
    channels: [
      {
        key: "alpha-general",
        name: "general",
        type: "GuildText",
        categoryKey: "alpha",
        permissionMode: "inherit",
      },
    ],
    permissionRules: [
      {
        key: "alpha-staff",
        scope: { type: "category", key: "alpha" },
        target: { type: "role", roleKey: "staff" },
        allow: ["ViewChannel"],
        deny: [],
      },
    ],
  });
  const live = snapshot({
    channels: [
      {
        id: "channel-alpha",
        name: "general",
        type: "GuildText",
        parentId: "category-alpha",
        position: 0,
        permissionsLocked: false,
      },
    ],
  });
  const operation = buildPlan(desired, live).permissions.synchronization[0];
  assert.equal(operation.action, "sync-permissions");
  assert.equal(operation.synchronization?.desiredMode, "inherit");
  assert.equal(operation.synchronization?.permissionsLocked, false);
  assert.deepEqual(
    operation.synchronization?.overwriteDifferences[0].changes.allowAdded,
    ["ViewChannel"],
  );
});

test("matching resources remain unchanged without field dumps", () => {
  const plan = buildPlan(profile(), snapshot());
  assert.equal(plan.roles[0].action, "unchanged");
  assert.equal(plan.categories[0].action, "unchanged");
  assert.equal(plan.channels[0].action, "unchanged");
  assert.deepEqual(plan.channels[0].fieldChanges, []);
});

test("structured operation ordering and JSON are deterministic", () => {
  const desired = profile();
  const live = snapshot();
  const plan = buildPlan(desired, live);
  const first = JSON.stringify(createPlanDocument(desired, live, plan));
  const second = JSON.stringify(createPlanDocument(desired, live, buildPlan(desired, live)));
  assert.equal(first, second);
  assert.deepEqual(
    flattenPlan(plan).slice(0, 3).map((operation) => operation.resourceType),
    ["role", "category", "category"],
  );
});

test("duplicate channel names under different categories resolve by parent", () => {
  const desired = profile();
  const live = snapshot();
  const alpha = resolveChannel(desired.channels[0], desired.categories[0], live);
  const beta = resolveChannel(desired.channels[1], desired.categories[1], live);
  assert.equal(alpha.ambiguous, false);
  assert.equal(alpha.match?.id, "channel-alpha");
  assert.equal(beta.ambiguous, false);
  assert.equal(beta.match?.id, "channel-beta");
});

test("duplicate channel names under the same category are ambiguous", () => {
  const desired = profile({ channels: [profile().channels[0]] });
  const live = snapshot({
    channels: [
      snapshot().channels[0],
      { ...snapshot().channels[0], id: "channel-alpha-duplicate" },
    ],
  });
  const resolution = resolveChannel(desired.channels[0], desired.categories[0], live);
  assert.equal(resolution.ambiguous, true);
  assert.equal(buildPlan(desired, live).channels[0].action, "warning");
});

test("unique exact-name channel in another category plans a move and is not unmanaged", () => {
  const desired = profile({ channels: [profile().channels[0]] });
  const live = snapshot({
    channels: [
      {
        ...snapshot().channels[0],
        parentId: "category-beta",
      },
    ],
  });
  const plan = buildPlan(desired, live);
  assert.equal(plan.channels[0].action, "move");
  assert.equal(plan.channels[0].identity.discordId, "channel-alpha");
  assert.deepEqual(plan.channels[0].fieldChanges[0], {
    field: "parent",
    before: "Beta",
    after: "Alpha",
  });
  assert.equal(
    plan.unmanaged.some((operation) => operation.label.includes("general")),
    false,
  );
});

test("unique normalized-name channel in another category plans a move-and-update", () => {
  const desired = profile({
    channels: [
      {
        key: "general-chat",
        name: "general-chat",
        type: "GuildText",
        categoryKey: "alpha",
      },
    ],
  });
  const live = snapshot({
    channels: [
      {
        ...snapshot().channels[0],
        name: "General Chat",
        parentId: "category-beta",
      },
    ],
  });
  const operation = buildPlan(desired, live).channels[0];
  assert.equal(operation.action, "move-and-update");
  assert.equal(operation.fieldChanges.some((change) => change.field === "name"), true);
});

test("parent and channel field changes plan a move-and-update", () => {
  const desired = profile({
    channels: [{ ...profile().channels[0], topic: "Desired topic" }],
  });
  const live = snapshot({
    channels: [
      {
        ...snapshot().channels[0],
        parentId: "category-beta",
        topic: "Current topic",
      },
    ],
  });
  const operation = buildPlan(desired, live).channels[0];
  assert.equal(operation.action, "move-and-update");
  assert.deepEqual(
    operation.fieldChanges.map((change) => change.field),
    ["parent", "topic"],
  );
});

test("ambiguous cross-category matches block replacement creation", () => {
  const desired = profile({ channels: [profile().channels[0]] });
  const live = snapshot({
    categories: [
      ...snapshot().categories,
      { id: "category-gamma", name: "Gamma", position: 2 },
    ],
    channels: [
      { ...snapshot().channels[0], parentId: "category-beta" },
      {
        ...snapshot().channels[0],
        id: "channel-gamma",
        parentId: "category-gamma",
      },
    ],
  });
  const document = createPlanDocument(desired, live, buildPlan(desired, live));
  const operation = document.operations.find(
    (item) => item.resourceType === "channel" && item.identity.profileKey === "alpha-general",
  );
  assert.equal(operation?.action, "warning");
  assert.equal(operation?.ambiguous, true);
  assert.equal(document.ambiguityCount, 1);
  assert.equal(document.executable, false);
  assert.equal(
    document.operations.some(
      (item) => item.resourceType === "channel" && item.action === "create",
    ),
    false,
  );
});

test("one live channel cannot satisfy two cross-category desired identities", () => {
  const desired = profile();
  const live = snapshot({
    categories: [],
    channels: [
      {
        ...snapshot().channels[0],
        parentId: null,
      },
    ],
  });
  const plan = buildPlan(desired, live);
  assert.equal(plan.channels.every((operation) => operation.ambiguous), true);
  assert.equal(plan.channels.some((operation) => operation.action === "create"), false);
});

test("incompatible channel types are never migration matches", () => {
  const desired = profile({ channels: [profile().channels[0]] });
  const live = snapshot({
    channels: [
      {
        ...snapshot().channels[0],
        type: "GuildVoice",
        parentId: "category-beta",
      },
    ],
  });
  assert.equal(buildPlan(desired, live).channels[0].action, "create");
});

test("substring names are never migration matches", () => {
  const desired = profile({ channels: [profile().channels[0]] });
  const live = snapshot({
    channels: [
      {
        ...snapshot().channels[0],
        name: "general-archive",
        parentId: "category-beta",
      },
    ],
  });
  assert.equal(buildPlan(desired, live).channels[0].action, "create");
});

test("channel under its desired parent does not plan a move", () => {
  const desired = profile({ channels: [profile().channels[0]] });
  assert.equal(buildPlan(desired, snapshot()).channels[0].action, "unchanged");
});

test("migration artifacts are deterministic and unsupported moves block apply safety", () => {
  const desired = profile({ channels: [profile().channels[0]] });
  const live = snapshot({
    channels: [{ ...snapshot().channels[0], parentId: "category-beta" }],
  });
  const first = createPlanDocument(desired, live, buildPlan(desired, live));
  const second = createPlanDocument(desired, live, buildPlan(desired, live));
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(first.summary.move, 1);
  assert.equal(first.unsupportedOperationCount, 1);
  assert.throws(() => validatePlanSafety(first), /non-executable|unsupported/i);
});

test("migration resolution is profile-isolated and never plans deletes", () => {
  const selectedProfile = profile({ channels: [profile().channels[0]] });
  const live = snapshot({
    channels: [
      { ...snapshot().channels[0], parentId: "category-beta" },
      {
        id: "other-profile-channel",
        name: "other-profile-only",
        type: "GuildText",
        parentId: "category-alpha",
        position: 1,
      },
    ],
  });
  const document = createPlanDocument(
    selectedProfile,
    live,
    buildPlan(selectedProfile, live),
  );
  assert.equal(
    document.operations.some(
      (operation) => operation.identity.profileKey === "other-profile-only",
    ),
    false,
  );
  assert.equal(
    document.operations.some((operation) => (operation.action as string) === "delete"),
    false,
  );
});
