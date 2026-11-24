# Wave Terminal (`v0.14.5`) — Verified Audit & Issue Backlog

> **Target environment:** Windows, 16GB RAM, 2 concurrent AI Agent sessions, McAfee Real-Time Scanning, Vietnamese IME (Unikey / EVKey / Windows Telex).
> **Verification protocol:** Audited against `N:\Wave` (`v0.14.5`) via 3 independent passes, including an independent **Pro-Model Cross-Auditor** to eliminate false positives, already-fixed upstream issues, and overstated claims.

---

## 1. High-Priority Backlog (Verified Core Issues)

### Phase 1 — Vietnamese Input (IME) & Font Rendering
| ID | Issue | Exact Location (`N:\Wave`) | Verification & Notes |
|---|---|---|---|
| **HP-IME-1** | Global, block, terminal, and Electron key pipelines lack `isComposing` / `keyCode === 229` / `"Process"` guards. Inside `<input>`/`<textarea>`, `isCharacterKeyEvent` requires `countGraphemes(key) == 1` and omits `"Process"`/`"Dead"`, so `shouldDispatchToBlock` returns `true` and leaks composing keystrokes to block handlers. *(Overlaps `#3164`, `#3382`, `#3545`)* | `frontend/util/keyutil.ts:21-32, 134-186, 231-272`<br>`frontend/app/store/keymodel.ts:104-121, 416-468`<br>`frontend/app/view/term/term-model.ts:699-780`<br>`frontend/app/aipanel/aipanel.tsx:320-326`<br>`emain/emain-tabview.ts:326-344` | **VERIFIED (HIGH)** |
| **HP-IME-2** | `AIPanelInput` controlled `<textarea>` lacks `onCompositionStart`/`onCompositionEnd` sync deferral and forces synchronous layout reflow (`height="auto"` -> `scrollHeight`) on every `input` change (`useEffect([input])`), causing caret/text jump under Unikey/EVKey & Windows Telex. | `frontend/app/aipanel/aipanelinput.tsx:25, 41-49, 96-98, 147-160` | **VERIFIED (HIGH)** *(Caveat: Enter key itself already checks `isComposing \|\| keyCode == 229` at `:70`)* |
| **HP-IME-3** | Font fallback & ClearType blur: JetBrains Mono loads `latin`-only `.woff2` (missing Vietnamese subset); terminal defaults to bare `"Hack"` with no fallback; AI Chat inherits `"Inter", sans-serif` instead of `--markdown-font-family`; `body` forces `transform: translateZ(0); backface-visibility: hidden` disabling ClearType subpixel rendering on Windows. | `frontend/util/fontutil.ts:19-30, 39-43`<br>`frontend/app/view/term/term.tsx:303`<br>`frontend/app/theme.scss:12-19`<br>`frontend/app/app.scss:20-22` | **VERIFIED (MEDIUM-HIGH)** *(Note: `fontutil.ts:43` typo `isHackFontLoaded` is real but latent since `loadFonts()` runs once)* |

---

