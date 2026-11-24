---
phase: 1
title: "Phase 1: Vietnamese IME & Font Rendering"
status: pending
priority: P1
effort: "1d"
dependencies: []
---

# Phase 1: Vietnamese IME & Font Rendering

## Goal
Eliminate Vietnamese character jumping, lost/reordered diacritics, and blurry/mismatched Vietnamese glyphs in AI Chat and Terminal for Unikey, EVKey, and Windows Telex (and CJK IMEs `#3164`, `#3382`, `#3545`).

## Context & Verified Evidence
- `frontend/util/keyutil.ts:21-32, 134-186, 231-272`: `keydownWrapper`, `adaptFromReactOrNativeKeyEvent`, and `adaptFromElectronKeyEvent` ignore `isComposing` / `keyCode === 229`. `isCharacterKeyEvent` requires `countGraphemes(event.key) == 1` and `inputKeyMap` omits `"Process"` and `"Dead"`, so `isInputEvent` returns falsy during IME composition.
- `frontend/app/store/keymodel.ts:104-121, 416-468`: Because `isInputEvent` is falsy for `"Process"`, `shouldDispatchToBlock` returns `true` even inside focused `<textarea>`/`<input>`, leaking composing keydowns to block `keyDownHandler`.
- `frontend/app/view/term/term-model.ts:699-780`, `frontend/app/aipanel/aipanel.tsx:320-326`, `emain/emain-tabview.ts:326-344`: Missing `isComposing` / `keyCode === 229` guards.
- `frontend/app/aipanel/aipanelinput.tsx:25, 41-49, 70, 96-98, 147-160`: Controlled `<textarea>` guards `Enter` at `:70`, but lacks `onCompositionStart`/`onCompositionEnd` deferral and executes synchronous `height="auto"` -> `scrollHeight` layout reflow on every `input` change (stuttering under rapid Unikey/EVKey synthetic Backspace+char sequences).
- `frontend/util/fontutil.ts:19-30, 39-43`: JetBrains Mono bundles only `latin` subset (`jetbrains-mono-v13-latin-*.woff2`); `:43` has latent typo `isHackFontLoaded = true` instead of `isHackNerdFontLoaded = true`.
- `frontend/app/view/term/term.tsx:303`, `frontend/app/theme.scss:12-19`, `frontend/app/app.scss:20-22`: Terminal defaults to bare `"Hack"` with no fallback chain; AI Chat inherits `--base-font` (`"Inter", sans-serif`) instead of a Vietnamese-safe UI stack; `body` forces `transform: translateZ(0); backface-visibility: hidden;` which disables Windows ClearType subpixel rendering.

## Files to Create / Modify
- Modify: `frontend/util/keyutil.ts`
- Modify: `frontend/app/store/keymodel.ts`
- Modify: `frontend/app/view/term/term-model.ts`
- Modify: `frontend/app/aipanel/aipanel.tsx`
- Modify: `emain/emain-tabview.ts`
- Modify: `frontend/app/aipanel/aipanelinput.tsx`
- Modify: `frontend/util/fontutil.ts`
- Modify: `frontend/app/theme.scss`
- Modify: `frontend/app/app.scss`
- Modify: `frontend/app/view/term/term.tsx`
- Create: `frontend/util/tests/keyutil-ime.test.ts`

## Tasks & Implementation Steps
1. **Guard IME composition across the entire key event pipeline:**
   - Extend `WaveKeyboardEvent` in `frontend/util/keyutil.ts` to carry `isComposing?: boolean` and `keyCode?: number` populated from both DOM/React events (`e.isComposing || e.keyCode === 229`) and Electron `input` (`input.isComposing`).
   - Add helper `isImeComposingEvent(e)` checking `e.isComposing || e.keyCode === 229 || e.key === "Process" || e.key === "Dead"`.
   - Update `isInputEvent` in `frontend/util/keyutil.ts` to return `true` when `isImeComposingEvent(e)` is true so `shouldDispatchToBlock` (`frontend/app/store/keymodel.ts:104-121`) never leaks composing keys out of `<input>`/`<textarea>`/`contentEditable`.
   - Short-circuit `appHandleKeyDown` (`keymodel.ts:416`), `handleTerminalKeydown` (`term-model.ts:699`, returning `true` so xterm handles the IME event natively without Wave intercepting), `aipanel.tsx:320`, and `emain/emain-tabview.ts:326` (`before-input-event`) when `isComposing` is true.
