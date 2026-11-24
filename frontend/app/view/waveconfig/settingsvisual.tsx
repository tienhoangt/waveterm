// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    InvalidJsonBanner,
    NumberControl,
    SelectControl,
    SettingRow,
    TextControl,
    ToggleControl,
    type SelectOption,
} from "@/app/view/waveconfig/visual-config-controls";
import {
    isEnvMacroValue,
    isSensitiveKeyName,
    useVisualConfigJson,
} from "@/app/view/waveconfig/visual-config-utils";
import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import type { WaveConfigEnv } from "@/app/view/waveconfig/waveconfigenv";
import { cn } from "@/util/util";
import { useAtomValue, useSetAtom } from "jotai";
import { memo, useMemo, useState } from "react";

type SettingCategory = "all" | "terminal" | "appearance" | "performance" | "app" | "editor" | "ai";

interface SettingDef {
    key: string;
    label: string;
    description: string;
    category: Exclude<SettingCategory, "all">;
    type: "boolean" | "number" | "string" | "enum";
    defaultValue?: any;
    min?: number;
    max?: number;
    step?: number;
    integer?: boolean;
    options?: SelectOption[];
    dynamicOptions?: "termthemes" | "waveaimodes";
    placeholder?: string;
    presets?: { label: string; value: string }[];
}

const CATEGORIES: { id: SettingCategory; label: string; icon: string }[] = [
    { id: "all", label: "All", icon: "fa-sliders" },
    { id: "terminal", label: "Terminal", icon: "fa-terminal" },
    { id: "appearance", label: "Appearance", icon: "fa-palette" },
    { id: "performance", label: "Performance", icon: "fa-gauge-high" },
    { id: "app", label: "App & Input", icon: "fa-keyboard" },
    { id: "editor", label: "Editor", icon: "fa-code" },
    { id: "ai", label: "AI & Privacy", icon: "fa-sparkles" },
];

