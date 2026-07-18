# Content and Community-as-Code architecture

## Scope of this phase

Phase 4 adds an explicitly invoked, strictly read-only live verifier for locally resolved destinations. Offline manifest validation, planning, diffing, hashing, and artifacts remain unchanged and credential-free. The verifier reads only guild and channel metadata; it does not inspect messages or create, edit, pin, or delete anything.

## Project layers

Discord IaC evolves into Community-as-Code through independent layers:

1. **Infrastructure-as-Code** describes roles, categories, channels, and permissions. Existing exporters, profiles, planners, apply, restore, verification, and drift behavior remain unchanged.
2. **Content-as-Code** will describe permanent community material in Markdown and manage the Discord messages that render it.
3. **Community-as-Code** will coordinate infrastructure, content, translations, events, and future user interfaces while preserving explicit plan, diff, verify, and apply boundaries.

Infrastructure snapshots remain in `exports/`. Infrastructure desired state and content sources live under the selected `profiles/<key>/` directory. Content code is isolated in `src/content/` and must not make the infrastructure planner depend on content.

## Source layout

```text
profiles/<profile>/content/
|-- content.json             authoritative managed-document manifest
|-- english/
|   |-- rules.md
|   |-- faq.md
|   |-- welcome.md
|   |-- beginner-guide.md
|   `-- events.md
`-- translations/
    `-- <language-code>/       future translated Markdown
```

The optional local comparison baseline is stored at `profiles/<profile>/content/.content-registry.json`. It is ignored by Git by default. Planning and diff commands only read this file; they never create or update it.

English is canonical. Planned translation language codes are `fr`, `de`, `es`, `pt`, `tr`, `ru`, and `zh`. Translated files must remain derived, reviewable content; no translation provider or AI service is configured in this phase.

## Manifest schema and validation

`content.json` is the source of truth for managed content. Automatic Markdown discovery no longer adds documents to a plan.

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

Validation requires version `1`, unique logical document IDs, unique source files and order values, supported language codes, booleans for `enabled` and `pinned`, and either a non-empty logical `targetChannel` or explicit `null`. Source paths must use forward-slash relative paths beneath `english/`, remain inside the selected profile's content directory after resolution, and reference existing Markdown files. At least one document must be enabled.

Enabled documents load by ascending manifest `order`, then document ID. Disabled documents remain declared but never enter the plan. Undeclared Markdown is reported and ignored. Validation errors name the profile, document, field, and reason.

Logical target channels are reviewed intent. Phase 3 resolves them only against `profiles/<PROFILE>/channels.json` and `categories.json`. A `null` target produces a planning warning instead of an invented mapping.

## Offline logical channel resolution

`OfflineLogicalChannelResolver` is a pure boundary between desired-profile loading and content planning. It never reads exports or constructs a Discord client.

Resolution proceeds deterministically:

1. Prefer an exact stable desired-profile channel key.
2. If no key matches, normalize the requested reference and compare it with local channel keys and names.
3. If no channel matches, compare categories so category references can be rejected explicitly.
4. Sort ambiguous candidates by logical key, name, and type.

Normalization trims surrounding whitespace, lowercases, collapses repeated whitespace or hyphens, and represents both spaces and hyphens with one hyphen. It deliberately avoids fuzzy matching, substring matching, stemming, aliases, or similarity scoring.

Resolution statuses are:

- `resolved`: exactly one text or announcement destination matches.
- `unresolved`: no desired-profile channel or category matches; validation continues with a warning.
- `not-configured`: the manifest target is `null`; validation continues with a warning.
- `ambiguous`: multiple supported channels match; validation fails.
- `invalid-target-type`: a forum, voice channel, or category matches; validation fails.

Text (`GuildText`) and announcement (`GuildNews`) destinations support future ordinary managed messages. Forum (`GuildForum`) targets are unsupported because no forum-post/thread model exists. Voice channels and categories cannot contain ordinary managed messages. The resolver does not mutate manifests or replace logical identities with Discord IDs.

## Content registry design

The future message registry maps a stable content identity to an existing Discord message:

```text
profile + content key + block key + language
    -> channel ID + Discord message ID + applied content hash
