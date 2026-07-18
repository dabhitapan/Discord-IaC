import "./bootstrap.js";
import path from "node:path";
import { ChannelType, PermissionFlagsBits } from "discord.js";
import { loadProfile } from "./profileLoader.js";
import type { DesiredProfile } from "../planner/types.js";
import { reportCliError } from "../utils/cliError.js";
import { getProfileDirectory } from "./profileSelection.js";

const validPermissions = new Set(Object.keys(PermissionFlagsBits));
const supportedChannelTypes = new Set([
  "GuildText",
  "GuildNews",
  "GuildForum",
  "GuildVoice",
]);

function findDuplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }

  return [...duplicates];
}

function checkUnique(
  label: string,
  values: string[],
  errors: string[],
): void {
  for (const duplicate of findDuplicates(values)) {
    errors.push(`Duplicate ${label}: ${JSON.stringify(duplicate)}.`);
  }
}

function validateNoDiscordIds(value: unknown, location: string, errors: string[]): void {
  if (typeof value === "string" && /^\d{17,20}$/.test(value)) {
    errors.push(`Discord ID found at ${location}; profiles must use logical keys.`);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      validateNoDiscordIds(item, `${location}[${index}]`, errors),
    );
    return;
  }

  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (/^(id|.*Id)$/i.test(key)) {
        errors.push(`Discord ID field ${location}.${key} is not allowed in a profile.`);
      }
      validateNoDiscordIds(child, `${location}.${key}`, errors);
    }
  }
}

function validatePermissionList(
  permissions: string[],
  location: string,
  errors: string[],
): void {
  checkUnique(`permission in ${location}`, permissions, errors);
  for (const permission of permissions) {
    if (!validPermissions.has(permission)) {
      errors.push(`Invalid permission ${JSON.stringify(permission)} in ${location}.`);
    }
  }
}

export function validateProfile(profile: DesiredProfile): string[] {
  const errors: string[] = [];
  const roleKeys = new Set(profile.roles.map((role) => role.key));
  const categoryKeys = new Set(profile.categories.map((category) => category.key));
  const channelKeys = new Set(profile.channels.map((channel) => channel.key));

  checkUnique("role key", profile.roles.map((role) => role.key), errors);
  checkUnique("role name", profile.roles.map((role) => role.name), errors);
  checkUnique("category key", profile.categories.map((category) => category.key), errors);
  checkUnique("channel key", profile.channels.map((channel) => channel.key), errors);
  checkUnique("permission rule key", profile.permissionRules.map((rule) => rule.key), errors);

  for (const role of profile.roles) {
    validatePermissionList(role.permissions, `role ${role.key}.permissions`, errors);
    validatePermissionList(
      role.deniedPermissions,
      `role ${role.key}.deniedPermissions`,
      errors,
    );
    const denied = new Set(role.deniedPermissions);
    for (const permission of role.permissions) {
      if (denied.has(permission)) {
        errors.push(`Role ${role.key} both grants and denies ${permission}.`);
      }
    }
  }

  for (const channel of profile.channels) {
    if (!categoryKeys.has(channel.categoryKey)) {
      errors.push(
        `Channel ${channel.key} references unknown category ${channel.categoryKey}.`,
      );
    }
    if (
      !supportedChannelTypes.has(channel.type) ||
      ChannelType[channel.type] === undefined
    ) {
      errors.push(`Channel ${channel.key} has invalid type ${channel.type}.`);
    }
  }

  checkUnique(
    "channel name within category",
    profile.channels.map((channel) => `${channel.categoryKey}\u0000${channel.name}`),
    errors,
  );

  for (const rule of profile.permissionRules) {
    const scopeExists =
      rule.scope.type === "category"
        ? categoryKeys.has(rule.scope.key)
        : channelKeys.has(rule.scope.key);
    if (!scopeExists) {
      errors.push(
        `Permission rule ${rule.key} references unknown ${rule.scope.type} ${rule.scope.key}.`,
      );
    }
    if (rule.target.type === "role" && !roleKeys.has(rule.target.roleKey)) {
      errors.push(
        `Permission rule ${rule.key} references unknown role ${rule.target.roleKey}.`,
      );
    }
    validatePermissionList(rule.allow, `rule ${rule.key}.allow`, errors);
    validatePermissionList(rule.deny, `rule ${rule.key}.deny`, errors);
    const denied = new Set(rule.deny);
    for (const permission of rule.allow) {
      if (denied.has(permission)) {
        errors.push(`Permission rule ${rule.key} both allows and denies ${permission}.`);
      }
    }
  }

  const explicitChannelRuleKeys = new Set(
    profile.permissionRules
      .filter((rule) => rule.scope.type === "channel")
      .map((rule) => rule.scope.key),
  );
  for (const channel of profile.channels) {
    if (
      channel.permissionMode === "inherit" &&
      explicitChannelRuleKeys.has(channel.key)
    ) {
      errors.push(
        `Channel ${channel.key} uses permissionMode inherit and also has explicit channel permission rules.`,
      );
    }
  }

  validateNoDiscordIds(profile, "profile", errors);
  return errors;
}

async function main(): Promise<void> {
  const profileDirectory = process.argv[2] ?? getProfileDirectory();
  const profile = await loadProfile(profileDirectory);
  const errors = validateProfile(profile);

  if (errors.length > 0) {
    errors.forEach((error) => console.error(`- ${error}`));
    throw new Error(`Profile validation failed with ${errors.length} error(s).`);
  }

  console.log(`Profile valid: ${profile.metadata.name}`);
  console.log(`Profile directory: ${path.resolve(profileDirectory)}`);
  console.log(
    `Validated ${profile.roles.length} roles, ${profile.categories.length} categories, ${profile.channels.length} channels, and ${profile.permissionRules.length} permission rules.`,
  );
  console.log("No Discord changes were made.");
}

if (require.main === module) {
  main().catch((error: unknown) => {
    reportCliError(error);
    process.exitCode = 1;
  });
}
