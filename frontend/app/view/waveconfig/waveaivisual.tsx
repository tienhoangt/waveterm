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
    isEnvMacroValue,
    isUnsafeObjectKey,
    renameConfigKey,
    updateConfigKey,
    useVisualConfigJson,
} from "@/app/view/waveconfig/visual-config-utils";
import { SecretNameRegex, type WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { cn } from "@/util/util";
import { useAtomValue, useSetAtom } from "jotai";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

interface WaveAIVisualContentProps {
    model: WaveConfigViewModel;
}

const MODE_KEY_REGEX = /^[a-zA-Z0-9_@.-]+$/;
const AZURE_RESOURCE_NAME_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

type AuthMode = "none" | "secret" | "token";

interface ProviderTemplate {
    id: string;
    label: string;
    subtitle: string;
    keyPrefix: string;
    icon: string;
    defaultSecretHint?: string;
    config: Record<string, any>;
}

const PROVIDER_TEMPLATES: ProviderTemplate[] = [
    {
        id: "openai",
        label: "OpenAI",
        subtitle: "GPT-5 / GPT-4.1 / o3 (auto API type)",
        keyPrefix: "openai",
        icon: "sparkles",
        defaultSecretHint: "OPENAI_KEY",
        config: {
            "display:name": "OpenAI",
            "display:icon": "sparkles",
            "ai:provider": "openai",
            "ai:model": "gpt-4.1",
            "ai:capabilities": ["tools", "images", "pdfs"],
        },
    },
    {
        id: "google",
        label: "Google Gemini",
        subtitle: "Gemini 2.5 Pro / Flash",
        keyPrefix: "gemini",
        icon: "gem",
        defaultSecretHint: "GOOGLE_AI_KEY",
        config: {
            "display:name": "Google Gemini",
            "display:icon": "gem",
            "ai:provider": "google",
            "ai:apitype": "google-gemini",
            "ai:model": "gemini-2.5-flash",
            "ai:capabilities": ["tools", "images", "pdfs"],
        },
    },
    {
        id: "openrouter",
        label: "OpenRouter",
        subtitle: "Claude, GPT, Gemini & open models",
        keyPrefix: "openrouter",
        icon: "route",
        defaultSecretHint: "OPENROUTER_KEY",
        config: {
            "display:name": "OpenRouter",
            "display:icon": "route",
            "ai:provider": "openrouter",
            "ai:apitype": "openai-chat",
            "ai:model": "anthropic/claude-sonnet-4",
            "ai:capabilities": ["tools", "images"],
        },
    },
    {
        id: "groq",
        label: "Groq",
        subtitle: "Fast LPU inference (Llama, Qwen)",
        keyPrefix: "groq",
        icon: "bolt",
        defaultSecretHint: "GROQ_KEY",
        config: {
            "display:name": "Groq",
            "display:icon": "bolt",
            "ai:provider": "groq",
            "ai:apitype": "openai-chat",
            "ai:model": "llama-3.3-70b-versatile",
            "ai:capabilities": ["tools"],
        },
    },
    {
        id: "ollama",
        label: "Ollama (Local)",
        subtitle: "Local models — no API key required",
        keyPrefix: "ollama",
        icon: "microchip",
        config: {
            "display:name": "Ollama (Local)",
            "display:icon": "microchip",
            "ai:provider": "custom",
            "ai:apitype": "openai-chat",
            "ai:endpoint": "http://localhost:11434/v1/chat/completions",
            "ai:model": "qwen2.5-coder:7b",
            "ai:capabilities": ["tools"],
        },
    },
    {
        id: "deepseek",
        label: "DeepSeek / Custom",
        subtitle: "Any OpenAI-compatible API endpoint",
        keyPrefix: "deepseek",
        icon: "robot",
        config: {
            "display:name": "DeepSeek / Custom",
            "display:icon": "robot",
            "ai:provider": "custom",
            "ai:apitype": "openai-chat",
            "ai:endpoint": "https://api.deepseek.com/v1/chat/completions",
            "ai:model": "deepseek-chat",
            "ai:capabilities": ["tools"],
        },
    },
    {
        id: "azure",
        label: "Azure OpenAI",
        subtitle: "Azure AI Foundry / OpenAI v1",
        keyPrefix: "azure-openai",
        icon: "cloud",
        defaultSecretHint: "AZURE_OPENAI_KEY",
        config: {
            "display:name": "Azure OpenAI",
            "display:icon": "cloud",
            "ai:provider": "azure",
            "ai:model": "gpt-4.1",
            "ai:capabilities": ["tools", "images"],
        },
    },
];

const PROVIDER_DEFAULT_SECRET_HINTS: Record<string, string> = {
    openai: "OPENAI_KEY",
    google: "GOOGLE_AI_KEY",
    openrouter: "OPENROUTER_KEY",
    groq: "GROQ_KEY",
    azure: "AZURE_OPENAI_KEY",
    "azure-legacy": "AZURE_OPENAI_KEY",
    nanogpt: "NANOGPT_KEY",
};

const PROVIDER_OPTIONS: SelectOption[] = [
    { value: "", label: "Not set" },
    { value: "openai", label: "OpenAI" },
    { value: "google", label: "Google Gemini" },
    { value: "openrouter", label: "OpenRouter" },
    { value: "groq", label: "Groq" },
    { value: "azure", label: "Azure OpenAI (v1)" },
    { value: "azure-legacy", label: "Azure OpenAI (Legacy)" },
    { value: "custom", label: "Custom (OpenAI-Compatible / Local)" },
    { value: "nanogpt", label: "NanoGPT" },
    { value: "wave", label: "Wave Cloud" },
];

const API_TYPE_OPTIONS: SelectOption[] = [
    { value: "", label: "Auto (unset)" },
    { value: "google-gemini", label: "Google Gemini (google-gemini)" },
    { value: "openai-responses", label: "OpenAI Responses (openai-responses)" },
    { value: "openai-chat", label: "OpenAI Chat Completions (openai-chat)" },
];

const THINKING_LEVEL_OPTIONS: SelectOption[] = [
    { value: "", label: "Default (unset)" },
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
];

const VERBOSITY_OPTIONS: SelectOption[] = [
    { value: "", label: "Default (unset)" },
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
];

const PRESET_ICONS: string[] = [
    "sparkles",
    "robot",
    "microchip",
    "bolt",
    "gem",
    "cloud",
    "route",
    "brain",
    "code",
    "terminal",
    "fire",
    "wand-magic-sparkles",
];

const CAPABILITY_DEFS: { id: "tools" | "images" | "pdfs"; label: string; description: string }[] = [
    {
        id: "tools",
        label: "Tools (AI Agent)",
        description: "Allow the model to call tools, read files, and run commands.",
    },
    {
        id: "images",
        label: "Images",
        description: "Allow sending images and screenshots in prompts.",
    },
    {
        id: "pdfs",
        label: "PDFs",
        description: "Allow attaching PDF documents for analysis.",
    },
];

function makeUniqueModeKey(data: Record<string, any>, baseKey: string): string {
    const cleanBase = baseKey.replace(/[^a-zA-Z0-9_@.-]/g, "-") || "mode";
    if (!Object.hasOwn(data, cleanBase) && !isUnsafeObjectKey(cleanBase)) {
        return cleanBase;
    }
    let idx = 2;
    while (Object.hasOwn(data, `${cleanBase}-${idx}`)) {
        idx++;
    }
    return `${cleanBase}-${idx}`;
}

function getSafeModeObject(entry: unknown): Record<string, any> | null {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
    }
    return entry as Record<string, any>;
}

