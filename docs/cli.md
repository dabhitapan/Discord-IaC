# CLI

Run `npm run cli -- --help` for the consolidated command list. Example:

```powershell
npm run cli -- plan --profile profiles/wao-noobs --snapshot exports
npm run cli -- diff --profile profiles/wao-noobs --snapshot exports
```

Commands are labeled `OFFLINE`, `ONLINE READ-ONLY`, or `ONLINE GUARDED WRITE`. Output uses plain text suitable for PowerShell and redirection, with no color dependency.

Exit codes are:

- `0`: success, no drift, or conforming verification
- `1`: actionable differences, detected drift, or runtime/write verification failure
- `2`: configuration, validation, ambiguity, identity, unsupported-operation, or safety failure

Normal failures print concise messages. Child diagnostics remain visible; `--debug` is reserved for expanded diagnostics as the CLI evolves.