const CURATED_SETTINGS: SettingDef[] = [
    // Terminal
    {
        key: "term:fontfamily",
        label: "Terminal Font Family",
        description: "Font stack for terminal blocks. Cascadia Mono + Consolas fixes Vietnamese diacritics on Windows.",
        category: "terminal",
        type: "string",
        defaultValue: "'Cascadia Mono', Consolas, Hack, monospace",
        placeholder: "'Cascadia Mono', Consolas, Hack, monospace",
        presets: [
            { label: "Cascadia + Hack (VN)", value: "'Cascadia Mono', Consolas, Hack, monospace" },
            { label: "Consolas + Hack", value: "Consolas, Hack, monospace" },
            { label: "Hack", value: "Hack" },
            { label: "JetBrains Mono", value: "JetBrains Mono" },
        ],
    },
    {
        key: "term:fontsize",
        label: "Terminal Font Size",
        description: "Default terminal font size in pixels.",
        category: "terminal",
        type: "number",
        defaultValue: 12,
        min: 8,
        max: 32,
        step: 1,
        integer: true,
    },
    {
        key: "term:theme",
        label: "Terminal Color Theme",
        description: "Color scheme applied to terminal blocks.",
        category: "terminal",
        type: "enum",
        defaultValue: "default-dark",
        dynamicOptions: "termthemes",
    },
    {
        key: "term:cursor",
        label: "Cursor Style",
        description: "Visual style of the terminal cursor.",
        category: "terminal",
        type: "enum",
        defaultValue: "block",
        options: [
            { value: "block", label: "Block" },
            { value: "underline", label: "Underline" },
            { value: "bar", label: "Bar" },
        ],
    },
    {
        key: "term:cursorblink",
        label: "Cursor Blink",
        description: "Enable blinking cursor in terminal blocks.",
        category: "terminal",
        type: "boolean",
        defaultValue: false,
    },
    {
        key: "term:shiftenternewline",
        label: "Shift+Enter Inserts Newline",
        description: "Send a literal newline when pressing Shift+Enter in terminal.",
        category: "terminal",
        type: "boolean",
        defaultValue: true,
    },
    {
        key: "term:trimtrailingwhitespace",
        label: "Trim Trailing Whitespace on Copy",
        description: "Strip trailing spaces from each line when copying terminal selections.",
        category: "terminal",
        type: "boolean",
        defaultValue: true,
    },
    {
        key: "term:localshellpath",
        label: "Local Shell Path",
        description: "Override default local shell executable (e.g. pwsh.exe, powershell.exe, /bin/zsh).",
        category: "terminal",
        type: "string",
        defaultValue: "",
        placeholder: "Auto-detect",
    },
    // Performance
    {
        key: "window:maxtabcachesize",
        label: "Max Cached Tabs in RAM",
        description: "Max inactive tabs kept alive in memory. Recommended: 3 for 16GB RAM machines.",
        category: "performance",
        type: "number",
        defaultValue: 3,
        min: 1,
        max: 15,
        step: 1,
        integer: true,
    },
    {
        key: "term:scrollback",
        label: "Terminal Scrollback Lines",
        description: "Lines kept in memory per terminal (0–50000). Lower values reduce RAM & serialize cost.",
        category: "performance",
        type: "number",
        defaultValue: 2000,
        min: 0,
        max: 50000,
        step: 500,
        integer: true,
    },
    {
        key: "term:disablewebgl",
        label: "Disable Terminal WebGL",
        description: "Force DOM renderer instead of WebGL if GPU drivers or multi-pane contexts glitch.",
        category: "performance",
        type: "boolean",
        defaultValue: false,
    },
    // Appearance & Window
    {
        key: "app:tabbar",
        label: "Tab Bar Position",
        description: "Display the tab bar along the top or left side of the window.",
        category: "appearance",
        type: "enum",
        defaultValue: "top",
        options: [
            { value: "top", label: "Top" },
            { value: "left", label: "Left" },
        ],
    },
    {
        key: "window:transparent",
        label: "Window Transparency",
        description: "Enable translucent window background (uses more GPU compositing on Windows).",
        category: "appearance",
        type: "boolean",
        defaultValue: false,
    },
    {
        key: "window:blur",
        label: "Window Background Blur",
        description: "Apply OS backdrop blur when window transparency is enabled.",
        category: "appearance",
        type: "boolean",
        defaultValue: false,
    },
    {
        key: "window:opacity",
        label: "Window Opacity",
        description: "Window background opacity (0.1 to 1.0) when transparency is active.",
        category: "appearance",
        type: "number",
        defaultValue: 0.8,
        min: 0.1,
        max: 1.0,
        step: 0.05,
    },
    {
        key: "window:bgcolor",
        label: "Window Background Color",
        description: "Base window background CSS color.",
        category: "appearance",
        type: "string",
        defaultValue: "",
        placeholder: "#222222",
    },
    {
        key: "window:nativetitlebar",
        label: "Native OS Titlebar",
        description: "Use standard OS window chrome instead of Wave's custom titlebar.",
        category: "appearance",
        type: "boolean",
        defaultValue: true,
    },
    {
        key: "window:zoom",
        label: "Window Zoom Factor",
        description: "UI scale multiplier (0.5 to 2.0).",
        category: "appearance",
        type: "number",
        defaultValue: 1.0,
        min: 0.5,
        max: 2.0,
        step: 0.1,
    },
    {
        key: "term:transparency",
        label: "Terminal Transparency",
        description: "Terminal block background transparency (0.0 opaque to 1.0 fully transparent).",
        category: "appearance",
        type: "number",
        defaultValue: 0.5,
        min: 0,
        max: 1,
        step: 0.05,
    },
    {
        key: "tab:confirmclose",
        label: "Confirm Before Closing Tab",
        description: "Show a confirmation dialog when closing a tab.",
        category: "appearance",
        type: "boolean",
        defaultValue: false,
    },
    // App & Input
    {
        key: "app:ctrlvpaste",
        label: "Ctrl+V Paste in Terminal",
        description: "Use Ctrl+V to paste into terminals (enabled by default on Windows).",
        category: "app",
        type: "boolean",
        defaultValue: true,
    },
    {
        key: "app:confirmquit",
        label: "Confirm Before Quitting",
        description: "Prompt for confirmation when exiting Wave Terminal.",
        category: "app",
        type: "boolean",
        defaultValue: true,
    },
    {
        key: "app:focusfollowscursor",
        label: "Focus Follows Cursor",
        description: "Automatically focus blocks as the mouse hovers over them.",
        category: "app",
        type: "enum",
        defaultValue: "off",
        options: [
            { value: "off", label: "Off" },
            { value: "on", label: "All Blocks" },
            { value: "term", label: "Terminal Only" },
        ],
    },
    {
        key: "app:hideaibutton",
        label: "Hide Wave AI Button",
        description: "Hide the Wave AI sidebar toggle button.",
        category: "app",
        type: "boolean",
        defaultValue: false,
    },
    {
        key: "app:showoverlayblocknums",
        label: "Show Block Number Overlays",
        description: "Show block shortcut numbers when holding modifier keys.",
        category: "app",
        type: "boolean",
        defaultValue: true,
    },
    {
        key: "app:defaultnewblock",
        label: "Default New Block Type",
        description: "Block view created when clicking '+' (e.g. term, preview, web).",
        category: "app",
        type: "string",
        defaultValue: "term",
        placeholder: "term",
    },
    {
        key: "app:globalhotkey",
        label: "Global Hotkey",
        description: "OS-wide shortcut to bring Wave Terminal to focus (e.g. Ctrl+Alt+W).",
        category: "app",
        type: "string",
        defaultValue: "",
        placeholder: "None",
    },
    // Editor
    {
        key: "editor:fontsize",
        label: "Editor Font Size",
        description: "Font size in pixels for Monaco code editor blocks.",
        category: "editor",
        type: "number",
        defaultValue: 12,
        min: 8,
        max: 32,
        step: 1,
        integer: true,
    },
    {
        key: "editor:minimapenabled",
        label: "Editor Minimap",
        description: "Show the code minimap in Monaco editor blocks.",
        category: "editor",
        type: "boolean",
        defaultValue: true,
    },
    {
        key: "editor:wordwrap",
        label: "Editor Word Wrap",
        description: "Wrap long lines in Monaco editor blocks.",
        category: "editor",
        type: "boolean",
        defaultValue: false,
    },
    {
        key: "editor:stickyscrollenabled",
        label: "Editor Sticky Scroll",
        description: "Keep enclosing function/class headers pinned while scrolling.",
        category: "editor",
        type: "boolean",
        defaultValue: false,
    },
    // AI & Privacy
    {
        key: "waveai:defaultmode",
        label: "Default Wave AI Mode",
        description: "Default AI mode selected when opening Wave AI.",
        category: "ai",
        type: "enum",
        defaultValue: "",
        dynamicOptions: "waveaimodes",
    },
    {
        key: "telemetry:enabled",
        label: "Telemetry Enabled",
        description: "Send anonymous usage telemetry (turning off also eliminates periodic telemetry DB writes).",
        category: "ai",
        type: "boolean",
        defaultValue: true,
    },
    {
        key: "autoupdate:enabled",
        label: "Auto-Update Enabled",
        description: "Automatically check for Wave Terminal updates.",
        category: "ai",
        type: "boolean",
        defaultValue: true,
    },
    {
        key: "autoupdate:channel",
        label: "Auto-Update Channel",
        description: "Release channel for automatic updates.",
        category: "ai",
        type: "enum",
        defaultValue: "latest",
        options: [
            { value: "latest", label: "Stable (latest)" },
            { value: "beta", label: "Beta" },
        ],
    },
];

