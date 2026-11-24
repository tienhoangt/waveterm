---
phase: 2
title: "Phase 2: McAfee-Safe Disk I/O & Go Backend Optimization"
status: pending
priority: P1
effort: "1.5d"
dependencies: []
---

# Phase 2: McAfee-Safe Disk I/O & Go Backend Optimization

## Goal
Drastically reduce SQLite fsync storms, disk churn, AV/AMSI process-creation triggers, background CPU polling, and unbounded Go heap growth in `wavesrv` under 2 concurrent AI Agent sessions on Windows with McAfee Real-Time Scanning.

## Context & Verified Evidence
- `pkg/filestore/blockstore_dbsetup.go:67-72` & `pkg/wstore/wstore_dbsetup.go:49-56`: Both SQLite DBs use WAL mode with `SetMaxOpenConns(1)` and omit `_synchronous=NORMAL` (defaulting to `FULL` `FlushFileBuffers` on every commit), `_temp_store=MEMORY`, and `_cache_size`.
- `pkg/filestore/blockstore.go:39, 228-238, 410-422, 512-527` & `pkg/filestore/blockstore_cache.go:329-349`: Every 5s (`DefaultFlushTime`), flusher opens a separate `WithTx` per dirty file, calls `entry.clear()` evicting the hot 64KB part immediately (forcing SQLite re-reads on the next PTY chunk), and calls `log.Printf("filestore flush...")` writing to `waveapp.log` every 5s.
- `pkg/wcore/block.go:157-195`: `DeleteBlock` never calls `filestore.WFS.DeleteZone(ctx, blockId)`, leaking `filestore.db` zones on disk forever.
- `pkg/blockcontroller/shellcontroller.go:552-560` & `pkg/web/ws.go:121-163`: PTY reads 4KB chunks and immediately writes/base64-encodes/publishes each chunk unbatched; WS RPC double-unmarshals/re-marshals JSON via `map[string]any`.
- `pkg/wshrpc/wshremote/sysinfo.go:21-72` & `cmd/server/main-server.go:393`: `RunSysInfoLoop` runs every 1s forever even when no SysInfo widget is subscribed, persisting 1024 snapshots across 2 scopes in `pkg/wps/wps.go:195-224`.
- `pkg/util/shellutil/shellutil.go:392-463` & `pkg/wavebase/wavebase.go:465-473`: Startup unconditionally overwrites 8 rc files + copies `wsh.exe` and spawns `powershell.exe` + WMI/CIM on Windows.
- `pkg/wconfig/filewatcher.go:27, 139-173`, `pkg/telemetry/telemetry.go:167-198, 347-438`, `emain/emain-log.ts:68-127`: Undebounced `fsnotify` holding `sync.Mutex` across disk I/O; 60s SQLite writes even when telemetry is disabled; `waveapp.log` never rotates at runtime.
- `pkg/aiusechat/chatstore/chatstore.go:14-129`, `pkg/aiusechat/anthropic/anthropic-backend.go:800-820`, `pkg/aiusechat/openai/openai-backend.go:829`, `cmd/server/main-server.go:459-616`: Unbounded in-memory `DefaultChatStore`, O(N²) string `+=` in streaming loops, and no `GOMEMLIMIT`/`GOGC`.

## Files to Create / Modify
- Modify: `pkg/filestore/blockstore_dbsetup.go`
- Modify: `pkg/filestore/blockstore.go`
- Modify: `pkg/filestore/blockstore_cache.go`
- Modify: `pkg/wstore/wstore_dbsetup.go`
- Modify: `pkg/wstore/wstore_dbops.go`
- Modify: `pkg/blockcontroller/shellcontroller.go`
- Modify: `pkg/blockcontroller/blockcontroller.go`
- Modify: `pkg/web/ws.go`
- Modify: `pkg/wshrpc/wshremote/sysinfo.go`
- Modify: `pkg/wps/wps.go`
- Modify: `pkg/util/shellutil/shellutil.go`
- Modify: `pkg/util/utilfn/utilfn.go`
- Create: `pkg/wavebase/sysinfo_windows.go` (`//go:build windows`)
- Create: `pkg/wavebase/sysinfo_other.go` (`//go:build !windows`)
- Modify: `pkg/wavebase/wavebase.go`
- Modify: `pkg/wconfig/filewatcher.go`
- Modify: `pkg/telemetry/telemetry.go`
- Modify: `emain/emain-log.ts`
- Modify: `pkg/aiusechat/chatstore/chatstore.go`
- Modify: `pkg/aiusechat/anthropic/anthropic-backend.go`
- Modify: `pkg/aiusechat/openai/openai-backend.go`
- Modify: `pkg/aiusechat/openaichat/openaichat-backend.go`
- Modify: `cmd/server/main-server.go`

