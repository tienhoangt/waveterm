# Wave Terminal — Visual Config UI Design System (`DESIGN.md`)

## Brand & Aesthetic Direction
- **Product:** Wave Terminal (Open-Source AI-Native Terminal Desktop App — Windows, macOS, Linux)
- **Theme:** Dark Developer Console / High-Contrast Precision UI
- **Visual Character:** Dense, calm, low-glare dark surfaces with crisp 1px structural borders, vibrant terminal green primary accents, and metric-aligned Vietnamese-complete typography.

## Color Palette
- **Primary Background (`--main-bg-color`):** `#222222`
- **Panel Surface (`--panel-bg-color`):** `rgba(31, 33, 31, 0.5)` / `#1F211F`
- **Block Surface (`--block-bg-solid-color`):** `#000000`
- **Primary Accent (`--accent-color`):** `#58C142` (Wave Terminal Green)
- **Primary Text (`--main-text-color`):** `#F7F7F7`
- **Secondary Text (`--secondary-text-color`):** `#C3C8C2`
- **Muted Text (`--grey-text-color`):** `#888888`
- **Border (`--border-color`):** `rgba(255, 255, 255, 0.16)`
- **Semantic Status:**
  - Success: `#4E9A06`
  - Warning: `#E0B956`
  - Error: `#E54D2E`

## Typography
- **UI Sans (`--base-font`):** `"Inter", "Segoe UI", "Noto Sans", -apple-system, BlinkMacSystemFont, sans-serif` (14px regular, Vietnamese-complete diacritics)
- **Terminal & Code Mono (`--fixed-font`):** `"Cascadia Mono", Consolas, "Hack", "JetBrains Mono", monospace` (12px regular/bold, ClearType-friendly on Windows)
- **Header Labels (`--header-font`):** `700 11px uppercase`

## Layout & Component Architecture (Wave Config)
- **Shell:** Left navigation sidebar (`192px`) listing `General`, `Connections`, `Sidebar Widgets`, `Wave AI Modes`, `Tab Backgrounds`, `Secrets`.
- **Header Bar:** Section title, docs link, file path badge, optional `Auto-save` toggle pill, `Unsaved changes` warning badge, primary `Save` button (`Alt+S` / `Cmd+S`), and 2-tab switcher (`Visual` | `Raw JSON`).
- **Master-Detail Screens (`Connections`, `Sidebar Widgets`, `Wave AI Modes`, `Tab Backgrounds`):**
  - Left list (`256px`) with search filter, `+ Add` quick-template picker, and custom vs built-in sections.
  - Right scrollable form with `SettingRow` rows (label, inline monospace key pill, `Modified` badge, reset icon button), `ToggleControl`, `SelectControl`, `TextControl` (with preset chips & sensitive password masking), `NumberControl`, `StringListControl`, `KeyValueControl`, and `DeferredKeyRenameControl`.
- **Special Components:**
  - `Tab Backgrounds`: Live mini-terminal preview box using sanitized CSS backgrounds, opacity slider (`0.0–1.0`), and focused/unfocused border color pickers.
  - `Wave AI Modes`: 7 1-click provider templates (OpenAI, Google Gemini, OpenRouter, Groq, Ollama Local, DeepSeek/Custom, Azure OpenAI), 3-mode Auth (None/Local, Wave Secret with inline secret creator, Direct Token), and capability checkboxes (`tools`, `images`, `pdfs`).
