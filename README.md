# Discord IaC

## Overview

Discord IaC treats Discord server configuration as code. It separates a server's current exported state from reusable desired-state profiles, then validates and compares those inputs without making changes to Discord.

Offline inspection and planning remain the default workflow. v1.0 also includes narrowly scoped guarded apply and restore commands; they require a saved plan or backup, live identity checks, exact confirmation phrases, and pre-write backups.

Discord IaC is an independent project and is not affiliated with, endorsed by, or sponsored by Discord.

## Current capabilities

- Read-only Discord server export using `discord.js`
- Deterministic, human-readable JSON snapshots
- Reusable desired-state profiles built around logical keys rather than Discord IDs
- Profile validation for names, references, channel types, and permissions
- Completely offline change planning
- Structured, field-level offline diffs with deterministic JSON output
- Offline snapshot auditing
- Permission-inheritance and synchronization analysis
- Detection and reporting of unmanaged resources
- Canonical snapshot/profile hashing and executable plan artifacts
- Guarded apply for supported operations, with drift checks and backups
- Conservative restore for existing resources
- Live read-only drift detection and offline verification
- No deletion support
- Deterministic offline Content-as-Code loading, Markdown block parsing, hashing, planning, and diffing
- Local profile-scoped content registry format without Discord message IDs
- Validated per-profile content manifests with logical channel targets
- Deterministic machine-readable content plans written only with explicit `--out`
- Offline logical target resolution against desired-profile channel keys and names

## Architecture

Discord IaC is evolving toward Community-as-Code. Infrastructure remains one independent layer, and the new Content layer provides architecture for permanent documentation and messages without implementing synchronization yet.

The three project layers are:

- **Infrastructure-as-Code:** desired roles, categories, channels, and permissions, compared with exported Discord snapshots.
- **Content-as-Code:** future source-controlled rules, FAQ, guides, welcome messages, announcements, and event templates rendered from Markdown.
- **Community-as-Code:** the long-term composition of infrastructure, content, translations, workflows, and a future Web UI.

Discord API access remains isolated. Infrastructure validation and planning operate on local files. Future content loading, parsing, translation preparation, planning, and diffing must also remain offline; only an explicit guarded Content Apply may eventually write messages.

At a high level, the exporter writes the current state to `exports/`. The profile loader reads desired state from `profiles/`. The offline planner resolves logical resources against the snapshot and produces descriptive actions such as `create`, `update`, `reorder`, and `sync-permissions`.

See [Infrastructure architecture](docs/architecture.md) for existing data flows and [Content architecture](docs/content-architecture.md) for the new layer, message-registry design, safety model, and roadmap.

## Project structure

```text
Discord-IaC/
├── docs/                     Project documentation
├── exports/                  Current server snapshots
├── profiles/                 Desired server configurations
│   └── wao-noobs/            WAO Noobs example profile
├── src/
│   ├── config/               Profile loading and validation
│   ├── planner/              Snapshot audit, resolution, planning, formatting
│   ├── apply/                Guarded apply orchestration
│   ├── backup/               Backup creation and loading
│   ├── discord/              Isolated Discord write adapter
│   ├── engine/               Safety, drift, verification, confirmation
│   ├── restore/              Conservative restore planning and command
│   ├── discord.ts            Discord client creation and guild fetching
│   ├── exporter.ts           Read-only snapshot exporter
│   ├── index.ts              Export command entry point
│   ├── logger.ts             Export logging
│   └── types.ts              Exported snapshot types
├── package.json
└── tsconfig.json
```

## Profiles

The two state directories serve different purposes:

- `exports/` contains snapshots of the current live Discord server. Snapshots include Discord IDs because they describe existing resources.
- `profiles/` contains desired server state. Profiles use stable logical keys and must not contain Discord IDs.
- `profiles/wao-noobs/` is one concrete profile for the WAO Noobs server, not the identity of the generic tool.
- `PROFILE` selects a desired profile directory. It defaults to `wao-noobs`, so existing commands remain backward-compatible.