2. **Stabilize `AIPanelInput` for both native IME (Windows Telex) and synthetic IME (Unikey / EVKey):**
   - In `frontend/app/aipanel/aipanelinput.tsx`, introduce local `draftValue` state + `isComposingRef` (`onCompositionStart` / `onCompositionEnd`). While `isComposingRef.current` is `true`, update only local state and flush to Jotai `model.inputAtom` on `onCompositionEnd`; synchronize external `model.inputAtom` resets (e.g., after submit or clear) via `useEffect` only when `!isComposingRef.current`.
   - Replace synchronous `resizeTextarea()` in `useEffect([input])` with a `requestAnimationFrame`-coalesced resize helper (cancelling pending rAF on unmount/re-trigger) that skips DOM height mutations when `scrollHeight` has not changed.
3. **Fix Vietnamese font rendering & Windows ClearType:**
   - In `frontend/util/fontutil.ts:43`, fix `isHackNerdFontLoaded = true`.
   - In `frontend/app/theme.scss:12-19`, extend `--base-font` with Vietnamese-complete OS fallbacks (`"Inter", "Segoe UI", "Noto Sans", -apple-system, BlinkMacSystemFont, sans-serif`) and `--font-mono` with `"Hack", "JetBrains Mono", "Cascadia Mono", "Consolas", monospace`; apply `--markdown-font-family` or the updated `--base-font` consistently in AI Chat (`aipanelinput.tsx` & `aimessage.tsx`).
   - In `frontend/app/view/term/term.tsx:303`, change the bare `"Hack"` fallback to `"Hack, 'Cascadia Mono', Consolas, monospace"` so missing Vietnamese glyphs fall back deterministically to a metric-compatible monospace font on Windows.
   - In `frontend/app/app.scss:20-22`, remove `backface-visibility: hidden; transform: translateZ(0);` from `body` so Windows Chromium preserves ClearType subpixel antialiasing for stacked Vietnamese diacritics.
4. **Add unit tests for IME key routing:**
   - Create `frontend/util/tests/keyutil-ime.test.ts` verifying `isImeComposingEvent`, `isInputEvent` for `"Process"`/`"Dead"`/`keyCode: 229`, and `shouldDispatchToBlock` returning `false` when composing inside `<textarea>`.

## Todo
- [x] Add `isComposing`/`keyCode`/`"Process"` guards to `keyutil.ts`, `keymodel.ts`, `term-model.ts`, `aipanel.tsx`, `emain-tabview.ts`
- [x] Refactor `AIPanelInput` with composition deferral and rAF-coalesced textarea resize
- [x] Update Vietnamese font fallback chains in `theme.scss`, `term.tsx`, fix typo in `fontutil.ts`, remove `translateZ(0)` in `app.scss`
- [x] Add and pass unit tests in `frontend/util/tests/keyutil-ime.test.ts`

## Verification
- Automated: `npx vitest run frontend/util/tests/keyutil-ime.test.ts` and `npm test`
- Manual on Windows (`task dev`): Type rapid Vietnamese paragraphs (`"Tiếng Việt có dấu ă â đ ê ô ơ ư ệ ộ ữ"`) using Unikey (Telex), EVKey, and Windows Telex in both AI Chat `<textarea>` and Terminal (`pwsh`), testing Space/Enter/Backspace mid-composition and verifying crisp glyph alignment.

## Risk Assessment
- Removing `transform: translateZ(0)` on `body` could affect an animation that implicitly assumed a composited root layer; verify window drag/fade transitions visually on Windows.
- Local `draftValue` in `AIPanelInput` must stay strictly synced when `model.inputAtom` is programmatically updated (e.g., prompt history, clear chat, slash commands).
