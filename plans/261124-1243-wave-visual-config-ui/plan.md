---
title: "Wave Visual Config UI: General Settings, Connections, Tab Backgrounds & AI Agent Setup"
description: "4-phase plan to build intuitive Visual Configuration UIs (with 2-way Raw JSON sync) for General settings.json, Connections (SSH/WSL), Tab Backgrounds, and Wave AI Agent/BYOK modes inside Wave Config."
status: completed
priority: P1
effort: "3d"
tags: [waveterm, ui, settings, connections, backgrounds, waveai, visual-config]
created: 2026-11-24
---

# Wave Visual Config UI Plan

## Overview

Wave Config (`frontend/app/view/waveconfig/`) already provides a `visualComponent` + `hasJsonView` tab architecture (`Visual` ↔ `Raw JSON`) and full JSON Schemas (`schema/settings.json`, `schema/connections.json`, `schema/backgrounds.json`, `schema/waveai.json`), yet currently only `Secrets` has a visual UI. This plan builds clean, fast, keyboard/Vietnamese-friendly Visual Config UIs for **General (`settings.json`)**, **Connections (`connections.json`)**, **Tab Backgrounds (`backgrounds.json`)**, and **Wave AI Modes / Agent Setup (`waveai.json`)** — all sharing `model.fileContentAtom` as the single source of truth with 2-way Raw JSON sync and preserving any unknown keys.

## Goals

| # | Goal | Priority |
|---|---|---|
| 1 | Build shared Visual Config primitives + searchable, categorized Visual UI for `General (settings.json)` | P1 |
| 2 | Build Visual Connection Manager for `Connections (connections.json)` (SSH hosts & WSL distros) | P1 |
| 3 | Build Visual Tab Background Gallery & Editor with live preview for `Tab Backgrounds (backgrounds.json)` | P1 |
| 4 | Build Visual AI Agent / BYOK / Local Model Setup UI for `Wave AI Modes (waveai.json)` integrating with Wave Secrets | P1 |

## Phases

| # | Phase | Priority | Effort | Status |
|---|---|---|---|---|
| 1 | [Shared Visual Config Framework & General Settings UI](./phase-01-start.md) | P1 | 1d | Completed |
| 2 | [Connections (SSH & WSL) Visual UI](./phase-02-connections-visual-ui.md) | P1 | 0.75d | Completed |
| 3 | [Tab Backgrounds Visual Gallery & Editor](./phase-03-backgrounds-visual-ui.md) | P1 | 0.5d | Completed |
| 4 | [Wave AI Modes / AI Agent Setup Visual UI](./phase-04-waveai-agent-setup-ui.md) | P1 | 0.75d | Completed |

## Dependencies & Execution Order

- **Phase 1** establishes the shared `useVisualConfigJson` hook, reusable form controls (`Toggle`, `Select`, `TextInput`, `NumberInput`, `TagListInput`, `KeyValueEditor`), and fixes the `Visual ↔ Raw JSON` tab switch in `waveconfig.tsx` so unsaved edits flow seamlessly both ways.
- **Phases 2, 3, and 4** depend on Phase 1's shared primitives and are mutually independent (disjoint component files).

## Success Criteria

- [ ] All 4 config files (`settings.json`, `connections.json`, `backgrounds.json`, `waveai.json`) open directly to a clean Visual UI with a 1-click toggle to `Raw JSON`.
- [ ] Editing in Visual updates `model.fileContentAtom`, preserves unknown/extra JSON keys and `$ENV:` macros, validates via lightweight per-file `ConfigValidator`s, and saves via `Save` / `model.saveShortcut` (`Alt+S` on Windows/Linux, `Cmd+S` on macOS) or optional Auto-save (excluding plaintext `ai:apitoken`).
- [ ] Switching `Raw JSON` → `Visual` with invalid JSON blocks safely with a clear banner instead of crashing or silently discarding edits.
- [ ] `npx vitest run` and `npm run build:dev` pass with zero regressions and zero eager Monaco imports on Visual tabs.

## Red Team Review

### Session — 2026-11-24
**Findings:** 10 deduplicated (10 accepted, 0 rejected) — 3 parallel reviewers (Security Adversary, Failure Mode Analyst, Assumption Destroyer)
**Severity breakdown:** 4 Critical, 4 High, 2 Medium

| # | Finding | Severity | Disposition | Applied To |
|---|---|---|---|---|
| 1 | Debounced auto-save races with `saveFile()`, typing & sidebar switching; `loadFile()` missing `loadSeq` & `validationErrorAtom` reset | Critical | Accept | Phase 1 |
| 2 | Phase 3 bypassed `computeBgStyleFromMeta`/`processBackgroundUrls`, allowing CSS/URL injection, zero-click fetches & missing 13 built-in defaults | Critical | Accept | Phase 3 |
| 3 | Inline secret creation bypassed Linux `basic_text` guard & overwrite check; calling `refreshSecrets()`/`addNewSecret()` toggles `isLoadingAtom` unmounting `<VisualComponent />` | Critical | Accept | Phase 1, Phase 2, Phase 4 |
| 4 | Wave AI templates contradicted Go `usechat-mode.go` (`"default"` thinking level, OpenAI `apitype`, Azure regex/deployment, missing None/Local auth) | Critical | Accept | Phase 4 |
| 5 | Prototype pollution via `__proto__`/`constructor`/`prototype` & live key-rename collisions | High | Accept | Phase 1–4 |
| 6 | Plaintext `ai:apitoken` flushed by 400ms auto-save & unmasked Advanced keys in `settings.json` | High | Accept | Phase 1, Phase 4 |
| 7 | Missing `ConfigValidator`s & per-entry type guards for `settings.json`, `connections.json`, `backgrounds.json` | High | Accept | Phase 1–4 |
| 8 | Stale `fileContentAtom` clobbering external config writes (`wsh setconfig`, menu changes) | High | Accept | Phase 1 |
| 9 | `$ENV:` macro clobbering, undocumented `bg:text` key, and `Alt+S`/`Cmd+S` shortcut correction | Medium | Accept | Plan, Phase 1, Phase 3, Phase 4 |
| 10 | Effective defaults from `fullConfig.settings` for booleans & `isLocalConnName` vs `isWslConnName` vs SSH in `connections.json` | Medium | Accept | Phase 1, Phase 2 |

**Whole-Plan Consistency Sweep:** Verified all 4 phase links, frontmatter schemas, cross-phase contracts (`WaveConfigViewModel.fetchSecretNamesQuietly`/`createSecretInline` -> Phases 2 & 4; `DeferredKeyRenameControl` -> Phases 2–4), and zero remaining `[UNVERIFIED]` markers.

<!-- slug: wave-visual-config-ui -->
