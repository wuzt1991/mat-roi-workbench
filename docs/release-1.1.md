# v1.1.0 release notes and verification

后续版本的必带修复与发布检查见 [下次正式版待发布修复](next-release.md)。本页保留 v1.1.0 的历史交付记录。

Windows 自动更新的仓库配置、发布和迁移步骤见 [Windows 自动更新](windows-auto-update.md)。

Approved prototype v0.8 is promoted into the desktop application, including the alignment patch. The prototype itself remains unchanged during this release task.

## Application changes

- Shop-scoped plans, multiple materials and quoted prices, shared size library, irregular production dimensions, gram inputs, shipping templates, configurable metric and SKU columns.
- Confirmed daily frozen records, immutable original versions, correction/void transitions, filtered ledger and investment/profit time series.
- Excel full/scoped export and merge/replace restore, compatible with prior workbook formats and legacy JSON.
- SQLite-backed SaveQueue, explicit durability status, recoverable per-window drafts, optimistic revision checks and protected history. Full restores preserve a pre-restore checkpoint.
- Automatic transactional v2-to-v3 migration with the exact original preserved in recovery. Damaged legacy data aborts migration without changing its revision or payload.
- New workspaces contain no sales/ledger examples and use distinct IDs across installations. Starting values reflect the user's cost assumptions.
- Routine checkpoints coalesce once per UTC date with retention of 30 dates; restore checkpoints retain 10 versions. Existing legacy recovery rows and business history are not pruned.
- Desktop checks the running service's version and data directory to prevent silently loading an old or unrelated service. Localhost origin restrictions, CSP, isolated renderer, no Node integration, no-store assets and explicit font MIME type remain enabled.

## Reproduce

```sh
npm ci
npm run check
npm test
node scripts/icons.cjs
MAT_ELECTRON_ZIPS="$PWD/.runtime-archives" npm run package
```

Icons require macOS AppKit, sips and iconutil. Packaging produces macOS arm64 and Windows x64 directories under dist/1.1.0, using cached official Electron 42.6.1 archives when specified. Existing output is not overwritten; move a task-generated preflight build aside before rebuilding. Package metadata is derived from package.json. Packaging prunes development dependencies.

For isolated checks, set MAT_DATA_DIR to a newly created temporary directory and MAT_PORT to an unused port. The desktop then also uses an isolated Electron profile. No test should use the owner's actual database directory.

## Verified on 2026-09-09

- 66 tests passed under both Node 26 and the final packaged Electron Node runtime, including the new-workspace identity regression.
- Native Mac executable started its own service from the packaged app with an isolated database. Restart retained the test records and their correction history.
- Browser UI: create two SKUs (4.19 / 8.99, 20% / 80%), spend 1000, ROI 3 → break-even display 2.54, profit 183.52801992528043. Confirm entry, raise material 10.2 to 20 → current forecast changes while recorded cost and profit remain frozen. Correct return rate and reload → one effective entry, two retained versions.
- Actual browser-generated Excel imported successfully using the production workbook reader. A workbook exported earlier from the prototype also imported successfully.
- Divider positions both y=64; two panels both 492×343 with four metrics at 1280 px; large monetary values have no numerical or page overflow. No browser error logs in the exercised flows.
- Mac ad hoc signature verified with codesign --verify --deep --strict. Custom icon matches source checksum. Mac minimum OS version is 12.0.
- Windows executable verified as PE32+ x86-64; production public/server/desktop files match source bytes on both platforms. package.json is deliberately pruned by the packager; version and main fields match. Packages contain no user SQLite databases.
- Final DMG passed hdiutil verify, Windows ZIP passed unzip -tq. SHA256SUMS.txt accompanies both files in the sibling 地垫工作台-v1.1 delivery folder. Both archives include the readable Chinese installation and migration guide.

No Apple Developer ID/notarization or Windows Authenticode certificate is configured. Windows was cross-packaged and structurally verified; no Windows real-machine execution is claimed. This is an offline single-user estimation tool, not an automatic Douyin connector or cloud synchronization service.
