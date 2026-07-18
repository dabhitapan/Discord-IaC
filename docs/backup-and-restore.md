# Backup and restore

Before apply or real restore, Discord IaC writes a new backup under:

```text
backups/<guild-id>/<timestamp>-<snapshot-hash-prefix>/
```

The directory contains the five snapshot JSON files and `manifest.json`. The manifest records schema version, guild identity, source snapshot hash, profile hash, plan hash, application version, reason, and historical creation time. Existing backup directories are never overwritten. Backup failure aborts before Discord writes.

`npm run restore -- --dry-run <backup-path>` connects read-only and prints a structured restore plan. A real restore uses `--backup <backup-path>` and requires `RESTORE <guild name>`.

Restore is intentionally limited: it updates supported properties and overwrites only for resources that still exist and pass ID/name checks. It can restore inherited channel permission state. It never recreates missing resources, removes new resources or overwrites, deletes anything, modifies managed roles, or modifies the `@everyone` server role.
