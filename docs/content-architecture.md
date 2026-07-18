# Content and Community-as-Code architecture

## Scope of this phase

Phase 1 implements deterministic English Markdown loading, block parsing, SHA256 hashing, a local registry format, and offline plan and diff commands. It does not translate content, contact Discord, or create, edit, or delete messages.

## Project layers

Discord IaC evolves into Community-as-Code through independent layers:

1. **Infrastructure-as-Code** describes roles, categories, channels, and permissions. Existing exporters, profiles, planners, apply, restore, verification, and drift behavior remain unchanged.
2. **Content-as-Code** will describe permanent community material in Markdown and manage the Discord messages that render it.
3. **Community-as-Code** will coordinate infrastructure, content, translations, events, and future user interfaces while preserving explicit plan, diff, verify, and apply boundaries.

Infrastructure snapshots remain in `exports/`. Infrastructure desired state and content sources live under the selected `profiles/<key>/` directory. Content code is isolated in `src/content/` and must not make the infrastructure planner depend on content.

## Source layout

```text
profiles/<profile>/content/
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

## Content registry design

The future message registry maps a stable content identity to an existing Discord message:

```text
profile + content key + block key + language
    -> channel ID + Discord message ID + applied content hash
```

For example, the `rules` source can resolve to the existing rules message ID. A subsequent plan can compare the desired content hash with the registry hash and produce an `update` operation against that message rather than reposting it.

The Phase 1 registry contains the profile key and each document's language, SHA256 hash, stable block IDs, and block hashes. It intentionally contains no Discord channel or message IDs. The file-backed implementation validates profile identity and writes deterministic, two-space-indented JSON atomically when explicitly called by future tooling. Plan and diff remain read-only.

## Component contracts

- `ContentLoader` discovers English profile content without Discord access; `FileContentLoader` is the Phase 1 implementation.
- `MarkdownParser` converts one source document into deterministic blocks; `DeterministicMarkdownParser` preserves Markdown source without rendering it.
- `TranslationProvider` is an optional future boundary; there is no implementation or external provider today.
- `MessageRegistry` resolves stable content identities to Discord channel and message IDs.
- `DiscordContentWriter` is the future isolated adapter for creating or updating messages.
- `Planner` creates a reviewable content plan; `OfflineContentPlanner` is implemented.
- `ContentDiffEngine` compares parsed desired content with registry state; `OfflineContentDiffEngine` is implemented.
- `Verifier` checks a plan or applied state without changing it.
- `ContentApplyEngine` is the only future orchestration boundary allowed to invoke writes.

The contracts are defined in `src/content/contracts.ts`; their shared data model is in `src/content/types.ts`; source and translation defaults are in `src/content/config.ts`. `FileContentRegistry` implements the local Phase 1 comparison registry.

## Safety flow

Future Content Sync must follow the same guarded progression as infrastructure:

```text
Markdown sources -> Plan -> Diff -> Verify -> explicit Apply -> Verify -> registry update
```

Loading, parsing, translation preparation, planning, and diffing must remain offline. No Discord message may be posted or edited by plan, diff, or verify. Apply must consume reviewed operations, perform identity and drift checks, and update existing registered messages where possible. Deletion is outside this phase.

## Roadmap

### Content Sync

1. Define a versioned profile content manifest and channel targets.
2. Extend the local registry with Discord identifiers only when synchronization begins.
3. Add deterministic machine-readable content plan artifacts.
4. Add read-only Discord verification.
5. Add a guarded writer that edits registered messages and creates only unregistered messages during explicit apply.
6. Add convergence, idempotency, drift, and failure-recovery tests.

### Translation

1. Add per-language manifests and translation status metadata.
2. Support checked-in human-authored translations first.
3. Add provider adapters only behind explicit configuration and review workflows.
4. Plan and verify translations independently for each language.
5. Never publish untranslated or unreviewed generated content implicitly.

### Web UI

1. Expose read-only profile, snapshot, content, registry, and plan views through an application service boundary.
2. Add local editing and validation without Discord credentials.
3. Add authenticated plan review and approval workflows.
4. Delegate apply to the same guarded engines used by the CLI; the UI must not bypass safety checks.
