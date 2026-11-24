// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    DeferredKeyRenameControl,
    EnvMacroBadge,
    InvalidJsonBanner,
    KeyValueControl,
    NumberControl,
    SelectControl,
    SettingRow,
    StringListControl,
    TextControl,
    ToggleControl,
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
import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import type { WaveConfigEnv } from "@/app/view/waveconfig/waveconfigenv";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import { cn, isLocalConnName, isWslConnName } from "@/util/util";
import { useAtomValue, useSetAtom } from "jotai";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

type ConnType = "ssh" | "wsl" | "local";
type NewConnType = "ssh" | "wsl";

function classifyConnName(key: string): ConnType {
    if (isWslConnName(key)) {
        return "wsl";
    }
    if (isLocalConnName(key)) {
        return "local";
    }
    return "ssh";
}

function isPlainObject(val: unknown): val is Record<string, any> {
    return val !== null && typeof val === "object" && !Array.isArray(val);
}

const KNOWN_FORM_KEYS = new Set([
    "display:order",
    "display:hidden",
    "ssh:hostname",
    "ssh:user",
    "ssh:port",
    "ssh:identityfile",
    "ssh:proxyjump",
    "ssh:passwordsecretname",
    "ssh:pubkeyauthentication",
    "ssh:passwordauthentication",
    "ssh:identitiesonly",
    "ssh:batchmode",
    "conn:ignoresshconfig",
    "term:durable",
    "conn:wshenabled",
    "conn:askbeforewshinstall",
    "conn:shellpath",
    "term:theme",
    "term:fontfamily",
    "term:fontsize",
    "cmd:env",
    "cmd:initscript",
]);

const ConnTypeBadge = memo(({ type }: { type: ConnType }) => {
    const styles: Record<ConnType, string> = {
        ssh: "bg-sky-500/15 text-sky-400 border-sky-500/30",
        wsl: "bg-purple-500/15 text-purple-400 border-purple-500/30",
        local: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    };
    const labels: Record<ConnType, string> = {
        ssh: "SSH",
        wsl: "WSL",
        local: "Local",
    };
    return (
        <span
            className={cn(
                "text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border shrink-0",
                styles[type]
            )}
        >
            {labels[type]}
        </span>
    );
});
ConnTypeBadge.displayName = "ConnTypeBadge";

const SectionHeader = memo(({ title, icon }: { title: string; icon: string }) => (
    <div className="px-4 py-2 bg-panel/50 border-b border-border/80 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-secondary">
        <i className={`fa fa-solid ${icon} text-[11px]`} />
        <span>{title}</span>
    </div>
));
SectionHeader.displayName = "SectionHeader";

