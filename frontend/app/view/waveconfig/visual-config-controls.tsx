// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { isEnvMacroValue, isUnsafeObjectKey } from "@/app/view/waveconfig/visual-config-utils";
import { cn } from "@/util/util";
import { memo, useEffect, useState } from "react";

export const InvalidJsonBanner = memo(
    ({ error, onOpenRawJson }: { error: string; onOpenRawJson: () => void }) => (
        <div className="p-6 flex flex-col items-start gap-3">
            <div className="text-error font-semibold flex items-center gap-2">
                <i className="fa fa-solid fa-triangle-exclamation" />
                <span>Cannot open Visual Editor — invalid JSON</span>
            </div>
            <div className="text-sm text-secondary font-mono bg-panel px-3 py-2 rounded border border-border">
                {error}
            </div>
            <button
                type="button"
                onClick={onOpenRawJson}
                className="px-3 py-1.5 rounded bg-accent/80 hover:bg-accent text-primary text-sm cursor-pointer transition-colors"
            >
                Fix in Raw JSON
            </button>
        </div>
    )
);
InvalidJsonBanner.displayName = "InvalidJsonBanner";

export const EnvMacroBadge = memo(
    ({ value, onOverride }: { value: string; onOverride: () => void }) => (
        <div className="flex items-center gap-2">
            <span
                className="px-2 py-1 rounded bg-secondary/60 border border-border text-xs font-mono text-accent truncate max-w-[260px]"
                title={value}
            >
                {value}
            </span>
            <button
                type="button"
                onClick={onOverride}
                className="px-2 py-1 rounded border border-border text-xs text-secondary hover:text-primary hover:bg-secondary/50 cursor-pointer"
            >
                Override
            </button>
        </div>
    )
);
EnvMacroBadge.displayName = "EnvMacroBadge";

export interface SettingRowProps {
    label: string;
    configKey?: string;
    description?: string;
    modified?: boolean;
    onReset?: () => void;
    children: React.ReactNode;
}