```

For example, the `rules` source can resolve to the existing rules message ID. A subsequent plan can compare the desired content hash with the registry hash and produce an `update` operation against that message rather than reposting it.

The local registry contains the profile key and each document's language, SHA256 hash, stable block IDs, and block hashes. It intentionally contains no Discord channel or message IDs. The file-backed implementation validates profile identity and writes deterministic, two-space-indented JSON atomically when explicitly called by future tooling. Plan and diff remain read-only. Registry entries no longer declared by the manifest produce orphan warnings and are never deleted.

## Component contracts

- `ContentLoader` loads only enabled, manifest-declared English content without Discord access; `FileContentLoader` is the implementation.
- `MarkdownParser` converts one source document into deterministic blocks; `DeterministicMarkdownParser` preserves Markdown source without rendering it.
- `TranslationProvider` is an optional future boundary; there is no implementation or external provider today.
- `MessageRegistry` resolves stable content identities to Discord channel and message IDs.
- `DiscordContentWriter` is the future isolated adapter for creating or updating messages.
- `Planner` creates a reviewable content plan; `OfflineContentPlanner` is implemented.
- `ContentDiffEngine` compares parsed desired content with registry state; `OfflineContentDiffEngine` is implemented.
- `Verifier` checks a plan or applied state without changing it.
- `ContentApplyEngine` is the only future orchestration boundary allowed to invoke writes.

The contracts are defined in `src/content/contracts.ts`; their shared data model is in `src/content/types.ts`; source and translation defaults are in `src/content/config.ts`. `FileContentRegistry` implements the local comparison registry. `content:validate`, `content:plan`, and `content:diff` are fully offline.

## Machine-readable plan artifacts

`npm run content:plan -- --out <path>` writes a canonical two-space-indented JSON artifact. Without `--out`, no artifact is written. The artifact contains schema version, selected profile, generation timestamp, canonical manifest hash, registry hash or `null`, ordered document plans, local target resolution objects, summary, warnings, plan hash, and the safety statement. It contains logical keys and names but no absolute paths or Discord IDs.

The SHA256 plan hash covers meaningful plan content, including document and warning details, but excludes both the generation timestamp and the hash field itself. Therefore two equivalent runs have the same plan hash even though their artifact timestamps differ.

```json
{
  "generatedAt": "2026-01-01T00:00:00.000Z",
  "manifestHash": "...",
  "planHash": "...",
  "profile": { "key": "titanz", "name": "Titanz" },
  "registryHash": null,
  "safetyStatement": "No Discord changes were made.",
  "schemaVersion": 1
}
```

## Safety flow

Future Content Sync must follow the same guarded progression as infrastructure:

```text
content.json + Markdown -> Validate -> Plan -> Diff -> Verify -> explicit Apply -> Verify -> registry update
```

Loading, parsing, translation preparation, planning, and diffing must remain offline. No Discord message may be posted or edited by plan, diff, or verify. Apply must consume reviewed operations, perform identity and drift checks, and update existing registered messages where possible. Deletion is outside this phase.

## Roadmap

### Content Sync

1. Define how verified logical identities bind to Discord channel IDs without changing manifests.
2. Add read-only message identity verification after a registry schema is designed.
3. Extend the registry with Discord message IDs only when synchronization begins.
4. Add a guarded writer that edits registered messages and creates only unregistered messages during explicit apply.
5. Add convergence, idempotency, drift, pinning, and failure-recovery tests.

Live verification is intentionally separate from offline resolution. The local desired profile proves intent reproducibly, while the verifier compares that identity with Discord only when explicitly invoked.

## Read-only live destination verification

`npm run content:verify` is the only Content-as-Code command in this phase that connects to Discord. It requires `DISCORD_TOKEN` and `GUILD_ID` from the centralized environment bootstrap. `PROFILE` selects both the content manifest and desired infrastructure profile as usual.

The production adapter constructs the existing `Guilds`-intent client, logs in, fetches the configured guild and its channels, converts them immediately into plain minimal metadata, and destroys the client in `finally`. The pure verifier receives only `ReadOnlyDiscordGateway.fetchGuild()`. It has no Discord client, writer, manager, roles, permissions, members, messages, or mutation methods.

Verification starts with Phase 3 local resolution and uses the strongest identity currently available:

1. A locally known channel ID, if a future desired-profile schema provides one. No current profile does.
2. A stable logical key mapped through local desired state. Current profiles do not store a live ID binding.
3. Exact normalized channel name plus the expected normalized category name.
4. Exact normalized channel name alone only when unique.

No fuzzy matching or silent ambiguous binding is allowed. The live type must exactly match the locally resolved `text` or `announcement` type, and the parent category must match when expected.

Statuses are `verified`, `not-configured`, `live-channel-missing`, `live-channel-type-mismatch`, `live-category-mismatch`, `live-channel-ambiguous`, `guild-mismatch`, `inaccessible`, and `skipped`. A `null` manifest target is `not-configured` and remains a warning. An unresolved configured local target is `skipped` and fails live verification because not every configured destination can be verified.

Exit behavior:

- `0`: guild identity verified and all configured destinations verified; `not-configured` warnings are allowed.
- `1`: inaccessible/mismatched guild, live drift, ambiguity, or an unverifiable configured target.
- `2`: required verification environment configuration is missing.

`npm run content:verify -- --out reports/content-verification.json` writes a report only when explicitly requested. It contains the selected profile, configured guild ID, minimal live guild identity, ordered per-document results, summary, warnings, errors, safety statement, timestamp, and deterministic verification hash. The hash excludes its own field and `generatedAt`. Reports contain no token, absolute path, member data, permissions, or message data.

Offline plans answer what content should exist and where it should go according to source control. Live verification answers whether those already-resolved destinations still exist with the expected identity. Keeping these paths separate prevents routine planning from gaining network or credential requirements.

Message verification remains deferred because there are no message IDs or registry bindings yet. Destination identity must be trustworthy before a later phase can safely reason about existing Discord messages without reposting them. Discord channel IDs belong in verified runtime state, and message IDs belong in the registry after guarded synchronization—not in content manifests.

## Translation roadmap

1. Add per-language manifests and translation status metadata.
2. Support checked-in human-authored translations first.
3. Add provider adapters only behind explicit configuration and review workflows.
4. Plan and verify translations independently for each language.
5. Never publish untranslated or unreviewed generated content implicitly.

## Web UI roadmap

1. Expose read-only profile, snapshot, content, registry, and plan views through an application service boundary.
2. Add local editing and validation without Discord credentials.
3. Add authenticated plan review and approval workflows.
4. Delegate apply to the same guarded engines used by the CLI; the UI must not bypass safety checks.
