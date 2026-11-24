---
phase: 2
title: "Phase 2: Connections (SSH & WSL) Visual UI"
status: pending
priority: P1
effort: "0.75d"
dependencies: [1]
---

# Phase 2: Connections (SSH & WSL) Visual UI

## Goal
Provide an intuitive Visual Connection Manager for `Connections (connections.json)` so users can add, edit, reorder, and delete SSH host profiles and WSL distro overrides without hand-editing JSON.

## Context & Verified Evidence
- `schema/connections.json:1-138`: Top-level map `<connName> -> ConnKeywords` (`additionalProperties: false`). Supports:
  - SSH fields: `ssh:hostname`, `ssh:user`, `ssh:port` (string!), `ssh:identityfile` (string[]), `ssh:passwordsecretname` (string), `ssh:proxyjump` (string[]), `ssh:pubkeyauthentication`, `ssh:passwordauthentication`, `ssh:batchmode`, `ssh:identitiesonly`, `ssh:addkeystoagent`.
  - Connection & Shell fields: `conn:wshenabled`, `conn:askbeforewshinstall`, `conn:shellpath`, `conn:wshpath`, `conn:ignoresshconfig`.
  - Terminal & Display fields: `display:order`, `display:hidden`, `term:fontfamily`, `term:fontsize`, `term:theme`, `term:durable`, `cmd:env` (`Record<string, string>`), `cmd:initscript`.
- `frontend/app/view/waveconfig/waveconfig-model.ts:68-74`: `Connections` entry currently has `hasJsonView: true` and no `visualComponent`.
- Secrets list is already accessible via `env.rpc.GetSecretsNamesCommand` (used by `secretscontent.tsx`), allowing a dropdown picker for `ssh:passwordsecretname`!

## Files to Create / Modify
- Create: `frontend/app/view/waveconfig/connectionsvisual.tsx` (`ConnectionsVisualContent`)
- Modify: `frontend/app/view/waveconfig/waveconfig-model.ts` (attach `visualComponent: ConnectionsVisualContent` to `Connections`)

## Tasks & Implementation Steps
1. **Master-detail Connection Manager layout (`connectionsvisual.tsx`):** <!-- Updated: Red Team 2026-11-24 - classify local/wsl/ssh, deferred key rename, quiet secrets fetch, per-entry type guard -->
   - Left column (list): displays all configured entries in `connections.json` classified into **SSH**, **WSL** (`isWslConnName`), or **Local** (`isLocalConnName`: `"local"` / `"local:*"`) badges, search filter, and **"+ Add Connection"** button (Connection Type: `SSH Host` or `WSL Distro`, rejecting empty, duplicate via `Object.hasOwn`, or unsafe keys). Guard against malformed non-object entries gracefully.
   - Right column (editor form for selected connection):
     - **Connection Identity & Display:** `DeferredKeyRenameControl` (commits on Apply/Enter/Blur only, rejecting duplicates/unsafe keys), `display:order`, `display:hidden`, Delete connection (with confirmation).
     - **SSH Settings** (shown **ONLY for SSH entries** — hidden for `isWslConnName` and `isLocalConnName`): `ssh:hostname`, `ssh:user`, `ssh:port` (strictly serialized as `string` per `schema/connections.json:72-74`), `ssh:identityfile` (`StringListControl`), `ssh:proxyjump` (`StringListControl`), `ssh:passwordsecretname` (dropdown populated via non-blocking `model.fetchSecretNamesQuietly()` — never `refreshSecrets()`), auth toggles (`ssh:pubkeyauthentication`, `ssh:passwordauthentication`, `ssh:identitiesonly`, `ssh:batchmode`), `conn:ignoresshconfig`, and `term:durable`.
     - **Shell & Wave Integration:** `conn:wshenabled`, `conn:askbeforewshinstall`, `conn:shellpath`.
     - **Terminal Overrides & Environment:** `term:theme` (dropdown from `fullConfig.termthemes`), `term:fontfamily`, `term:fontsize`, `cmd:env` (`KeyValueControl`), `cmd:initscript`.
2. **Schema-safe serialization:**
   - Omit empty strings / empty arrays / `undefined` values when updating a connection entry so `connections.json` stays clean and passes `connections.json` validator (`ssh:port` as string).
   - Preserve any advanced keys already in that connection object (`cmd:initscript.bash`, `ssh:userknownhostsfile`, `$ENV:` macros, etc.) that aren't edited in the form.
3. **Register `visualComponent` in `waveconfig-model.ts:68-74`.**

## Todo
- [x] Implement `connectionsvisual.tsx` master-detail SSH/WSL connection manager
- [x] Wire Wave Secrets dropdown for `ssh:passwordsecretname` and themes dropdown for `term:theme`
- [x] Register `ConnectionsVisualContent` in `waveconfig-model.ts`

## Verification
- Automated: `npx vitest run` and `npm run build:dev`
- Manual: Open Wave Config → Connections, add an SSH host and a WSL override, verify `ssh:port` serializes as string, switch to Raw JSON to confirm schema validity, save & reload.

## Risk Assessment
- `ssh:port` in `schema/connections.json:72-74` is `"type": "string"` (NOT number) — writing a number fails schema validation; enforce string conversion in the form handler.
- Renaming a connection key must reject collisions with existing keys to prevent accidental overwrite.