export const SettingRow = memo(({ label, configKey, description, modified, onReset, children }: SettingRowProps) => (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-3 px-4 border-b border-border/60 hover:bg-secondary/20 transition-colors">
        <div className="flex flex-col min-w-0 flex-1 pr-3">
            <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-primary">{label}</span>
                {configKey && (
                    <code className="text-[11px] px-1.5 py-0.5 rounded bg-secondary/60 text-muted-foreground font-mono">
                        {configKey}
                    </code>
                )}
                {modified && (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-accent/20 text-accent font-semibold">
                        Modified
                    </span>
                )}
            </div>
            {description && <div className="text-xs text-muted-foreground mt-0.5">{description}</div>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
            {children}
            {modified && onReset && (
                <button
                    type="button"
                    onClick={onReset}
                    title="Reset to default"
                    className="px-2 py-1 rounded text-xs text-muted-foreground hover:text-primary hover:bg-secondary/60 cursor-pointer transition-colors"
                >
                    <i className="fa fa-solid fa-rotate-left" />
                </button>
            )}
        </div>
    </div>
));
SettingRow.displayName = "SettingRow";

export const ToggleControl = memo(
    ({
        checked,
        onChange,
        rawValue,
        onOverrideEnv,
        disabled,
    }: {
        checked: boolean;
        onChange: (next: boolean) => void;
        rawValue?: unknown;
        onOverrideEnv?: () => void;
        disabled?: boolean;
    }) => {
        if (isEnvMacroValue(rawValue) && onOverrideEnv) {
            return <EnvMacroBadge value={rawValue} onOverride={onOverrideEnv} />;
        }
        return (
            <button
                type="button"
                role="switch"
                aria-checked={checked}
                disabled={disabled}
                onClick={() => onChange(!checked)}
                className={cn(
                    "relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer",
                    checked ? "bg-accent" : "bg-secondary border border-border",
                    disabled && "opacity-50 cursor-not-allowed"
                )}
            >
                <span
                    className={cn(
                        "inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform",
                        checked ? "translate-x-4.5" : "translate-x-0.5"
                    )}
                />
            </button>
        );
    }
);
ToggleControl.displayName = "ToggleControl";

export interface SelectOption {
    value: string;
    label: string;
}

export const SelectControl = memo(
    ({
        value,
        options,
        onChange,
        rawValue,
        onOverrideEnv,
        className,
    }: {
        value: string;
        options: SelectOption[];
        onChange: (next: string) => void;
        rawValue?: unknown;
        onOverrideEnv?: () => void;
        className?: string;
    }) => {
        if (isEnvMacroValue(rawValue) && onOverrideEnv) {
            return <EnvMacroBadge value={rawValue} onOverride={onOverrideEnv} />;
        }
        return (
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className={cn(
                    "px-2.5 py-1.5 rounded bg-panel border border-border text-sm text-primary focus:outline-none focus:border-accent min-w-[160px]",
                    className
                )}
            >
                {options.map((opt) => (
                    <option key={opt.value} value={opt.value} className="bg-zinc-900 text-white">
                        {opt.label}
                    </option>
                ))}
            </select>
        );
    }
);
SelectControl.displayName = "SelectControl";

export const TextControl = memo(
    ({
        value,
        onChange,
        placeholder,
        sensitive,
        presets,
        className,
    }: {
        value: string;
        onChange: (next: string) => void;
        placeholder?: string;
        sensitive?: boolean;
        presets?: { label: string; value: string }[];
        className?: string;
    }) => {
        const [revealed, setRevealed] = useState(false);
        return (
            <div className="flex flex-col items-end gap-1.5">
                <div className="flex items-center gap-1">
                    <input
                        type={sensitive && !revealed ? "password" : "text"}
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder={placeholder}
                        className={cn(
                            "px-2.5 py-1.5 rounded bg-panel border border-border text-sm text-primary focus:outline-none focus:border-accent w-60",
                            className
                        )}
                    />
                    {sensitive && (
                        <button
                            type="button"
                            onClick={() => setRevealed((r) => !r)}
                            title={revealed ? "Hide" : "Reveal"}
                            className="px-2 py-1.5 rounded border border-border text-xs text-secondary hover:text-primary cursor-pointer"
                        >
                            <i className={`fa fa-solid ${revealed ? "fa-eye-slash" : "fa-eye"}`} />
                        </button>
                    )}
                </div>
                {presets && presets.length > 0 && (
                    <div className="flex flex-wrap justify-end gap-1 max-w-xs">
                        {presets.map((p) => (
                            <button
                                key={p.label}
                                type="button"
                                onClick={() => onChange(p.value)}
                                className="text-[11px] px-1.5 py-0.5 rounded bg-secondary/50 hover:bg-secondary text-secondary hover:text-primary cursor-pointer transition-colors"
                            >
                                {p.label}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        );
    }
);
TextControl.displayName = "TextControl";

export const NumberControl = memo(
    ({
        value,
        onChange,
        min,
        max,
        step = 1,
        integer = false,
        placeholder,
        rawValue,
        onOverrideEnv,
        className,
    }: {
        value: number | "";
        onChange: (next: number | undefined) => void;
        min?: number;
        max?: number;
        step?: number;
        integer?: boolean;
        placeholder?: string;
        rawValue?: unknown;
        onOverrideEnv?: () => void;
        className?: string;
    }) => {
        if (isEnvMacroValue(rawValue) && onOverrideEnv) {
            return <EnvMacroBadge value={rawValue} onOverride={onOverrideEnv} />;
        }
        return (
            <input
                type="number"
                value={value}
                min={min}
                max={max}
                step={step}
                placeholder={placeholder}
                onChange={(e) => {
                    const raw = e.target.value;
                    if (raw === "") {
                        onChange(undefined);
                        return;
                    }
                    let num = Number(raw);
                    if (!Number.isFinite(num)) return;
                    if (integer) num = Math.round(num);
                    if (min != null && num < min) num = min;
                    if (max != null && num > max) num = max;
                    onChange(num);
                }}
                className={cn(
                    "px-2.5 py-1.5 rounded bg-panel border border-border text-sm text-primary focus:outline-none focus:border-accent w-28",
                    className
                )}
            />
        );
    }
);
NumberControl.displayName = "NumberControl";

export const StringListControl = memo(
    ({
        items,
        onChange,
        placeholder = "Add item...",
    }: {
        items: string[];
        onChange: (next: string[]) => void;
        placeholder?: string;
    }) => {
        const [draft, setDraft] = useState("");
        const safeItems = Array.isArray(items) ? items : [];

        const handleAdd = () => {
            const val = draft.trim();
            if (!val) return;
            onChange([...safeItems, val]);
            setDraft("");
        };

        return (
            <div className="flex flex-col gap-1.5 w-full max-w-md">
                {safeItems.map((item, idx) => (
                    <div key={`${item}-${idx}`} className="flex items-center gap-1.5">
                        <input
                            type="text"
                            value={item}
                            onChange={(e) => {
                                const next = [...safeItems];
                                next[idx] = e.target.value;
                                onChange(next);
                            }}
                            className="flex-1 px-2 py-1 rounded bg-panel border border-border text-xs font-mono text-primary focus:outline-none focus:border-accent"
                        />
                        <button
                            type="button"
                            onClick={() => onChange(safeItems.filter((_, i) => i !== idx))}
                            className="px-2 py-1 rounded text-xs text-muted-foreground hover:text-error hover:bg-secondary/50 cursor-pointer"
                            title="Remove"
                        >
                            ✕
                        </button>
                    </div>
                ))}
                <div className="flex items-center gap-1.5">
                    <input
                        type="text"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.nativeEvent?.isComposing && e.keyCode !== 229) {
                                e.preventDefault();
                                handleAdd();
                            }
                        }}
                        placeholder={placeholder}
                        className="flex-1 px-2 py-1 rounded bg-panel border border-border text-xs font-mono text-primary focus:outline-none focus:border-accent"
                    />
                    <button
                        type="button"
                        onClick={handleAdd}
                        className="px-2.5 py-1 rounded bg-secondary hover:bg-secondary/80 text-xs text-primary cursor-pointer"
                    >
                        + Add
                    </button>
                </div>
            </div>
        );
    }
);
StringListControl.displayName = "StringListControl";

export const KeyValueControl = memo(
    ({
        entries,
        onChange,
        keyPlaceholder = "VAR_NAME",
        valuePlaceholder = "value",
    }: {
        entries: Record<string, string>;
        onChange: (next: Record<string, string>) => void;
        keyPlaceholder?: string;
        valuePlaceholder?: string;
    }) => {
        const [newKey, setNewKey] = useState("");
        const [newVal, setNewVal] = useState("");
        const [err, setErr] = useState<string | null>(null);
        const safeObj = entries && typeof entries === "object" && !Array.isArray(entries) ? entries : {};
        const keys = Object.keys(safeObj).filter((k) => !isUnsafeObjectKey(k));

        const handleAdd = () => {
            const k = newKey.trim();
            if (!k) return;
            if (isUnsafeObjectKey(k)) {
                setErr(`Reserved key "${k}" is not allowed`);
                return;
            }
            const next: Record<string, string> = {};
            for (const existing of keys) next[existing] = safeObj[existing];
            next[k] = newVal;
            onChange(next);
            setNewKey("");
            setNewVal("");
            setErr(null);
        };

        return (
            <div className="flex flex-col gap-1.5 w-full max-w-lg">
                {keys.map((k) => (
                    <div key={k} className="flex items-center gap-1.5">
                        <code className="px-2 py-1 rounded bg-secondary/50 text-xs font-mono text-primary min-w-[110px] truncate">
                            {k}
                        </code>
                        <input
                            type="text"
                            value={String(safeObj[k] ?? "")}
                            onChange={(e) => {
                                const next: Record<string, string> = {};
                                for (const existing of keys) next[existing] = safeObj[existing];
                                next[k] = e.target.value;
                                onChange(next);
                            }}
                            className="flex-1 px-2 py-1 rounded bg-panel border border-border text-xs font-mono text-primary focus:outline-none focus:border-accent"
                        />
                        <button
                            type="button"
                            onClick={() => {
                                const next: Record<string, string> = {};
                                for (const existing of keys) {
                                    if (existing !== k) next[existing] = safeObj[existing];
                                }
                                onChange(next);
                            }}
                            className="px-2 py-1 rounded text-xs text-muted-foreground hover:text-error hover:bg-secondary/50 cursor-pointer"
                            title="Remove"
                        >
                            ✕
                        </button>
                    </div>
                ))}
                <div className="flex items-center gap-1.5">
                    <input
                        type="text"
                        value={newKey}
                        onChange={(e) => {
                            setNewKey(e.target.value);
                            setErr(null);
                        }}
                        placeholder={keyPlaceholder}
                        className="w-32 px-2 py-1 rounded bg-panel border border-border text-xs font-mono text-primary focus:outline-none focus:border-accent"
                    />
                    <input
                        type="text"
                        value={newVal}
                        onChange={(e) => setNewVal(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.nativeEvent?.isComposing && e.keyCode !== 229) {
                                e.preventDefault();
                                handleAdd();
                            }
                        }}
                        placeholder={valuePlaceholder}
                        className="flex-1 px-2 py-1 rounded bg-panel border border-border text-xs font-mono text-primary focus:outline-none focus:border-accent"
                    />
                    <button
                        type="button"
                        onClick={handleAdd}
                        className="px-2.5 py-1 rounded bg-secondary hover:bg-secondary/80 text-xs text-primary cursor-pointer"
                    >
                        + Add
                    </button>
                </div>
                {err && <div className="text-xs text-error">{err}</div>}
            </div>
        );
    }
);
KeyValueControl.displayName = "KeyValueControl";

export const DeferredKeyRenameControl = memo(
    ({
        currentKey,
        existingKeys,
        pattern,
        patternError,
        onRename,
    }: {
        currentKey: string;
        existingKeys: string[];
        pattern?: RegExp;
        patternError?: string;
        onRename: (nextKey: string) => void;
    }) => {
        const [draft, setDraft] = useState(currentKey);
        const [err, setErr] = useState<string | null>(null);

        useEffect(() => {
            setDraft(currentKey);
            setErr(null);
        }, [currentKey]);

        const commit = () => {
            const next = draft.trim();
            if (next === currentKey) {
                setErr(null);
                return;
            }
            if (!next) {
                setErr("Key cannot be empty");
                return;
            }
            if (isUnsafeObjectKey(next)) {
                setErr(`Reserved key "${next}" is not allowed`);
                return;
            }
            if (pattern && !pattern.test(next)) {
                setErr(patternError || "Invalid key format");
                return;
            }
            if (existingKeys.includes(next)) {
                setErr(`Key "${next}" already exists`);
                return;
            }
            setErr(null);
            onRename(next);
        };

        const dirty = draft.trim() !== currentKey;

        return (
            <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1.5">
                    <input
                        type="text"
                        value={draft}
                        onChange={(e) => {
                            setDraft(e.target.value);
                            setErr(null);
                        }}
                        onBlur={commit}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.nativeEvent?.isComposing && e.keyCode !== 229) {
                                e.preventDefault();
                                commit();
                            } else if (e.key === "Escape") {
                                setDraft(currentKey);
                                setErr(null);
                            }
                        }}
                        className="px-2.5 py-1.5 rounded bg-panel border border-border text-sm font-mono text-primary focus:outline-none focus:border-accent w-60"
                    />
                    {dirty && (
                        <button
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={commit}
                            className="px-2.5 py-1.5 rounded bg-accent/80 hover:bg-accent text-xs text-primary cursor-pointer"
                        >
                            Rename
                        </button>
                    )}
                </div>
                {err && <div className="text-xs text-error">{err}</div>}
            </div>
        );
    }
);
DeferredKeyRenameControl.displayName = "DeferredKeyRenameControl";
