# v1.2.0 packaging preflight

This file records the repeatable packaging gate. It does not record a release and it is not evidence that Windows validation has already passed.

## Runtime payload

`common/runtime-manifest.cjs` is the only application-file allowlist. Both `scripts/package.cjs` and `electron-builder.config.cjs` consume it. A source check fails when a referenced browser module or local CommonJS dependency is absent from the allowlist. Because electron-builder always excludes lock files from `app.asar`, the package carries `common/runtime-dependencies.json`; source validation regenerates its expected content from `package-lock.json`, and package validation checks every installed production dependency against that snapshot.

The payload includes the frozen v3 compatibility modules, the v4 pricing and workbook modules, the file-job child process and streaming readers/writer, the eight approved visual files, the Side Rays license, and the locked production dependency closure. The audit also compares every formal runtime file with the current source by SHA-256 and enforces a 30 MiB application-payload budget. Review prototypes, thickness prototypes, UI preview shells, documentation, tests, outputs, databases, logs, and development dependencies are rejected.

## Local checks

Run from a clean dependency install:

```sh
npm ci
npm test
npm run check
npm run audit:package
npm run package:win
npm run audit:package -- --artifact dist-builder/win-unpacked
npm run audit:package-child -- --artifact dist-builder/win-unpacked
```

`package:win` always uses `--publish never`. `npm run release` deliberately exits with an error so a local build cannot publish an unverified replacement artifact.

## Candidate workflow

The tag must exactly match `package.json` as `v<version>`. The Windows workflow installs from the lock, runs tests and source checks, builds once, audits `win-unpacked`, runs its packaged file-job child through Electron's Node mode and IPC, starts that packaged executable against an isolated temporary data directory, verifies `/api/health` reports the same version, and retains the exact installer, blockmap, and update metadata as a workflow artifact. It does not publish a GitHub Release.

Passing this gate does not replace the S7 real-file, installer upgrade, large-import performance, GPU/DPR, G62, or user-data migration checks defined in the construction plan. Those results must be attached to the same final artifact before a production release is approved.
