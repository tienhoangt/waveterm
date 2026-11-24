---
phase: 5
title: "Phase 5: Verified Upstream Bugfixes (Optional Lower Priority)"
status: pending
priority: P2
effort: "0.5d"
dependencies: [1, 2, 3, 4]
---

# Phase 5: Verified Upstream Bugfixes (Optional Lower Priority)

## Goal
Fix 7 independently verified real bugs from `wavetermdev/waveterm/issues` still present in `N:\Wave` (`v0.14.5`), while skipping already-fixed (`#3301` Part A) and external-PTY-only (`#3607`) issues.

## Context & Verified Evidence
- **`#3568`** (`frontend/app/view/webview/webview.tsx:288-299, 758, 781`): Unbound `fetchSuggestions={model.fetchBookmarkSuggestions}` throws `TypeError` on `this.env`; `:758` opens `presets/bookmarks.json` while Go backend (`pkg/wconfig/settingsconfig.go:377`) reads `bookmarks.json`.
- **`#3563`** (`frontend/app/view/term/termutil.ts:51-53`, `termwrap.ts:174-197`): `computeTheme()` sets `themeCopy.background = "#00000000"` and `termwrap.ts` registers no OSC 11 handler, so Codex CLI / TUI apps querying OSC 11 (`\x1b]11;?\x07`) always receive black even under light themes.
- **`#3517`** (`cmd/server/main-server.go:538, 565`, `pkg/wcore/workspace.go:190-196`): `wcore.EnsureInitialData()` runs at `:538` *before* `startConfigWatcher()` at `:565`, so recreating a tab after closing the last tab reads an empty config and loses `TabBackground`.
- **`#3150`** (`frontend/app/view/waveconfig/waveconfig-model.ts:302-325`): `loadFile()` calls `FileReadCommand` directly without checking `FileInfoCommand` (`notfound`) for optional uncreated config files (`waveai.json`, `widgets.json`, `backgrounds.json`), showing an error banner on fresh installs.
- **`#3301` (Part B + edge case)** (`pkg/aiusechat/openaichat/openaichat-types.go:65`, `pkg/aiusechat/tools_term.go:88-98`): `json:"reasoning_content,omitempty"` omits empty `reasoning_content` on DeepSeek thinking tool-call messages; `tools_term.go` fails with `no route for "feblock:..."` when a target tab was evicted/unmounted.
- **`#3330`** (`pkg/remote/sshclient.go:841-869, 964-1109`, `pkg/wconfig/settingsconfig.go:408-424`): `ProxyCommand` & `StrictHostKeyChecking` are unsupported; `:998` assigns `&hostNameRaw` instead of `&hostNameProcessed` (leaving quotes intact).
- **`#3193`** (`frontend/app/view/term/term.tsx:292, 311`, `pkg/util/shellutil/shellintegration/zsh_zshrc.sh`): macOS `Option+Arrow` prints `;3D` / `;3C` in stock ZSH because `macOptionIsMeta` defaults to `false` and Wave's ZSH rc has no `bindkey` for `^[[1;3D`/`^[[1;3C`.

## Files to Create / Modify
- Modify: `frontend/app/view/webview/webview.tsx`
- Modify: `frontend/app/view/term/termwrap.ts`
- Modify: `cmd/server/main-server.go`
- Modify: `pkg/wconfig/filewatcher.go`
- Modify: `frontend/app/view/waveconfig/waveconfig-model.ts`
- Modify: `pkg/aiusechat/openaichat/openaichat-types.go`
- Modify: `pkg/remote/sshclient.go`
- Modify: `pkg/util/shellutil/shellintegration/zsh_zshrc.sh`

## Tasks & Implementation Steps
1. **Fix `#3568` (WebBookmarks typeahead & path mismatch):**
   - Bind `fetchBookmarkSuggestions` in `frontend/app/view/webview/webview.tsx:781` (arrow method or `.bind(model)`), and align `openBookmarksJson` (`:758`) to `bookmarks.json` matching `pkg/wconfig/settingsconfig.go:377`.
2. **Fix `#3563` (OSC 11 real background color for Codex CLI / light themes — hardened):** <!-- Updated: Red Team 2026-11-24 - loaded/exact-query/colord/direct sendDataHandler guards -->
   - Pass the real `bgcolor` (computed by `computeTheme()` in `termutil.ts:51`) into `TermWrap` and register an OSC `11` handler in `frontend/app/view/term/termwrap.ts:174-197`.
   - Guard strictly with `if (!this.loaded || data !== "?") return false;`, parse `bgcolor` via `colord` (already in `package.json:89`) into clamped 8-bit `(r, g, b)` integers, format strictly as `\x1b]11;rgb:${r16}/${g16}/${b16}\x1b\\`, and write directly to `this.sendDataHandler` (**never** `handleTermData`/`multiInputCallback`).
