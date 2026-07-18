# Safety model

Discord IaC v1.0 has a permanent no-delete guarantee. It never deletes roles, categories, channels, overwrites, unmanaged resources, or Community-designated channels.

An apply is executable only when the profile validates, guild identity exists, all actionable IDs resolve, matching is unambiguous, and every action is supported. The command then verifies the profile hash, connects, checks the guild ID, hashes a fresh snapshot, aborts on drift, recomputes operations, and requires byte-equivalent canonical operations. It displays warnings and requires `APPLY <guild name>` exactly before creating a backup and writing.

Managed roles and the `@everyone` server role cannot be updated. Resource creates and reorders are unsupported in v1.0 and abort the entire apply. Supported writes are existing role updates, overwrite creation/update, and channel permission synchronization.

Apply always destroys its Discord client. Each writer operation verifies its immediate result. A post-apply snapshot is exported and replanned; any remaining actionable operation is failure. Partial failures report how many operations completed and identify the backup.

Restore requires `RESTORE <guild name>`, matches existing resources by ID and identity, creates a fresh backup first, and never recreates or deletes resources.
