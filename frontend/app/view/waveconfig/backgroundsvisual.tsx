// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    DeferredKeyRenameControl,
    InvalidJsonBanner,
    NumberControl,
    SelectControl,
    SettingRow,
    TextControl,
    type SelectOption,
} from "@/app/view/waveconfig/visual-config-controls";
import {
    deleteConfigKey,
    isUnsafeObjectKey,
    renameConfigKey,
    updateConfigKey,
    useVisualConfigJson,
} from "@/app/view/waveconfig/visual-config-utils";
import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import type { WaveConfigEnv } from "@/app/view/waveconfig/waveconfigenv";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import { cn } from "@/util/util";
import { computeBgStyleFromMeta, processBackgroundUrls } from "@/util/waveutil";
import { useAtomValue, useSetAtom } from "jotai";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

type BgMode = "solid" | "gradient" | "image";

interface StarterPreset {
    id: string;
    slug: string;
    label: string;
    config: Record<string, any>;
}

const STARTER_PRESETS: StarterPreset[] = [
    {
        id: "midnight-gradient",
        slug: "midnight-gradient",
        label: "Midnight Gradient",
        config: {
            "display:name": "Midnight Gradient",
            "display:order": 1,
            bg: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #312e81 100%)",
            "bg:opacity": 0.75,
            "bg:blendmode": "normal",
            "bg:activebordercolor": "#818cf8",
        },
    },
    {
        id: "emerald-glow",
        slug: "emerald-glow",
        label: "Emerald Glow",
        config: {
            "display:name": "Emerald Glow",
            "display:order": 2,
            bg: "radial-gradient(circle at 20% 20%, rgba(16, 185, 129, 0.55), transparent 55%), linear-gradient(135deg, #022c22 0%, #064e3b 60%, #0f172a 100%)",
            "bg:opacity": 0.7,
            "bg:blendmode": "normal",
            "bg:activebordercolor": "#34d399",
        },
    },
    {
        id: "sunset-dark",
        slug: "sunset-dark",
        label: "Sunset Dark",
        config: {
            "display:name": "Sunset Dark",
            "display:order": 3,
            bg: "linear-gradient(135deg, #450a0a 0%, #9a3412 45%, #3b0764 100%)",
            "bg:opacity": 0.75,
            "bg:blendmode": "overlay",
            "bg:activebordercolor": "#fb923c",
        },
    },
    {
        id: "solid-slate",
        slug: "solid-slate",
        label: "Solid Slate",
        config: {
            "display:name": "Solid Slate",
            "display:order": 4,
            bg: "#1e293b",
            "bg:opacity": 0.6,
            "bg:bordercolor": "#334155",
            "bg:activebordercolor": "#38bdf8",
        },
    },
];

const KNOWN_BUILTIN_BG_KEYS = new Set([
    "bg@rainbow",
    "bg@green",
    "bg@blue",
    "bg@red",
    "bg@ocean-depths",
    "bg@aqua-horizon",
    "bg@sunset",
    "bg@enchantedforest",
    "bg@twilight-mist",
    "bg@duskhorizon",
    "bg@tropical-radiance",
    "bg@twilight-ember",
    "bg@cosmic-tide",
]);

const KNOWN_SCHEMA_FIELDS = new Set([
    "bg",
    "bg:opacity",
    "bg:blendmode",
    "bg:bordercolor",
    "bg:activebordercolor",
    "display:name",
    "display:order",
]);

const BLEND_MODE_OPTIONS: SelectOption[] = [
    { value: "", label: "Default" },
    { value: "normal", label: "normal" },
    { value: "multiply", label: "multiply" },
    { value: "screen", label: "screen" },
    { value: "overlay", label: "overlay" },
    { value: "darken", label: "darken" },
    { value: "lighten", label: "lighten" },
    { value: "color-dodge", label: "color-dodge" },
    { value: "color-burn", label: "color-burn" },
    { value: "hard-light", label: "hard-light" },
    { value: "soft-light", label: "soft-light" },
    { value: "difference", label: "difference" },
    { value: "exclusion", label: "exclusion" },
    { value: "hue", label: "hue" },
    { value: "saturation", label: "saturation" },
    { value: "color", label: "color" },
    { value: "luminosity", label: "luminosity" },
];

const QUICK_SOLID_COLORS = ["#0f172a", "#1e293b", "#172554", "#064e3b", "#450a0a", "#3b0764", "#27272a"];

const QUICK_GRADIENTS = [
    { label: "Indigo", value: "linear-gradient(135deg, #0f172a 0%, #312e81 100%)" },
    { label: "Teal", value: "linear-gradient(135deg, #042f2e 0%, #0e7490 100%)" },
    { label: "Rose", value: "linear-gradient(135deg, #4c0519 0%, #831843 50%, #1e1b4b 100%)" },
    { label: "Aurora", value: "linear-gradient(135deg, #064e3b 0%, #1e3a8a 50%, #581c87 100%)" },
];

