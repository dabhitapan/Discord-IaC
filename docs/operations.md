# Operations and plan artifacts

`npm run plan` is concise. `npm run diff` prints changed fields. `npm run plan:write` and `npm run diff:json` write `plans/wao-noobs.plan.json`.

The artifact contains schema version, profile and guild identity, canonical SHA-256 snapshot/profile hashes, deterministic structured operations, summary, warnings, unsupported-operation count, ambiguity count, unresolved-ID count, and an executable flag. It has no timestamp, secret, absolute path, or formatting-dependent hash input.

Structured operations include resource identity, current/desired state, field and permission deltas, dependencies, deterministic sort keys, support/ambiguity metadata, and full overwrite or synchronization details. This is the writer contract.

`npm run drift` contacts Discord read-only and exits 0 when the fresh snapshot hash matches, 1 for drift, and 2 for safety/configuration errors. `npm run verify` is offline and exits 0 when no actionable operations remain, 1 when differences remain, and 2 for validation, ambiguity, identity, or configuration failures.