const CURATED_KEY_SET = new Set(CURATED_SETTINGS.map((s) => s.key));

export const SettingsVisualContent = memo(({ model }: { model: WaveConfigViewModel }) => {
    const env = useWaveEnv<WaveConfigEnv>();
    const fullConfig = useAtomValue(env.atoms.fullConfigAtom);
    const setActiveTab = useSetAtom(model.activeTabAtom);
    const { parsed, parseError, setField, deleteField } = useVisualConfigJson(model);

    const [search, setSearch] = useState("");
    const [category, setCategory] = useState<SettingCategory>("all");
    const [showAdvanced, setShowAdvanced] = useState(false);

    const termThemeOptions = useMemo<SelectOption[]>(() => {
        const themes = fullConfig?.termthemes ?? {};
        const keys = Object.keys(themes).sort();
        return keys.map((k) => ({ value: k, label: themes[k]?.["display:name"] || k }));
    }, [fullConfig?.termthemes]);

    const waveAiModeOptions = useMemo<SelectOption[]>(() => {
        const modes = fullConfig?.waveai ?? {};
        const keys = Object.keys(modes).sort();
        return [
            { value: "", label: "(Default)" },
            ...keys.map((k) => ({ value: k, label: modes[k]?.["display:name"] ? `${modes[k]["display:name"]} (${k})` : k })),
        ];
    }, [fullConfig?.waveai]);

    const filteredSettings = useMemo(() => {
        const q = search.trim().toLowerCase();
        return CURATED_SETTINGS.filter((def) => {
            if (category !== "all" && def.category !== category) {
                return false;
            }
            if (!q) return true;
            return (
                def.label.toLowerCase().includes(q) ||
                def.key.toLowerCase().includes(q) ||
                def.description.toLowerCase().includes(q)
            );
        });
    }, [search, category]);

    const extraKeys = useMemo(() => {
        if (!parsed) return [];
        const q = search.trim().toLowerCase();
        return Object.keys(parsed)
            .filter((k) => !CURATED_KEY_SET.has(k))
            .filter((k) => !q || k.toLowerCase().includes(q))
            .sort();
    }, [parsed, search]);

    if (parseError || !parsed) {
        return <InvalidJsonBanner error={parseError || "Invalid JSON"} onOpenRawJson={() => setActiveTab("json")} />;
    }

    const effectiveSettings = fullConfig?.settings ?? {};

    return (
        <div className="flex flex-col h-full min-h-0">
            <div className="flex flex-col gap-2.5 px-4 py-3 border-b border-border bg-panel/40 shrink-0">
                <div className="relative">
                    <i className="fa fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground" />
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search settings (e.g. font, scrollback, cache, telemetry, theme)..."
                        className="w-full pl-8 pr-8 py-1.5 rounded bg-panel border border-border text-sm text-primary focus:outline-none focus:border-accent"
                    />
                    {search && (
                        <button
                            type="button"
                            onClick={() => setSearch("")}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-primary cursor-pointer"
                        >
                            ✕
                        </button>
                    )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                    {CATEGORIES.map((cat) => (
                        <button
                            key={cat.id}
                            type="button"
                            onClick={() => setCategory(cat.id)}
                            className={cn(
                                "px-2.5 py-1 rounded text-xs flex items-center gap-1.5 cursor-pointer transition-colors",
                                category === cat.id
                                    ? "bg-accent/80 text-primary font-medium"
                                    : "bg-secondary/40 text-secondary hover:bg-secondary/70 hover:text-primary"
                            )}
                        >
                            <i className={`fa fa-solid ${cat.icon} text-[11px]`} />
                            <span>{cat.label}</span>
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0">
                {filteredSettings.length === 0 && extraKeys.length === 0 ? (
                    <div className="p-8 text-center text-sm text-muted-foreground">
                        No settings match "{search}".
                    </div>
                ) : (
                    <>
                        {filteredSettings.map((def) => {
                            const isModified = Object.hasOwn(parsed, def.key);
                            const rawValue = isModified ? parsed[def.key] : undefined;
                            const effectiveVal =
                                rawValue !== undefined
                                    ? rawValue
                                    : effectiveSettings[def.key] !== undefined
                                      ? effectiveSettings[def.key]
                                      : def.defaultValue;

                            let options = def.options ?? [];
                            if (def.dynamicOptions === "termthemes") {
                                options = termThemeOptions.length > 0 ? termThemeOptions : [{ value: "default-dark", label: "Default Dark" }];
                            } else if (def.dynamicOptions === "waveaimodes") {
                                options = waveAiModeOptions;
                            }

                            return (
                                <SettingRow
                                    key={def.key}
                                    label={def.label}
                                    configKey={def.key}
                                    description={def.description}
                                    modified={isModified}
                                    onReset={() => deleteField(def.key)}
                                >
                                    {def.type === "boolean" && (
                                        <ToggleControl
                                            checked={Boolean(effectiveVal)}
                                            rawValue={rawValue}
                                            onOverrideEnv={() => setField(def.key, Boolean(def.defaultValue))}
                                            onChange={(next) => setField(def.key, next)}
                                        />
                                    )}
                                    {def.type === "number" && (
                                        <NumberControl
                                            value={typeof effectiveVal === "number" ? effectiveVal : ""}
                                            min={def.min}
                                            max={def.max}
                                            step={def.step}
                                            integer={def.integer}
                                            rawValue={rawValue}
                                            onOverrideEnv={() => setField(def.key, def.defaultValue ?? 0)}
                                            onChange={(next) => {
                                                if (next === undefined) {
                                                    deleteField(def.key);
                                                } else {
                                                    setField(def.key, next);
                                                }
                                            }}
                                        />
                                    )}
                                    {def.type === "enum" && (
                                        <SelectControl
                                            value={String(effectiveVal ?? "")}
                                            options={
                                                options.some((o) => o.value === String(effectiveVal ?? ""))
                                                    ? options
                                                    : [
                                                          ...options,
                                                          { value: String(effectiveVal ?? ""), label: String(effectiveVal ?? "") },
                                                      ]
                                            }
                                            rawValue={rawValue}
                                            onOverrideEnv={() => setField(def.key, def.defaultValue ?? "")}
                                            onChange={(next) => {
                                                if (next === "" && def.defaultValue === "") {
                                                    deleteField(def.key);
                                                } else {
                                                    setField(def.key, next);
                                                }
                                            }}
                                        />
                                    )}
                                    {def.type === "string" && (
                                        <TextControl
                                            value={String(effectiveVal ?? "")}
                                            placeholder={def.placeholder}
                                            presets={def.presets}
                                            onChange={(next) => {
                                                if (next === "" && !def.defaultValue) {
                                                    deleteField(def.key);
                                                } else {
                                                    setField(def.key, next);
                                                }
                                            }}
                                        />
                                    )}
                                </SettingRow>
                            );
                        })}

                        {extraKeys.length > 0 && (
                            <div className="border-t border-border mt-2">
                                <button
                                    type="button"
                                    onClick={() => setShowAdvanced((s) => !s)}
                                    className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-secondary hover:bg-secondary/30 cursor-pointer"
                                >
                                    <span>Other / Advanced Keys ({extraKeys.length})</span>
                                    <i className={`fa fa-solid ${showAdvanced ? "fa-chevron-up" : "fa-chevron-down"}`} />
                                </button>
                                {showAdvanced &&
                                    extraKeys.map((k) => {
                                        const val = parsed[k];
                                        const sensitive = isSensitiveKeyName(k);
                                        const isPrimitive =
                                            typeof val === "string" || typeof val === "number" || typeof val === "boolean";
                                        return (
                                            <SettingRow
                                                key={k}
                                                label={k}
                                                modified={true}
                                                onReset={() => deleteField(k)}
                                                description={
                                                    isEnvMacroValue(val)
                                                        ? "Environment variable macro (preserved)"
                                                        : sensitive
                                                          ? "Sensitive value (masked)"
                                                          : "Custom setting key"
                                                }
                                            >
                                                {typeof val === "boolean" ? (
                                                    <ToggleControl checked={val} onChange={(next) => setField(k, next)} />
                                                ) : typeof val === "number" ? (
                                                    <NumberControl
                                                        value={val}
                                                        onChange={(next) =>
                                                            next === undefined ? deleteField(k) : setField(k, next)
                                                        }
                                                    />
                                                ) : isPrimitive ? (
                                                    <TextControl
                                                        value={String(val)}
                                                        sensitive={sensitive && !isEnvMacroValue(val)}
                                                        onChange={(next) =>
                                                            setField(k, next, { skipAutoSave: sensitive })
                                                        }
                                                    />
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => setActiveTab("json")}
                                                        className="px-2.5 py-1 rounded border border-border text-xs text-secondary hover:text-primary cursor-pointer"
                                                    >
                                                        Edit in Raw JSON
                                                    </button>
                                                )}
                                            </SettingRow>
                                        );
                                    })}
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
});

SettingsVisualContent.displayName = "SettingsVisualContent";