const BG_KEY_PATTERN = /^bg@[a-zA-Z0-9_.-]+$/;
const FORBIDDEN_IMAGE_PATH_CHARS = /["')\\]/;

function hasOwnKey(obj: object, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(obj, key);
}

function isPlainObject(val: unknown): val is Record<string, any> {
    return typeof val === "object" && val !== null && !Array.isArray(val);
}

function hasExternalHttpUrl(bg?: unknown): boolean {
    if (typeof bg !== "string" || !bg.trim()) {
        return false;
    }
    return /url\s*\([\s\S]*?https?:\/\//i.test(bg);
}

function detectBgMode(bg?: unknown): BgMode {
    if (typeof bg !== "string" || !bg.trim()) {
        return "gradient";
    }
    const trimmed = bg.trim();
    if (/url\s*\(/i.test(trimmed)) {
        return "image";
    }
    if (/gradient\s*\(/i.test(trimmed)) {
        return "gradient";
    }
    return "solid";
}

function extractImagePathFromBg(bg?: unknown): string {
    if (typeof bg !== "string") return "";
    const match = bg.match(/url\s*\(\s*["']?([^"')]+)["']?\s*\)/i);
    return match ? match[1].trim() : "";
}

function toHexColorOrFallback(val: unknown, fallback = "#1e293b"): string {
    if (typeof val !== "string") return fallback;
    const trimmed = val.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
        return trimmed;
    }
    if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
        const [, r, g, b] = trimmed.match(/^#(.)(.)(.)$/)!;
        return `#${r}${r}${g}${g}${b}${b}`;
    }
    return fallback;
}

function clampOpacity(val: number): number {
    if (!Number.isFinite(val)) return 1;
    return Math.min(1, Math.max(0, Math.round(val * 100) / 100));
}

function validateBgCss(bg?: unknown): { valid: boolean; error?: string } {
    if (typeof bg !== "string" || !bg.trim()) {
        return { valid: true };
    }
    try {
        const processed = processBackgroundUrls(bg);
        if (processed == null) {
            return {
                valid: false,
                error: "Background CSS contains an unsafe or unsupported URL scheme.",
            };
        }
        return { valid: true };
    } catch (err: any) {
        return {
            valid: false,
            error: `Invalid CSS background syntax: ${err?.message || String(err)}`,
        };
    }
}

function buildValidatedImageBg(rawPath: string): { valid: boolean; css?: string; error?: string } {
    const trimmed = rawPath.trim();
    if (!trimmed) {
        return { valid: true, css: "" };
    }
    if (FORBIDDEN_IMAGE_PATH_CHARS.test(trimmed)) {
        return {
            valid: false,
            error: 'Image path cannot contain ", \', ), or \\ characters. Use forward slashes (/) for Windows paths.',
        };
    }
    const candidateCss = `url("${trimmed}") center / cover no-repeat`;
    try {
        const processed = processBackgroundUrls(candidateCss);
        if (processed == null) {
            return {
                valid: false,
                error: "Unsupported URL or relative path. Use an absolute path (/..., ~/..., C:/...), file:///..., data:..., or http(s)://...",
            };
        }
        return { valid: true, css: candidateCss };
    } catch (err: any) {
        return {
            valid: false,
            error: `Invalid image background: ${err?.message || String(err)}`,
        };
    }
}

function computeSafePreviewStyle(
    entry: Record<string, any> | null | undefined,
    allowExternal: boolean
): { style: React.CSSProperties | null; blockedExternal: boolean; invalid: boolean } {
    if (!isPlainObject(entry)) {
        return { style: null, blockedExternal: false, invalid: false };
    }
    const bg = typeof entry.bg === "string" ? entry.bg : "";
    if (!bg.trim()) {
        return { style: null, blockedExternal: false, invalid: false };
    }
    if (hasExternalHttpUrl(bg) && !allowExternal) {
        return { style: null, blockedExternal: true, invalid: false };
    }
    const computed = computeBgStyleFromMeta(entry as Omit<BackgroundConfigType, "display:name">);
    if (!computed || computed.background == null) {
        return { style: null, blockedExternal: false, invalid: true };
    }
    return { style: computed, blockedExternal: false, invalid: false };
}

function generateUniqueKey(baseKey: string, existingKeys: Set<string>): string {
    if (!existingKeys.has(baseKey)) {
        return baseKey;
    }
    let idx = 2;
    while (existingKeys.has(`${baseKey}-${idx}`)) {
        idx++;
    }
    return `${baseKey}-${idx}`;
}

function sortByOrderThenKey(keys: string[], map: Record<string, any>): string[] {
    return [...keys].sort((a, b) => {
        const entryA = map[a];
        const entryB = map[b];
        const orderA = isPlainObject(entryA) && typeof entryA["display:order"] === "number" ? entryA["display:order"] : 9999;
        const orderB = isPlainObject(entryB) && typeof entryB["display:order"] === "number" ? entryB["display:order"] : 9999;
        if (orderA !== orderB) {
            return orderA - orderB;
        }
        return a.localeCompare(b);
    });
}

interface BgSwatchProps {
    entry: Record<string, any>;
    allowExternal: boolean;
    onUnlockExternal?: () => void;
    className?: string;
}

const BgSwatch = memo(({ entry, allowExternal, onUnlockExternal, className }: BgSwatchProps) => {
    const { style, blockedExternal, invalid } = useMemo(
        () => computeSafePreviewStyle(entry, allowExternal),
        [entry, allowExternal]
    );

    return (
        <div
            className={cn(
                "relative rounded border border-border overflow-hidden bg-zinc-950 shrink-0",
                className
            )}
        >
            {style && <div className="absolute inset-0 pointer-events-none" style={style} />}
            {blockedExternal && (
                <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/90 p-1">
                    {onUnlockExternal ? (
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                onUnlockExternal();
                            }}
                            title="External URL preview is gated to avoid automatic network requests. Click to load."
                            className="px-1.5 py-0.5 rounded bg-secondary/90 hover:bg-secondary border border-border text-[10px] text-primary cursor-pointer transition-colors leading-tight text-center"
                        >
                            <i className="fa fa-solid fa-globe mr-1 text-accent" />
                            Preview
                        </button>
                    ) : (
                        <span className="text-[10px] text-muted-foreground">External URL</span>
                    )}
                </div>
            )}
            {invalid && (
                <div
                    className="absolute inset-0 flex items-center justify-center bg-zinc-900/90 text-warning text-[10px]"
                    title="Invalid or unsafe background CSS"
                >
                    <i className="fa fa-solid fa-triangle-exclamation" />
                </div>
            )}
            {!style && !blockedExternal && !invalid && (
                <div className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground/60">
                    None
                </div>
            )}
        </div>
    );
});
BgSwatch.displayName = "BgSwatch";

interface MiniTerminalPreviewProps {
    entry: Record<string, any>;
    allowExternal: boolean;
    onUnlockExternal: () => void;
}

const MiniTerminalPreview = memo(({ entry, allowExternal, onUnlockExternal }: MiniTerminalPreviewProps) => {
    const { style, blockedExternal, invalid } = useMemo(
        () => computeSafePreviewStyle(entry, allowExternal),
        [entry, allowExternal]
    );

    const activeBorder =
        typeof entry["bg:activebordercolor"] === "string" && entry["bg:activebordercolor"].trim()
            ? entry["bg:activebordercolor"].trim()
            : "var(--accent-color)";
    const inactiveBorder =
        typeof entry["bg:bordercolor"] === "string" && entry["bg:bordercolor"].trim()
            ? entry["bg:bordercolor"].trim()
            : "rgba(255, 255, 255, 0.16)";
    const opacityLabel =
        typeof entry["bg:opacity"] === "number" ? `${Math.round(clampOpacity(entry["bg:opacity"]) * 100)}%` : "100%";
    const blendLabel =
        typeof entry["bg:blendmode"] === "string" && entry["bg:blendmode"].trim() ? entry["bg:blendmode"].trim() : null;

    return (
        <div className="flex flex-col gap-2">
            <div className="relative rounded-lg border border-border overflow-hidden bg-zinc-950 h-44 select-none">
                {style && <div className="absolute inset-0 pointer-events-none" style={style} />}
                {blockedExternal && (
                    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-zinc-950/85 backdrop-blur-[1px] p-4 text-center">
                        <div className="text-xs text-secondary flex items-center gap-1.5">
                            <i className="fa fa-solid fa-shield-halved text-accent" />
                            <span>External URL background preview is paused to avoid automatic network requests.</span>
                        </div>
                        <button
                            type="button"
                            onClick={onUnlockExternal}
                            className="px-2.5 py-1 rounded bg-accent/80 hover:bg-accent text-xs text-primary cursor-pointer transition-colors"
                        >
                            Click to Preview External Image
                        </button>
                    </div>
                )}
                <div className="relative z-10 h-full p-3 grid grid-cols-2 gap-2.5">
                    <div
                        className="rounded-md bg-zinc-950/65 backdrop-blur-[1px] flex flex-col overflow-hidden"
                        style={{ border: `2px solid ${activeBorder}` }}
                    >
                        <div className="px-2 py-1 text-[10px] font-mono text-primary/90 bg-black/40 border-b border-white/10 flex items-center justify-between">
                            <span>zsh — ~/wave</span>
                            <span className="text-[9px] uppercase tracking-wide text-accent">Focused</span>
                        </div>
                        <div className="p-2 text-[11px] font-mono leading-relaxed text-zinc-200/90">
                            <div>
                                <span className="text-emerald-400">$</span> git status
                            </div>
                            <div className="text-zinc-400">On branch main</div>
                            <div className="text-zinc-300">nothing to commit</div>
                        </div>
                    </div>
                    <div
                        className="rounded-md bg-zinc-950/65 backdrop-blur-[1px] flex flex-col overflow-hidden"
                        style={{ border: `1.5px solid ${inactiveBorder}` }}
                    >
                        <div className="px-2 py-1 text-[10px] font-mono text-zinc-400 bg-black/40 border-b border-white/10 flex items-center justify-between">
                            <span>server.log</span>
                            <span className="text-[9px] uppercase tracking-wide text-zinc-500">Unfocused</span>
                        </div>
                        <div className="p-2 text-[11px] font-mono leading-relaxed text-zinc-400">
                            <div>[info] listening :8080</div>
                            <div>[info] ready in 42ms</div>
                        </div>
                    </div>
                </div>
                <div className="absolute bottom-1.5 right-2 z-10 flex items-center gap-1.5 pointer-events-none">
                    <span className="px-1.5 py-0.5 rounded bg-black/65 border border-white/10 text-[10px] font-mono text-zinc-300">
                        opacity {opacityLabel}
                    </span>
                    {blendLabel && (
                        <span className="px-1.5 py-0.5 rounded bg-black/65 border border-white/10 text-[10px] font-mono text-zinc-300">
                            {blendLabel}
                        </span>
                    )}
                </div>
            </div>
            {invalid && (
                <div className="text-xs text-warning flex items-center gap-1.5">
                    <i className="fa fa-solid fa-triangle-exclamation" />
                    <span>Preview unavailable: background CSS is invalid or uses an unsupported URL scheme.</span>
                </div>
            )}
        </div>
    );
});
MiniTerminalPreview.displayName = "MiniTerminalPreview";

interface ColorFieldControlProps {
    value: string;
    onChange: (next: string | undefined) => void;
    placeholder?: string;
}

const ColorFieldControl = memo(({ value, onChange, placeholder }: ColorFieldControlProps) => {
    const pickerValue = toHexColorOrFallback(value, "#38bdf8");
    return (
        <div className="flex items-center gap-1.5">
            <input
                type="color"
                value={pickerValue}
                onChange={(e) => onChange(e.target.value)}
                title="Pick color"
                className="w-8 h-8 rounded border border-border bg-panel cursor-pointer p-0.5"
            />
            <input
                type="text"
                value={value}
                onChange={(e) => {
                    const v = e.target.value;
                    onChange(v === "" ? undefined : v);
                }}
                placeholder={placeholder}
                className="px-2.5 py-1.5 rounded bg-panel border border-border text-sm font-mono text-primary focus:outline-none focus:border-accent w-48"
            />
            {value && (
                <button
                    type="button"
                    onClick={() => onChange(undefined)}
                    title="Clear color"
                    className="px-2 py-1.5 rounded text-xs text-muted-foreground hover:text-primary hover:bg-secondary/60 cursor-pointer"
                >
                    ✕
                </button>
            )}
        </div>
    );
});
ColorFieldControl.displayName = "ColorFieldControl";

export const BackgroundsVisualContent = memo(({ model }: { model: WaveConfigViewModel }) => {
    const env = useWaveEnv<WaveConfigEnv>();
    const fullConfig = useAtomValue(env.atoms.fullConfigAtom);
    const setActiveTab = useSetAtom(model.activeTabAtom);
    const { parsed, parseError, replaceData } = useVisualConfigJson(model);

    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [showNewMenu, setShowNewMenu] = useState(false);
    const [unlockedExternal, setUnlockedExternal] = useState<Record<string, boolean>>({});
    const [bgMode, setBgMode] = useState<BgMode>("gradient");
    const [imagePathDraft, setImagePathDraft] = useState("");
    const [imagePathError, setImagePathError] = useState<string | null>(null);

    const builtinBackgrounds = useMemo<Record<string, any>>(() => {
        const raw = fullConfig?.backgrounds;
        if (!isPlainObject(raw)) {
            return {};
        }
        return raw;
    }, [fullConfig?.backgrounds]);

    const customKeys = useMemo(() => {
        if (!parsed) return [];
        const keys = Object.keys(parsed).filter((k) => !isUnsafeObjectKey(k));
        return sortByOrderThenKey(keys, parsed);
    }, [parsed]);

    const builtinOnlyKeys = useMemo(() => {
        if (!parsed) return [];
        const keys = Object.keys(builtinBackgrounds).filter(
            (k) =>
                !isUnsafeObjectKey(k) &&
                !hasOwnKey(parsed, k) &&
                isPlainObject(builtinBackgrounds[k])
        );
        return sortByOrderThenKey(keys, builtinBackgrounds);
    }, [parsed, builtinBackgrounds]);

    // Keep selectedKey valid when data changes
    useEffect(() => {
        if (!parsed) return;
        if (selectedKey != null) {
            const existsInCustom = hasOwnKey(parsed, selectedKey);
            const existsInBuiltin = hasOwnKey(builtinBackgrounds, selectedKey) && isPlainObject(builtinBackgrounds[selectedKey]);
            if (existsInCustom || existsInBuiltin) {
                return;
            }
        }
        if (customKeys.length > 0) {
            setSelectedKey(customKeys[0]);
        } else if (builtinOnlyKeys.length > 0) {
            setSelectedKey(builtinOnlyKeys[0]);
        } else {
            setSelectedKey(null);
        }
    }, [parsed, selectedKey, customKeys, builtinOnlyKeys, builtinBackgrounds]);

    const isSelectedInCustom = Boolean(parsed && selectedKey && hasOwnKey(parsed, selectedKey));
    const selectedCustomEntry = isSelectedInCustom && parsed && selectedKey ? parsed[selectedKey] : undefined;
    const selectedBuiltinEntry =
        !isSelectedInCustom && selectedKey && isPlainObject(builtinBackgrounds[selectedKey])
            ? builtinBackgrounds[selectedKey]
            : undefined;

    // Sync bgMode and imagePathDraft when switching selection
    useEffect(() => {
        if (isPlainObject(selectedCustomEntry)) {
            const detected = detectBgMode(selectedCustomEntry.bg);
            setBgMode(detected);
            setImagePathDraft(detected === "image" ? extractImagePathFromBg(selectedCustomEntry.bg) : "");
            setImagePathError(null);
        } else {
            setImagePathDraft("");
            setImagePathError(null);
        }
    }, [selectedKey, isSelectedInCustom]);

    const getUnlockToken = (key: string, entry: Record<string, any>) => `${key}::${String(entry?.bg ?? "")}`;

    const unlockExternalFor = useCallback((key: string, entry: Record<string, any>) => {
        const token = getUnlockToken(key, entry);
        setUnlockedExternal((prev) => ({ ...prev, [token]: true }));
    }, []);

    const handleCreatePreset = useCallback(
        (preset: StarterPreset) => {
            if (!parsed) return;
            const allKeys = new Set<string>([...Object.keys(parsed), ...Object.keys(builtinBackgrounds)]);
            const newKey = generateUniqueKey(`bg@${preset.slug}`, allKeys);
            const nextData = updateConfigKey(parsed, newKey, { ...preset.config });
            replaceData(nextData);
            setSelectedKey(newKey);
            setShowNewMenu(false);
        },
        [parsed, builtinBackgrounds, replaceData]
    );

    const handleCustomizeBuiltin = useCallback(
        (key: string) => {
            if (!parsed) return;
            const src = builtinBackgrounds[key];
            if (!isPlainObject(src)) return;
            const cloned: Record<string, any> = { ...src };
            if (typeof cloned["display:name"] !== "string" || !cloned["display:name"].trim()) {
                cloned["display:name"] = key.replace(/^bg@/, "");
            }
            replaceData(updateConfigKey(parsed, key, cloned));
            setSelectedKey(key);
        },
        [parsed, builtinBackgrounds, replaceData]
    );

    const handleHideBuiltin = useCallback(
        (key: string) => {
            if (!parsed) return;
            replaceData(updateConfigKey(parsed, key, null));
            setSelectedKey(key);
        },
        [parsed, replaceData]
    );

    const handleRestoreBuiltin = useCallback(
        (key: string) => {
            if (!parsed) return;
            replaceData(deleteConfigKey(parsed, key));
            setSelectedKey(key);
        },
        [parsed, replaceData]
    );

    const handleUpdateEntryField = useCallback(
        (field: string, value: any) => {
            if (!parsed || !selectedKey || !isPlainObject(parsed[selectedKey])) return;
            const current = parsed[selectedKey];
            const nextEntry: Record<string, any> = { ...current };
            if (value === undefined) {
                delete nextEntry[field];
            } else {
                nextEntry[field] = value;
            }
            replaceData(updateConfigKey(parsed, selectedKey, nextEntry));
        },
        [parsed, selectedKey, replaceData]
    );

    const handleRenameSelected = useCallback(
        (nextKey: string) => {
            if (!parsed || !selectedKey) return;
            const nextData = renameConfigKey(parsed, selectedKey, nextKey);
            if (nextData !== parsed) {
                replaceData(nextData);
                setSelectedKey(nextKey);
            }
        },
        [parsed, selectedKey, replaceData]
    );

    const handleDuplicateSelected = useCallback(() => {
        if (!parsed || !selectedKey || !isPlainObject(parsed[selectedKey])) return;
        const current = parsed[selectedKey];
        const allKeys = new Set<string>([...Object.keys(parsed), ...Object.keys(builtinBackgrounds)]);
        const newKey = generateUniqueKey(`${selectedKey}-copy`, allKeys);
        const baseName =
            typeof current["display:name"] === "string" && current["display:name"].trim()
                ? current["display:name"].trim()
                : selectedKey;
        const cloned: Record<string, any> = {
            ...current,
            "display:name": `${baseName} (Copy)`,
        };
        replaceData(updateConfigKey(parsed, newKey, cloned));
        setSelectedKey(newKey);
    }, [parsed, selectedKey, builtinBackgrounds, replaceData]);

    const handleDeleteSelected = useCallback(() => {
        if (!parsed || !selectedKey) return;
        const nextData = deleteConfigKey(parsed, selectedKey);
        replaceData(nextData);
        setSelectedKey(null);
    }, [parsed, selectedKey, replaceData]);

    if (parseError || !parsed) {
        return <InvalidJsonBanner error={parseError || "Invalid JSON"} onOpenRawJson={() => setActiveTab("json")} />;
    }

    const isSelectedBuiltinOverride = Boolean(selectedKey && KNOWN_BUILTIN_BG_KEYS.has(selectedKey));
    const currentBgCssValidation = isPlainObject(selectedCustomEntry)
        ? validateBgCss(selectedCustomEntry.bg)
        : { valid: true };

    const extraUnknownKeys = isPlainObject(selectedCustomEntry)
        ? Object.keys(selectedCustomEntry).filter((k) => !KNOWN_SCHEMA_FIELDS.has(k) && !isUnsafeObjectKey(k))
        : [];

    return (
        <div className="flex flex-row h-full w-full min-h-0">
            {/* Left Gallery */}
            <div className="w-72 shrink-0 border-r border-border flex flex-col min-h-0 bg-panel/30">
                <div className="p-3 border-b border-border flex flex-col gap-2">
                    <button
                        type="button"
                        onClick={() => setShowNewMenu((v) => !v)}
                        className="w-full px-3 py-1.5 rounded bg-accent/80 hover:bg-accent text-primary text-sm font-medium flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                    >
                        <i className="fa fa-solid fa-plus text-xs" />
                        <span>New Background</span>
                    </button>
                    {showNewMenu && (
                        <div className="rounded border border-border bg-panel p-1.5 flex flex-col gap-1 shadow-md">
                            <div className="text-[11px] text-muted-foreground px-1.5 py-0.5 uppercase tracking-wide font-semibold">
                                Starter Presets
                            </div>
                            {STARTER_PRESETS.map((preset) => (
                                <button
                                    key={preset.id}
                                    type="button"
                                    onClick={() => handleCreatePreset(preset)}
                                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-secondary/60 text-left cursor-pointer transition-colors"
                                >
                                    <BgSwatch entry={preset.config} allowExternal={false} className="w-8 h-6" />
                                    <span className="text-xs text-primary truncate">{preset.label}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-4">
                    {/* Section 1: Custom & Modified */}
                    <div className="flex flex-col gap-1.5">
                        <div className="px-1.5 flex items-center justify-between">
                            <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
                                Custom &amp; Modified ({customKeys.length})
                            </span>
                        </div>
                        {customKeys.length === 0 ? (
                            <div className="px-2 py-3 text-xs text-muted-foreground rounded border border-dashed border-border/70">
                                No custom backgrounds yet. Create one above or customize a built-in below.
                            </div>
                        ) : (
                            customKeys.map((key) => {
                                const entry = parsed[key];
                                const isSelected = selectedKey === key;
                                const isTombstone = entry === null;
                                const isMalformed = !isTombstone && !isPlainObject(entry);
                                const isOverride = KNOWN_BUILTIN_BG_KEYS.has(key);

                                return (
                                    <div
                                        key={key}
                                        onClick={() => setSelectedKey(key)}
                                        className={cn(
                                            "flex items-center gap-2.5 p-2 rounded border cursor-pointer transition-colors",
                                            isSelected
                                                ? "bg-accentbg border-accent/60 text-primary"
                                                : "border-transparent hover:bg-secondary/40 text-secondary hover:text-primary"
                                        )}
                                    >
                                        {isTombstone ? (
                                            <div className="w-12 h-9 rounded border border-dashed border-border bg-zinc-900/70 flex items-center justify-center shrink-0 text-muted-foreground">
                                                <i className="fa fa-solid fa-eye-slash text-xs" />
                                            </div>
                                        ) : isMalformed ? (
                                            <div className="w-12 h-9 rounded border border-error/50 bg-error/10 flex items-center justify-center shrink-0 text-error">
                                                <i className="fa fa-solid fa-triangle-exclamation text-xs" />
                                            </div>
                                        ) : (
                                            <BgSwatch
                                                entry={entry}
                                                allowExternal={Boolean(unlockedExternal[getUnlockToken(key, entry)])}
                                                onUnlockExternal={() => unlockExternalFor(key, entry)}
                                                className="w-12 h-9"
                                            />
                                        )}
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-sm font-medium truncate text-primary">
                                                    {isPlainObject(entry) && typeof entry["display:name"] === "string" && entry["display:name"].trim()
                                                        ? entry["display:name"]
                                                        : key.replace(/^bg@/, "")}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                                <code className="text-[10px] text-muted-foreground font-mono truncate max-w-[120px]">
                                                    {key}
                                                </code>
                                                {isTombstone && (
                                                    <span className="text-[10px] px-1.5 py-0.25 rounded bg-secondary text-muted-foreground font-medium">
                                                        Hidden Built-in
                                                    </span>
                                                )}
                                                {isMalformed && (
                                                    <span className="text-[10px] px-1.5 py-0.25 rounded bg-error/20 text-error font-medium">
                                                        Invalid
                                                    </span>
                                                )}
                                                {!isTombstone && !isMalformed && isOverride && (
                                                    <span className="text-[10px] px-1.5 py-0.25 rounded bg-accent/20 text-accent font-medium">
                                                        Modified
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>

                    {/* Section 2: Built-in Backgrounds */}
                    <div className="flex flex-col gap-1.5">
                        <div className="px-1.5 flex items-center justify-between">
                            <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
                                Built-in Backgrounds ({builtinOnlyKeys.length})
                            </span>
                        </div>
                        {builtinOnlyKeys.length === 0 ? (
                            <div className="px-2 py-2 text-xs text-muted-foreground">
                                All built-in backgrounds are customized or hidden above.
                            </div>
                        ) : (
                            builtinOnlyKeys.map((key) => {
                                const entry = builtinBackgrounds[key];
                                const isSelected = selectedKey === key && !isSelectedInCustom;
                                return (
                                    <div
                                        key={key}
                                        onClick={() => setSelectedKey(key)}
                                        className={cn(
                                            "flex flex-col gap-1.5 p-2 rounded border cursor-pointer transition-colors",
                                            isSelected
                                                ? "bg-accentbg border-accent/60 text-primary"
                                                : "border-transparent hover:bg-secondary/40 text-secondary hover:text-primary"
                                        )}
                                    >
                                        <div className="flex items-center gap-2.5">
                                            <BgSwatch
                                                entry={entry}
                                                allowExternal={Boolean(unlockedExternal[getUnlockToken(key, entry)])}
                                                onUnlockExternal={() => unlockExternalFor(key, entry)}
                                                className="w-12 h-9"
                                            />
                                            <div className="min-w-0 flex-1">
                                                <div className="text-sm font-medium truncate text-primary">
                                                    {typeof entry["display:name"] === "string" && entry["display:name"].trim()
                                                        ? entry["display:name"]
                                                        : key.replace(/^bg@/, "")}
                                                </div>
                                                <code className="text-[10px] text-muted-foreground font-mono truncate block">
                                                    {key}
                                                </code>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1.5 pl-14">
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleCustomizeBuiltin(key);
                                                }}
                                                className="px-2 py-0.5 rounded bg-secondary/70 hover:bg-secondary text-[11px] text-primary cursor-pointer transition-colors"
                                            >
                                                Customize
                                            </button>
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleHideBuiltin(key);
                                                }}
                                                className="px-2 py-0.5 rounded border border-border/70 hover:bg-secondary/50 text-[11px] text-muted-foreground hover:text-primary cursor-pointer transition-colors"
                                            >
                                                Hide
                                            </button>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            </div>

            {/* Right Detail Editor */}
            <div className="flex-1 min-w-0 overflow-y-auto">
                {!selectedKey ? (
                    <div className="h-full flex flex-col items-center justify-center p-8 text-center text-muted-foreground gap-2">
                        <i className="fa fa-solid fa-palette text-2xl opacity-50" />
                        <div className="text-sm">Select a background from the gallery or create a new one.</div>
                    </div>
                ) : isSelectedInCustom && selectedCustomEntry === null ? (
                    /* Null Tombstone Panel */
                    <div className="p-6 max-w-2xl flex flex-col gap-4">
                        <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded bg-secondary text-xs font-medium text-muted-foreground">
                                Hidden Built-in
                            </span>
                            <code className="text-xs font-mono text-muted-foreground">{selectedKey}</code>
                        </div>
                        <div className="text-base font-semibold text-primary">
                            This built-in background is currently hidden
                        </div>
                        <div className="text-sm text-secondary leading-relaxed">
                            Mapping <code className="font-mono text-xs px-1 py-0.5 rounded bg-secondary/60">{selectedKey}</code>{" "}
                            to <code className="font-mono text-xs px-1 py-0.5 rounded bg-secondary/60">null</code> in{" "}
                            <code className="font-mono text-xs">backgrounds.json</code> removes it from the tab background menu.
                        </div>
                        <div>
                            <button
                                type="button"
                                onClick={() => handleRestoreBuiltin(selectedKey)}
                                className="px-3.5 py-1.5 rounded bg-accent/80 hover:bg-accent text-primary text-sm font-medium cursor-pointer transition-colors flex items-center gap-2"
                            >
                                <i className="fa fa-solid fa-rotate-left text-xs" />
                                <span>Restore Default</span>
                            </button>
                        </div>
                    </div>
                ) : isSelectedInCustom && !isPlainObject(selectedCustomEntry) ? (
                    /* Malformed Non-Object Entry Fallback */
                    <div className="p-6 max-w-2xl flex flex-col items-start gap-3">
                        <div className="text-error font-semibold flex items-center gap-2">
                            <i className="fa fa-solid fa-triangle-exclamation" />
                            <span>Malformed background entry: {selectedKey}</span>
                        </div>
                        <div className="text-sm text-secondary">
                            Expected a background configuration object or <code className="font-mono">null</code>, but found{" "}
                            <code className="font-mono">
                                {Array.isArray(selectedCustomEntry) ? "array" : typeof selectedCustomEntry}
                            </code>
                            .
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setActiveTab("json")}
                                className="px-3 py-1.5 rounded bg-accent/80 hover:bg-accent text-primary text-sm cursor-pointer transition-colors"
                            >
                                Edit in Raw JSON
                            </button>
                            <button
                                type="button"
                                onClick={handleDeleteSelected}
                                className="px-3 py-1.5 rounded border border-error/50 text-error hover:bg-error/10 text-sm cursor-pointer transition-colors"
                            >
                                Delete Entry
                            </button>
                        </div>
                    </div>
                ) : !isSelectedInCustom && selectedBuiltinEntry ? (
                    /* Built-in Read-Only Preview */
                    <div className="p-6 max-w-3xl flex flex-col gap-5">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <div className="flex items-center gap-2">
                                    <h2 className="text-lg font-semibold text-primary">
                                        {selectedBuiltinEntry["display:name"] || selectedKey}
                                    </h2>
                                    <span className="text-[11px] px-2 py-0.5 rounded bg-secondary text-muted-foreground font-medium">
                                        Built-in
                                    </span>
                                </div>
                                <code className="text-xs font-mono text-muted-foreground">{selectedKey}</code>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                <button
                                    type="button"
                                    onClick={() => handleCustomizeBuiltin(selectedKey)}
                                    className="px-3 py-1.5 rounded bg-accent/80 hover:bg-accent text-primary text-sm font-medium cursor-pointer transition-colors"
                                >
                                    Customize
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleHideBuiltin(selectedKey)}
                                    className="px-3 py-1.5 rounded border border-border hover:bg-secondary/60 text-secondary hover:text-primary text-sm cursor-pointer transition-colors"
                                >
                                    Hide Built-in
                                </button>
                            </div>
                        </div>
                        <MiniTerminalPreview
                            entry={selectedBuiltinEntry}
                            allowExternal={Boolean(unlockedExternal[getUnlockToken(selectedKey, selectedBuiltinEntry)])}
                            onUnlockExternal={() => unlockExternalFor(selectedKey, selectedBuiltinEntry)}
                        />
                        <div className="text-xs text-muted-foreground bg-panel/60 border border-border rounded p-3">
                            Built-in backgrounds are read-only until customized. Click <strong>Customize</strong> to copy
                            this preset into <code className="font-mono">backgrounds.json</code> and edit its colors,
                            opacity, or borders.
                        </div>
                    </div>
                ) : isPlainObject(selectedCustomEntry) ? (
                    /* Editable Object Entry */
                    <div className="flex flex-col pb-8">
                        {/* Header & Actions */}
                        <div className="px-5 py-4 border-b border-border flex flex-wrap items-center justify-between gap-3">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                    <h2 className="text-base font-semibold text-primary truncate">
                                        {typeof selectedCustomEntry["display:name"] === "string" &&
                                        selectedCustomEntry["display:name"].trim()
                                            ? selectedCustomEntry["display:name"]
                                            : selectedKey}
                                    </h2>
                                    {isSelectedBuiltinOverride && (
                                        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-accent/20 text-accent font-semibold">
                                            Built-in Override
                                        </span>
                                    )}
                                </div>
                                <code className="text-xs font-mono text-muted-foreground">{selectedKey}</code>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                                <button
                                    type="button"
                                    onClick={handleDuplicateSelected}
                                    className="px-2.5 py-1 rounded border border-border hover:bg-secondary/60 text-xs text-primary cursor-pointer transition-colors"
                                >
                                    <i className="fa fa-solid fa-copy mr-1.5" />
                                    Duplicate
                                </button>
                                {isSelectedBuiltinOverride ? (
                                    <>
                                        <button
                                            type="button"
                                            onClick={() => handleRestoreBuiltin(selectedKey)}
                                            className="px-2.5 py-1 rounded border border-border hover:bg-secondary/60 text-xs text-secondary hover:text-primary cursor-pointer transition-colors"
                                        >
                                            <i className="fa fa-solid fa-rotate-left mr-1.5" />
                                            Reset to Default
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleHideBuiltin(selectedKey)}
                                            className="px-2.5 py-1 rounded border border-border hover:bg-secondary/60 text-xs text-secondary hover:text-primary cursor-pointer transition-colors"
                                        >
                                            <i className="fa fa-solid fa-eye-slash mr-1.5" />
                                            Hide Built-in
                                        </button>
                                    </>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={handleDeleteSelected}
                                        className="px-2.5 py-1 rounded border border-error/40 hover:bg-error/15 text-xs text-error cursor-pointer transition-colors"
                                    >
                                        <i className="fa fa-solid fa-trash mr-1.5" />
                                        Delete
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Live Mini-Terminal Preview */}
                        <div className="px-5 py-4 border-b border-border/60">
                            <MiniTerminalPreview
                                entry={selectedCustomEntry}
                                allowExternal={Boolean(
                                    unlockedExternal[getUnlockToken(selectedKey, selectedCustomEntry)]
                                )}
                                onUnlockExternal={() => unlockExternalFor(selectedKey, selectedCustomEntry)}
                            />
                        </div>

                        {/* Form Fields */}
                        <div className="flex flex-col">
                            <SettingRow
                                label="Display Name"
                                configKey="display:name"
                                description="Required name shown in the tab right-click background menu."
                            >
                                <div className="flex flex-col items-end gap-1">
                                    <TextControl
                                        value={
                                            typeof selectedCustomEntry["display:name"] === "string"
                                                ? selectedCustomEntry["display:name"]
                                                : ""
                                        }
                                        onChange={(val) => handleUpdateEntryField("display:name", val)}
                                        placeholder="e.g. Midnight Gradient"
                                    />
                                    {(typeof selectedCustomEntry["display:name"] !== "string" ||
                                        selectedCustomEntry["display:name"].trim() === "") && (
                                        <div className="text-xs text-error">Display name is required</div>
                                    )}
                                </div>
                            </SettingRow>

                            <SettingRow
                                label="Background Key"
                                description='Unique identifier in backgrounds.json (typically prefixed with "bg@").'
                            >
                                <DeferredKeyRenameControl
                                    currentKey={selectedKey}
                                    existingKeys={Object.keys(parsed)}
                                    pattern={BG_KEY_PATTERN}
                                    patternError='Key must start with "bg@" and contain only letters, numbers, dots, underscores, or hyphens'
                                    onRename={handleRenameSelected}
                                />
                            </SettingRow>

                            <SettingRow
                                label="Menu Order"
                                configKey="display:order"
                                description="Optional sort order in the tab background menu (lower appears first)."
                                modified={hasOwnKey(selectedCustomEntry, "display:order")}
                                onReset={() => handleUpdateEntryField("display:order", undefined)}
                            >
                                <NumberControl
                                    value={
                                        typeof selectedCustomEntry["display:order"] === "number"
                                            ? selectedCustomEntry["display:order"]
                                            : ""
                                    }
                                    step={0.1}
                                    placeholder="e.g. 1.0"
                                    onChange={(val) => handleUpdateEntryField("display:order", val)}
                                />
                            </SettingRow>

                            {/* Background Mode & CSS Value */}
                            <div className="flex flex-col gap-3 py-3.5 px-4 border-b border-border/60">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium text-primary">Background</span>
                                            <code className="text-[11px] px-1.5 py-0.5 rounded bg-secondary/60 text-muted-foreground font-mono">
                                                bg
                                            </code>
                                        </div>
                                        <div className="text-xs text-muted-foreground mt-0.5">
                                            Choose a solid color, CSS gradient, or local/remote image path.
                                        </div>
                                    </div>
                                    <div className="inline-flex rounded border border-border overflow-hidden text-xs">
                                        {(
                                            [
                                                { id: "solid", label: "Solid Color" },
                                                { id: "gradient", label: "Gradient CSS" },
                                                { id: "image", label: "Image Path" },
                                            ] as { id: BgMode; label: string }[]
                                        ).map((tab) => (
                                            <button
                                                key={tab.id}
                                                type="button"
                                                onClick={() => {
                                                    setBgMode(tab.id);
                                                    if (tab.id === "image") {
                                                        setImagePathDraft(extractImagePathFromBg(selectedCustomEntry.bg));
                                                        setImagePathError(null);
                                                    }
                                                }}
                                                className={cn(
                                                    "px-2.5 py-1 cursor-pointer transition-colors",
                                                    bgMode === tab.id
                                                        ? "bg-accent/80 text-primary font-medium"
                                                        : "bg-panel text-secondary hover:text-primary hover:bg-secondary/40"
                                                )}
                                            >
                                                {tab.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {bgMode === "solid" && (
                                    <div className="flex flex-col gap-2">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <input
                                                type="color"
                                                value={toHexColorOrFallback(selectedCustomEntry.bg, "#1e293b")}
                                                onChange={(e) => handleUpdateEntryField("bg", e.target.value)}
                                                className="w-9 h-8 rounded border border-border bg-panel cursor-pointer p-0.5"
                                            />
                                            <input
                                                type="text"
                                                value={typeof selectedCustomEntry.bg === "string" ? selectedCustomEntry.bg : ""}
                                                onChange={(e) =>
                                                    handleUpdateEntryField(
                                                        "bg",
                                                        e.target.value === "" ? undefined : e.target.value
                                                    )
                                                }
                                                placeholder="#1e293b or rgba(30, 41, 59, 0.9)"
                                                className="flex-1 min-w-[200px] px-2.5 py-1.5 rounded bg-panel border border-border text-sm font-mono text-primary focus:outline-none focus:border-accent"
                                            />
                                        </div>
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                            {QUICK_SOLID_COLORS.map((hex) => (
                                                <button
                                                    key={hex}
                                                    type="button"
                                                    onClick={() => handleUpdateEntryField("bg", hex)}
                                                    title={hex}
                                                    className="w-6 h-6 rounded border border-border cursor-pointer hover:scale-105 transition-transform"
                                                    style={{ backgroundColor: hex }}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {bgMode === "gradient" && (
                                    <div className="flex flex-col gap-2">
                                        <textarea
                                            rows={3}
                                            value={typeof selectedCustomEntry.bg === "string" ? selectedCustomEntry.bg : ""}
                                            onChange={(e) =>
                                                handleUpdateEntryField(
                                                    "bg",
                                                    e.target.value === "" ? undefined : e.target.value
                                                )
                                            }
                                            placeholder="linear-gradient(135deg, #0f172a 0%, #312e81 100%)"
                                            className="w-full px-2.5 py-2 rounded bg-panel border border-border text-xs font-mono text-primary focus:outline-none focus:border-accent resize-y"
                                        />
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                            <span className="text-[11px] text-muted-foreground mr-1">Quick gradients:</span>
                                            {QUICK_GRADIENTS.map((g) => (
                                                <button
                                                    key={g.label}
                                                    type="button"
                                                    onClick={() => handleUpdateEntryField("bg", g.value)}
                                                    className="text-[11px] px-2 py-0.5 rounded bg-secondary/60 hover:bg-secondary text-secondary hover:text-primary cursor-pointer transition-colors"
                                                >
                                                    {g.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {bgMode === "image" && (
                                    <div className="flex flex-col gap-1.5">
                                        <input
                                            type="text"
                                            value={imagePathDraft}
                                            onChange={(e) => {
                                                const nextRaw = e.target.value;
                                                setImagePathDraft(nextRaw);
                                                const result = buildValidatedImageBg(nextRaw);
                                                if (!result.valid) {
                                                    setImagePathError(result.error || "Invalid image path");
                                                } else {
                                                    setImagePathError(null);
                                                    handleUpdateEntryField("bg", result.css || undefined);
                                                }
                                            }}
                                            placeholder="/path/to/wallpaper.jpg, ~/bg.png, C:/Users/me/bg.png, or https://..."
                                            className="w-full px-2.5 py-1.5 rounded bg-panel border border-border text-sm font-mono text-primary focus:outline-none focus:border-accent"
                                        />
                                        <div className="text-[11px] text-muted-foreground">
                                            Validated via <code className="font-mono">processBackgroundUrls</code>. Use
                                            forward slashes (<code className="font-mono">/</code>) for Windows paths.
                                        </div>
                                        {imagePathError && <div className="text-xs text-error">{imagePathError}</div>}
                                    </div>
                                )}

                                {!currentBgCssValidation.valid && !imagePathError && (
                                    <div className="text-xs text-warning flex items-center gap-1.5">
                                        <i className="fa fa-solid fa-triangle-exclamation" />
                                        <span>{currentBgCssValidation.error}</span>
                                    </div>
                                )}
                            </div>

                            <SettingRow
                                label="Opacity"
                                configKey="bg:opacity"
                                description="Transparency of the background layer (0.0 to 1.0)."
                                modified={hasOwnKey(selectedCustomEntry, "bg:opacity")}
                                onReset={() => handleUpdateEntryField("bg:opacity", undefined)}
                            >
                                <div className="flex items-center gap-3">
                                    <input
                                        type="range"
                                        min={0}
                                        max={1}
                                        step={0.05}
                                        value={
                                            typeof selectedCustomEntry["bg:opacity"] === "number"
                                                ? clampOpacity(selectedCustomEntry["bg:opacity"])
                                                : 1
                                        }
                                        onChange={(e) =>
                                            handleUpdateEntryField("bg:opacity", clampOpacity(Number(e.target.value)))
                                        }
                                        className="w-36 accent-[var(--accent-color)] cursor-pointer"
                                    />
                                    <NumberControl
                                        value={
                                            typeof selectedCustomEntry["bg:opacity"] === "number"
                                                ? clampOpacity(selectedCustomEntry["bg:opacity"])
                                                : ""
                                        }
                                        min={0}
                                        max={1}
                                        step={0.05}
                                        placeholder="1.0"
                                        onChange={(val) =>
                                            handleUpdateEntryField(
                                                "bg:opacity",
                                                val === undefined ? undefined : clampOpacity(val)
                                            )
                                        }
                                        className="w-20"
                                    />
                                </div>
                            </SettingRow>

                            <SettingRow
                                label="Blend Mode"
                                configKey="bg:blendmode"
                                description="CSS background-blend-mode applied to multi-layer backgrounds."
                                modified={hasOwnKey(selectedCustomEntry, "bg:blendmode")}
                                onReset={() => handleUpdateEntryField("bg:blendmode", undefined)}
                            >
                                <SelectControl
                                    value={
                                        typeof selectedCustomEntry["bg:blendmode"] === "string"
                                            ? selectedCustomEntry["bg:blendmode"]
                                            : ""
                                    }
                                    options={BLEND_MODE_OPTIONS}
                                    onChange={(val) => handleUpdateEntryField("bg:blendmode", val || undefined)}
                                />
                            </SettingRow>

                            <SettingRow
                                label="Block Border Color"
                                configKey="bg:bordercolor"
                                description="Border color for unfocused terminal/widget blocks."
                                modified={hasOwnKey(selectedCustomEntry, "bg:bordercolor")}
                                onReset={() => handleUpdateEntryField("bg:bordercolor", undefined)}
                            >
                                <ColorFieldControl
                                    value={
                                        typeof selectedCustomEntry["bg:bordercolor"] === "string"
                                            ? selectedCustomEntry["bg:bordercolor"]
                                            : ""
                                    }
                                    onChange={(val) => handleUpdateEntryField("bg:bordercolor", val)}
                                    placeholder="e.g. rgba(255,255,255,0.2)"
                                />
                            </SettingRow>

                            <SettingRow
                                label="Active Block Border Color"
                                configKey="bg:activebordercolor"
                                description="Border color for the currently focused block."
                                modified={hasOwnKey(selectedCustomEntry, "bg:activebordercolor")}
                                onReset={() => handleUpdateEntryField("bg:activebordercolor", undefined)}
                            >
                                <ColorFieldControl
                                    value={
                                        typeof selectedCustomEntry["bg:activebordercolor"] === "string"
                                            ? selectedCustomEntry["bg:activebordercolor"]
                                            : ""
                                    }
                                    onChange={(val) => handleUpdateEntryField("bg:activebordercolor", val)}
                                    placeholder="e.g. #818cf8"
                                />
                            </SettingRow>

                            {extraUnknownKeys.length > 0 && (
                                <div className="px-4 py-3 text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                                    <i className="fa fa-solid fa-circle-info text-accent" />
                                    <span>Preserved additional keys (editable in Raw JSON):</span>
                                    {extraUnknownKeys.map((k) => (
                                        <code
                                            key={k}
                                            className="px-1.5 py-0.5 rounded bg-secondary/60 font-mono text-[11px] text-secondary"
                                        >
                                            {k}
                                        </code>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                ) : null}
            </div>
        </div>
    );
});

BackgroundsVisualContent.displayName = "BackgroundsVisualContent";