## Tasks & Implementation Steps
1. **Optimize SQLite WAL & `filestore` flush/eviction (McAfee-safe):** <!-- Updated: Red Team 2026-11-24 - keep WithTxRtn to prevent SetMaxOpenConns(1) self-deadlock, fix AB-BA batch flush lock order, remove false DeleteBlock DeleteZone duplicate -->
   - Add `_synchronous=NORMAL&_temp_store=MEMORY&_cache_size=-16000` (16MB cache) to DSNs in `pkg/filestore/blockstore_dbsetup.go:67` and `pkg/wstore/wstore_dbsetup.go:51`; configure `PRAGMA wal_autocheckpoint=1000`.
   - **Keep `WithTx` / `WithTxRtn` on read-only queries** so nested calls inside outer transactions reuse the active `txwrap` connection under `SetMaxOpenConns(1)` without self-deadlocking (read-only SQLite WAL transactions do not fsync).
   - In `pkg/filestore/blockstore.go` & `blockstore_cache.go`:
     - Add explicit `dirtyGen`/`flushedGen`, dirty part set, and `lastAccessTs` to `CacheEntry` (do not rely on `entry.File != nil` as the sole dirty indicator).
     - Increase `DefaultFlushTime` from `5s` to `15s`. In `FlushCache`, **snapshot (clone) dirty `(file, dirtyParts)` copies under each `entry.Lock` and release `entry.Lock` BEFORE opening the single batch `WithTx`** (eliminating AB-BA deadlock with `WriteFile`/`AppendData`). After commit, mark entries clean only where `dirtyGen == snapGen` and sweep idle clean entries (`> 60s`) separately.
     - Add `FlushWait(ctx)` in `doShutdown()` (`cmd/server/main-server.go:86-95`) so clean exit waits for any in-flight flush and commits remaining dirty entries before `os.Exit(0)`.
     - Guard `log.Printf("filestore flush...")` behind debug-only / error-only logging.
   - In `pkg/wstore/wstore_dbops.go:285-297` (`DBDelete`, which already calls `filestore.WFS.DeleteZone`), raise the `2*time.Second` timeout (e.g., to `10*time.Second`) so McAfee I/O stalls do not abort zone cleanup.
2. **Coalesce PTY output & eliminate WS RPC double-marshalling:**
   - In `pkg/blockcontroller/shellcontroller.go:552-560`, add a lightweight 8–12ms / 32KB output coalescer (flushing immediately on 32KB full buffer, 12ms timer, or EOF) before calling `HandleAppendBlockFile` so fast AI Agent TUI bursts produce fewer `filestore` appends and WebSocket frames without adding perceptible typing latency.
   - Include post-append byte offset in `WSFileEventData` (`pkg/blockcontroller/blockcontroller.go:381-386`) so `TermWrap` (Phase 4) can deduplicate `heldData` safely against `ptyOffset`.
   - In `pkg/web/ws.go:121-163`, decode `"message"` as `json.RawMessage` instead of `map[string]any` + re-marshal.
3. **Eliminate idle polling & Windows McAfee startup triggers:** <!-- Updated: Red Team 2026-11-24 - shouldPoll predicate for remote connserver, SHA-256 + atomic rc writes, build-tagged Windows Registry files -->
   - In `pkg/wshrpc/wshremote/sysinfo.go:21-72`, accept an optional `shouldPoll func() bool` predicate; pass `wps.Broker.HasSubscribers(wps.Event_SysInfo)` **only from `cmd/server/main-server.go:393`** so remote SSH/WSL `wsh connserver` SysInfo widgets keep working.
   - In `pkg/util/shellutil/shellutil.go:392-463` & `pkg/util/utilfn/utilfn.go`, add `AtomicWriteFileIfDifferent` (temp file + atomic rename when contents differ) for the 8 rc files, and skip `AtomicRenameCopy` of `wsh.exe` **only when SHA-256 matches** (never `mtime+size`, preventing `$PATH` binary tampering).
   - Split the Windows OS summary lookup out of `pkg/wavebase/wavebase.go:465-473` into `pkg/wavebase/sysinfo_windows.go` (`//go:build windows`, using `golang.org/x/sys/windows/registry` reading `ProductName` + `CurrentBuildNumber`) and `pkg/wavebase/sysinfo_other.go` (`//go:build !windows`) so Linux/macOS cross-builds stay intact.
