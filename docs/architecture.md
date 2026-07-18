# Discord IaC architecture

## Design goals

Discord IaC separates Discord API access from deterministic configuration validation and comparison. Network-aware code is limited to snapshot creation; planning code consumes ordinary JSON and can be run safely without credentials or a Discord connection.

This boundary keeps desired-state modeling testable, makes plans reproducible, and ensures the guarded writer consumes reviewed operations instead of recalculating intent.

## Current data flow

```text
Discord API
    │
    ▼
read-only exporter
    │
    ▼
exports/*.json (current snapshot)
    │
    ├──────────────┐
    ▼              ▼
snapshot audit   resolver ◀── profile loader and validator ◀── profiles/<key>/*.json
                   │
                   ▼
             offline planner
                   │
                   ▼
          formatted descriptive plan
```

The current components are:

- `src/discord.ts`: constructs the Discord client with the `Guilds` intent and fetches one guild.
- `src/exporter.ts`: fetches roles and channels and writes deterministic snapshots.
- `exports/`: represents current server state, including live Discord IDs.
- `src/config/`: loads desired profiles and validates their logical keys and references.
- `src/planner/snapshotAudit.ts`: audits a local snapshot without loading Discord credentials.
- `src/planner/resolver.ts`: matches desired resources to snapshot resources and derives actions.
- `src/planner/diffTypes.ts`: defines the structured operation contract, identities, field changes, permission deltas, and synchronization details.
- `src/planner/diffEngine.ts`: provides pure diff helpers, deterministic operation flattening, summaries, and machine-readable plan documents.
- `src/planner/formatter.ts`: renders the concise offline plan without making comparison decisions.
- `src/planner/diffFormatter.ts`: renders only changed fields from the same structured operations.
- `profiles/`: represents desired state without Discord IDs.

The exporter is not invoked by validation, auditing, or planning. A snapshot must be refreshed explicitly.

## Planner and detailed diff

`npm run plan` is the concise review surface. It groups operations by resource and reports stable action totals. `npm run diff` renders the field-level details behind creates, moves, move-and-updates, updates, reorders, permission-overwrite changes, and permission synchronization. `npm run diff:json` writes the same operations deterministically to `plans/wao-noobs.plan.json`.

## Channel identity and migrations

Channel resolution is profile-local and type-safe. It checks exact name plus compatible type under the desired parent first. If that parent changed or does not yet exist, it searches the snapshot guild for a unique exact name plus compatible type, then for a unique normalized exact match. Normalization trims, lowercases, and treats repeated whitespace and hyphens consistently. It never performs substring or fuzzy matching and never matches incompatible channel types.

A unique guild-wide match preserves the existing channel ID. A different parent produces `move`; a simultaneous desired field change produces `move-and-update`. Parent and desired order are represented as field changes in the deterministic artifact. Matching candidates are not reported as unmanaged. If multiple compatible candidates remain, the planner emits a blocking ambiguity operation and suppresses replacement creation.

The current desired-profile schema has stable logical channel keys but no stored Discord-ID binding. A future identity registry or optional ID binding can be inserted ahead of name matching without changing the fallback rules. For now, ambiguous names require manual resolution.

Moves are descriptive and planning-only. They are deliberately unsupported by the Discord writer, so plan safety marks the artifact non-executable and apply aborts before any write. The safe migration workflow is: refresh the read-only snapshot explicitly, review `plan` and `diff`, resolve all ambiguity, save and review the deterministic artifact, and only add guarded move execution in a separately tested phase. No step deletes old channels or categories.

Resolution and comparison happen once in the pure planner layer. Human-readable and JSON formatters consume the resulting structured operations and never decide independently whether values differ. The model includes current and desired values, stable profile keys, available Discord IDs, target identities, complete overwrite states, and synchronization reasons. It is intended to become the reviewed input contract for a future guarded apply engine, which must not recalculate an unreviewed diff.

All three planner and diff commands are fully offline and do not construct a Discord client.

## Permission inheritance

Channels may declare `permissionMode: "inherit"`. The planner compares their current channel-level overwrites with the complete desired overwrite set of the parent category. It can describe a `sync-permissions` action when contents differ, when a newer snapshot reports `permissionsLocked: false`, or when stale independent overwrites exist.

Older snapshots without `permissionsLocked` remain supported. Their overwrite contents are compared, and their unknown synchronization state is reported as a warning.

Explicit channel-level rules, such as read-only public announcement permissions, are separate from inherited category permissions. Validation prevents a channel from combining explicit rules with inheritance mode.

## Guarded apply data flow

```text
fresh live snapshot
    │
    ▼
drift check
    │
    ▼
detailed diff
    │
    ▼
guarded operation list
    │
    ▼
backup
    │
    ▼
explicitly authorized apply
    │
    ▼
post-apply verification
    │
    ▼
new snapshot
```

The apply layer consumes a reviewed, guarded structured operation list rather than planning and mutating in one pass. It verifies a fresh snapshot, detects drift, protects managed resources, creates a recoverable backup, requires explicit authorization, verifies each operation, exports post-apply state, and requires convergence.

Discord API writes should remain isolated from profile parsing and pure comparison logic. The resolver and planner should stay deterministic and independently testable, with no token access, client construction, or implicit network calls.

`src/discord/writer.ts` is the only Discord mutation adapter. `src/apply/engine.ts` is dependency-injected and tested with mocks. Canonical hashes cover combined snapshot and profile objects, while generated plan artifacts exclude timestamps and local paths.
