---
phase: 4
title: "Phase 4: Wave AI Modes / AI Agent Setup Visual UI"
status: pending
priority: P1
effort: "0.75d"
dependencies: [1]
---

# Phase 4: Wave AI Modes / AI Agent Setup Visual UI

## Goal
Replace the stub `waveaivisual.tsx` with a full, beginner-friendly Visual AI Agent & BYOK/Local Model Setup UI for `Wave AI Modes (waveai.json)` supporting quick provider templates, Wave Secrets API-key binding, model/thinking/capability controls, and 2-way Raw JSON sync.

## Context & Verified Evidence
- `frontend/app/view/waveconfig/waveaivisual.tsx:1-20`: Currently a stub (`"Visual editor coming soon..."`), commented out at `waveconfig-model.ts:90` (`// visualComponent: WaveAIVisualContent`).
- `frontend/app/view/waveconfig/waveconfig-model.ts:45-56`: `validateWaveAiJson` enforces key pattern `/^[a-zA-Z0-9_@.-]+$/`.
- `schema/waveai.json:1-116`: Top-level map `<modeKey> -> AIModeConfigType` (`additionalProperties: false`, `required: ["display:name"]`):
  - Display: `display:name` (required), `display:description`, `display:icon`, `display:order`.
  - Provider & API: `ai:provider` (`wave`, `google`, `groq`, `openrouter`, `nanogpt`, `openai`, `azure`, `azure-legacy`, `custom`), `ai:apitype` (`google-gemini`, `openai-responses`, `openai-chat`), `ai:model`, `ai:endpoint`, `ai:proxyurl`.
  - Auth: `ai:apitokensecretname` (preferred — references Wave Secrets!) and `ai:apitoken` (masked password input with security nudge to use Secrets instead).
  - Azure-specific (shown conditionally when provider is `azure` or `azure-legacy`): `ai:azureresourcename`, `ai:azuredeployment`, `ai:azureapiversion`.
  - Agent & Reasoning: `ai:thinkinglevel` (`low`, `medium`, `high`), `ai:verbosity` (`low`, `medium`, `high` — shown for `openai-responses`), `ai:capabilities` (checkboxes: `tools`, `images`, `pdfs`).
- Wave Secrets can be fetched via `env.rpc.GetSecretsNamesCommand` and new secrets created directly via `env.rpc.SetSecretsCommand` (same RPCs used in `secretscontent.tsx`) — so users can save an API key into Wave Secrets without even leaving the AI Agent setup screen!

## Files to Create / Modify
- Modify: `frontend/app/view/waveconfig/waveaivisual.tsx` (full Visual AI Agent / Mode Setup UI)
- Modify: `frontend/app/view/waveconfig/waveconfig-model.ts` (uncomment/enable `visualComponent: WaveAIVisualContent` for `waveai.json`)

## Tasks & Implementation Steps
1. **Quick-Start AI Agent Provider Templates (`waveaivisual.tsx` — aligned with Go `usechat-mode.go`):** <!-- Updated: Red Team 2026-11-24 - omit ai:apitype on OpenAI/Azure, validate AzureResourceNameRegex, 3-way auth incl None/Local, deleteField for Default thinking level, non-blocking inline secret creation -->
   - Left column: list of configured AI modes in `waveai.json` (showing icon, `display:name`, provider badge, model name, capabilities badges) + **"+ Add AI Mode"** button with 1-click provider templates aligned with `pkg/aiusechat/usechat-mode.go`:
     - **OpenAI** (`ai:provider: "openai"`, omit `ai:apitype` so Go auto-selects per model, `ai:capabilities: ["tools", "images", "pdfs"]`, default secret hint `OPENAI_KEY`)
     - **Google Gemini** (`ai:provider: "google"`, `ai:apitype: "google-gemini"`, `ai:capabilities: ["tools", "images", "pdfs"]`, default secret hint `GOOGLE_AI_KEY`)
     - **OpenRouter** (`ai:provider: "openrouter"`, `ai:apitype: "openai-chat"`, `ai:capabilities: ["tools", "images"]`, default secret hint `OPENROUTER_KEY`)
     - **Groq** (`ai:provider: "groq"`, `ai:apitype: "openai-chat"`, `ai:capabilities: ["tools"]`, default secret hint `GROQ_KEY`)
     - **Ollama (Local)** (`ai:provider: "custom"`, `ai:apitype: "openai-chat"`, `ai:endpoint: "http://localhost:11434/v1/chat/completions"`, `ai:capabilities: ["tools"]`, Auth = **None / Local**)
     - **DeepSeek / Custom OpenAI-Compatible** (`ai:provider: "custom"`, `ai:apitype: "openai-chat"`, `ai:capabilities: ["tools"]`)
     - **Azure OpenAI** (`ai:provider: "azure"`, omit `ai:apitype` for Auto, `ai:capabilities: ["tools", "images"]`, default secret hint `AZURE_OPENAI_KEY`)