4. **Fix config watcher, telemetry writes, and log rotation:** <!-- Updated: Red Team 2026-11-24 - gate at RecordTEvent and UpdateActivity -->
   - In `pkg/wconfig/filewatcher.go`, switch `sync.Mutex` to `sync.RWMutex`, debounce `fsnotify` events by 150ms, and perform `ReadFullConfig()` outside the write lock (swap pointer atomically under brief lock).
   - In `pkg/telemetry/telemetry.go`, gate both `RecordTEvent` (`:273`) and `UpdateActivity` (`:347`) with `if !IsTelemetryEnabled() { return nil }` so no `db_tevent` or `db_activity` rows are persisted when telemetry is off.
   - In `emain/emain-log.ts`, add runtime size-check / Winston `maxsize: 10 * 1024 * 1024, maxFiles: 3` rotation so `waveapp.log` cannot grow unboundedly.
5. **Bound `wavesrv` memory & fix O(N²) AI streaming:**
   - In `pkg/aiusechat/chatstore/chatstore.go`, enforce an LRU cap (e.g., max 20 chats in RAM, evicting oldest untouched chats) and wire `WaveAIModel.clearChat()` to delete the old chat ID.
   - Replace `+=` string concatenation with `strings.Builder` in `anthropic-backend.go:800-820`, `openai-backend.go:829`, and `openaichat-backend.go:205`.
   - In `cmd/server/main-server.go`, set `debug.SetMemoryLimit(512 << 20)` (unless `GOMEMLIMIT` env is already set) and `debug.SetGCPercent(75)` (unless `GOGC` env is set).

## Todo
- [x] Add SQLite WAL PRAGMAs (`_synchronous=NORMAL`, `_temp_store=MEMORY`, `_cache_size`) while preserving `WithTxRtn` reentrancy
- [x] Implement generation-tracked snapshot batch flush (15s) + idle sweep + `FlushWait` on shutdown + raise `DBDelete` `DeleteZone` timeout
- [x] Add 12ms/32KB PTY coalescer in `shellcontroller.go`, byte offset in `WSFileEventData`, and `json.RawMessage` in `ws.go`
- [x] Gate local `RunSysInfoLoop` via `shouldPoll` predicate; use SHA-256 skip for `wsh.exe` + `AtomicWriteFileIfDifferent` for rc files; add build-tagged `sysinfo_windows.go`/`sysinfo_other.go`
- [x] Debounce `filewatcher.go` with `RWMutex`; gate telemetry at `RecordTEvent` + `UpdateActivity`; add runtime log rotation in `emain-log.ts`
- [x] Add LRU cap to `DefaultChatStore`, switch streaming concat to `strings.Builder`, and set default `GOMEMLIMIT`/`GOGC`

## Verification
- Automated: `go test ./pkg/filestore/... ./pkg/wstore/... ./pkg/blockcontroller/... ./pkg/wconfig/... ./pkg/aiusechat/... ./pkg/wcore/...` and `go build ./cmd/server`
- Manual on Windows: Run 2 AI Agent sessions streaming output and confirm with Process Monitor / Task Manager that `wavesrv.exe` RSS stays bounded, `waveapp.log` is quiet during normal output, and no `powershell.exe` spawns on Wave startup.

## Risk Assessment
- PTY coalescing window must remain small (<=12ms) and flush immediately on buffer threshold (32KB) or EOF so interactive keystroke echo feels instantaneous.
- `filestore` flush interval increase (5s -> 15s) means up to 15s of terminal scrollback could be lost on hard power-off; ensure clean shutdown (`Shutdown()` / `FlushAll()`) still flushes synchronously on app exit.
- Windows Registry `ProductName` reports "Windows 10" on Windows 11 unless `CurrentBuildNumber >= 22000` is checked; handle that mapping cleanly.
