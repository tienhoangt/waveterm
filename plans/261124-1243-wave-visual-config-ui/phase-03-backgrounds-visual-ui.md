---
phase: 3
title: "Phase 3: Tab Backgrounds Visual Gallery & Editor"
status: pending
priority: P1
effort: "0.5d"
dependencies: [1]
---

# Phase 3: Tab Backgrounds Visual Gallery & Editor

## Goal
Build a Visual Tab Background Gallery & Editor for `Tab Backgrounds (backgrounds.json)` with live CSS background previews, built-in gradient/color presets, opacity & blend mode controls, and 2-way Raw JSON sync.

## Context & Verified Evidence
- `schema/backgrounds.json:1-53`: Top-level map `<bgKey> -> BackgroundConfigType | null` (`additionalProperties: false`, `required: ["display:name"]`).
  - Properties: `display:name` (required string), `display:order` (number), `bg` (CSS background string — solid color, `linear-gradient(...)`, `radial-gradient(...)`, or `url(...)`), `bg:opacity` (number `0.0–1.0`), `bg:blendmode` (CSS `background-blend-mode`), `bg:bordercolor` (string), `bg:activebordercolor` (string).
  - Note: a key mapped to `null` hides/deletes a built-in default background!
- `frontend/app/view/waveconfig/waveconfig-model.ts:93-98`: `Tab Backgrounds` (`backgrounds.json`) currently has no `visualComponent`.

## Files to Create / Modify
- Create: `frontend/app/view/waveconfig/backgroundsvisual.tsx` (`BackgroundsVisualContent`)
- Modify: `frontend/app/view/waveconfig/waveconfig-model.ts` (attach `visualComponent: BackgroundsVisualContent` to `Tab Backgrounds`)

## Tasks & Implementation Steps
1. **Build Visual Gallery + Sanitized Live Preview Editor (`backgroundsvisual.tsx`):** <!-- Updated: Red Team 2026-11-24 - mandate computeBgStyleFromMeta/processBackgroundUrls, gate external http(s) swatches, show built-in defaults with Customize/Hide/Restore -->
   - **Sanitized preview helper:** Use `computeBgStyleFromMeta` and `processBackgroundUrls` from `@/util/waveutil` for ALL swatch cards and the live mini-terminal preview (NEVER raw `style={{ background: entry.bg }}`). For gallery swatch cards, gate external `http://`/`https://` URLs behind a click-to-preview badge (preventing zero-click outbound requests on open); validate Image Path/URL inputs through `processBackgroundUrls` (escaping/rejecting `"`, `'`, `)`, `\`) and show an inline warning if rejected.
   - **Two-section Gallery (left):**
     - **Custom & Modified Backgrounds** (keys in `backgrounds.json`): live swatch cards for non-null entries, and a "Hidden Built-in" badge for `null` tombstones.
     - **Built-in Backgrounds** (from `fullConfig.backgrounds` not overridden in `backgrounds.json`): read-only preview swatches with 1-click **Customize** (copies into `backgrounds.json`) or **Hide** (writes `null` tombstone).
   - **"+ New Background"** button with starter presets (*Midnight Gradient*, *Emerald Glow*, *Sunset Dark*, *Solid Slate*) generating a unique `bg@<slug>` key and required `display:name`.
   - **Detail Editor with Live Mini-Terminal Preview:**
     - For `null` tombstone entries: render a clean read-only "Hidden Built-in" panel with a single **Restore Default** button (removes the `null` key from JSON).
     - For object entries: live mini-terminal preview + fields (`display:name` required, `DeferredKeyRenameControl` for `bg@...`, `display:order`, Background Mode helper: Solid Color / Gradient / Image Path, `bg:opacity` slider `0.0–1.0`, `bg:blendmode`, `bg:bordercolor`, `bg:activebordercolor`).
     - Action buttons: **Duplicate**, and **Delete** (for custom keys) or **Reset to Default** / **Hide Built-in** (for overrides of built-in keys).
2. **Schema-safe serialization:**
   - Ensure every non-null entry always contains non-empty `display:name`, clamp `bg:opacity` to `[0, 1]`, preserve unknown keys like `bg:text`, and guard `entry === null` / malformed non-object entries everywhere.
3. **Register `visualComponent` in `waveconfig-model.ts:93-98`.**

## Todo
- [x] Implement `backgroundsvisual.tsx` gallery, starter presets, live mini-preview, and editor form
- [x] Handle `null` (hidden built-in) entries cleanly without crashing
- [x] Register `BackgroundsVisualContent` in `waveconfig-model.ts`

## Verification
- Automated: `npx vitest run` and `npm run build:dev`
- Manual: Open Wave Config → Tab Backgrounds, create a gradient background, adjust opacity slider & border colors, verify live preview updates immediately, save, and apply the new background from a tab's right-click menu.

## Risk Assessment
- `backgrounds.json` allows `null` values to hide built-in presets (`schema/backgrounds.json:47-49`); editor must guard `entry === null` so it never throws `Cannot read properties of null`.
- `bg` CSS strings referencing local file paths should avoid unescaped quotes; document/sanitize simple paths cleanly.