export const ConnectionsVisualContent = memo(({ model }: { model: WaveConfigViewModel }) => {
    const env = useWaveEnv<WaveConfigEnv>();
    const fullConfig = useAtomValue(env.atoms.fullConfigAtom);
    const secretNames = useAtomValue(model.secretNamesAtom);
    const setActiveTab = useSetAtom(model.activeTabAtom);
    const { parsed, parseError, replaceData } = useVisualConfigJson(model);

    const [search, setSearch] = useState("");
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [isAdding, setIsAdding] = useState(false);
    const [newConnType, setNewConnType] = useState<NewConnType>("ssh");
    const [newConnName, setNewConnName] = useState("");
    const [addError, setAddError] = useState<string | null>(null);
    const [confirmDelete, setConfirmDelete] = useState(false);

    useEffect(() => {
        void model.fetchSecretNamesQuietly();
    }, [model]);

    const allKeys = useMemo(() => {
        if (!parsed) return [];
        const keys = Object.keys(parsed).filter((k) => !isUnsafeObjectKey(k));
        return keys.sort((a, b) => {
            const entryA = parsed[a];
            const entryB = parsed[b];
            const orderA = isPlainObject(entryA) && typeof entryA["display:order"] === "number" ? entryA["display:order"] : 0;
            const orderB = isPlainObject(entryB) && typeof entryB["display:order"] === "number" ? entryB["display:order"] : 0;
            if (orderA !== orderB) return orderA - orderB;
            return a.localeCompare(b);
        });
    }, [parsed]);

    const filteredKeys = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return allKeys;
        return allKeys.filter((k) => {
            if (k.toLowerCase().includes(q)) return true;
            const entry = parsed?.[k];
            if (isPlainObject(entry)) {
                const host = typeof entry["ssh:hostname"] === "string" ? entry["ssh:hostname"].toLowerCase() : "";
                const user = typeof entry["ssh:user"] === "string" ? entry["ssh:user"].toLowerCase() : "";
                if (host.includes(q) || user.includes(q)) return true;
            }
            return false;
        });
    }, [allKeys, parsed, search]);

    useEffect(() => {
        if (selectedKey && allKeys.includes(selectedKey)) {
            return;
        }
        setSelectedKey(allKeys.length > 0 ? allKeys[0] : null);
    }, [allKeys, selectedKey]);

    useEffect(() => {
        setConfirmDelete(false);
    }, [selectedKey]);

    const termThemeOptions = useMemo<SelectOption[]>(() => {
        const themes = fullConfig?.termthemes ?? {};
        const keys = Object.keys(themes).sort();
        return [
            { value: "", label: "(Inherit default)" },
            ...keys.map((k) => ({ value: k, label: themes[k]?.["display:name"] || k })),
        ];
    }, [fullConfig?.termthemes]);

    const secretOptions = useMemo<SelectOption[]>(() => {
        const sorted = [...(secretNames ?? [])].sort();
        return [{ value: "", label: "(None)" }, ...sorted.map((s) => ({ value: s, label: s }))];
    }, [secretNames]);

    const updateEntry = useCallback(
        (connKey: string, updater: (prev: Record<string, any>) => Record<string, any>) => {
            if (!parsed || isUnsafeObjectKey(connKey) || !Object.hasOwn(parsed, connKey)) {
                return;
            }
            const rawEntry = parsed[connKey];
            const baseObj = isPlainObject(rawEntry) ? rawEntry : {};
            const nextEntry = updater(baseObj);
            const nextData = updateConfigKey(parsed, connKey, nextEntry);
            replaceData(nextData);
        },
        [parsed, replaceData]
    );

    const setEntryField = useCallback(
        (connKey: string, fieldKey: string, value: any) => {
            if (isUnsafeObjectKey(fieldKey)) {
                return;
            }
            updateEntry(connKey, (prev) => {
                const shouldOmit =
                    value === undefined ||
                    value === "" ||
                    (Array.isArray(value) && value.length === 0) ||
                    (isPlainObject(value) && Object.keys(value).length === 0);
                if (shouldOmit) {
                    return deleteConfigKey(prev, fieldKey);
                }
                return updateConfigKey(prev, fieldKey, value);
            });
        },
        [updateEntry]
    );

    const unsetEntryField = useCallback(
        (connKey: string, fieldKey: string) => {
            if (isUnsafeObjectKey(fieldKey)) {
                return;
            }
            updateEntry(connKey, (prev) => deleteConfigKey(prev, fieldKey));
        },
        [updateEntry]
    );

    const handleAddConnection = useCallback(() => {
        if (!parsed) return;
        const trimmed = newConnName.trim();
        if (!trimmed) {
            setAddError("Connection name cannot be empty.");
            return;
        }
        let finalKey = trimmed;
        if (newConnType === "wsl") {
            if (!finalKey.startsWith("wsl://")) {
                finalKey = `wsl://${finalKey}`;
            }
            if (finalKey === "wsl://") {
                setAddError("Please enter a WSL distro name (e.g. Ubuntu).");
                return;
            }
        }
        if (isUnsafeObjectKey(finalKey)) {
            setAddError(`Reserved key "${finalKey}" is not allowed.`);
            return;
        }
        if (Object.hasOwn(parsed, finalKey)) {
            setAddError(`Connection "${finalKey}" already exists.`);
            return;
        }
        const nextData = updateConfigKey(parsed, finalKey, {});
        replaceData(nextData);
        setSelectedKey(finalKey);
        setNewConnName("");
        setAddError(null);
        setIsAdding(false);
    }, [parsed, newConnName, newConnType, replaceData]);

    const handleRename = useCallback(
        (oldKey: string, nextKey: string) => {
            if (!parsed || !nextKey || oldKey === nextKey) return;
            if (isUnsafeObjectKey(nextKey) || Object.hasOwn(parsed, nextKey)) {
                return;
            }
            const nextData = renameConfigKey(parsed, oldKey, nextKey);
            replaceData(nextData);
            setSelectedKey(nextKey);
        },
        [parsed, replaceData]
    );

    const handleDelete = useCallback(
        (connKey: string) => {
            if (!parsed || !Object.hasOwn(parsed, connKey)) return;
            const nextData = deleteConfigKey(parsed, connKey);
            replaceData(nextData);
            setConfirmDelete(false);
            const remaining = allKeys.filter((k) => k !== connKey);
            setSelectedKey(remaining.length > 0 ? remaining[0] : null);
        },
        [parsed, replaceData, allKeys]
    );

    if (parseError || !parsed) {
        return <InvalidJsonBanner error={parseError || "Invalid JSON"} onOpenRawJson={() => setActiveTab("json")} />;
    }

    const hasSelected = selectedKey !== null && Object.hasOwn(parsed, selectedKey);
    const rawSelectedEntry = hasSelected ? parsed[selectedKey] : undefined;
    const isMalformedEntry = hasSelected && rawSelectedEntry != null && !isPlainObject(rawSelectedEntry);
    const entry: Record<string, any> = hasSelected && isPlainObject(rawSelectedEntry) ? rawSelectedEntry : {};
    const connType: ConnType = hasSelected ? classifyConnName(selectedKey) : "ssh";

    const advancedKeys = hasSelected && !isMalformedEntry
        ? Object.keys(entry).filter((k) => !isUnsafeObjectKey(k) && !KNOWN_FORM_KEYS.has(k))
        : [];

    const currentSecretVal = typeof entry["ssh:passwordsecretname"] === "string" ? entry["ssh:passwordsecretname"] : "";
    const resolvedSecretOptions =
        currentSecretVal && !secretOptions.some((o) => o.value === currentSecretVal)
            ? [...secretOptions, { value: currentSecretVal, label: `${currentSecretVal} (not found)` }]
            : secretOptions;

    const currentThemeVal = typeof entry["term:theme"] === "string" ? entry["term:theme"] : "";
    const resolvedThemeOptions =
        currentThemeVal && !termThemeOptions.some((o) => o.value === currentThemeVal)
            ? [...termThemeOptions, { value: currentThemeVal, label: currentThemeVal }]
            : termThemeOptions;

    return (
        <div className="flex h-full min-h-0">
            {/* Left Master List */}
            <div className="w-72 shrink-0 border-r border-border flex flex-col bg-panel/30 min-h-0">
                <div className="p-3 border-b border-border flex flex-col gap-2 shrink-0">
                    <div className="relative">
                        <i className="fa fa-solid fa-magnifying-glass absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground" />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Filter connections..."
                            className="w-full pl-8 pr-7 py-1.5 rounded bg-panel border border-border text-xs text-primary focus:outline-none focus:border-accent"
                        />
                        {search && (
                            <button
                                type="button"
                                onClick={() => setSearch("")}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-primary cursor-pointer"
                            >
                                ✕
                            </button>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                            setIsAdding((v) => !v);
                            setAddError(null);
                        }}
                        className="w-full py-1.5 px-2.5 rounded bg-accent/80 hover:bg-accent text-primary text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                    >
                        <i className="fa fa-solid fa-plus text-[11px]" />
                        <span>Add Connection</span>
                    </button>

                    {isAdding && (
                        <div className="p-2.5 rounded bg-panel border border-border flex flex-col gap-2">
                            <div className="flex gap-1">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setNewConnType("ssh");
                                        setAddError(null);
                                    }}
                                    className={cn(
                                        "flex-1 py-1 rounded text-xs font-medium cursor-pointer transition-colors",
                                        newConnType === "ssh"
                                            ? "bg-sky-500/20 text-sky-300 border border-sky-500/40"
                                            : "bg-secondary/40 text-secondary hover:text-primary"
                                    )}
                                >
                                    SSH Host
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setNewConnType("wsl");
                                        setAddError(null);
                                    }}
                                    className={cn(
                                        "flex-1 py-1 rounded text-xs font-medium cursor-pointer transition-colors",
                                        newConnType === "wsl"
                                            ? "bg-purple-500/20 text-purple-300 border border-purple-500/40"
                                            : "bg-secondary/40 text-secondary hover:text-primary"
                                    )}
                                >
                                    WSL Distro
                                </button>
                            </div>
                            <input
                                type="text"
                                value={newConnName}
                                onChange={(e) => {
                                    setNewConnName(e.target.value);
                                    setAddError(null);
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && !e.nativeEvent?.isComposing && e.keyCode !== 229) {
                                        e.preventDefault();
                                        handleAddConnection();
                                    } else if (e.key === "Escape") {
                                        setIsAdding(false);
                                        setAddError(null);
                                    }
                                }}
                                placeholder={newConnType === "wsl" ? "Ubuntu-24.04 (auto wsl://)" : "user@host or alias"}
                                className="w-full px-2 py-1.5 rounded bg-background border border-border text-xs font-mono text-primary focus:outline-none focus:border-accent"
                                autoFocus
                            />
                            {addError && <div className="text-[11px] text-error">{addError}</div>}
                            <div className="flex justify-end gap-1.5">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setIsAdding(false);
                                        setNewConnName("");
                                        setAddError(null);
                                    }}
                                    className="px-2 py-1 rounded text-xs text-secondary hover:text-primary hover:bg-secondary/50 cursor-pointer"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={handleAddConnection}
                                    className="px-2.5 py-1 rounded bg-accent/80 hover:bg-accent text-xs text-primary font-medium cursor-pointer"
                                >
                                    Create
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                <div className="flex-1 overflow-y-auto min-h-0 py-1">
                    {filteredKeys.length === 0 ? (
                        <div className="p-4 text-center text-xs text-muted-foreground">
                            {allKeys.length === 0
                                ? "No connections configured yet."
                                : `No connections match "${search}".`}
                        </div>
                    ) : (
                        filteredKeys.map((key) => {
                            const itemRaw = parsed[key];
                            const itemMalformed = itemRaw != null && !isPlainObject(itemRaw);
                            const itemObj = isPlainObject(itemRaw) ? itemRaw : {};
                            const type = classifyConnName(key);
                            const isSelected = key === selectedKey;
                            const subtitle =
                                type === "ssh" && typeof itemObj["ssh:hostname"] === "string" && itemObj["ssh:hostname"]
                                    ? `${itemObj["ssh:user"] ? `${itemObj["ssh:user"]}@` : ""}${itemObj["ssh:hostname"]}`
                                    : null;

                            return (
                                <button
                                    key={key}
                                    type="button"
                                    onClick={() => setSelectedKey(key)}
                                    className={cn(
                                        "w-full text-left px-3 py-2 flex flex-col gap-0.5 border-l-2 transition-colors cursor-pointer",
                                        isSelected
                                            ? "bg-accent/15 border-accent text-primary"
                                            : "border-transparent text-secondary hover:bg-secondary/40 hover:text-primary"
                                    )}
                                >
                                    <div className="flex items-center justify-between gap-2 min-w-0">
                                        <span className="text-xs font-mono font-medium truncate">{key}</span>
                                        <div className="flex items-center gap-1 shrink-0">
                                            {itemMalformed && (
                                                <span
                                                    className="text-[10px] px-1 py-0.5 rounded bg-error/20 text-error font-semibold"
                                                    title="Malformed entry"
                                                >
                                                    !
                                                </span>
                                            )}
                                            <ConnTypeBadge type={type} />
                                        </div>
                                    </div>
                                    {(subtitle || itemObj["display:hidden"]) && (
                                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground truncate">
                                            {subtitle && <span className="truncate font-mono">{subtitle}</span>}
                                            {itemObj["display:hidden"] && (
                                                <span className="text-[10px] italic shrink-0">Hidden</span>
                                            )}
                                        </div>
                                    )}
                                </button>
                            );
                        })
                    )}
                </div>
            </div>

            {/* Right Detail Editor */}
            <div className="flex-1 overflow-y-auto min-h-0 flex flex-col">
                {!hasSelected ? (
                    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center gap-3 text-muted-foreground">
                        <i className="fa fa-solid fa-plug text-2xl opacity-50" />
                        <div className="text-sm">Select a connection to edit or click "+ Add Connection" to create one.</div>
                    </div>
                ) : isMalformedEntry ? (
                    <div className="p-6 flex flex-col items-start gap-3">
                        <div className="text-error font-semibold flex items-center gap-2">
                            <i className="fa fa-solid fa-triangle-exclamation" />
                            <span>Malformed connection entry: &quot;{selectedKey}&quot;</span>
                        </div>
                        <div className="text-sm text-secondary">
                            This entry in <code className="font-mono">connections.json</code> is not a valid JSON object
                            (found <code className="font-mono">{Array.isArray(rawSelectedEntry) ? "array" : typeof rawSelectedEntry}</code>).
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setActiveTab("json")}
                                className="px-3 py-1.5 rounded bg-accent/80 hover:bg-accent text-primary text-xs font-medium cursor-pointer"
                            >
                                Fix in Raw JSON
                            </button>
                            <button
                                type="button"
                                onClick={() => replaceData(updateConfigKey(parsed, selectedKey, {}))}
                                className="px-3 py-1.5 rounded border border-border text-xs text-secondary hover:text-primary hover:bg-secondary/50 cursor-pointer"
                            >
                                Reset to Empty Object
                            </button>
                            <button
                                type="button"
                                onClick={() => handleDelete(selectedKey)}
                                className="px-3 py-1.5 rounded border border-error/40 text-xs text-error hover:bg-error/15 cursor-pointer"
                            >
                                Delete Entry
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col pb-8">
                        {/* Detail Header */}
                        <div className="px-4 py-3 border-b border-border bg-panel/40 flex items-center justify-between gap-3 sticky top-0 z-10 backdrop-blur-sm">
                            <div className="flex items-center gap-2.5 min-w-0">
                                <span className="text-sm font-mono font-semibold text-primary truncate">{selectedKey}</span>
                                <ConnTypeBadge type={connType} />
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                {confirmDelete ? (
                                    <>
                                        <span className="text-xs text-error">Delete this connection?</span>
                                        <button
                                            type="button"
                                            onClick={() => handleDelete(selectedKey)}
                                            className="px-2.5 py-1 rounded bg-error text-white text-xs font-medium cursor-pointer"
                                        >
                                            Confirm
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setConfirmDelete(false)}
                                            className="px-2 py-1 rounded border border-border text-xs text-secondary hover:text-primary cursor-pointer"
                                        >
                                            Cancel
                                        </button>
                                    </>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => setConfirmDelete(true)}
                                        className="px-2.5 py-1 rounded border border-border text-xs text-muted-foreground hover:text-error hover:border-error/50 cursor-pointer transition-colors flex items-center gap-1.5"
                                    >
                                        <i className="fa fa-solid fa-trash-can text-[11px]" />
                                        <span>Delete</span>
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Section 1: Connection Identity & Display */}
                        <SectionHeader title="Connection Identity & Display" icon="fa-id-card" />
                        <SettingRow
                            label="Connection Name (Key)"
                            description="Unique identifier in connections.json (e.g. user@host, prod, wsl://Ubuntu, local)."
                        >
                            <DeferredKeyRenameControl
                                currentKey={selectedKey}
                                existingKeys={allKeys}
                                onRename={(nextKey) => handleRename(selectedKey, nextKey)}
                            />
                        </SettingRow>
                        <SettingRow
                            label="Display Order"
                            configKey="display:order"
                            description="Sort order in the connection dropdown (lower numbers appear first)."
                            modified={Object.hasOwn(entry, "display:order")}
                            onReset={() => unsetEntryField(selectedKey, "display:order")}
                        >
                            <NumberControl
                                value={typeof entry["display:order"] === "number" ? entry["display:order"] : ""}
                                step={1}
                                placeholder="0"
                                rawValue={entry["display:order"]}
                                onOverrideEnv={() => setEntryField(selectedKey, "display:order", 0)}
                                onChange={(next) => setEntryField(selectedKey, "display:order", next)}
                            />
                        </SettingRow>
                        <SettingRow
                            label="Hidden"
                            configKey="display:hidden"
                            description="Hide this connection from the connection picker menu."
                            modified={Object.hasOwn(entry, "display:hidden")}
                            onReset={() => unsetEntryField(selectedKey, "display:hidden")}
                        >
                            <ToggleControl
                                checked={Boolean(entry["display:hidden"])}
                                rawValue={entry["display:hidden"]}
                                onOverrideEnv={() => setEntryField(selectedKey, "display:hidden", false)}
                                onChange={(next) => setEntryField(selectedKey, "display:hidden", next)}
                            />
                        </SettingRow>

                        {/* Section 2: SSH Settings (SSH entries ONLY) */}
                        {connType === "ssh" && (
                            <>
                                <SectionHeader title="SSH Settings" icon="fa-server" />
                                <SettingRow
                                    label="Hostname"
                                    configKey="ssh:hostname"
                                    description="Remote host address or domain name to connect to."
                                    modified={Object.hasOwn(entry, "ssh:hostname")}
                                    onReset={() => unsetEntryField(selectedKey, "ssh:hostname")}
                                >
                                    <TextControl
                                        value={typeof entry["ssh:hostname"] === "string" ? entry["ssh:hostname"] : ""}
                                        placeholder="example.com or 192.168.1.10"
                                        onChange={(next) => setEntryField(selectedKey, "ssh:hostname", next)}
                                    />
                                </SettingRow>
                                <SettingRow
                                    label="Username"
                                    configKey="ssh:user"
                                    description="SSH login username."
                                    modified={Object.hasOwn(entry, "ssh:user")}
                                    onReset={() => unsetEntryField(selectedKey, "ssh:user")}
                                >
                                    <TextControl
                                        value={typeof entry["ssh:user"] === "string" ? entry["ssh:user"] : ""}
                                        placeholder="ubuntu"
                                        onChange={(next) => setEntryField(selectedKey, "ssh:user", next)}
                                    />
                                </SettingRow>
                                <SettingRow
                                    label="Port"
                                    configKey="ssh:port"
                                    description="SSH port number (stored as string per schema, default 22)."
                                    modified={Object.hasOwn(entry, "ssh:port")}
                                    onReset={() => unsetEntryField(selectedKey, "ssh:port")}
                                >
                                    <TextControl
                                        value={
                                            entry["ssh:port"] !== undefined && entry["ssh:port"] !== null
                                                ? String(entry["ssh:port"])
                                                : ""
                                        }
                                        placeholder="22"
                                        className="w-28 font-mono"
                                        onChange={(next) => {
                                            const cleaned = next.trim();
                                            setEntryField(selectedKey, "ssh:port", cleaned === "" ? "" : String(cleaned));
                                        }}
                                    />
                                </SettingRow>
                                <SettingRow
                                    label="Identity Files"
                                    configKey="ssh:identityfile"
                                    description="Private key file paths used for public-key authentication."
                                    modified={Object.hasOwn(entry, "ssh:identityfile")}
                                    onReset={() => unsetEntryField(selectedKey, "ssh:identityfile")}
                                >
                                    {isEnvMacroValue(entry["ssh:identityfile"]) ? (
                                        <EnvMacroBadge
                                            value={entry["ssh:identityfile"]}
                                            onOverride={() => setEntryField(selectedKey, "ssh:identityfile", [])}
                                        />
                                    ) : (
                                        <StringListControl
                                            items={Array.isArray(entry["ssh:identityfile"]) ? entry["ssh:identityfile"] : []}
                                            placeholder="~/.ssh/id_ed25519"
                                            onChange={(next) => setEntryField(selectedKey, "ssh:identityfile", next)}
                                        />
                                    )}
                                </SettingRow>
                                <SettingRow
                                    label="ProxyJump"
                                    configKey="ssh:proxyjump"
                                    description="Jump host(s) to tunnel SSH connections through."
                                    modified={Object.hasOwn(entry, "ssh:proxyjump")}
                                    onReset={() => unsetEntryField(selectedKey, "ssh:proxyjump")}
                                >
                                    {isEnvMacroValue(entry["ssh:proxyjump"]) ? (
                                        <EnvMacroBadge
                                            value={entry["ssh:proxyjump"]}
                                            onOverride={() => setEntryField(selectedKey, "ssh:proxyjump", [])}
                                        />
                                    ) : (
                                        <StringListControl
                                            items={Array.isArray(entry["ssh:proxyjump"]) ? entry["ssh:proxyjump"] : []}
                                            placeholder="bastion.example.com"
                                            onChange={(next) => setEntryField(selectedKey, "ssh:proxyjump", next)}
                                        />
                                    )}
                                </SettingRow>
                                <SettingRow
                                    label="Password Secret"
                                    configKey="ssh:passwordsecretname"
                                    description="Wave Secret name storing the SSH password or passphrase."
                                    modified={Object.hasOwn(entry, "ssh:passwordsecretname")}
                                    onReset={() => unsetEntryField(selectedKey, "ssh:passwordsecretname")}
                                >
                                    <SelectControl
                                        value={currentSecretVal}
                                        options={resolvedSecretOptions}
                                        rawValue={entry["ssh:passwordsecretname"]}
                                        onOverrideEnv={() => unsetEntryField(selectedKey, "ssh:passwordsecretname")}
                                        onChange={(next) => setEntryField(selectedKey, "ssh:passwordsecretname", next)}
                                    />
                                </SettingRow>
                                <SettingRow
                                    label="Public Key Authentication"
                                    configKey="ssh:pubkeyauthentication"
                                    description="Allow public key authentication."
                                    modified={Object.hasOwn(entry, "ssh:pubkeyauthentication")}
                                    onReset={() => unsetEntryField(selectedKey, "ssh:pubkeyauthentication")}
                                >
                                    <ToggleControl
                                        checked={
                                            entry["ssh:pubkeyauthentication"] !== undefined
                                                ? Boolean(entry["ssh:pubkeyauthentication"])
                                                : true
                                        }
                                        rawValue={entry["ssh:pubkeyauthentication"]}
                                        onOverrideEnv={() => setEntryField(selectedKey, "ssh:pubkeyauthentication", true)}
                                        onChange={(next) => setEntryField(selectedKey, "ssh:pubkeyauthentication", next)}
                                    />
                                </SettingRow>
                                <SettingRow
                                    label="Password Authentication"
                                    configKey="ssh:passwordauthentication"
                                    description="Allow password authentication."
                                    modified={Object.hasOwn(entry, "ssh:passwordauthentication")}
                                    onReset={() => unsetEntryField(selectedKey, "ssh:passwordauthentication")}
                                >
                                    <ToggleControl
                                        checked={
                                            entry["ssh:passwordauthentication"] !== undefined
                                                ? Boolean(entry["ssh:passwordauthentication"])
                                                : true
                                        }
                                        rawValue={entry["ssh:passwordauthentication"]}
                                        onOverrideEnv={() => setEntryField(selectedKey, "ssh:passwordauthentication", true)}
                                        onChange={(next) => setEntryField(selectedKey, "ssh:passwordauthentication", next)}
                                    />
                                </SettingRow>
                                <SettingRow
                                    label="Identities Only"
                                    configKey="ssh:identitiesonly"
                                    description="Only use explicitly configured identity files, ignoring SSH agent keys."
                                    modified={Object.hasOwn(entry, "ssh:identitiesonly")}
                                    onReset={() => unsetEntryField(selectedKey, "ssh:identitiesonly")}
                                >
                                    <ToggleControl
                                        checked={Boolean(entry["ssh:identitiesonly"])}
                                        rawValue={entry["ssh:identitiesonly"]}
                                        onOverrideEnv={() => setEntryField(selectedKey, "ssh:identitiesonly", false)}
                                        onChange={(next) => setEntryField(selectedKey, "ssh:identitiesonly", next)}
                                    />
                                </SettingRow>
                                <SettingRow
                                    label="Batch Mode"
                                    configKey="ssh:batchmode"
                                    description="Disable interactive passphrase/password prompts."
                                    modified={Object.hasOwn(entry, "ssh:batchmode")}
                                    onReset={() => unsetEntryField(selectedKey, "ssh:batchmode")}
                                >
                                    <ToggleControl
                                        checked={Boolean(entry["ssh:batchmode"])}
                                        rawValue={entry["ssh:batchmode"]}
                                        onOverrideEnv={() => setEntryField(selectedKey, "ssh:batchmode", false)}
                                        onChange={(next) => setEntryField(selectedKey, "ssh:batchmode", next)}
                                    />
                                </SettingRow>
                                <SettingRow
                                    label="Ignore ~/.ssh/config"
                                    configKey="conn:ignoresshconfig"
                                    description="Ignore settings from local SSH config files for this host."
                                    modified={Object.hasOwn(entry, "conn:ignoresshconfig")}
                                    onReset={() => unsetEntryField(selectedKey, "conn:ignoresshconfig")}
                                >
                                    <ToggleControl
                                        checked={Boolean(entry["conn:ignoresshconfig"])}
                                        rawValue={entry["conn:ignoresshconfig"]}
                                        onOverrideEnv={() => setEntryField(selectedKey, "conn:ignoresshconfig", false)}
                                        onChange={(next) => setEntryField(selectedKey, "conn:ignoresshconfig", next)}
                                    />
                                </SettingRow>
                                <SettingRow
                                    label="Durable Terminal Session"
                                    configKey="term:durable"
                                    description="Keep remote terminal session alive across network disconnects."
                                    modified={Object.hasOwn(entry, "term:durable")}
                                    onReset={() => unsetEntryField(selectedKey, "term:durable")}
                                >
                                    <ToggleControl
                                        checked={Boolean(entry["term:durable"])}
                                        rawValue={entry["term:durable"]}
                                        onOverrideEnv={() => setEntryField(selectedKey, "term:durable", false)}
                                        onChange={(next) => setEntryField(selectedKey, "term:durable", next)}
                                    />
                                </SettingRow>
                            </>
                        )}

                        {/* Section 3: Shell & Wave Integration */}
                        <SectionHeader title="Shell & Wave Integration" icon="fa-terminal" />
                        <SettingRow
                            label="Enable wsh Integration"
                            configKey="conn:wshenabled"
                            description="Enable Wave Shell (wsh) helper on this connection."
                            modified={Object.hasOwn(entry, "conn:wshenabled")}
                            onReset={() => unsetEntryField(selectedKey, "conn:wshenabled")}
                        >
                            <ToggleControl
                                checked={entry["conn:wshenabled"] !== undefined ? Boolean(entry["conn:wshenabled"]) : true}
                                rawValue={entry["conn:wshenabled"]}
                                onOverrideEnv={() => setEntryField(selectedKey, "conn:wshenabled", true)}
                                onChange={(next) => setEntryField(selectedKey, "conn:wshenabled", next)}
                            />
                        </SettingRow>
                        <SettingRow
                            label="Ask Before Installing wsh"
                            configKey="conn:askbeforewshinstall"
                            description="Prompt before automatically installing the wsh binary."
                            modified={Object.hasOwn(entry, "conn:askbeforewshinstall")}
                            onReset={() => unsetEntryField(selectedKey, "conn:askbeforewshinstall")}
                        >
                            <ToggleControl
                                checked={
                                    entry["conn:askbeforewshinstall"] !== undefined
                                        ? Boolean(entry["conn:askbeforewshinstall"])
                                        : true
                                }
                                rawValue={entry["conn:askbeforewshinstall"]}
                                onOverrideEnv={() => setEntryField(selectedKey, "conn:askbeforewshinstall", true)}
                                onChange={(next) => setEntryField(selectedKey, "conn:askbeforewshinstall", next)}
                            />
                        </SettingRow>
                        <SettingRow
                            label="Shell Path"
                            configKey="conn:shellpath"
                            description="Override the default shell executable for this connection."
                            modified={Object.hasOwn(entry, "conn:shellpath")}
                            onReset={() => unsetEntryField(selectedKey, "conn:shellpath")}
                        >
                            <TextControl
                                value={typeof entry["conn:shellpath"] === "string" ? entry["conn:shellpath"] : ""}
                                placeholder="/bin/zsh or pwsh.exe"
                                onChange={(next) => setEntryField(selectedKey, "conn:shellpath", next)}
                            />
                        </SettingRow>

                        {/* Section 4: Terminal Overrides & Environment */}
                        <SectionHeader title="Terminal Overrides & Environment" icon="fa-palette" />
                        <SettingRow
                            label="Terminal Theme"
                            configKey="term:theme"
                            description="Override terminal color theme for this connection."
                            modified={Object.hasOwn(entry, "term:theme")}
                            onReset={() => unsetEntryField(selectedKey, "term:theme")}
                        >
                            <SelectControl
                                value={currentThemeVal}
                                options={resolvedThemeOptions}
                                rawValue={entry["term:theme"]}
                                onOverrideEnv={() => unsetEntryField(selectedKey, "term:theme")}
                                onChange={(next) => setEntryField(selectedKey, "term:theme", next)}
                            />
                        </SettingRow>
                        <SettingRow
                            label="Font Family"
                            configKey="term:fontfamily"
                            description="Override terminal font family for this connection."
                            modified={Object.hasOwn(entry, "term:fontfamily")}
                            onReset={() => unsetEntryField(selectedKey, "term:fontfamily")}
                        >
                            <TextControl
                                value={typeof entry["term:fontfamily"] === "string" ? entry["term:fontfamily"] : ""}
                                placeholder="Inherit default"
                                onChange={(next) => setEntryField(selectedKey, "term:fontfamily", next)}
                            />
                        </SettingRow>
                        <SettingRow
                            label="Font Size"
                            configKey="term:fontsize"
                            description="Override terminal font size in pixels (8–32)."
                            modified={Object.hasOwn(entry, "term:fontsize")}
                            onReset={() => unsetEntryField(selectedKey, "term:fontsize")}
                        >
                            <NumberControl
                                value={typeof entry["term:fontsize"] === "number" ? entry["term:fontsize"] : ""}
                                min={8}
                                max={32}
                                step={1}
                                integer={true}
                                placeholder="Default"
                                rawValue={entry["term:fontsize"]}
                                onOverrideEnv={() => unsetEntryField(selectedKey, "term:fontsize")}
                                onChange={(next) => setEntryField(selectedKey, "term:fontsize", next)}
                            />
                        </SettingRow>
                        <SettingRow
                            label="Environment Variables"
                            configKey="cmd:env"
                            description="Additional environment variables injected into shell sessions."
                            modified={Object.hasOwn(entry, "cmd:env")}
                            onReset={() => unsetEntryField(selectedKey, "cmd:env")}
                        >
                            {isEnvMacroValue(entry["cmd:env"]) ? (
                                <EnvMacroBadge
                                    value={entry["cmd:env"]}
                                    onOverride={() => unsetEntryField(selectedKey, "cmd:env")}
                                />
                            ) : (
                                <KeyValueControl
                                    entries={isPlainObject(entry["cmd:env"]) ? entry["cmd:env"] : {}}
                                    keyPlaceholder="VAR_NAME"
                                    valuePlaceholder="value"
                                    onChange={(next) => setEntryField(selectedKey, "cmd:env", next)}
                                />
                            )}
                        </SettingRow>
                        <SettingRow
                            label="Init Script"
                            configKey="cmd:initscript"
                            description="Script or command executed when a new shell starts on this connection."
                            modified={Object.hasOwn(entry, "cmd:initscript")}
                            onReset={() => unsetEntryField(selectedKey, "cmd:initscript")}
                        >
                            <textarea
                                rows={3}
                                value={typeof entry["cmd:initscript"] === "string" ? entry["cmd:initscript"] : ""}
                                onChange={(e) => setEntryField(selectedKey, "cmd:initscript", e.target.value)}
                                placeholder="# Optional shell init commands..."
                                className="w-72 px-2.5 py-1.5 rounded bg-panel border border-border text-xs font-mono text-primary focus:outline-none focus:border-accent resize-y"
                            />
                        </SettingRow>

                        {/* Preserved Advanced Keys */}
                        {advancedKeys.length > 0 && (
                            <div className="mx-4 mt-4 px-3 py-2.5 rounded border border-border bg-panel/40 flex items-center justify-between gap-3">
                                <div className="text-xs text-secondary min-w-0">
                                    <span className="font-medium text-primary">
                                        {advancedKeys.length} additional key{advancedKeys.length === 1 ? "" : "s"} preserved:{" "}
                                    </span>
                                    <span className="font-mono text-muted-foreground">
                                        {advancedKeys.join(", ")}
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setActiveTab("json")}
                                    className="px-2.5 py-1 rounded border border-border text-xs text-secondary hover:text-primary hover:bg-secondary/50 shrink-0 cursor-pointer"
                                >
                                    Edit in Raw JSON
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
});

ConnectionsVisualContent.displayName = "ConnectionsVisualContent";