function deriveAuthMode(mode: Record<string, any> | null): AuthMode {
    if (!mode) return "none";
    if (typeof mode["ai:apitokensecretname"] === "string" && mode["ai:apitokensecretname"].trim() !== "") {
        return "secret";
    }
    if (typeof mode["ai:apitoken"] === "string" && mode["ai:apitoken"] !== "") {
        return "token";
    }
    return "none";
}

function isValidAzureResourceName(val: string): boolean {
    if (val === "") return true;
    return val.length <= 63 && AZURE_RESOURCE_NAME_REGEX.test(val);
}

function cloneSafeObject(obj: Record<string, any>): Record<string, any> {
    const next: Record<string, any> = {};
    for (const k of Object.keys(obj)) {
        if (!isUnsafeObjectKey(k)) {
            next[k] = obj[k];
        }
    }
    return next;
}

export const WaveAIVisualContent = memo(({ model }: WaveAIVisualContentProps) => {
    const { parsed, parseError, replaceData } = useVisualConfigJson(model);
    const setActiveTab = useSetAtom(model.activeTabAtom);
    const secretNames = useAtomValue(model.secretNamesAtom);
    const storageBackendError = useAtomValue(model.storageBackendErrorAtom);

    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [showTemplates, setShowTemplates] = useState(false);
    const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);

    // Per-mode explicit auth tab override so users can switch tabs before entering a value
    const [authModeOverride, setAuthModeOverride] = useState<{ key: string; mode: AuthMode } | null>(null);

    // Inline secret creation state (local only — never written to waveai.json)
    const [showNewSecretForm, setShowNewSecretForm] = useState(false);
    const [newSecretName, setNewSecretName] = useState("");
    const [newSecretValue, setNewSecretValue] = useState("");
    const [newSecretError, setNewSecretError] = useState<string | null>(null);
    const [isCreatingSecret, setIsCreatingSecret] = useState(false);

    useEffect(() => {
        void model.fetchSecretNamesQuietly();
    }, [model]);

    const modeKeys = useMemo(() => {
        if (!parsed) return [];
        const keys = Object.keys(parsed).filter((k) => !isUnsafeObjectKey(k));
        return keys.sort((a, b) => {
            const entryA = getSafeModeObject(parsed[a]);
            const entryB = getSafeModeObject(parsed[b]);
            const orderA = typeof entryA?.["display:order"] === "number" ? entryA["display:order"] : Number.MAX_SAFE_INTEGER;
            const orderB = typeof entryB?.["display:order"] === "number" ? entryB["display:order"] : Number.MAX_SAFE_INTEGER;
            if (orderA !== orderB) return orderA - orderB;
            return 0;
        });
    }, [parsed]);

    // Keep selectedKey valid when data changes
    useEffect(() => {
        if (!parsed) return;
        if (selectedKey && Object.hasOwn(parsed, selectedKey) && !isUnsafeObjectKey(selectedKey)) {
            return;
        }
        setSelectedKey(modeKeys[0] ?? null);
    }, [parsed, modeKeys, selectedKey]);

    // Reset transient inline forms when switching modes
    useEffect(() => {
        setConfirmDeleteKey(null);
        setShowNewSecretForm(false);
        setNewSecretName("");
        setNewSecretValue("");
        setNewSecretError(null);
    }, [selectedKey]);

    const selectedMode = useMemo(() => {
        if (!parsed || !selectedKey || !Object.hasOwn(parsed, selectedKey)) return null;
        return getSafeModeObject(parsed[selectedKey]);
    }, [parsed, selectedKey]);

    const activeAuthMode: AuthMode = useMemo(() => {
        if (selectedKey && authModeOverride?.key === selectedKey) {
            return authModeOverride.mode;
        }
        return deriveAuthMode(selectedMode);
    }, [selectedKey, authModeOverride, selectedMode]);

    const patchSelectedMode = useCallback(
        (
            mutator: (next: Record<string, any>) => void,
            opts?: { skipAutoSave?: boolean; saveImmediately?: boolean }
        ) => {
            if (!parsed || !selectedKey || !selectedMode || isUnsafeObjectKey(selectedKey)) {
                return;
            }
            const nextEntry = cloneSafeObject(selectedMode);
            mutator(nextEntry);
            const nextData = updateConfigKey(parsed, selectedKey, nextEntry);
            replaceData(nextData, { skipAutoSave: opts?.skipAutoSave });
            if (opts?.saveImmediately) {
                void model.saveFile();
            }
        },
        [parsed, selectedKey, selectedMode, replaceData, model]
    );

    const setModeField = useCallback(
        (field: string, value: any, opts?: { skipAutoSave?: boolean }) => {
            if (isUnsafeObjectKey(field)) return;
            patchSelectedMode(
                (next) => {
                    next[field] = value;
                },
                { skipAutoSave: opts?.skipAutoSave || field === "ai:apitoken" }
            );
        },
        [patchSelectedMode]
    );

    const deleteModeField = useCallback(
        (field: string, opts?: { skipAutoSave?: boolean }) => {
            if (isUnsafeObjectKey(field)) return;
            patchSelectedMode((next) => {
                delete next[field];
            }, opts);
        },
        [patchSelectedMode]
    );

    const handleAddFromTemplate = useCallback(
        (template: ProviderTemplate) => {
            if (!parsed) return;
            const newKey = makeUniqueModeKey(parsed, template.keyPrefix);
            const entryCopy: Record<string, any> = {};
            for (const [k, v] of Object.entries(template.config)) {
                entryCopy[k] = Array.isArray(v) ? [...v] : v;
            }
            const nextData = updateConfigKey(parsed, newKey, entryCopy);
            replaceData(nextData);
            setSelectedKey(newKey);
            setShowTemplates(false);
            setAuthModeOverride(null);
        },
        [parsed, replaceData]
    );

    const handleDuplicateMode = useCallback(() => {
        if (!parsed || !selectedKey || !selectedMode) return;
        const newKey = makeUniqueModeKey(parsed, `${selectedKey}-copy`);
        const cloned = JSON.parse(JSON.stringify(selectedMode));
        if (typeof cloned["display:name"] === "string" && cloned["display:name"].trim() !== "") {
            cloned["display:name"] = `${cloned["display:name"]} (Copy)`;
        }
        const nextData = updateConfigKey(parsed, newKey, cloned);
        replaceData(nextData);
        setSelectedKey(newKey);
        setAuthModeOverride(null);
    }, [parsed, selectedKey, selectedMode, replaceData]);

    const handleDeleteMode = useCallback(
        (keyToDelete: string) => {
            if (!parsed || !Object.hasOwn(parsed, keyToDelete)) return;
            const nextData = deleteConfigKey(parsed, keyToDelete);
            replaceData(nextData);
            setConfirmDeleteKey(null);
            if (selectedKey === keyToDelete) {
                const remaining = Object.keys(nextData).filter((k) => !isUnsafeObjectKey(k));
                setSelectedKey(remaining[0] ?? null);
            }
        },
        [parsed, replaceData, selectedKey]
    );

    const handleRenameMode = useCallback(
        (nextKey: string) => {
            if (!parsed || !selectedKey) return;
            if (isUnsafeObjectKey(nextKey) || Object.hasOwn(parsed, nextKey)) return;
            const nextData = renameConfigKey(parsed, selectedKey, nextKey);
            replaceData(nextData);
            setSelectedKey(nextKey);
            if (authModeOverride?.key === selectedKey) {
                setAuthModeOverride({ key: nextKey, mode: authModeOverride.mode });
            }
        },
        [parsed, selectedKey, replaceData, authModeOverride]
    );

    const handleSwitchAuthMode = useCallback(
        (nextMode: AuthMode) => {
            if (!selectedKey || !selectedMode) return;
            const hadPlaintextToken =
                typeof selectedMode["ai:apitoken"] === "string" && selectedMode["ai:apitoken"] !== "";

            setAuthModeOverride({ key: selectedKey, mode: nextMode });
            setShowNewSecretForm(false);
            setNewSecretValue("");
            setNewSecretError(null);

            if (nextMode === "none") {
                patchSelectedMode(
                    (next) => {
                        delete next["ai:apitoken"];
                        delete next["ai:apitokensecretname"];
                    },
                    { skipAutoSave: hadPlaintextToken, saveImmediately: hadPlaintextToken }
                );
            } else if (nextMode === "secret") {
                if (hadPlaintextToken) {
                    patchSelectedMode(
                        (next) => {
                            delete next["ai:apitoken"];
                        },
                        { skipAutoSave: true, saveImmediately: true }
                    );
                }
            } else if (nextMode === "token") {
                patchSelectedMode(
                    (next) => {
                        delete next["ai:apitokensecretname"];
                    },
                    { skipAutoSave: true }
                );
            }
        },
        [selectedKey, selectedMode, patchSelectedMode]
    );

    const handleSelectSecret = useCallback(
        (secretName: string) => {
            if (!selectedMode) return;
            const hadPlaintextToken =
                typeof selectedMode["ai:apitoken"] === "string" && selectedMode["ai:apitoken"] !== "";

            patchSelectedMode(
                (next) => {
                    delete next["ai:apitoken"];
                    if (secretName) {
                        next["ai:apitokensecretname"] = secretName;
                    } else {
                        delete next["ai:apitokensecretname"];
                    }
                },
                { skipAutoSave: hadPlaintextToken, saveImmediately: hadPlaintextToken }
            );
        },
        [selectedMode, patchSelectedMode]
    );

    const handleOpenNewSecretForm = useCallback(() => {
        const provider = typeof selectedMode?.["ai:provider"] === "string" ? selectedMode["ai:provider"] : "";
        const suggested = PROVIDER_DEFAULT_SECRET_HINTS[provider] || "";
        setNewSecretName(suggested && !secretNames.includes(suggested) ? suggested : "");
        setNewSecretValue("");
        setNewSecretError(null);
        setShowNewSecretForm(true);
    }, [selectedMode, secretNames]);

    const handleCreateSecretInline = useCallback(async () => {
        const trimmedName = newSecretName.trim();
        if (!trimmedName) {
            setNewSecretError("Secret name cannot be empty.");
            return;
        }
        if (!SecretNameRegex.test(trimmedName)) {
            setNewSecretError(
                "Invalid secret name: must start with a letter and contain only letters, numbers, and underscores."
            );
            return;
        }
        if (!newSecretValue) {
            setNewSecretError("Secret value cannot be empty.");
            return;
        }

        setIsCreatingSecret(true);
        setNewSecretError(null);
        const valueToSave = newSecretValue;
        try {
            const res = await model.createSecretInline(trimmedName, valueToSave);
            if ("error" in res) {
                setNewSecretError(res.error);
                return;
            }
            const hadPlaintextToken =
                typeof selectedMode?.["ai:apitoken"] === "string" && selectedMode["ai:apitoken"] !== "";

            patchSelectedMode(
                (next) => {
                    delete next["ai:apitoken"];
                    next["ai:apitokensecretname"] = trimmedName;
                },
                { skipAutoSave: hadPlaintextToken, saveImmediately: hadPlaintextToken }
            );
            setShowNewSecretForm(false);
            setNewSecretName("");
            setNewSecretError(null);
        } finally {
            setNewSecretValue("");
            setIsCreatingSecret(false);
        }
    }, [newSecretName, newSecretValue, model, selectedMode, patchSelectedMode]);

    const currentSecretName =
        typeof selectedMode?.["ai:apitokensecretname"] === "string" ? selectedMode["ai:apitokensecretname"] : "";

    const secretSelectOptions: SelectOption[] = useMemo(() => {
        const opts: SelectOption[] = [{ value: "", label: "-- Select a Wave Secret --" }];
        const seen = new Set<string>();
        for (const name of secretNames) {
            seen.add(name);
            opts.push({ value: name, label: name });
        }
        if (currentSecretName && !seen.has(currentSecretName)) {
            opts.push({ value: currentSecretName, label: `${currentSecretName} (not found in secrets)` });
        }
        return opts;
    }, [secretNames, currentSecretName]);

    if (parseError || !parsed) {
        return (
            <InvalidJsonBanner
                error={parseError || "Invalid JSON"}
                onOpenRawJson={() => setActiveTab("json")}
            />
        );
    }

    const provider = typeof selectedMode?.["ai:provider"] === "string" ? selectedMode["ai:provider"] : "";
    const apiType = typeof selectedMode?.["ai:apitype"] === "string" ? selectedMode["ai:apitype"] : "";
    const isAzure = provider === "azure" || provider === "azure-legacy";
    const isAzureLegacy = provider === "azure-legacy";
    const azureResourceName =
        typeof selectedMode?.["ai:azureresourcename"] === "string" ? selectedMode["ai:azureresourcename"] : "";
    const azureResourceNameValid = isValidAzureResourceName(azureResourceName);
    const displayName = typeof selectedMode?.["display:name"] === "string" ? selectedMode["display:name"] : "";
    const displayNameMissing = selectedMode != null && displayName.trim() === "";
    const defaultSecretHint = PROVIDER_DEFAULT_SECRET_HINTS[provider];

    const capabilities: string[] = Array.isArray(selectedMode?.["ai:capabilities"])
        ? selectedMode["ai:capabilities"]
        : [];
    const thinkingLevel =
        typeof selectedMode?.["ai:thinkinglevel"] === "string" ? selectedMode["ai:thinkinglevel"] : "";
    const verbosity = typeof selectedMode?.["ai:verbosity"] === "string" ? selectedMode["ai:verbosity"] : "";
    const showVerbosity = apiType === "openai-responses" || verbosity !== "";

    const currentApiToken = typeof selectedMode?.["ai:apitoken"] === "string" ? selectedMode["ai:apitoken"] : "";

    return (
        <div className="flex h-full w-full overflow-hidden">
            {/* Left Column: Configured AI Modes + Quick-Start Templates */}
            <div className="w-72 shrink-0 border-r border-border flex flex-col bg-panel/40 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2.5 border-b border-border shrink-0">
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-secondary">
                            AI Modes
                        </span>
                        <span className="text-[11px] px-1.5 py-0.5 rounded bg-secondary/60 text-muted-foreground font-mono">
                            {modeKeys.length}
                        </span>
                    </div>
                    <button
                        type="button"
                        onClick={() => setShowTemplates((v) => !v)}
                        className={cn(
                            "px-2.5 py-1 rounded text-xs font-medium flex items-center gap-1.5 cursor-pointer transition-colors",
                            showTemplates
                                ? "bg-secondary text-primary"
                                : "bg-accent/80 hover:bg-accent text-primary"
                        )}
                    >
                        <i className={`fa fa-solid ${showTemplates ? "fa-xmark" : "fa-plus"}`} />
                        <span>{showTemplates ? "Close" : "Add AI Mode"}</span>
                    </button>
                </div>

                {showTemplates && (
                    <div className="border-b border-border bg-secondary/20 p-2.5 flex flex-col gap-1.5 overflow-y-auto max-h-[60%] shrink-0">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-1">
                            Quick-Start Templates
                        </div>
                        {PROVIDER_TEMPLATES.map((tpl) => (
                            <button
                                key={tpl.id}
                                type="button"
                                onClick={() => handleAddFromTemplate(tpl)}
                                className="flex items-start gap-2.5 p-2 rounded border border-border/60 bg-panel hover:border-accent/70 hover:bg-secondary/40 text-left cursor-pointer transition-colors"
                            >
                                <i className={`fa fa-solid fa-${tpl.icon} text-accent mt-0.5 w-4 text-center shrink-0`} />
                                <div className="min-w-0 flex-1">
                                    <div className="text-xs font-medium text-primary truncate">{tpl.label}</div>
                                    <div className="text-[11px] text-muted-foreground truncate">{tpl.subtitle}</div>
                                </div>
                            </button>
                        ))}
                    </div>
                )}

                <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
                    {modeKeys.length === 0 ? (
                        <div className="p-4 text-center text-xs text-muted-foreground">
                            No custom AI modes yet. Click <strong>Add AI Mode</strong> to start from a provider template.
                        </div>
                    ) : (
                        modeKeys.map((key) => {
                            const entry = getSafeModeObject(parsed[key]);
                            const name =
                                typeof entry?.["display:name"] === "string" && entry["display:name"].trim() !== ""
                                    ? entry["display:name"]
                                    : key;
                            const missingName =
                                !entry || typeof entry["display:name"] !== "string" || entry["display:name"].trim() === "";
                            const icon =
                                typeof entry?.["display:icon"] === "string" && entry["display:icon"].trim() !== ""
                                    ? entry["display:icon"].trim()
                                    : "sparkles";
                            const prov = typeof entry?.["ai:provider"] === "string" ? entry["ai:provider"] : "";
                            const mdl = typeof entry?.["ai:model"] === "string" ? entry["ai:model"] : "";
                            const caps: string[] = Array.isArray(entry?.["ai:capabilities"])
                                ? entry["ai:capabilities"]
                                : [];
                            const isSelected = key === selectedKey;

                            return (
                                <button
                                    key={key}
                                    type="button"
                                    onClick={() => {
                                        setSelectedKey(key);
                                        setShowTemplates(false);
                                    }}
                                    className={cn(
                                        "w-full text-left px-2.5 py-2 rounded border transition-colors cursor-pointer flex flex-col gap-1",
                                        isSelected
                                            ? "bg-accent/15 border-accent/60 text-primary"
                                            : "bg-transparent border-transparent hover:bg-secondary/40 text-secondary hover:text-primary"
                                    )}
                                >
                                    <div className="flex items-center gap-2 min-w-0">
                                        <i className={`fa fa-solid fa-${icon} text-xs text-accent w-4 text-center shrink-0`} />
                                        <span className="text-sm font-medium truncate flex-1">{name}</span>
                                        {missingName && (
                                            <i
                                                className="fa fa-solid fa-triangle-exclamation text-warning text-xs shrink-0"
                                                title='Missing required "display:name"'
                                            />
                                        )}
                                    </div>
                                    <div className="flex items-center gap-1.5 flex-wrap pl-6">
                                        {prov && (
                                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary/70 text-secondary font-medium uppercase">
                                                {prov}
                                            </span>
                                        )}
                                        {mdl && (
                                            <span className="text-[11px] text-muted-foreground font-mono truncate max-w-[140px]">
                                                {mdl}
                                            </span>
                                        )}
                                    </div>
                                    {caps.length > 0 && (
                                        <div className="flex items-center gap-1 flex-wrap pl-6">
                                            {caps.map((cap) => (
                                                <span
                                                    key={cap}
                                                    className="text-[10px] px-1.5 py-0.2 rounded bg-accent/15 text-accent font-mono"
                                                >
                                                    {cap}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </button>
                            );
                        })
                    )}
                </div>
            </div>

            {/* Right Column: Structured AI Mode Editor */}
            <div className="flex-1 overflow-y-auto">
                {!selectedKey || !selectedMode ? (
                    <div className="h-full flex flex-col items-center justify-center p-8 text-center gap-4">
                        <i className="fa fa-solid fa-robot text-4xl text-muted-foreground/50" />
                        <div className="max-w-md flex flex-col gap-1">
                            <h3 className="text-base font-semibold text-primary">Configure Wave AI Modes</h3>
                            <p className="text-xs text-muted-foreground">
                                Add your own API keys (BYOK) or connect local models like Ollama. Choose a quick-start
                                template below to create your first AI mode.
                            </p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-w-2xl w-full mt-2">
                            {PROVIDER_TEMPLATES.map((tpl) => (
                                <button
                                    key={tpl.id}
                                    type="button"
                                    onClick={() => handleAddFromTemplate(tpl)}
                                    className="flex items-start gap-2.5 p-3 rounded border border-border bg-panel hover:border-accent/70 hover:bg-secondary/40 text-left cursor-pointer transition-colors"
                                >
                                    <i className={`fa fa-solid fa-${tpl.icon} text-accent mt-0.5 w-4 text-center shrink-0`} />
                                    <div className="min-w-0 flex-1">
                                        <div className="text-xs font-semibold text-primary truncate">{tpl.label}</div>
                                        <div className="text-[11px] text-muted-foreground">{tpl.subtitle}</div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="max-w-3xl mx-auto pb-10">
                        {/* Mode Header & Actions */}
                        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border sticky top-0 bg-panel/95 backdrop-blur z-10">
                            <div className="flex items-center gap-2.5 min-w-0">
                                <i
                                    className={`fa fa-solid fa-${
                                        typeof selectedMode["display:icon"] === "string" &&
                                        selectedMode["display:icon"].trim() !== ""
                                            ? selectedMode["display:icon"].trim()
                                            : "sparkles"
                                    } text-accent text-base shrink-0`}
                                />
                                <div className="min-w-0">
                                    <div className="text-sm font-semibold text-primary truncate">
                                        {displayName.trim() || selectedKey}
                                    </div>
                                    <div className="text-[11px] font-mono text-muted-foreground truncate">
                                        {selectedKey}
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                <button
                                    type="button"
                                    onClick={handleDuplicateMode}
                                    className="px-2.5 py-1.5 rounded border border-border text-xs text-secondary hover:text-primary hover:bg-secondary/50 cursor-pointer flex items-center gap-1.5"
                                >
                                    <i className="fa fa-solid fa-copy" />
                                    <span>Duplicate</span>
                                </button>
                                {confirmDeleteKey === selectedKey ? (
                                    <div className="flex items-center gap-1.5">
                                        <button
                                            type="button"
                                            onClick={() => handleDeleteMode(selectedKey)}
                                            className="px-2.5 py-1.5 rounded bg-error/80 hover:bg-error text-white text-xs font-medium cursor-pointer"
                                        >
                                            Confirm Delete
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setConfirmDeleteKey(null)}
                                            className="px-2 py-1.5 rounded border border-border text-xs text-secondary hover:text-primary cursor-pointer"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => setConfirmDeleteKey(selectedKey)}
                                        className="px-2.5 py-1.5 rounded border border-border text-xs text-error hover:bg-error/10 cursor-pointer flex items-center gap-1.5"
                                    >
                                        <i className="fa fa-solid fa-trash" />
                                        <span>Delete</span>
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Section 1: Identity & Display */}
                        <div className="px-4 pt-4 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Identity &amp; Display
                        </div>

                        <SettingRow
                            label="Mode Key"
                            description="Unique identifier in waveai.json (letters, numbers, _, @, ., -)."
                        >
                            <DeferredKeyRenameControl
                                currentKey={selectedKey}
                                existingKeys={modeKeys}
                                pattern={MODE_KEY_REGEX}
                                patternError="Only letters, numbers, underscores, @, dots, and hyphens are allowed"
                                onRename={handleRenameMode}
                            />
                        </SettingRow>

                        <SettingRow
                            label="Display Name"
                            configKey="display:name"
                            description="Required name shown in the Wave AI mode selector."
                        >
                            <div className="flex flex-col items-end gap-1">
                                <TextControl
                                    value={displayName}
                                    onChange={(val) => setModeField("display:name", val)}
                                    placeholder="e.g. OpenAI GPT-4.1"
                                    className={displayNameMissing ? "border-error" : undefined}
                                />
                                {displayNameMissing && (
                                    <span className="text-xs text-error">Display name is required</span>
                                )}
                            </div>
                        </SettingRow>

                        <SettingRow
                            label="Description"
                            configKey="display:description"
                            description="Optional short description shown in the mode picker."
                            modified={Object.hasOwn(selectedMode, "display:description")}
                            onReset={() => deleteModeField("display:description")}
                        >
                            <TextControl
                                value={
                                    typeof selectedMode["display:description"] === "string"
                                        ? selectedMode["display:description"]
                                        : ""
                                }
                                onChange={(val) =>
                                    val === ""
                                        ? deleteModeField("display:description")
                                        : setModeField("display:description", val)
                                }
                                placeholder="Optional description"
                            />
                        </SettingRow>

                        <SettingRow
                            label="Icon"
                            configKey="display:icon"
                            description="FontAwesome icon name (e.g. sparkles, robot, microchip)."
                            modified={Object.hasOwn(selectedMode, "display:icon")}
                            onReset={() => deleteModeField("display:icon")}
                        >
                            <div className="flex flex-col items-end gap-1.5">
                                <TextControl
                                    value={
                                        typeof selectedMode["display:icon"] === "string"
                                            ? selectedMode["display:icon"]
                                            : ""
                                    }
                                    onChange={(val) =>
                                        val.trim() === ""
                                            ? deleteModeField("display:icon")
                                            : setModeField("display:icon", val.trim())
                                    }
                                    placeholder="sparkles"
                                />
                                <div className="flex flex-wrap justify-end gap-1 max-w-xs">
                                    {PRESET_ICONS.map((iconName) => {
                                        const active = selectedMode["display:icon"] === iconName;
                                        return (
                                            <button
                                                key={iconName}
                                                type="button"
                                                title={iconName}
                                                onClick={() => setModeField("display:icon", iconName)}
                                                className={cn(
                                                    "w-7 h-7 rounded flex items-center justify-center text-xs cursor-pointer border transition-colors",
                                                    active
                                                        ? "bg-accent/20 border-accent text-accent"
                                                        : "bg-secondary/40 border-border/50 text-secondary hover:text-primary hover:bg-secondary"
                                                )}
                                            >
                                                <i className={`fa fa-solid fa-${iconName}`} />
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </SettingRow>

                        <SettingRow
                            label="Display Order"
                            configKey="display:order"
                            description="Optional sort order (lower numbers appear first)."
                            modified={Object.hasOwn(selectedMode, "display:order")}
                            onReset={() => deleteModeField("display:order")}
                        >
                            <NumberControl
                                value={
                                    typeof selectedMode["display:order"] === "number"
                                        ? selectedMode["display:order"]
                                        : ""
                                }
                                onChange={(val) =>
                                    val === undefined
                                        ? deleteModeField("display:order")
                                        : setModeField("display:order", val)
                                }
                                step={1}
                                placeholder="Auto"
                            />
                        </SettingRow>

                        {/* Section 2: Model & Endpoint */}
                        <div className="px-4 pt-5 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Model &amp; Endpoint
                        </div>

                        <SettingRow
                            label="Provider"
                            configKey="ai:provider"
                            description="AI provider backend used to route requests."
                            modified={Object.hasOwn(selectedMode, "ai:provider")}
                            onReset={() => deleteModeField("ai:provider")}
                        >
                            <SelectControl
                                value={provider}
                                options={PROVIDER_OPTIONS}
                                onChange={(val) =>
                                    val === ""
                                        ? deleteModeField("ai:provider")
                                        : setModeField("ai:provider", val)
                                }
                            />
                        </SettingRow>

                        <SettingRow
                            label="API Type"
                            configKey="ai:apitype"
                            description="Leave as Auto (unset) for OpenAI and Azure v1 so Wave auto-selects by model."
                            modified={Object.hasOwn(selectedMode, "ai:apitype")}
                            onReset={() => deleteModeField("ai:apitype")}
                        >
                            <SelectControl
                                value={apiType}
                                options={API_TYPE_OPTIONS}
                                onChange={(val) =>
                                    val === ""
                                        ? deleteModeField("ai:apitype")
                                        : setModeField("ai:apitype", val)
                                }
                            />
                        </SettingRow>

                        <SettingRow
                            label="Model"
                            configKey="ai:model"
                            description="Model identifier sent to the provider (for Azure v1, use your deployment/model name)."
                            modified={Object.hasOwn(selectedMode, "ai:model")}
                            onReset={() => deleteModeField("ai:model")}
                        >
                            <TextControl
                                value={typeof selectedMode["ai:model"] === "string" ? selectedMode["ai:model"] : ""}
                                onChange={(val) =>
                                    val === "" ? deleteModeField("ai:model") : setModeField("ai:model", val)
                                }
                                placeholder={
                                    provider === "google"
                                        ? "gemini-2.5-flash"
                                        : provider === "openrouter"
                                          ? "anthropic/claude-sonnet-4"
                                          : provider === "groq"
                                            ? "llama-3.3-70b-versatile"
                                            : "gpt-4.1"
                                }
                            />
                        </SettingRow>

                        <SettingRow
                            label="Endpoint URL"
                            configKey="ai:endpoint"
                            description={
                                provider === "custom"
                                    ? "Required for Custom/Local providers (e.g. http://localhost:11434/v1/chat/completions)."
                                    : "Optional custom API endpoint override."
                            }
                            modified={Object.hasOwn(selectedMode, "ai:endpoint")}
                            onReset={() => deleteModeField("ai:endpoint")}
                        >
                            <TextControl
                                value={
                                    typeof selectedMode["ai:endpoint"] === "string"
                                        ? selectedMode["ai:endpoint"]
                                        : ""
                                }
                                onChange={(val) =>
                                    val === "" ? deleteModeField("ai:endpoint") : setModeField("ai:endpoint", val)
                                }
                                placeholder="http://localhost:11434/v1/chat/completions"
                                className={
                                    provider === "custom" && !selectedMode["ai:endpoint"]
                                        ? "border-accent/70"
                                        : undefined
                                }
                            />
                        </SettingRow>

                        <SettingRow
                            label="Proxy URL"
                            configKey="ai:proxyurl"
                            description="Optional HTTP/SOCKS proxy URL for outbound API requests."
                            modified={Object.hasOwn(selectedMode, "ai:proxyurl")}
                            onReset={() => deleteModeField("ai:proxyurl")}
                        >
                            <TextControl
                                value={
                                    typeof selectedMode["ai:proxyurl"] === "string"
                                        ? selectedMode["ai:proxyurl"]
                                        : ""
                                }
                                onChange={(val) =>
                                    val === "" ? deleteModeField("ai:proxyurl") : setModeField("ai:proxyurl", val)
                                }
                                placeholder="http://127.0.0.1:7890"
                            />
                        </SettingRow>

                        {/* Section 3: Conditional Azure Section */}
                        {isAzure && (
                            <>
                                <div className="px-4 pt-5 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    Azure OpenAI Settings
                                </div>

                                <SettingRow
                                    label="Azure Resource Name"
                                    configKey="ai:azureresourcename"
                                    description="Your Azure OpenAI resource name (lowercase letters, digits, hyphens; max 63 chars)."
                                    modified={Object.hasOwn(selectedMode, "ai:azureresourcename")}
                                    onReset={() => deleteModeField("ai:azureresourcename")}
                                >
                                    <div className="flex flex-col items-end gap-1">
                                        <TextControl
                                            value={azureResourceName}
                                            onChange={(val) =>
                                                val === ""
                                                    ? deleteModeField("ai:azureresourcename")
                                                    : setModeField("ai:azureresourcename", val)
                                            }
                                            placeholder="my-azure-openai-resource"
                                            className={!azureResourceNameValid ? "border-warning" : undefined}
                                        />
                                        {!azureResourceNameValid && (
                                            <span className="text-xs text-warning max-w-xs text-right">
                                                Must be 1–63 chars of lowercase letters, digits, or hyphens (cannot start
                                                or end with a hyphen).
                                            </span>
                                        )}
                                    </div>
                                </SettingRow>

                                {isAzureLegacy && (
                                    <SettingRow
                                        label="Azure Deployment"
                                        configKey="ai:azuredeployment"
                                        description="Deployment name (used only by azure-legacy; Azure v1 uses ai:model)."
                                        modified={Object.hasOwn(selectedMode, "ai:azuredeployment")}
                                        onReset={() => deleteModeField("ai:azuredeployment")}
                                    >
                                        <TextControl
                                            value={
                                                typeof selectedMode["ai:azuredeployment"] === "string"
                                                    ? selectedMode["ai:azuredeployment"]
                                                    : ""
                                            }
                                            onChange={(val) =>
                                                val === ""
                                                    ? deleteModeField("ai:azuredeployment")
                                                    : setModeField("ai:azuredeployment", val)
                                            }
                                            placeholder="my-deployment"
                                        />
                                    </SettingRow>
                                )}

                                <SettingRow
                                    label="Azure API Version"
                                    configKey="ai:azureapiversion"
                                    description="Optional Azure OpenAI API version string."
                                    modified={Object.hasOwn(selectedMode, "ai:azureapiversion")}
                                    onReset={() => deleteModeField("ai:azureapiversion")}
                                >
                                    <TextControl
                                        value={
                                            typeof selectedMode["ai:azureapiversion"] === "string"
                                                ? selectedMode["ai:azureapiversion"]
                                                : ""
                                        }
                                        onChange={(val) =>
                                            val === ""
                                                ? deleteModeField("ai:azureapiversion")
                                                : setModeField("ai:azureapiversion", val)
                                        }
                                        placeholder="2025-04-01-preview"
                                    />
                                </SettingRow>
                            </>
                        )}

                        {/* Section 4: Authentication (3-mode, Secrets-first) */}
                        <div className="px-4 pt-5 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            API Key / Authentication
                        </div>

                        <div className="px-4 py-3 border-b border-border/60 flex flex-col gap-3">
                            {/* 3-mode segmented selector */}
                            <div className="flex flex-wrap gap-1.5">
                                {(
                                    [
                                        { id: "none", label: "None (Local / Default)" },
                                        { id: "secret", label: "Use Wave Secret (Recommended)" },
                                        { id: "token", label: "Direct Token / $ENV:" },
                                    ] as { id: AuthMode; label: string }[]
                                ).map((opt) => (
                                    <button
                                        key={opt.id}
                                        type="button"
                                        onClick={() => handleSwitchAuthMode(opt.id)}
                                        className={cn(
                                            "px-3 py-1.5 rounded text-xs font-medium border cursor-pointer transition-colors",
                                            activeAuthMode === opt.id
                                                ? "bg-accent/20 border-accent text-primary"
                                                : "bg-panel border-border text-secondary hover:text-primary hover:bg-secondary/40"
                                        )}
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                            </div>

                            {activeAuthMode === "none" && (
                                <div className="text-xs text-muted-foreground bg-secondary/25 border border-border/60 rounded p-3 flex items-start gap-2">
                                    <i className="fa fa-solid fa-circle-info text-accent mt-0.5 shrink-0" />
                                    <div>
                                        {defaultSecretHint ? (
                                            <>
                                                No explicit key is stored in <code className="font-mono">waveai.json</code>.
                                                Wave will automatically check the default Wave Secret{" "}
                                                <code className="font-mono text-primary px-1 py-0.5 rounded bg-secondary/70">
                                                    {defaultSecretHint}
                                                </code>{" "}
                                                for this provider.
                                            </>
                                        ) : (
                                            <>
                                                No API key will be sent. Ideal for local servers like Ollama or LM Studio.
                                            </>
                                        )}
                                    </div>
                                </div>
                            )}

                            {activeAuthMode === "secret" && (
                                <div className="flex flex-col gap-2.5">
                                    {storageBackendError && (
                                        <div className="flex items-start gap-2 p-2.5 rounded border border-warning/40 bg-warning/10 text-warning text-xs">
                                            <i className="fa fa-solid fa-triangle-exclamation mt-0.5 shrink-0" />
                                            <span>{storageBackendError}</span>
                                        </div>
                                    )}

                                    <div className="flex flex-wrap items-center gap-2">
                                        <SelectControl
                                            value={currentSecretName}
                                            options={secretSelectOptions}
                                            onChange={handleSelectSecret}
                                            className="min-w-[240px]"
                                        />
                                        <button
                                            type="button"
                                            onClick={handleOpenNewSecretForm}
                                            disabled={!!storageBackendError}
                                            className={cn(
                                                "px-2.5 py-1.5 rounded border border-border text-xs font-medium flex items-center gap-1.5 cursor-pointer transition-colors",
                                                storageBackendError
                                                    ? "opacity-50 cursor-not-allowed text-muted-foreground"
                                                    : "bg-secondary/50 hover:bg-secondary text-primary"
                                            )}
                                        >
                                            <i className="fa fa-solid fa-plus" />
                                            <span>New Secret</span>
                                        </button>
                                        {defaultSecretHint && !currentSecretName && (
                                            <span className="text-[11px] text-muted-foreground">
                                                Default: <code className="font-mono">{defaultSecretHint}</code>
                                            </span>
                                        )}
                                    </div>

                                    {showNewSecretForm && (
                                        <div className="p-3 rounded border border-border bg-secondary/20 flex flex-col gap-2.5">
                                            <div className="text-xs font-medium text-primary">
                                                Create New Wave Secret
                                            </div>
                                            <div className="flex flex-col sm:flex-row gap-2">
                                                <input
                                                    type="text"
                                                    value={newSecretName}
                                                    onChange={(e) => {
                                                        setNewSecretName(e.target.value);
                                                        setNewSecretError(null);
                                                    }}
                                                    placeholder="SECRET_NAME (e.g. OPENAI_KEY)"
                                                    className="px-2.5 py-1.5 rounded bg-panel border border-border text-xs font-mono text-primary focus:outline-none focus:border-accent sm:w-52"
                                                />
                                                <input
                                                    type="password"
                                                    value={newSecretValue}
                                                    onChange={(e) => {
                                                        setNewSecretValue(e.target.value);
                                                        setNewSecretError(null);
                                                    }}
                                                    onKeyDown={(e) => {
                                                        if (
                                                            e.key === "Enter" &&
                                                            !e.nativeEvent?.isComposing &&
                                                            e.keyCode !== 229
                                                        ) {
                                                            e.preventDefault();
                                                            void handleCreateSecretInline();
                                                        }
                                                    }}
                                                    placeholder="Paste API key value..."
                                                    autoComplete="off"
                                                    className="flex-1 px-2.5 py-1.5 rounded bg-panel border border-border text-xs font-mono text-primary focus:outline-none focus:border-accent"
                                                />
                                            </div>
                                            {newSecretError && (
                                                <div className="text-xs text-error">{newSecretError}</div>
                                            )}
                                            <div className="flex items-center gap-2">
                                                <button
                                                    type="button"
                                                    disabled={isCreatingSecret}
                                                    onClick={() => void handleCreateSecretInline()}
                                                    className="px-3 py-1.5 rounded bg-accent/80 hover:bg-accent text-primary text-xs font-medium cursor-pointer disabled:opacity-50"
                                                >
                                                    {isCreatingSecret ? "Saving..." : "Save Secret & Bind"}
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={isCreatingSecret}
                                                    onClick={() => {
                                                        setShowNewSecretForm(false);
                                                        setNewSecretName("");
                                                        setNewSecretValue("");
                                                        setNewSecretError(null);
                                                    }}
                                                    className="px-2.5 py-1.5 rounded border border-border text-xs text-secondary hover:text-primary cursor-pointer"
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {activeAuthMode === "token" && (
                                <div className="flex flex-col gap-2">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <TextControl
                                            value={currentApiToken}
                                            sensitive={!isEnvMacroValue(currentApiToken)}
                                            placeholder="sk-... or $ENV:MY_API_KEY"
                                            onChange={(val) =>
                                                val === ""
                                                    ? deleteModeField("ai:apitoken", { skipAutoSave: true })
                                                    : setModeField("ai:apitoken", val, { skipAutoSave: true })
                                            }
                                            className="w-72 font-mono"
                                        />
                                        {isEnvMacroValue(currentApiToken) && (
                                            <span className="text-[11px] px-2 py-0.5 rounded bg-accent/20 text-accent font-mono font-medium">
                                                Env Var
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-start gap-2 p-2.5 rounded border border-warning/40 bg-warning/10 text-warning text-xs">
                                        <i className="fa fa-solid fa-triangle-exclamation mt-0.5 shrink-0" />
                                        <span>
                                            Raw tokens are stored in plaintext in{" "}
                                            <code className="font-mono">waveai.json</code> and are never auto-saved
                                            (click <strong>Save</strong> explicitly). Prefer{" "}
                                            <strong>Use Wave Secret</strong> or an{" "}
                                            <code className="font-mono">$ENV:VAR_NAME</code> reference instead.
                                        </span>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Section 5: Agent Capabilities & Reasoning */}
                        <div className="px-4 pt-5 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Agent Capabilities &amp; Reasoning
                        </div>

                        <div className="px-4 py-3 border-b border-border/60 flex flex-col gap-2">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-primary">Capabilities</span>
                                <code className="text-[11px] px-1.5 py-0.5 rounded bg-secondary/60 text-muted-foreground font-mono">
                                    ai:capabilities
                                </code>
                            </div>
                            <div className="flex flex-col gap-2 mt-1">
                                {CAPABILITY_DEFS.map((cap) => {
                                    const checked = capabilities.includes(cap.id);
                                    return (
                                        <label
                                            key={cap.id}
                                            className="flex items-start gap-2.5 cursor-pointer select-none"
                                        >
                                            <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={(e) => {
                                                    const nextCaps = e.target.checked
                                                        ? Array.from(new Set([...capabilities, cap.id]))
                                                        : capabilities.filter((c) => c !== cap.id);
                                                    if (nextCaps.length === 0) {
                                                        deleteModeField("ai:capabilities");
                                                    } else {
                                                        setModeField("ai:capabilities", nextCaps);
                                                    }
                                                }}
                                                className="mt-0.5 accent-accent cursor-pointer"
                                            />
                                            <div className="flex flex-col">
                                                <span className="text-xs font-medium text-primary">{cap.label}</span>
                                                <span className="text-[11px] text-muted-foreground">
                                                    {cap.description}
                                                </span>
                                            </div>
                                        </label>
                                    );
                                })}
                            </div>
                        </div>

                        <SettingRow
                            label="Thinking Level"
                            configKey="ai:thinkinglevel"
                            description="Reasoning effort for models that support extended thinking."
                            modified={Object.hasOwn(selectedMode, "ai:thinkinglevel")}
                            onReset={() => deleteModeField("ai:thinkinglevel")}
                        >
                            <SelectControl
                                value={thinkingLevel}
                                options={THINKING_LEVEL_OPTIONS}
                                onChange={(val) =>
                                    val === ""
                                        ? deleteModeField("ai:thinkinglevel")
                                        : setModeField("ai:thinkinglevel", val)
                                }
                            />
                        </SettingRow>

                        {showVerbosity && (
                            <SettingRow
                                label="Verbosity"
                                configKey="ai:verbosity"
                                description="Text verbosity level (OpenAI Responses API only)."
                                modified={Object.hasOwn(selectedMode, "ai:verbosity")}
                                onReset={() => deleteModeField("ai:verbosity")}
                            >
                                <SelectControl
                                    value={verbosity}
                                    options={VERBOSITY_OPTIONS}
                                    onChange={(val) =>
                                        val === ""
                                            ? deleteModeField("ai:verbosity")
                                            : setModeField("ai:verbosity", val)
                                    }
                                />
                            </SettingRow>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
});

WaveAIVisualContent.displayName = "WaveAIVisualContent";
