---
phase: 4
title: "Phase 4: Windows GPU Render, Terminal Flicker & AI Streaming Smoothness"
status: pending
priority: P1
effort: "1d"
dependencies: [2, 3]
---

# Phase 4: Windows GPU Render, Terminal Flicker & AI Streaming Smoothness

## Goal
Eliminate Windows GPU stalls (`capturePage`), xterm.js ConPTY/WebGL render glitches and Claude Code flicker (`#3085`, `#3501`), hover `toPng()` freezes, unnecessary GPU blur layers, and AI Chat token-streaming re-render storms.

## Context & Verified Evidence
- `emain/emain-ipc.ts:346-372` & `frontend/app/app-bg.tsx:27-54`: `AppBackground` creates a fresh `style` object every render, invalidating `useCallback(debounce(30, ...))` and triggering Windows `capturePage()` GPU readback + synchronous `PNG.sync.read()` on Electron main thread on every render and 30ms resize tick.
- `frontend/app/view/term/term.tsx:272-345`: (1) Omits xterm.js `windowsPty` option (`{ backend: "conpty", buildNumber }`), causing broken Windows TUI layouts (`#3501`) and wrapped copy breaks (`#3253`); (2) hardcodes `allowTransparency: true` even on opaque windows; (3) disposes and recreates the entire `Terminal` + WebGL context whenever any `term:*` setting changes.
- `frontend/app/view/term/termwrap.ts:58-68, 198-244, 272, 349-361, 429, 469-542, 580-600`: (1) `detectWebGLSupport()` leaks 1 WebGL2 context per renderer tab; (2) `onContextLoss` permanently degrades to DOM with no recovery; (3) `CSI ?2026l` after `CSI 3J` runs `setTimeout(() => scrollToBottom(), 20)` causing flicker/jumps (`#3085`); (4) `heldData` pushed before `this.loaded = true` is never drained; (5) `loadInitialTerminalData` does not `await` `doTerminalWrite(cacheData)` before `resize()`; (6) `serializeAddon.serialize()` runs every 100KB -> `SaveTerminalState` disk write.
- `frontend/layout/lib/TileLayout.tsx:245-288, 312` & `frontend/app/hook/useDimensions.tsx:35, 122, 147`: `onPointerEnter` eagerly calls `toPng(previewRef.current)` and `useMemo` calls `setState` during render; `useDimensions` debounce is dead due to stale `domRect == null` closure.
- `frontend/app/tab/tabbar.scss:14` & `emain/emain-window.ts:231-240, 533-545` & `emain/emain-tabview.ts:213-220`: Permanent `backdrop-filter: blur(20px)` on `.tab-bar-wrapper`; 1s `winBoundsPoller` calls native `setBounds()` unconditionally on every off-screen tab.
- `frontend/app/aipanel/aipanel.tsx:276, 359, 604-612`, `aipanelmessages.tsx:34-64`, `aimessage.tsx:210-267`, `streamdown.tsx:64-81, 208-328`: Full-panel re-render per streamed token, broken `React.memo` via inline callbacks, unthrottled scroll handler + forced `scrollToBottom()` per token, unmemoized `WaveStreamdown` + uncancelled Shiki throttle.

## Files to Create / Modify
- Modify: `emain/preload.ts`
- Modify: `frontend/types/custom.d.ts`
- Modify: `frontend/app/app-bg.tsx`
- Modify: `emain/emain-ipc.ts`
- Modify: `frontend/app/view/term/term.tsx`
- Modify: `frontend/app/view/term/termutil.ts`
- Modify: `frontend/app/view/term/termwrap.ts`
- Modify: `frontend/layout/lib/TileLayout.tsx`
- Modify: `frontend/app/hook/useDimensions.tsx`
- Modify: `frontend/app/tab/tabbar.scss`
- Modify: `emain/emain-tabview.ts`
- Modify: `frontend/app/aipanel/aipanel.tsx`
- Modify: `frontend/app/aipanel/aipanelmessages.tsx`
- Modify: `frontend/app/aipanel/aimessage.tsx`
- Modify: `frontend/app/element/streamdown.tsx`

## Tasks & Implementation Steps
1. **Eliminate Windows `capturePage()` + `PNG.sync.read()` main-thread stall:** <!-- Updated: Red Team 2026-11-24 - add preload.ts & custom.d.ts direct-color IPC -->
   - Expose `getOsRelease(): string` (from Node `os.release()`) and extend `updateWindowControlsOverlay` in `emain/preload.ts` + `frontend/types/custom.d.ts` to accept either a `Dimensions` rect or an explicit `{ color: string; isDark: boolean }` payload.
   - In `frontend/app/app-bg.tsx`, memoize `style` with `useMemo` based on actual primitive/serialized metadata fields, increase debounce to `250ms`, and compute titlebar overlay contrast directly from the configured theme/background CSS color (sending `{ color, isDark }` and bypassing `capturePage()` completely) whenever no custom image background is active.
   - In `emain/emain-ipc.ts:346-372`, handle direct `{ color, isDark }` payloads without calling `capturePage()`/`PNG.sync.read()`, and cache image-background `capturePage()` results by `(tabId, bgHash, width)`.