3. **Fix `#3517` (Tab background lost after closing only tab — migration-safe):** <!-- Updated: Red Team 2026-11-24 - run MigratePresetsBackgrounds + synchronous LoadInitialConfig before EnsureInitialData -->
   - In `cmd/server/main-server.go`, run `wconfig.MigratePresetsBackgrounds()` + a synchronous `wconfig.GetWatcher().LoadInitialConfig()` (reading config into memory without starting `fsnotify` or publishing to `wps.Broker`) **before** `wcore.EnsureInitialData()` (`:538`), then start the `fsnotify` watcher goroutine at `:565` after `createMainWshClient()`.
4. **Fix `#3150` (Wave Config menu error on fresh install):**
   - In `frontend/app/view/waveconfig/waveconfig-model.ts:302-325`, check `FileInfoCommand` (`notfound`) before `FileReadCommand` and initialize missing optional config files with `{}` (or empty template) instead of setting `errorMessageAtom`.
5. **Fix `#3301` DeepSeek `reasoning_content` empty-string edge case:** <!-- Updated: Red Team 2026-11-24 - feblock error handling moved to Phase 3 -->
   - In `pkg/aiusechat/openaichat/openaichat-types.go:65`, ensure assistant messages in thinking/reasoning mode preserve `reasoning_content` even when empty (pointer `*string` or explicit flag so `omitempty` only omits when nil, not `""`). *(Note: `#3301` Part B `feblock:` graceful error handling is now implemented in Phase 3 Task 3.)*
6. **Fix `#3330` (SSH `HostName` quote bug & hardened `ProxyCommand`/`StrictHostKeyChecking`):** <!-- Updated: Red Team 2026-11-24 - strict allowlists, non-shell exec.CommandContext, preserve Revoked/Changed MITM hard-fail -->
   - Fix `pkg/remote/sshclient.go:998` (`&hostNameProcessed` instead of `&hostNameRaw`).
   - Add `ProxyCommand` support in `pkg/remote/sshclient.go` **from `~/.ssh/config` only** (never overridable via untrusted RPC flags): validate expanded tokens with strict allowlists (`%p`: numeric `1..65535`, `%h`: `[a-zA-Z0-9._:-]` no leading `-`, `%r`: `[a-zA-Z0-9._-]` no leading `-`), parse argv with `exec.CommandContext` (avoiding `cmd.exe /C` shell invocation), and kill the proxy process group on `net.Conn.Close()`.
   - Parse `StrictHostKeyChecking` (`no`/`accept-new`/`yes`) ensuring `accept-new` **still hard-fails on `RevokedError` and changed keys (`len(serr.Want) > 0`)** so MITM protection is never silently downgraded.
7. **Fix `#3193` (macOS Option+Arrow in stock ZSH):**
   - In `pkg/util/shellutil/shellintegration/zsh_zshrc.sh`, add conditional `bindkey '^[[1;3D' backward-word` and `bindkey '^[[1;3C' forward-word` only when not already bound by user config.

## Todo
- [x] Fix `#3568` unbound `fetchBookmarkSuggestions` and `bookmarks.json` path
- [x] Fix `#3563` hardened OSC 11 handler (`this.loaded`, `data === "?"`, `colord`, direct `sendDataHandler`)
- [x] Fix `#3517` run `MigratePresetsBackgrounds()` + synchronous `LoadInitialConfig()` before `EnsureInitialData()`
- [x] Fix `#3150` graceful missing-file handling in `waveconfig-model.ts`
- [x] Fix `#3301` empty `reasoning_content` serialization edge case
- [x] Fix `#3330` `hostNameProcessed` bug + hardened `ProxyCommand` (allowlists + `exec.CommandContext` + process-group kill) & `StrictHostKeyChecking`
- [x] Fix `#3193` ZSH `bindkey` for `Option+Arrow`

## Verification
- Automated: `go test ./pkg/aiusechat/... ./pkg/remote/... ./pkg/wcore/...` and `npm test`
- Manual: Test `Alt+O` bookmark suggestions, query `printf '\e]11;?\a'` under a light theme, close all tabs & relaunch to confirm tab background persists, and open Wave Config on a fresh config directory.

## Risk Assessment
- Moving `startConfigWatcher()` before `EnsureInitialData()` in `main-server.go` must not depend on DB state created by `EnsureInitialData()`; verify `startConfigWatcher()` only reads the filesystem config dir and registers `wps` broker publishes.
- `ProxyCommand` executes a user-configured shell command from `~/.ssh/config`; validate token substitution (`%h`, `%p`, `%r`) against shell injection (reject unexpected control/shell metacharacters in host/port/user tokens).
