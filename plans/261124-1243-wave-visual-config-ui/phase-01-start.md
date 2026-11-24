---
phase: 1
title: "Phase 1: Shared Visual Config Framework & General Settings UI"
status: pending
priority: P1
effort: "1d"
dependencies: []
---

# Phase 1: Shared Visual Config Framework & General Settings UI

## Goal
Build the shared Visual Config state/UI primitives, make `Visual ↔ Raw JSON` tab switching lossless, and implement a searchable, categorized Visual Settings UI for `General (settings.json)`.

## Context & Verified Evidence
- `frontend/app/view/waveconfig/waveconfig-model.ts:20-31, 58-107`: `ConfigFile` already supports `visualComponent` + `hasJsonView: true`; `General` (`settings.json`) currently omits `visualComponent`.
- `frontend/app/view/waveconfig/waveconfig.tsx:233-263`: Currently clicking `Visual` runs `confirmDiscardChanges()` + `discardChanges()`, which would wipe edits made in `Raw JSON` before switching. Because our Visual editors share `model.fileContentAtom`, switching between `Visual` and `Raw JSON` should preserve unsaved edits (blocking `Raw JSON -> Visual` only if JSON fails to parse).
- `schema/settings.json:1-360` & `pkg/wconfig/defaultconfig/settings.json`: Defines all typed keys (`app:*`, `term:*`, `window:*`, `editor:*`, `ai:*`, `telemetry:*`, `autoupdate:*`, `tab:*`, `web:*`) with exact types and enums.

## Files to Create / Modify
- Create: `frontend/app/view/waveconfig/visual-config-utils.ts` (shared JSON parse/patch helpers, `useVisualConfigJson` hook, key-preserving immutable updater, optional debounced auto-save helper)
- Create: `frontend/app/view/waveconfig/visual-config-controls.tsx` (reusable Tailwind-styled `SettingRow`, `ToggleControl`, `SelectControl`, `TextControl`, `NumberControl`, `StringListControl`, `KeyValueControl`, `InvalidJsonBanner`)
- Create: `frontend/app/view/waveconfig/settingsvisual.tsx` (`SettingsVisualContent` with search bar, category sidebar/pills, curated metadata + font/theme presets, Reset-to-default per setting)
- Create: `frontend/app/view/waveconfig/tests/visual-config-utils.test.ts`
- Modify: `frontend/app/view/waveconfig/waveconfig-model.ts` (register `visualComponent: SettingsVisualContent` for `settings.json`, add `activeTabAtom` default `"visual"` when `visualComponent` exists, support optional `autoSaveVisualAtom`)
- Modify: `frontend/app/view/waveconfig/waveconfig.tsx` (lossless `Visual ↔ Raw JSON` switch + Auto-save toggle in header for visual files)

## Tasks & Implementation Steps
1. **Build `visual-config-utils.ts` (prototype-safe & `$ENV:`-aware):** <!-- Updated: Red Team 2026-11-24 - prototype pollution guards, $ENV: detection, defensive type guards -->
   - Implement `isUnsafeObjectKey(key)` rejecting `"__proto__"`, `"constructor"`, `"prototype"`, and use `Object.hasOwn(obj, key)` for all membership/collision checks.
   - Implement `parseConfigObject(raw: string): { ok: true; data: Record<string, any> } | { ok: false; error: string }` handling empty string as `{}` and rejecting arrays/primitives/null.
   - Implement `isEnvMacroValue(val: unknown): boolean` detecting `"$ENV:..."` strings so typed controls render an `Env Var` badge with an explicit **Override** button instead of clobbering `$ENV:` references.
   - Implement `updateConfigKey(data, key, value)` and `deleteConfigKey(data, key)` that preserve all unrelated keys and serialize cleanly with `JSON.stringify(next, null, 2)`.
   - Implement `useVisualConfigJson(model)` hook reading `model.fileContentAtom`, exposing `{ parsed, parseError, setField, deleteField, replaceData }` and delegating debounced auto-save to `model.scheduleAutoSave()` (never auto-saving sensitive plaintext keys like `ai:apitoken`).
2. **Build reusable form controls in `visual-config-controls.tsx`:**
   - Accessible, compact dark-mode controls matching Wave's Tailwind theme tokens (`border-border`, `bg-secondary`, `text-primary`, `text-muted-foreground`, `bg-accent`):
     - `ToggleControl`, `SelectControl`, `TextControl` (with optional datalist/preset chips and `sensitive?: boolean` password masking), `NumberControl` (clamped min/max + integer enforcement where required), `StringListControl` (add/remove array items), `KeyValueControl` (rejecting unsafe keys), `DeferredKeyRenameControl` (commits key renames only on explicit Apply/Enter/Blur after uniqueness + regex check), `InvalidJsonBanner` (button to jump straight to `Raw JSON`).
   - Ensure all text inputs handle Vietnamese IME cleanly (do not intercept `isComposing` / `keyCode === 229`).
