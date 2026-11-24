---
title: "Wave Terminal Stabilization: Vietnamese IME, McAfee-Safe I/O, 16GB RAM & Windows Render"
description: "5-phase stabilization and optimization roadmap for Wave Terminal v0.14.5 targeting Windows 16GB RAM, 2 concurrent AI Agent sessions, McAfee Real-Time Scanning, Vietnamese IME, and verified upstream bugfixes."
status: completed
priority: P1
effort: "5d"
tags: [waveterm, ime, vietnamese, performance, windows, mcafee, memory-leak, bugfix]
created: 2026-11-24
---

# Wave Terminal Stabilization & Optimization Plan

## Overview

Stabilize and optimize our `N:\Wave` (`v0.14.5`) fork for **Windows 16GB RAM + 2 concurrent AI Agent sessions + McAfee Real-Time Scanning + Vietnamese IME (Unikey / EVKey / Windows Telex)** while staying merge-friendly with `upstream` (`wavetermdev/waveterm`). Every item in this plan was cross-verified against `N:\Wave` source code via 3 independent passes (including a `pro`-model cross-audit) documented in `plans/wave-audit-backlog.md`.

## Goals

| # | Goal | Priority |
|---|---|---|
| 1 | Eliminate Vietnamese font glitches and character/caret jumping across AI Chat and Terminal (Unikey, EVKey, Windows Telex) | P1 |
| 2 | Eliminate McAfee Real-Time Scan I/O stalls by fixing SQLite WAL sync, `filestore` 5s flush/evict churn, PTY batching, and startup AV triggers | P1 |
| 3 | Cut idle & active RAM footprint for 16GB machines by fixing `fileSubjects`/`TermWrap` leaks, tab cache eviction, eager Monaco, and unbounded `DefaultChatStore` | P1 |
| 4 | Eliminate Windows GPU/render glitches, AI TUI flicker (`#3085`, `#3501`), `capturePage()` main-thread stalls, and AI streaming re-render storms | P1 |
| 5 | Fix 7 verified upstream bugfixes (`#3568`, `#3563`, `#3517`, `#3150`, `#3301` Part B, `#3330`, `#3193`) cleanly | P2 |

## Phases

| # | Phase | Priority | Effort | Status |
|---|---|---|---|---|
| 1 | [Vietnamese IME & Font Rendering](./phase-01-start.md) | P1 | 1d | Completed |
| 2 | [McAfee-Safe Disk I/O & Go Backend](./phase-02-mcafee-disk-io-go-backend.md) | P1 | 1.5d | Completed |
| 3 | [16GB RAM Reduction & Memory Leaks](./phase-03-ram-reduction-memory-leaks.md) | P1 | 1d | Completed |
| 4 | [Windows GPU Render & AI Streaming](./phase-04-windows-gpu-render-ai-streaming.md) | P1 | 1d | Completed |
| 5 | [Verified Upstream Bugfixes (Optional Lower Priority)](./phase-05-upstream-verified-bugfixes.md) | P2 | 0.5d | Completed |

## Dependencies & Execution Order

- **Phase 1** is standalone and ships immediate daily typing relief.
- **Phase 2** (Go backend) and **Phase 3** (Electron/Frontend RAM) are largely independent; running Phase 2 before Phase 4 ensures PTY chunk batching is in place when testing terminal repaint smoothness.
- **Phase 5** touches isolated modules and can be executed last or cherry-picked per issue.

## Success Criteria

- [ ] Typing Vietnamese with Unikey, EVKey, and Windows Telex in AI Chat and Terminal produces zero jumped/reordered/duplicated characters and crisp diacritics.
- [ ] Running 2 concurrent AI Agent sessions on Windows under McAfee shows no periodic 5s disk/UI stutter and zero SQLite lock/deadlock errors.
- [ ] Opening/closing 10+ tabs and terminals leaves zero leaked `fileSubjects`, zero zombie `TermWrap` idle timers, Monaco split into an async Vite chunk, and stays well within 16GB RAM budget.
- [ ] `go test ./...`, `GOOS=linux go build ./cmd/wsh`, and `npm test` pass with zero regressions; `task build` / `task dev` runs cleanly on Windows.

## Red Team Review

### Session — 2026-11-24
**Findings:** 15 (15 accepted, 0 rejected) — 3 parallel reviewers (Security Adversary, Failure Mode Analyst, Assumption Destroyer)
**Severity breakdown:** 8 Critical, 6 High, 1 Medium

| # | Finding | Severity | Disposition | Applied To |
|---|---|---|---|---|
| 1 | SQLite `SetMaxOpenConns(1)` self-deadlock if `WithTxRtn` removed | Critical | Accept | Phase 2 |
| 2 | `filestore` batch-flush AB-BA deadlock, `entry.File` dirty invariant, `doShutdown` flush drop | Critical | Accept | Phase 2 |
| 3 | SSH `ProxyCommand` shell injection & `StrictHostKeyChecking` MITM downgrade | Critical | Accept | Phase 5 |
| 4 | Unconditional `heldData` drain duplicates output & corrupts `ptyOffset` | Critical | Accept | Phase 2, Phase 4 |
| 5 | Fire-and-forget `EventSubCommand` races with HTTP `fetchWaveFile` | Critical | Accept | Phase 3 |
| 6 | `allowTransparency: false` with `#00000000` turns opaque terminals solid black | Critical | Accept | Phase 4 |
| 7 | Static `codeeditor.tsx`/`monaco-react.tsx` imports defeat Monaco lazy chunking | Critical | Accept | Phase 3 |
| 8 | Importing `golang.org/x/sys/windows/registry` in `wavebase.go` breaks Linux/macOS builds | Critical | Accept | Phase 2 |
| 9 | `DeleteBlock` already calls `DeleteZone` via `wstore.DBDelete` (2s timeout is real issue) | High | Accept | Phase 2 |
| 10 | Gating `RunSysInfoLoop` on `wps.Broker` inside `wshremote` breaks SSH/WSL SysInfo | High | Accept | Phase 2 |
| 11 | Missing `preload.ts`/`custom.d.ts` APIs for `getOsRelease` & direct-color overlay IPC | High | Accept | Phase 4 |
| 12 | `tools_term.go` raw `filestore` fallback leaks cleared secrets & ANSI prompt injection | High | Accept | Phase 3 |
| 13 | `wsh.exe` `mtime+size` skip enables `$PATH` tampering; non-atomic `WriteFileIfDifferent` | High | Accept | Phase 2 |
| 14 | OSC 11 handler lacks `this.loaded`, `data === "?"`, `colord`, direct `sendDataHandler` | High | Accept | Phase 5 |
| 15 | `checkAndEvictCache` loop/order, `<AIPanel />` `"submitted"` abort, `MigratePresetsBackgrounds`/`RecordTEvent` | High/Med | Accept | Phase 2, Phase 3, Phase 5 |

**Whole-Plan Consistency Sweep:** Verified all 5 phase links, frontmatter schemas, cross-phase dependencies (Phase 2 `WSFileEventData` offset -> Phase 4 `heldData` dedup; Phase 3 `#3301` `feblock:` prerequisite -> `MaxCacheSize = 3`), and zero remaining `[UNVERIFIED]` markers.

<!-- slug: wave-vi-perf-stabilization -->
