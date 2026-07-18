# Content and Community-as-Code architecture

## Scope of this phase

This phase establishes contracts, source layout, and safety boundaries only. It does not parse Markdown, translate content, maintain registry state, contact Discord, or create or edit messages.

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

English is canonical. Planned translation language codes are `fr`, `de`, `es`, `pt`, `tr`, `ru`, and `zh`. Translated files must remain derived, reviewable content; no translation provider or AI service is configured in this phase.

## Content registry design

The future message registry maps a stable content identity to an existing Discord message:

```text
profile + content key + block key + language
    -> channel ID + Discord message ID + applied content hash
```

For example, the `rules` source can resolve to the existing rules message ID. A subsequent plan can compare the desired content hash with the registry hash and produce an `update` operation against that message rather than reposting it.

Only the registry interfaces and data types exist today. No registry file or database is created. Future registry storage must be deterministic, profile-scoped, auditable, and updated only after a successful Discord write. Secrets and message content must not be stored in the registry.

## Component contracts

- `ContentLoader` discovers profile content without Discord access.
- `MarkdownParser` converts one source document into deterministic message-sized blocks.
- `TranslationProvider` is an optional future boundary; there is no implementation or external provider today.
- `MessageRegistry` resolves stable content identities to Discord channel and message IDs.
- `DiscordContentWriter` is the future isolated adapter for creating or updating messages.
- `Planner` creates a reviewable content plan.
- `ContentDiffEngine` compares parsed desired content with registry state.
- `Verifier` checks a plan or applied state without changing it.
- `ContentApplyEngine` is the only future orchestration boundary allowed to invoke writes.

The contracts are defined in `src/content/contracts.ts`; their shared data model is in `src/content/types.ts`; source and translation defaults are in `src/content/config.ts`.

## Safety flow

Future Content Sync must follow the same guarded progression as infrastructure:

```text
Markdown sources -> Plan -> Diff -> Verify -> explicit Apply -> Verify -> registry update
```

Loading, parsing, translation preparation, planning, and diffing must remain offline. No Discord message may be posted or edited by plan, diff, or verify. Apply must consume reviewed operations, perform identity and drift checks, and update existing registered messages where possible. Deletion is outside this phase.

## Roadmap

### Content Sync

1. Define a versioned profile content manifest and channel targets.
2. Implement deterministic loading, Markdown parsing, splitting, and hashing.
3. Implement a file-backed registry with validation and atomic updates.
4. Add pure content diff and deterministic plan artifacts.
5. Add read-only Discord verification.
6. Add a guarded writer that edits registered messages and creates only unregistered messages during explicit apply.
7. Add convergence, idempotency, drift, and failure-recovery tests.

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
