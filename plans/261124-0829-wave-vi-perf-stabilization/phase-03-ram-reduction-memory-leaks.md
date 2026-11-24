---
phase: 3
title: "Phase 3: 16GB RAM Reduction & Memory Leaks"
status: pending
priority: P1
effort: "1d"
dependencies: []
---

# Phase 3: 16GB RAM Reduction & Memory Leaks

## Goal
Eliminate critical frontend/Electron memory leaks (`fileSubjects`, `TermWrap` zombie timers, unpruned atom caches) and reduce multi-tab Chromium RAM footprint by 40–60% on 16GB Windows machines.

## Context & Verified Evidence
- `frontend/app/store/global.ts:84-93` & `frontend/app/store/wps.ts:55-64, 111-128` & `frontend/app/view/term/termwrap.ts:402-403, 453`: Global `"blockfile"` subscribes with `allscopes: true` across all cached tabs; every incoming chunk calls `getFileSubject()` incrementing `refCount++` without ever releasing; `termwrap.ts:403` never unsubscribes its listener, permanently retaining disposed `TermWrap`/`Terminal` instances.
- `frontend/app/view/term/termwrap.ts:431, 434-454, 593-600`: `runProcessIdleTimeout()` schedules an infinite `setTimeout(5000)` -> `requestIdleCallback` loop with no `isDisposed` flag and no cleanup in `dispose()`, leaking every closed/recreated terminal forever.
- `emain/emain-tabview.ts:237, 253-293, 375-395` & `pkg/wconfig/defaultconfig/settings.json:23`: `MaxCacheSize = 10` + `HotSpareTab` keeps up to 11 Chromium `WebContentsView`s alive; `checkAndEvictCache()` comparator is non-transitive and sorts active tabs to index `0` where eviction starts, skipping eviction of inactive tabs.
- `frontend/wave.ts:5, 193, 264` & `frontend/app/monaco/monaco-env.ts:1-82`: Statically imports and eagerly initializes Monaco Editor (5 languages + 6 workers) before first render on every tab including terminal-only tabs and `HotSpareTab`.
- `frontend/app/workspace/workspace.tsx:148-151`: `<AIPanel />` stays mounted (`opacity-0` + `inert`) even when collapsed in every tab.
- `frontend/app/store/ws.ts:62-68, 211`, `frontend/app/store/wos.ts:149, 211, 263-266`, `frontend/app/view/term/termwrap.ts:466`, `frontend/app/view/term/term.tsx:323`, `emain/emain.ts:374-400`: Leaked ping interval, per-frame `new Blob([msg]).size`, unpruned `wos` object/atom caches, leaked DOM focus listener, global `window.term` ref, and unbounded Chromium disk cache/V8 flags.

## Files to Create / Modify
- Modify: `frontend/app/store/global.ts`
- Modify: `frontend/app/store/wps.ts`
- Modify: `frontend/app/view/term/termwrap.ts`
- Modify: `frontend/app/view/term/term.tsx`
- Modify: `emain/emain-tabview.ts`
- Modify: `pkg/wconfig/defaultconfig/settings.json`
- Modify: `emain/emain.ts`
- Modify: `frontend/wave.ts`
- Modify: `frontend/app/monaco/monaco-env.ts`
- Modify: `frontend/app/monaco/monaco-react.tsx`
- Modify: `frontend/app/view/codeeditor/codeeditor.tsx` (change value `import * as MonacoModule` to `import type` + `React.lazy` wrapper)
- Modify: `frontend/app/workspace/workspace.tsx`
- Modify: `frontend/app/aipanel/aipanel.tsx`
- Modify: `frontend/app/aipanel/waveai-model.tsx`
- Modify: `pkg/aiusechat/tools_term.go`
- Modify: `frontend/app/store/ws.ts`
- Modify: `frontend/app/store/wos.ts`

## Tasks & Implementation Steps
1. **Fix `fileSubjects` refCount leak & scope `"blockfile"` subscriptions (race-free):** <!-- Updated: Red Team 2026-11-24 - await EventSubCommand before fetchWaveFile -->
   - Add a non-creating lookup helper `peekFileSubject(zoneId, fileName)` in `frontend/app/store/wps.ts` that returns an existing `Subject` without creating one or incrementing `refCount`.
   - Update `frontend/app/store/global.ts:84-93` to use `peekFileSubject(zoneid, filename)` (no-op if no active subscriber in this tab!).
   - Provide an async `ensureBlockFileSubscribed(blockId)` in `wps.ts` that **awaits `RpcApi.EventSubCommand` (without `{ noresponse: true }`)** before `loadInitialTerminalData()` calls `fetchWaveFile()`, eliminating the WS/HTTP mount race; unsubscribe the `block:<blockId>` scope when `refCount` hits `0`.
   - In `frontend/app/view/term/termwrap.ts:403, 453`, store the `Subscription` returned by `this.mainFileSubject.subscribe(...)` and call `subscription.unsubscribe()` in `dispose()` before `this.mainFileSubject.release()`.
2. **Fix `TermWrap` zombie idle timer & DOM/window leaks:**
   - Add `private isDisposed = false;`, `private idleTimeoutId`, and `private idleCallbackId` to `TermWrap`; check `if (this.isDisposed) return;` inside `runProcessIdleTimeout()` and cancel both handles in `dispose()`.
   - Remove the focus event listener added at `termwrap.ts:466` inside `dispose()`, and clear `(window as any).term` in `term.tsx` cleanup if it points to the disposed instance.