A profile defines metadata, ordered roles, categories, channels, role permissions, category overwrites, explicit channel overwrites, and permission-inheritance intent.

Each profile may also contain canonical English Markdown under `content/english/`, an authoritative `content/content.json` manifest, and future reviewed translations under `content/translations/`. Infrastructure commands do not load these files.

The concise planner answers which resources require attention. The detailed diff explains the exact field, permission, overwrite, and inheritance changes behind those actions. Both commands consume the same structured operations produced by the pure comparison layer; terminal formatting does not recalculate differences.

## Content manifests

`profiles/<PROFILE>/content/content.json` declares exactly which Markdown documents Content-as-Code manages. Files not declared by the manifest are warned about and never planned automatically.

```json
{
  "version": 1,
  "sourceLanguage": "en",
  "documents": [
    {
      "id": "rules",
      "file": "english/rules.md",
      "targetChannel": "rules",
      "order": 10,
      "enabled": true,
      "pinned": true,
      "languages": ["en"]
    }
  ]
}
```

`targetChannel` is a logical channel name or profile key, not a Discord ID. Resolution uses the selected local desired-state profile—never exports or live Discord—and prefers exact channel keys before normalized names. Use `null` when placement is not yet known; planning reports this explicitly. The validator rejects unsupported versions or languages, duplicate IDs/files/orders, invalid booleans or targets, missing Markdown, unsafe paths, manifests without an enabled document, ambiguous targets, and unsupported destination types.

Logical normalization trims whitespace, lowercases text, collapses repeated spaces or hyphens, and treats spaces and Discord-style hyphens consistently. It does not perform fuzzy matching. Text and announcement channels are supported. Forum, voice, and category targets are rejected because ordinary message placement is not defined for them. Missing matches and `null` targets remain warnings so profiles can be completed incrementally.

## Commands

| Command | Purpose | Discord access |
| --- | --- | --- |
| `npm run dev` | Run the read-only exporter from TypeScript | Connects |
| `npm run export` | Export the configured server to `exports/*.json` | Connects |
| `npm run validate:profile` | Validate the selected `profiles/<PROFILE>` directory | Offline |
| `npm run profile:init -- --profile <key> --source <snapshot>` | Initialize a desired profile while preserving the raw snapshot | Offline |
| `npm run audit:snapshot` | Audit the local snapshot for structural and permission issues | Offline |
| `npm run plan` | Compare the desired profile with local snapshots | Offline |
| `npm run diff` | Print detailed field-level structured operations | Offline |
| `npm run diff:json` | Write deterministic operations to `plans/wao-noobs.plan.json` | Offline |
| `npm run plan:write` | Write the hashed executable/non-executable plan artifact | Offline |
| `npm run verify` | Verify a local snapshot; exits 1 when actions remain | Offline |
| `npm run drift` | Compare fresh live read-only state with a saved plan | Connects, read-only |
| `npm run apply` | Guarded supported writes after exact confirmation | Connects, writes |
| `npm run restore -- --dry-run <path>` | Preview conservative restore operations | Connects, read-only |
| `npm run restore -- --backup <path>` | Guarded restore of supported existing resources | Connects, writes |
| `npm run cli -- --help` | Show consolidated CLI commands and safety labels | Offline |
| `npm run content:plan` | Build an offline content plan from English Markdown and the local registry | Offline |
| `npm run content:plan -- --out <path>` | Also write a deterministic machine-readable plan artifact | Offline |
| `npm run content:diff` | Compare English Markdown hashes with the local registry | Offline |
| `npm run content:validate` | Validate content files and resolve logical targets against the selected desired profile | Offline |
| `npm run content:apply` | Placeholder for future guarded content apply | Offline; no writes implemented |
| `npm run content:verify` | Placeholder for future content verification | Offline |
| `npm test` | Run focused tests for the pure diff engine | Offline |
| `npm run typecheck` | Check TypeScript without emitting files | Offline |
| `npm run build` | Compile TypeScript into `dist/` | Offline |
| `npm start` | Run the compiled read-only exporter after a build | Connects |