3. **Harden `WaveConfigViewModel` & `waveconfig.tsx` (lossless Visual ↔ JSON, race-free auto-save, validators, & quiet secrets helpers):** <!-- Updated: Red Team 2026-11-24 - serialized saveFile snapshot, loadSeq, validationError clear, non-blocking secrets helpers, external reload -->
   - Move debounced auto-save (400ms) into `WaveConfigViewModel` with `cancelPendingAutoSave()` called in `loadFile()`, `discardChanges()`, and manual `saveFile()`. In `saveFile()`, snapshot `(targetFilePath, contentSnapshot)` before `await FileWriteCommand` and only clear `hasEditedAtom` / update `fileContentAtom` if `selectedFileAtom.path === targetFilePath` and `fileContentAtom` has not mutated while in flight (otherwise queue one trailing save). Gate auto-save so it skips disk writes when validation errors exist.
   - Add a monotonic `loadSeq` counter to `loadFile()` (discard stale async responses), clear `validationErrorAtom` on every `loadFile()`, track file `modtime` from `FileInfoCommand`, and auto-reload silently when `fullConfigAtom` updates while `!hasEditedAtom`.
   - Add lightweight `ConfigValidator` functions for `settings.json` (integer check on `term:scrollback` / `window:maxtabcachesize`), `connections.json` (entry object check, `ssh:port` string), `backgrounds.json` (entry `null` or object with non-empty `display:name`, `bg:opacity` in `[0,1]`), and `waveai.json` (key regex + `display:name` + enum check).
   - Add non-blocking `fetchSecretNamesQuietly()` and `createSecretInline(name, value)` on `WaveConfigViewModel` that update `secretNamesAtom` **without touching `isLoadingAtom`** (preventing `<VisualComponent />` unmount), enforce `checkStorageBackend()` (`basic_text`/`unknown` guard), and reject duplicate secret names.
   - In `waveconfig.tsx`, when switching `Raw JSON -> Visual`: validate `parseConfigObject(fileContent)`; if invalid, set `validationErrorAtom` and stay on `Raw JSON`. When switching `Visual -> Raw JSON`: switch directly without losing edits. Default `activeTabAtom` to `"visual"` when opening a file with `visualComponent`. Add an `Auto-save` toggle pill in the header (default `false`).
4. **Implement `SettingsVisualContent` (`settingsvisual.tsx`):** <!-- Updated: Red Team 2026-11-24 - effective defaults from fullConfig.settings, mask sensitive advanced keys -->
   - Search box filtering by label, key (`term:fontfamily`), or description.
   - Category filter tabs: **All**, **Terminal**, **Appearance & Window**, **App & Shortcuts**, **Performance (RAM)**, **Editor**, **AI & Privacy**.
   - Display effective values via `parsed[key] ?? fullConfig?.settings?.[key] ?? def.defaultValue` (so booleans defaulting to `true` in `defaultconfig/settings.json` display accurately), while using `Object.hasOwn(parsed, key)` for the "Modified" badge + 1-click **Reset** button (`deleteField(key)`).
   - Curated definitions covering Terminal (`term:fontfamily` with `'Cascadia Mono', Consolas, Hack, monospace` preset, `term:fontsize`, `term:theme`, `term:scrollback`, `term:cursor`, `term:cursorblink`, `term:disablewebgl`, `term:transparency`, `term:shiftenternewline`, `term:trimtrailingwhitespace`, `term:localshellpath`), Appearance & Window (`app:tabbar`, `window:transparent`, `window:blur`, `window:opacity`, `window:bgcolor`, `window:nativetitlebar`, `window:zoom`, `tab:confirmclose`), Performance (`window:maxtabcachesize`, `term:scrollback`, `term:disablewebgl`), App & Shortcuts (`app:ctrlvpaste`, `app:confirmquit`, `app:focusfollowscursor`, `app:hideaibutton`, `app:showoverlayblocknums`, `app:defaultnewblock`, `app:globalhotkey`), Editor (`editor:fontsize`, `editor:minimapenabled`, `editor:wordwrap`, `editor:stickyscrollenabled`), AI & Privacy (`telemetry:enabled`, `autoupdate:enabled`, `autoupdate:channel`, `waveai:defaultmode`).
   - Collapsible "Other / Advanced Keys" section masking any key matching `/token|secret|password/i` by default.
5. **Unit tests:**
   - Create `frontend/app/view/waveconfig/tests/visual-config-utils.test.ts` testing `parseConfigObject`, `isUnsafeObjectKey` (`__proto__`, `constructor`, `prototype`, `toString`), `isEnvMacroValue`, and key-preserving updates/deletes.

## Todo
- [x] Create `visual-config-utils.ts` with prototype-safe `parseConfigObject`, `isEnvMacroValue`, `updateConfigKey`, `deleteConfigKey`, `useVisualConfigJson`
- [x] Create `visual-config-controls.tsx` reusable form components including `DeferredKeyRenameControl` and sensitive masking
- [x] Harden `waveconfig-model.ts` & `waveconfig.tsx` (serialized auto-save, `loadSeq`, `validationErrorAtom` reset, validators, non-blocking `fetchSecretNamesQuietly`/`createSecretInline`, lossless tab switching)
- [x] Implement `settingsvisual.tsx` with effective defaults from `fullConfig.settings`, search, presets, reset, and masked advanced keys
- [x] Add unit tests in `visual-config-utils.test.ts` and verify `npx vitest run`

## Verification
- Automated: `npx vitest run frontend/app/view/waveconfig/tests/visual-config-utils.test.ts` and `npm run build:dev`
- Manual: Open Wave Config → General, toggle settings, search `"font"`, switch to Raw JSON and back without losing edits, verify `Save` updates `settings.json` live.

## Risk Assessment
- If `settings.json` contains JSONC comments (rare), `JSON.parse` will fail; `InvalidJsonBanner` lets the user jump to Raw JSON without losing data.
- `SettingsVisualContent` must NOT statically import `monaco-editor` so our Phase 3 lazy-Monaco split stays intact.