### Phase 2 — McAfee Disk I/O Protection & Go Backend Optimization
| ID | Issue | Exact Location (`N:\Wave`) | Verification & Notes |
|---|---|---|---|
| **HP-IO-1** | `filestore.db` & `wavestore.db` run SQLite WAL without `_synchronous=NORMAL` (defaults to `FULL` fsync) and `SetMaxOpenConns(1)`; `filestore` flushes every 5s with separate per-file Tx, immediately evicts hot 64KB part (`entry.clear()`) causing immediate re-read on next PTY chunk, and logs `log.Printf("filestore flush...")` to `waveapp.log` every 5s — continuous McAfee scan trigger. | `pkg/filestore/blockstore_dbsetup.go:67-72`<br>`pkg/filestore/blockstore.go:39, 228-238, 410-422, 512-527`<br>`pkg/filestore/blockstore_cache.go:329-349`<br>`pkg/filestore/blockstore_dbops.go:39-110`<br>`pkg/wstore/wstore_dbsetup.go:49-56`<br>`pkg/wstore/wstore_dbops.go:40-131` | **VERIFIED (CRITICAL for McAfee)** |
| **HP-IO-2** | Deleted blocks never reclaim `filestore.db` zones (`DeleteBlock` never calls `filestore.WFS.DeleteZone`), causing unbounded disk DB growth over time. | `pkg/wcore/block.go:157-195` | **VERIFIED (HIGH — missed in Pass 1, caught by Pro Cross-Audit)** |
| **HP-IO-3** | Unbatched 4KB PTY read loop immediately writes to `filestore`, base64-encodes, and publishes a separate WS event per chunk (fragments AI Agent / Claude Code TUI repaints). *(Overlaps `#3085`)* | `pkg/blockcontroller/shellcontroller.go:552-560`<br>`pkg/blockcontroller/blockcontroller.go:369-389`<br>`pkg/web/ws.go:121-163` | **VERIFIED (HIGH)** |
| **HP-IO-4** | `RunSysInfoLoop` runs unconditionally every 1s forever (calling `gopsutil` CPU + mem + RPC + `Persist: 1024` across 2 scopes in `wps`) even when no SysInfo widget is open. | `pkg/wshrpc/wshremote/sysinfo.go:21-72`<br>`cmd/server/main-server.go:393`<br>`pkg/wps/wps.go:195-224` | **VERIFIED (HIGH)** |
| **HP-IO-5** | Startup McAfee/AMSI triggers: unconditionally overwrites 8 shell rc files + copies `wsh.exe` on every launch; spawns `powershell.exe` + WMI/CIM to read Windows OS caption. | `pkg/util/shellutil/shellutil.go:392-463`<br>`pkg/wavebase/wavebase.go:465-473` | **VERIFIED (HIGH for Startup/McAfee)** *(Runs in background goroutines, doesn't block listen, but spikes AV/CPU/RAM)* |
| **HP-IO-6** | `pkg/wconfig/filewatcher.go` has zero debounce on `fsnotify` and holds `sync.Mutex` during full synchronous disk config reload; 60s telemetry activity writes 2 SQLite Tx/min even when `telemetry:enabled` is `false`; `waveapp.log` has no runtime rotation. | `pkg/wconfig/filewatcher.go:27, 139-173`<br>`emain/emain.ts:170-241`<br>`pkg/telemetry/telemetry.go:167-198, 347-438`<br>`emain/emain-log.ts:68-127` | **VERIFIED (MEDIUM)** |

---

### Phase 3 — 16GB RAM Reduction & Memory Leaks
| ID | Issue | Exact Location (`N:\Wave`) | Verification & Notes |
|---|---|---|---|
| **HP-MEM-1** | **`blockfile` `allscopes: true` broadcast + permanent `fileSubjects` `refCount` leak:** Every cached tab receives & parses every other tab's PTY chunks; `global.ts:88` increments `refCount++` on every chunk without ever calling `release()`, so `TermWrap.dispose()` never frees subjects and `termwrap.ts:403` retains disposed terminals forever. | `frontend/app/store/global.ts:84-93`<br>`frontend/app/store/wps.ts:55-64, 111-128`<br>`frontend/app/view/term/termwrap.ts:402-403, 453` | **VERIFIED (CRITICAL)** |
| **HP-MEM-2** | **`TermWrap.runProcessIdleTimeout()` infinite zombie loop:** Never stores timer/idle IDs and has zero `isDisposed` check; `dispose()` never cancels it, leaking disposed `TermWrap`/`Terminal`/`serializeAddon` instances and running `serialize()` every 5s forever. | `frontend/app/view/term/termwrap.ts:431, 434-454, 593-600` | **VERIFIED (CRITICAL)** |
| **HP-MEM-3** | **Up to 11 Chromium renderers alive + broken cache eviction comparator:** `MaxCacheSize = 10` + `HotSpareTab`; `checkAndEvictCache()` comparator is non-transitive and sorts active tabs to index `0` where eviction starts, causing `tryEvictEntry` to skip evicting inactive tabs. | `emain/emain-tabview.ts:237, 253-293, 375-395`<br>`pkg/wconfig/defaultconfig/settings.json:23` | **VERIFIED (HIGH)** |
| **HP-MEM-4** | **Eager Monaco loading on every tab (including terminal-only & HotSpare):** `wave.ts` statically imports `monaco-env.ts` (5 languages + 6 workers) and calls `loadMonaco()` before first render. | `frontend/wave.ts:5, 193, 264`<br>`frontend/app/monaco/monaco-env.ts:1-82` | **VERIFIED (MEDIUM-HIGH)** |
| **HP-MEM-5** | **`<AIPanel />` stays mounted in every tab when collapsed** (`opacity-0` + `inert`), multiplying idle AI DOM/hooks across cached tabs. | `frontend/app/workspace/workspace.tsx:148-151`<br>`frontend/app/aipanel/aipanel.tsx:579` | **VERIFIED (MEDIUM-HIGH)** |
| **HP-MEM-6** | **Unbounded `DefaultChatStore` in `wavesrv` + O(N²) streaming concat + missing `GOMEMLIMIT`:** `clearChat()` generates a new UUID without calling `Delete()`; attachments (base64 images/PDFs) stay in RAM until exit; no `debug.SetMemoryLimit` / `GOGC` cap. | `pkg/aiusechat/chatstore/chatstore.go:14-129`<br>`frontend/app/aipanel/waveai-model.tsx:294-308`<br>`pkg/aiusechat/anthropic/anthropic-backend.go:800-820`<br>`pkg/aiusechat/openai/openai-backend.go:829`<br>`cmd/server/main-server.go:459-616` | **VERIFIED (HIGH)** |
| **HP-MEM-7** | Unpruned frontend atom/object caches (`wos.ts`, `global.ts`, `tab-model.ts`), leaked `ws.ts` ping `setInterval` & per-frame `new Blob([msg]).size`, leaked `TermWrap` focus listener & `(window as any).term`. | `frontend/app/store/wos.ts:149, 211, 263-266`<br>`frontend/app/store/ws.ts:62-68, 211`<br>`frontend/app/view/term/termwrap.ts:466`<br>`frontend/app/view/term/term.tsx:323` | **VERIFIED (MEDIUM)** |

---

### Phase 4 — Windows GPU, Render Glitches, Flicker & AI Chat Smoothness
| ID | Issue | Exact Location (`N:\Wave`) | Verification & Notes |
|---|---|---|---|
| **HP-GPU-1** | **Windows GPU readback stall (`capturePage`) + sync `PNG.sync.read` on main thread:** Triggered on every `AppBackground` render (because `style` is a new object reference every render) and every 30ms during resize. | `emain/emain-ipc.ts:346-372`<br>`frontend/app/app-bg.tsx:27-54` | **VERIFIED (HIGH)** |
| **HP-GPU-2** | **Windows xterm.js missing `windowsPty` + WebGL context exhaustion + `?2026l` 20ms scroll jump + `heldData` dropped + unawaited `loadInitialTerminalData`:** Missing `windowsPty: { backend: "conpty", buildNumber }` breaks Windows TUI/reflow (`#3501`, `#3253`); `detectWebGLSupport()` leaks 1 context/tab and `onContextLoss` permanently degrades to DOM; `CSI ?2026l` triggers a 20ms delayed `scrollToBottom()` jump (`#3085`); `heldData` is never drained; `serializeAddon.serialize()` forces disk write every 100KB. | `frontend/app/view/term/term.tsx:272-345`<br>`frontend/app/view/term/termwrap.ts:58-68, 198-244, 272, 349-361, 429, 469-542, 580-600` | **VERIFIED (HIGH)** *(Caveat: `doTerminalWrite` per-chunk Promise is allocation overhead since xterm batches frames internally; `serializeAddon` is gated by 100KB + `requestIdleCallback`)* |
| **HP-GPU-3** | **`TileLayout` runs `html-to-image` `toPng()` on `onPointerEnter` + calls `setState` inside `useMemo`** during render; `useDimensions.tsx` debounce broken by stale `domRect == null` closure. | `frontend/layout/lib/TileLayout.tsx:245-288, 312`<br>`frontend/app/hook/useDimensions.tsx:35, 122, 147` | **VERIFIED (HIGH)** *(Caveat: `toPng` caches per `previewElementGeneration`, so runs once per hover per generation)* |
| **HP-GPU-4** | **Unnecessary GPU compositing & 1s native `setBounds()` poller:** Permanent `backdrop-filter: blur(20px)` on `.tab-bar-wrapper`, hardcoded `allowTransparency: true` on xterm even on opaque windows, and 1s `winBoundsPoller` unconditionally calling native `setBounds()` on every off-screen tab. | `frontend/app/tab/tabbar.scss:14`<br>`frontend/app/view/term/term.tsx:307`<br>`emain/emain-window.ts:231-240, 533-545`<br>`emain/emain-tabview.ts:213-220` | **VERIFIED (MEDIUM-HIGH)** |
| **HP-GPU-5** | **AI Chat streaming re-render storm:** `useChat` at `AIPanelComponentInner` re-renders entire panel per token; inline props break `React.memo`; unthrottled scroll listener + `scrollToBottom()` per token; `WaveStreamdown` not `memo`-wrapped + uncancelled Shiki throttle. | `frontend/app/aipanel/aipanel.tsx:276, 359, 604-612`<br>`frontend/app/aipanel/aipanelmessages.tsx:34-64`<br>`frontend/app/element/streamdown.tsx:64-81, 208-328` | **VERIFIED (HIGH)** |

---

## 2. Lower-Priority Optional Bugfixes (Verified from `wavetermdev/waveterm/issues`)

All issues below were independently verified against `N:\Wave` (`v0.14.5`) by both the GitHub Issue Verifier and the Pro-Model Cross-Auditor.

| Upstream Issue | Summary | Exact Root Cause (`N:\Wave`) | Fix Effort | Value |
|---|---|---|---|---|
| **#3568** | WebBookmarks typeahead (`Alt+O`/`Cmd+O`) always empty + wrong JSON path | `frontend/app/view/webview/webview.tsx:781` passes unbound `model.fetchBookmarkSuggestions` (throws `TypeError` on `this.env`). Bonus: `:758` opens `presets/bookmarks.json` while backend (`pkg/wconfig/settingsconfig.go:377`) reads `bookmarks.json`. | Trivial (5 min) | High |
| **#3563** | Codex CLI unreadable dark input under light themes (OSC 11 reports black) | `frontend/app/view/term/termutil.ts:51-53` hardcodes `themeCopy.background = "#00000000"` with no OSC 11 handler in `termwrap.ts:174-197`. | Small | High (for Codex CLI users) |
| **#3517** | Tab background setting resets after closing the only tab | `cmd/server/main-server.go:538` calls `wcore.EnsureInitialData()` **before** `startConfigWatcher()` at `:565`, so `getTabBackground()` (`pkg/wcore/workspace.go:190-196`) runs before `settings.json` is loaded. | Small | Medium |
| **#3150** | Wave Config menu shows "Failed to load files" on fresh install | `frontend/app/view/waveconfig/waveconfig-model.ts:302-325` calls `FileReadCommand` without checking `FileInfoCommand` (`notfound`) first for optional files (`waveai.json`, `widgets.json`, `backgrounds.json`). | Trivial | Medium |
| **#3301 (Part B + edge case)** | `no route for "feblock:..."` when AI tool targets evicted/unmounted tab; empty `reasoning_content` omitted by `omitempty` | `frontend/app/view/term/term-wsh.tsx:16-24` / `pkg/aiusechat/tools_term.go:88-98` (Part B); `pkg/aiusechat/openaichat/openaichat-types.go:65` `omitempty` drops empty `reasoning_content` on DeepSeek thinking tool calls. | Medium | Medium |
| **#3330** | SSH `ProxyCommand` & `StrictHostKeyChecking` unsupported + quoted `HostName` bug | `pkg/remote/sshclient.go:841-869, 964-1109` omits `ProxyCommand`/`StrictHostKeyChecking`; `:998` assigns `&hostNameRaw` instead of `&hostNameProcessed`. | Medium-Large | Medium (SSH users) |
| **#3193** | macOS `Option+Arrow` outputs `;3D` / `;3C` in stock ZSH | `frontend/app/view/term/term.tsx:292, 311` defaults `macOptionIsMeta: false` and `zsh_zshrc.sh` lacks `bindkey` for `^[[1;3D`/`^[[1;3C`. | Small | Low-Medium (macOS only) |

*(Note: Upstream issues **`#3085`**, **`#3501`**, **`#3164`**, **`#3382`**, and **`#3545`** are already folded into **High-Priority Phases 1, 2 & 4** above because they directly match our core Vietnamese IME + AI Agent flicker + Windows ConPTY goals.)*

---

## 3. Filtered Out / Already Fixed / External Limitations (Avoided False Positives)

| Item / Issue | Status | Why Excluded or Downgraded |
|---|---|---|
| **#3301 (Part A — `reasoning_content` missing)** | **Mostly Already Fixed in `v0.14.5`** | `pkg/aiusechat/openaichat/openaichat-backend.go:177-184, 258` and `openaichat-backend_test.go:14-161` already implement & unit-test `reasoning_content` round-trip. Only the `omitempty` edge case & Part B (`feblock:`) remain. |
| **#3607 (Windows local terminal mouse input)** | **External ConPTY / `photostorm/pty` limitation** | Wave forwards raw mouse escape bytes unmodified (`termwrap.ts:375` -> `shellcontroller.go:578`). Root cause is inbox `conhost.exe` via 2023 `github.com/photostorm/pty` fork; fixing requires replacing the PTY library / bundling `OpenConsole.exe` (high risk, out of scope unless prioritized separately). |
| **#3253 (Copying wrapped text adds hard breaks)** | **Partial / ConPTY** | Wave's `trimTerminalSelection()` (`termutil.ts:13-18`) never inserts `\n`; partly mitigated automatically by adding `windowsPty` in **HP-GPU-2**, rest depends on PTY/TUI app emitting explicit CRLF. |
| **`fontutil.ts:43` `isHackFontLoaded` typo** | **Downgraded to Trivial** | Real typo, but `loadFonts()` is only called once in `wave.ts:67` so it does not cause infinite reloads. Still worth a 1-line cleanup during Phase 1. |
| **`AIPanel` singleton collision across tabs** | **False Positive (ruled out)** | Each tab runs in its own Electron `WebContentsView` renderer process, so singletons do not collide; the real issue is only wasted RAM/DOM from keeping `<AIPanel />` mounted when collapsed (**HP-MEM-5**). |