3. **Fix tab cache eviction bug, lower default `MaxCacheSize`, & handle `#3301` `feblock:` gracefully:** <!-- Updated: Red Team 2026-11-24 - single-pass loop, waveTabId init order, move #3301 feblock error here -->
   - In `emain/emain-tabview.ts:282-292`, fix `checkAndEvictCache()` to filter out `isActiveTab` entries first, sort inactive entries by `lastUsedTs` ascending, and iterate **once** (`for (const tv of inactive)` breaking when `wcvCache.size <= MaxCacheSize` — never a `while` loop that can hang when all tabs are active or `< 1000ms` old). Also set `tabView.waveTabId = tabId` **before** calling `setWaveTabView(tabId, tabView)` (`:313-314`).
   - Lower default `"window:maxtabcachesize"` from `10` to `3` (or dynamically cap at `3` when `os.totalmem() <= 16 * 1024^3`, configurable via `settings.json`).
   - In `pkg/aiusechat/tools_term.go:88-98` (moved from Phase 5 as a prerequisite for `MaxCacheSize = 3`), catch missing `feblock:` route errors and return a structured, actionable tool error telling the agent/user the terminal is on an inactive/evicted tab and must be focused (never fall back to raw `filestore` bytes, avoiding cleared-secret leakage and ANSI prompt injection).
   - In `emain/emain.ts:374-400`, append conservative Chromium switches on Windows (`--disk-cache-size=104857600` to cap disk cache at 100MB and reduce McAfee cache-churn).
4. **Truly lazy-load Monaco Editor (code-split out of `wave.ts` entry):** <!-- Updated: Red Team 2026-11-24 - break static BlockRegistry -> codeeditor -> monaco-react chain -->
   - Remove the top-level static `import { loadMonaco }` from `frontend/wave.ts:5, 193, 264`.
   - Break the static import chain reachable from `blockregistry.ts`: change `frontend/app/view/codeeditor/codeeditor.tsx:8` from `import * as MonacoModule from "monaco-editor"` to `import type * as MonacoModule from "monaco-editor"`, lazy-load `MonacoCodeEditor` via `React.lazy(() => import("@/app/monaco/monaco-react"))` wrapped in `<Suspense>`, and audit all remaining `monaco-editor`/`monaco-env` callers so Vite splits Monaco + its 6 workers into an async chunk never imported by `wave.ts` or `HotSpareTab`.
5. **Reduce collapsed `<AIPanel />` DOM/memory safely & fix `ws.ts` / `wos.ts` leaks:** <!-- Updated: Red Team 2026-11-24 - guard submitted+streaming via isAIStreaming and preserve focus/appendText -->
   - In `frontend/app/workspace/workspace.tsx:148-151` & `aipanel.tsx`, gate unmounting the heavy message list (`AIPanelMessages` / `WaveStreamdown` DOM subtree) on `!aiPanelVisible && !model.isAIStreaming` (`status === "streaming" || status === "submitted"`), while keeping `useChat` / `WaveAIModel` focus/appendText handlers intact (or flushing deferred focus on mount) so submitted reasoning-model streams are never aborted and external "Ask Wave AI" actions never drop focus.
   - In `frontend/app/store/ws.ts`, save and `clearInterval` the ping timer in `shutdown()`, and replace `new Blob([msg]).size` with `msg.length` (or `TextEncoder` only when length > threshold).
   - In `frontend/app/store/wos.ts:263-266`, prune `waveObjectValueCache` and `waveObjectDerivedAtomCache` entries on `"delete"` events.

## Todo
- [x] Implement `peekFileSubject`, awaited `ensureBlockFileSubscribed`, and `TermWrap` subscription unsubscribe
- [x] Fix `TermWrap.runProcessIdleTimeout()` zombie loop, focus listener leak, and `window.term` cleanup
- [x] Fix `checkAndEvictCache()` single-pass loop + `waveTabId` init order, cap `MaxCacheSize` to 3, handle `#3301` `feblock:` error cleanly in `tools_term.go`, add `--disk-cache-size`
- [x] Break static `codeeditor.tsx`/`monaco-react.tsx` import chain with `React.lazy` + `import type` and verify Vite chunk split
- [x] Unmount collapsed `AIPanelMessages` subtree safely (guarding `isAIStreaming` = `streaming || submitted`), clear `ws.ts` ping timer, remove per-frame `Blob`, and prune `wos.ts` caches on delete

## Verification
- Automated: `npm test` and `npm run build:dev` (verify Vite splits Monaco into a separate async chunk not imported by `wave.ts` entry)
- Manual: Open 8 tabs with terminals, close 5 tabs, inspect Chrome DevTools Memory heap snapshot and Task Manager to verify `fileSubjects.size` drops to active blocks, zero zombie `TermWrap` instances remain, and renderer process count stays `<= MaxCacheSize + 1`.

## Risk Assessment
- Unmounting `<AIPanel />` while an AI response is actively streaming could abort the SSE stream; guard unmounting so an actively streaming panel stays mounted until stream completes (or move stream lifecycle to `WaveAIModel`).
- Scoped `"blockfile"` subscriptions must ensure `getFileSubject` registers the `block:<blockId>` scope *before* initial file read completes so no append chunks are missed during mount.