Online commands require valid environment configuration. `export` and `drift` are read-only. `apply` and non-dry-run `restore` can write only after their full safety workflows and exact guild-name confirmations.

## Safety model

- There is no delete support.
- Managed Discord roles and the `@everyone` server role are protected from modification.
- The planner is offline and compares only profiles with exported snapshots.
- `.env` is excluded from Git.
- Desired profiles use logical keys and do not store Discord IDs.
- Generated snapshot JSON is excluded from Git by default.
- Structured operations are the reviewed contract used by the writer; the writer does not recalculate intent.
- Apply aborts on drift, changed operations, ambiguity, unsupported work, unresolved IDs, guild mismatch, or backup failure.
- Apply confirmation must exactly match `APPLY <guild name>`.
- Restore confirmation must exactly match `RESTORE <guild name>`.
- Existing unmanaged resources and Community-designated channels remain untouched.
- Exporting uses only the `Guilds` gateway intent and always destroys the client in a `finally` block.

## WAO Noobs example

The included `profiles/wao-noobs` profile demonstrates a complete desired configuration for the WAO Noobs Discord server. It includes ordered roles, public and private category layouts, explicit read-only announcement rules, and inherited permission modes for private Alliance HQ and Staff channels.

The Discord bot may continue to be named WAO Server Setup. Bot and server names are independent of the Discord IaC product name.

## Roadmap

The v1.0 infrastructure foundation is complete. Community-as-Code will be introduced incrementally:

1. **Content Sync:** extend the completed manifest, loading, parsing, hashing, registry, plan artifact, diff, and local target resolution foundation with read-only live verification, then guarded message updates.
2. **Translation:** checked-in human translations first, followed by optional provider adapters with explicit review and per-language planning. No translation or AI integration exists today.
3. **Web UI:** read-only inspection and local editing first, then authenticated plan review using the same guarded engines as the CLI.

See [ROADMAP.md](ROADMAP.md) for infrastructure improvements and [Content architecture](docs/content-architecture.md) for the detailed Community-as-Code roadmap.

## Local setup

1. Install a supported Node.js version and npm.
2. Install dependencies:

   ```sh
   npm install
   ```

3. Create a local `.env` file containing the required environment variables.
4. Validate the example profile and inspect the existing snapshot offline:

   ```sh
   npm run validate:profile
   npm run audit:snapshot
   npm run plan
   ```

5. Run `npm run export` only when a fresh live snapshot is intentionally required.

## Environment variables

The read-only exporter requires:

- `DISCORD_TOKEN`: bot token used to authenticate the Discord client
- `GUILD_ID`: Discord server to export
- `PROFILE`: optional desired-profile key, such as `wao-noobs` or `titanz`; defaults to `wao-noobs`

These variables are needed by online commands: `dev`, `export`, `start`, `drift`, `apply`, and `restore`. Do not commit `.env`, disclose token values, or place secrets in profiles, plans, backups, or snapshots.

## Known limitations

- Deletion is never supported in v1.0.
- Apply supports existing role updates, overwrite create/update, and permission synchronization. Resource creates and reorders abort as unsupported.
- Restore does not recreate missing resources, delete new resources, or restore every channel/server property.
- Older snapshots may not include `permissionsLocked`; synchronization state is then reported as unknown and inferred from overwrite contents.
- Matching currently relies on exact role names, exact category names, and exact channel name plus parent category.
- Ambiguous matches require manual resolution.
- Desired profiles do not yet cover every Discord resource type or server setting.
- Snapshot freshness is the operator's responsibility; offline plans are only as current as their input exports.

See [Safety](docs/safety.md), [Operations](docs/operations.md), [Backup and restore](docs/backup-and-restore.md), and [CLI](docs/cli.md) for exact behavior and exit codes.