2. **Structured AI Mode Editor Form:**
   - **Identity:** `DeferredKeyRenameControl` for Mode Key (validated against `/^[a-zA-Z0-9_@.-]+$/` + `isUnsafeObjectKey` + uniqueness via `Object.hasOwn`), `display:name` (required), `display:description`, `display:icon` (preset icon picker), `display:order`.
   - **Model & Endpoint:** `ai:provider` dropdown, `ai:apitype` dropdown (`Auto (unset)` -> deletes key, `google-gemini`, `openai-responses`, `openai-chat`), `ai:model` text input, `ai:endpoint` (highlighted for `custom`), `ai:proxyurl` (optional).
   - **Conditional Azure Section:** Shown only when `ai:provider === "azure" || ai:provider === "azure-legacy"`: validate `ai:azureresourcename` against `/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/` (max 63 chars); show `ai:azuredeployment` **only for `azure-legacy`** (`azure` v1 uses `ai:model`); `ai:azureapiversion`.
   - **API Key / Authentication (3-mode, Secrets-first):**
     - **None (Local / Provider Default):** clears both `ai:apitoken` and `ai:apitokensecretname`; shows provider's implicit default secret name (e.g., `OPENAI_KEY`) as hint.
     - **Use Wave Secret (Recommended):** `ai:apitokensecretname` dropdown populated via non-blocking `model.fetchSecretNamesQuietly()` + inline **"+ New Secret"** using `model.createSecretInline(name, value)` (enforces `checkStorageBackend()` Linux keyring guard, rejects duplicate names, clears local input state immediately, clears stale `ai:apitoken`, and triggers `model.saveFile()` when migrating away from a plaintext token).
     - **Direct Token / `$ENV:`:** masked `type="password"` input (or `Env Var` badge when value starts with `$ENV:`); **never auto-saved** (requires explicit Save button click) with warning that raw tokens are stored in `waveai.json`.
   - **Agent Capabilities & Reasoning:**
     - Checkboxes for `ai:capabilities` (defensively guarding `Array.isArray`): **Tools (AI Agent)** (`tools`), **Images** (`images`), **PDFs** (`pdfs`).
     - Dropdowns for `ai:thinkinglevel` (`Default (unset)` -> **deletes key**, `low`, `medium`, `high` — never serializes `"default"`) and `ai:verbosity` (`Default (unset)` -> deletes key, `low`, `medium`, `high`, shown when `ai:apitype === "openai-responses"`).
   - **Duplicate & Delete** actions with confirmation.
3. **Enable `visualComponent: WaveAIVisualContent` in `waveconfig-model.ts:90`.**

## Todo
- [x] Implement `waveaivisual.tsx` with provider quick-start templates and structured mode editor
- [x] Integrate Wave Secrets picker + inline quick-create secret for `ai:apitokensecretname`
- [x] Validate mode keys against `validateWaveAiJson` regex and required `display:name`
- [x] Enable `visualComponent: WaveAIVisualContent` in `waveconfig-model.ts`

## Verification
- Automated: `npx vitest run` and `npm run build:dev`
- Manual: Open Wave Config → Wave AI Modes, add an OpenRouter or Ollama mode via template, bind an API key via Wave Secrets, toggle `tools` capability, switch to Raw JSON to verify schema-clean output, save, and confirm the new mode appears in the Wave AI panel dropdown.

## Risk Assessment
- Inline secret creation must validate secret names against `SecretNameRegex` (`/^[A-Za-z][A-Za-z0-9_]*$/`) and never echo or store the secret value into `waveai.json` (only `ai:apitokensecretname`).
- Switching between `Use Wave Secret` and `Direct Token` must clear the opposite key (`ai:apitoken` vs `ai:apitokensecretname`) so stale plaintext tokens aren't left behind in `waveai.json`.