2. **Fix xterm.js Windows ConPTY, opaque background theme, WebGL lifecycle, `heldData` offset dedup, and flicker (`#3085`, `#3501`):** <!-- Updated: Red Team 2026-11-24 - coordinate allowTransparency:false with real bgcolor, offset-dedup heldData -->
   - Parse Windows build number from `getApi().getOsRelease()` and pass `windowsPty: { backend: "conpty", buildNumber }` when constructing `Terminal` on Windows in `frontend/app/view/term/term.tsx:296-315`.
   - Set `allowTransparency: isWindowTransparent || hasCustomTabBg` (false by default on opaque Windows) AND in `frontend/app/view/term/termutil.ts:51-53` / `term.tsx:277` **set `termTheme.background = bgcolor` (the real opaque theme background) whenever `allowTransparency` is `false`**, preventing opaque terminals from turning pitch black (`#00000000`). Update mutable `terminal.options` (`fontSize`, `fontFamily`, `theme`, `scrollback`) in place instead of disposing/recreating `TermWrap`.
   - In `frontend/app/view/term/termwrap.ts`:
     - Call `gl.getExtension("WEBGL_lose_context")?.loseContext()` in `detectWebGLSupport()` (`:58-68`).
     - In `loadInitialTerminalData`, `await this.doTerminalWrite(cacheData, ptyOffset)` before `this.terminal.resize(...)` (`:530-532`). When draining `this.heldData` after `this.loaded = true`, **deduplicate/slice each chunk against `this.ptyOffset` using the byte offset emitted in `WSFileEventData` (Phase 2)** so chunks already included in `fetchWaveFile` are never double-written or allowed to corrupt `this.ptyOffset`.
     - Replace the 20ms `setTimeout(() => scrollToBottom(), 20)` on CSI `?2026l` (`:235-240`) with `requestAnimationFrame` only when the viewport was already at bottom (`wasAtBottom`), preventing scroll jumps during Claude Code repaints.
     - Increase `MinDataProcessedForCache` (e.g., `512KB`) and require terminal output idle for `>= 15s` before calling `serializeAddon.serialize()` -> `SaveTerminalState`, preventing mid-stream stalls and McAfee disk churn.
3. **Fix `TileLayout` hover `toPng()` & `useDimensions` debounce:**
   - In `frontend/layout/lib/TileLayout.tsx:245-288, 312`, remove `setPreviewElementGeneration` from inside `useMemo` (move to `useEffect` or ref counter) and trigger `toPng()` lazily on drag start (or skip raster preview in favor of lightweight CSS ghost) instead of `onPointerEnter`.
   - In `frontend/app/hook/useDimensions.tsx:35, 122`, track `hasMeasuredRef` instead of closing over stale `domRect == null` so `setDomRectDebounced` actually executes on resize.
4. **Remove unnecessary GPU blur & redundant `setBounds()`:**
   - In `frontend/app/tab/tabbar.scss:14`, apply `backdrop-filter: blur(20px)` only when transparency/blur mode is explicitly enabled (`.window-transparent .tab-bar-wrapper`), using an opaque background color by default.
   - In `emain/emain-tabview.ts:213-220` (`positionTabOffScreen`), guard `this.setBounds(...)` by comparing against `this.getBounds()` (matching `positionTabOnScreen`).
5. **Optimize AI Chat streaming re-renders:**
   - In `frontend/app/aipanel/aipanel.tsx`, memoize `handleSubmit` and `onContextMenu` with `useCallback` so `AIPanelMessages` and `AIPanelInput` `React.memo` actually hit.
   - In `frontend/app/aipanel/aipanelmessages.tsx`, throttle the `scroll` listener and coalesce `scrollToBottom()` via `requestAnimationFrame`.
   - In `frontend/app/aipanel/aimessage.tsx` and `frontend/app/element/streamdown.tsx`, memoize derived message part grouping, wrap `WaveStreamdown` in `React.memo` with module-level constant `shikiTheme`/`controls`/`mermaid` configs, and cancel Shiki's `throttle` in a `useEffect` unmount cleanup.

## Todo
- [x] Add `getOsRelease()` and direct-color `updateWindowControlsOverlay` to `preload.ts`, `custom.d.ts`, `emain-ipc.ts`, and memoize `AppBackground` style
- [x] Add Windows `windowsPty`, opaque `allowTransparency` paired with real `bgcolor`, in-place `terminal.options` updates, offset-deduplicated `heldData` drain, awaited `loadInitialTerminalData`, WebGL context cleanup, rAF `?2026l` scroll, and idle-gated `serializeAddon`
- [x] Move `TileLayout` `toPng()` off `onPointerEnter`, remove `setState` in `useMemo`, and fix `useDimensions.tsx` stale closure
- [x] Gate `.tab-bar-wrapper` `backdrop-filter` on transparent windows and guard `positionTabOffScreen` `setBounds()`
- [x] Memoize AI Chat callbacks, rAF-coalesce auto-scroll, `React.memo` `WaveStreamdown`, and cancel Shiki throttle on unmount

## Verification
- Automated: `npm test` and `npm run build:dev`
- Manual on Windows (`task dev`): Run 2 concurrent Claude Code / AI TUI sessions, hover across blocks, resize window rapidly, and verify zero scroll jumps, smooth 60fps resizing, and low GPU/main-thread usage in Electron DevTools Performance panel.

## Risk Assessment
- In-place `terminal.options` updates must still call `fitAddon.fit()` when `fontSize` or `fontFamily` changes so PTY columns/rows stay synchronized.
- Bypassing `capturePage()` on non-image backgrounds must preserve light/dark window control overlay contrast on Windows custom themes.
