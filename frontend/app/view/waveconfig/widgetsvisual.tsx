// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    DeferredKeyRenameControl,
    InvalidJsonBanner,
    NumberControl,
    SelectControl,
    SettingRow,
    TextControl,
    ToggleControl,
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
import { useAtomValue, useSetAtom } from "jotai";
import { memo, useMemo, useState } from "react";

const hasOwn = (obj: Record<string, any> | null | undefined, key: string): boolean =>
    obj != null && Object.prototype.hasOwnProperty.call(obj, key);

const WIDGET_KEY_PATTERN = /^[a-zA-Z0-9_@.-]+$/;

const VIEW_OPTIONS: SelectOption[] = [
    { value: "term", label: "Terminal (term)" },
    { value: "web", label: "Web Browser (web)" },
    { value: "preview", label: "File / Folder Preview (preview)" },
    { value: "sysinfo", label: "System Info (sysinfo)" },
    { value: "launcher", label: "Launcher (launcher)" },
];

const CONTROLLER_OPTIONS: SelectOption[] = [
    { value: "shell", label: "Interactive Shell (shell)" },
    { value: "cmd", label: "Command Runner (cmd)" },
];

const ICON_PRESETS = ["terminal", "folder", "globe", "bolt", "robot", "code", "rocket", "microchip", "book", "star"];
const COLOR_PRESETS = ["#58c142", "#3b82f6", "#a855f7", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899"];

interface WidgetTemplate {
    id: string;
    name: string;
    icon: string;
    slug: string;
    config: Record<string, any>;
}

const WIDGET_TEMPLATES: WidgetTemplate[] = [
    {
        id: "term",
        name: "Terminal Shortcut",
        icon: "terminal",
        slug: "defwidget@term-custom",
        config: {
            icon: "terminal",
            color: "#58c142",
            label: "Project Term",
            description: "Open terminal in a preset folder",
            blockdef: {
                meta: {
                    view: "term",
                    controller: "shell",
                    "cmd:cwd": "",
                },
            },
        },
    },
    {
        id: "cmd",
        name: "Quick Command / AI Agent",
        icon: "bolt",
        slug: "defwidget@quick-cmd",
        config: {
            icon: "bolt",
            color: "#a855f7",
            label: "Run Tool",
            description: "Launch a CLI tool or AI Agent",
            blockdef: {
                meta: {
                    view: "term",
                    controller: "cmd",
                    cmd: "",
                    "cmd:cwd": "",
                    "cmd:interactive": true,
                    "cmd:runonstart": true,
                },
            },
        },
    },
    {
        id: "web",
        name: "Web Bookmark",
        icon: "globe",
        slug: "defwidget@web-custom",
        config: {
            icon: "globe",
            color: "#3b82f6",
            label: "Web App",
            description: "Open a URL in a Web block",
            blockdef: {
                meta: {
                    view: "web",
                    url: "https://",
                },
            },
        },
    },
    {
        id: "preview",
        name: "Folder / File Preview",
        icon: "folder",
        slug: "defwidget@files-custom",
        config: {
            icon: "folder",
            color: "#f59e0b",
            label: "Files",
            description: "Open a folder or file in Preview",
            blockdef: {
                meta: {
                    view: "preview",
                    file: "~",
                },
            },
        },
    },
    {
        id: "sysinfo",
        name: "System Info",
        icon: "microchip",
        slug: "defwidget@sysinfo-custom",
        config: {
            icon: "microchip",
            color: "#06b6d4",
            label: "SysInfo",
            description: "CPU & memory monitor",
            blockdef: {
                meta: {
                    view: "sysinfo",
                },
            },
        },
    },
];

function uniqueWidgetKey(base: string, existing: Set<string>): string {
    if (!existing.has(base)) return base;
    let i = 2;
    while (existing.has(`${base}-${i}`)) i++;
    return `${base}-${i}`;
}

export const WidgetsVisualContent = memo(({ model }: { model: WaveConfigViewModel }) => {
    const env = useWaveEnv<WaveConfigEnv>();
    const fullConfig = useAtomValue(env.atoms.fullConfigAtom);
    const setActiveTab = useSetAtom(model.activeTabAtom);
    const { parsed, parseError, replaceData } = useVisualConfigJson(model);

    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [selectedIsBuiltIn, setSelectedIsBuiltIn] = useState(false);
    const [showTemplates, setShowTemplates] = useState(false);
    const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);

    const builtInWidgets = useMemo<Record<string, any>>(() => fullConfig?.defaultwidgets ?? fullConfig?.widgets ?? {}, [
        fullConfig?.defaultwidgets,
        fullConfig?.widgets,
    ]);

    const customKeys = useMemo(() => {
        if (!parsed) return [];
        return Object.keys(parsed)
            .filter((k) => !isUnsafeObjectKey(k))
            .sort((a, b) => {
                const oa = parsed[a]?.["display:order"] ?? 0;
                const ob = parsed[b]?.["display:order"] ?? 0;
                if (oa !== ob) return oa - ob;
                return a.localeCompare(b);
            });
    }, [parsed]);

    const uncustomizedBuiltInKeys = useMemo(() => {
        if (!parsed) return [];
        return Object.keys(builtInWidgets)
            .filter((k) => !isUnsafeObjectKey(k) && !hasOwn(parsed, k))
            .sort((a, b) => {
                const oa = builtInWidgets[a]?.["display:order"] ?? 0;
                const ob = builtInWidgets[b]?.["display:order"] ?? 0;
                if (oa !== ob) return oa - ob;
                return a.localeCompare(b);
            });
    }, [parsed, builtInWidgets]);

    if (parseError || !parsed) {
        return <InvalidJsonBanner error={parseError || "Invalid JSON"} onOpenRawJson={() => setActiveTab("json")} />;
    }

    const activeKey =
        selectedKey && ((selectedIsBuiltIn && hasOwn(builtInWidgets, selectedKey)) || hasOwn(parsed, selectedKey))
            ? selectedKey
            : customKeys[0] ?? uncustomizedBuiltInKeys[0] ?? null;
    const isViewingBuiltInOnly = activeKey != null && !hasOwn(parsed, activeKey) && hasOwn(builtInWidgets, activeKey);

    const allKnownKeys = new Set([...Object.keys(parsed), ...Object.keys(builtInWidgets)]);

    const handleCreateFromTemplate = (tpl: WidgetTemplate) => {
        const key = uniqueWidgetKey(tpl.slug, allKnownKeys);
        const clone = JSON.parse(JSON.stringify(tpl.config));
        replaceData(updateConfigKey(parsed, key, clone));
        setSelectedKey(key);
        setSelectedIsBuiltIn(false);
        setShowTemplates(false);
    };

    const handleCustomizeBuiltIn = (key: string) => {
        const src = builtInWidgets[key];
        if (!src) return;
        const clone = JSON.parse(JSON.stringify(src));
        replaceData(updateConfigKey(parsed, key, clone));
        setSelectedKey(key);
        setSelectedIsBuiltIn(false);
    };

    const handleHideBuiltIn = (key: string) => {
        replaceData(updateConfigKey(parsed, key, null));
        setSelectedKey(key);
        setSelectedIsBuiltIn(false);
    };

    const handleRestoreBuiltIn = (key: string) => {
        replaceData(deleteConfigKey(parsed, key));
        setSelectedKey(key);
        setSelectedIsBuiltIn(true);
    };

    const updateEntry = (key: string, updater: (cur: Record<string, any>) => Record<string, any>) => {
        const cur = parsed[key];
        if (!cur || typeof cur !== "object" || Array.isArray(cur)) return;
        const nextEntry = updater({ ...cur });
        replaceData(updateConfigKey(parsed, key, nextEntry));
    };

    const updateMeta = (key: string, metaKey: string, val: any) => {
        updateEntry(key, (cur) => {
            const blockdef = cur.blockdef && typeof cur.blockdef === "object" ? { ...cur.blockdef } : {};
            const meta = blockdef.meta && typeof blockdef.meta === "object" ? { ...blockdef.meta } : {};
            if (val === undefined || val === "") {
                delete meta[metaKey];
            } else {
                meta[metaKey] = val;
            }
            blockdef.meta = meta;
            return { ...cur, blockdef };
        });
    };

    const activeEntry = activeKey ? (isViewingBuiltInOnly ? builtInWidgets[activeKey] : parsed[activeKey]) : null;
    const isNullTombstone = activeKey != null && !isViewingBuiltInOnly && parsed[activeKey] === null;
    const isMalformed =
        activeKey != null && !isNullTombstone && (typeof activeEntry !== "object" || activeEntry == null || Array.isArray(activeEntry));
    const activeMeta: Record<string, any> =
        !isNullTombstone && !isMalformed && activeEntry?.blockdef?.meta && typeof activeEntry.blockdef.meta === "object"
            ? activeEntry.blockdef.meta
            : {};
    const activeView = String(activeMeta.view ?? "term");
    const isBuiltInOverride = activeKey != null && !isViewingBuiltInOnly && hasOwn(builtInWidgets, activeKey);

    return (
        <div className="flex flex-row h-full min-h-0">
            {/* Left List */}
            <div className="w-64 border-r border-border flex flex-col min-h-0 shrink-0 bg-panel/30">
                <div className="p-3 border-b border-border flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-secondary">Widgets</span>
                    <button
                        type="button"
                        onClick={() => setShowTemplates((s) => !s)}
                        className="px-2.5 py-1 rounded bg-accent/80 hover:bg-accent text-xs text-primary cursor-pointer transition-colors"
                    >
                        + Add Widget
                    </button>
                </div>

                {showTemplates && (
                    <div className="p-2 border-b border-border bg-secondary/30 flex flex-col gap-1">
                        <div className="text-[11px] text-muted-foreground px-1 mb-0.5">Choose a widget template:</div>
                        {WIDGET_TEMPLATES.map((tpl) => (
                            <button
                                key={tpl.id}
                                type="button"
                                onClick={() => handleCreateFromTemplate(tpl)}
                                className="flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left text-primary hover:bg-secondary/70 cursor-pointer transition-colors"
                            >
                                <i className={`fa fa-solid fa-${tpl.icon} w-4 text-center text-accent`} />
                                <span>{tpl.name}</span>
                            </button>
                        ))}
                    </div>
                )}

                <div className="flex-1 overflow-y-auto min-h-0">
                    {customKeys.length > 0 && (
                        <>
                            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold bg-secondary/20">
                                Custom & Modified ({customKeys.length})
                            </div>
                            {customKeys.map((k) => {
                                const entry = parsed[k];
                                const isHiddenNull = entry === null;
                                const isSel = activeKey === k && !isViewingBuiltInOnly;
                                return (
                                    <div
                                        key={k}
                                        onClick={() => {
                                            setSelectedKey(k);
                                            setSelectedIsBuiltIn(false);
                                            setConfirmDeleteKey(null);
                                        }}
                                        className={cn(
                                            "px-3 py-2 border-b border-border/50 cursor-pointer flex items-center gap-2 transition-colors",
                                            isSel ? "bg-accentbg text-primary" : "hover:bg-secondary/40 text-secondary"
                                        )}
                                    >
                                        <i
                                            className={`fa fa-solid fa-${entry?.icon || "cube"} w-4 text-center shrink-0`}
                                            style={entry?.color ? { color: entry.color } : undefined}
                                        />
                                        <div className="min-w-0 flex-1">
                                            <div className="text-xs font-medium truncate text-primary">
                                                {isHiddenNull ? k : entry?.label || k}
                                            </div>
                                            <div className="text-[11px] text-muted-foreground truncate font-mono">{k}</div>
                                        </div>
                                        {isHiddenNull && (
                                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground shrink-0">
                                                Hidden
                                            </span>
                                        )}
                                        {!isHiddenNull && entry?.["display:hidden"] && (
                                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground shrink-0">
                                                Off
                                            </span>
                                        )}
                                    </div>
                                );
                            })}
                        </>
                    )}

                    {uncustomizedBuiltInKeys.length > 0 && (
                        <>
                            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold bg-secondary/20">
                                Built-in Widgets ({uncustomizedBuiltInKeys.length})
                            </div>
                            {uncustomizedBuiltInKeys.map((k) => {
                                const entry = builtInWidgets[k];
                                const isSel = activeKey === k && isViewingBuiltInOnly;
                                return (
                                    <div
                                        key={k}
                                        onClick={() => {
                                            setSelectedKey(k);
                                            setSelectedIsBuiltIn(true);
                                            setConfirmDeleteKey(null);
                                        }}
                                        className={cn(
                                            "px-3 py-2 border-b border-border/50 cursor-pointer flex items-center gap-2 transition-colors",
                                            isSel ? "bg-accentbg text-primary" : "hover:bg-secondary/40 text-secondary"
                                        )}
                                    >
                                        <i
                                            className={`fa fa-solid fa-${entry?.icon || "cube"} w-4 text-center shrink-0`}
                                            style={entry?.color ? { color: entry.color } : undefined}
                                        />
                                        <div className="min-w-0 flex-1">
                                            <div className="text-xs font-medium truncate text-primary">
                                                {entry?.label || k}
                                            </div>
                                            <div className="text-[11px] text-muted-foreground truncate font-mono">{k}</div>
                                        </div>
                                    </div>
                                );
                            })}
                        </>
                    )}
                </div>
            </div>

            {/* Right Detail Editor */}
            <div className="flex-1 overflow-y-auto min-h-0">
                {!activeKey ? (
                    <div className="p-8 text-center text-sm text-muted-foreground">
                        Click <strong>+ Add Widget</strong> to create a custom sidebar shortcut.
                    </div>
                ) : isNullTombstone ? (
                    <div className="p-6 flex flex-col gap-3">
                        <div className="text-base font-semibold text-primary">Hidden Built-in Widget</div>
                        <div className="text-sm text-secondary">
                            <code className="font-mono">{activeKey}</code> is currently hidden (<code>null</code> in{" "}
                            <code>widgets.json</code>).
                        </div>
                        <div>
                            <button
                                type="button"
                                onClick={() => handleRestoreBuiltIn(activeKey)}
                                className="px-3 py-1.5 rounded bg-accent/80 hover:bg-accent text-sm text-primary cursor-pointer"
                            >
                                Restore Default Widget
                            </button>
                        </div>
                    </div>
                ) : isMalformed ? (
                    <div className="p-6 flex flex-col gap-3">
                        <div className="text-error font-semibold">Malformed widget entry: {activeKey}</div>
                        <button
                            type="button"
                            onClick={() => setActiveTab("json")}
                            className="px-3 py-1.5 rounded bg-secondary text-sm text-primary w-fit cursor-pointer"
                        >
                            Edit in Raw JSON
                        </button>
                    </div>
                ) : isViewingBuiltInOnly ? (
                    <div className="p-6 flex flex-col gap-4">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded bg-secondary/60 flex items-center justify-center">
                                <i
                                    className={`fa fa-solid fa-${activeEntry?.icon || "cube"} text-lg`}
                                    style={activeEntry?.color ? { color: activeEntry.color } : undefined}
                                />
                            </div>
                            <div>
                                <div className="text-base font-semibold text-primary">
                                    {activeEntry?.label || activeKey}
                                </div>
                                <div className="text-xs text-muted-foreground font-mono">{activeKey} (Built-in)</div>
                            </div>
                        </div>
                        {activeEntry?.description && (
                            <div className="text-sm text-secondary">{activeEntry.description}</div>
                        )}
                        <div className="text-xs text-muted-foreground font-mono bg-panel p-3 rounded border border-border">
                            view: {activeMeta.view || "term"}
                            {activeMeta.url ? ` | url: ${activeMeta.url}` : ""}
                            {activeMeta.file ? ` | file: ${activeMeta.file}` : ""}
                            {activeMeta.cmd ? ` | cmd: ${activeMeta.cmd}` : ""}
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => handleCustomizeBuiltIn(activeKey)}
                                className="px-3 py-1.5 rounded bg-accent/80 hover:bg-accent text-sm text-primary cursor-pointer"
                            >
                                Customize
                            </button>
                            <button
                                type="button"
                                onClick={() => handleHideBuiltIn(activeKey)}
                                className="px-3 py-1.5 rounded border border-border hover:bg-secondary/50 text-sm text-secondary hover:text-primary cursor-pointer"
                            >
                                Hide from Sidebar
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col">
                        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-panel/40">
                            <div className="flex items-center gap-2.5 min-w-0">
                                <i
                                    className={`fa fa-solid fa-${activeEntry.icon || "cube"} text-base`}
                                    style={activeEntry.color ? { color: activeEntry.color } : undefined}
                                />
                                <span className="text-sm font-semibold text-primary truncate">
                                    {activeEntry.label || activeKey}
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                {isBuiltInOverride ? (
                                    <>
                                        <button
                                            type="button"
                                            onClick={() => handleRestoreBuiltIn(activeKey)}
                                            className="px-2.5 py-1 rounded border border-border text-xs text-secondary hover:text-primary cursor-pointer"
                                        >
                                            Reset to Default
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleHideBuiltIn(activeKey)}
                                            className="px-2.5 py-1 rounded border border-border text-xs text-secondary hover:text-error cursor-pointer"
                                        >
                                            Hide Built-in
                                        </button>
                                    </>
                                ) : confirmDeleteKey === activeKey ? (
                                    <div className="flex items-center gap-1.5">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                replaceData(deleteConfigKey(parsed, activeKey));
                                                setSelectedKey(null);
                                                setConfirmDeleteKey(null);
                                            }}
                                            className="px-2.5 py-1 rounded bg-error text-xs text-white cursor-pointer"
                                        >
                                            Confirm Delete
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setConfirmDeleteKey(null)}
                                            className="px-2 py-1 rounded border border-border text-xs text-secondary cursor-pointer"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => setConfirmDeleteKey(activeKey)}
                                        className="px-2.5 py-1 rounded border border-border text-xs text-secondary hover:text-error cursor-pointer"
                                    >
                                        Delete
                                    </button>
                                )}
                            </div>
                        </div>

                        <SettingRow label="Widget Key" description="Unique identifier in widgets.json.">
                            <DeferredKeyRenameControl
                                currentKey={activeKey}
                                existingKeys={Object.keys(parsed).filter((k) => k !== activeKey)}
                                pattern={WIDGET_KEY_PATTERN}
                                patternError="Only letters, numbers, _, @, ., and - are allowed"
                                onRename={(nextKey) => {
                                    replaceData(renameConfigKey(parsed, activeKey, nextKey));
                                    setSelectedKey(nextKey);
                                }}
                            />
                        </SettingRow>

                        <SettingRow label="Label" configKey="label" description="Short text shown under the sidebar icon.">
                            <TextControl
                                value={String(activeEntry.label ?? "")}
                                placeholder="My Widget"
                                onChange={(val) =>
                                    updateEntry(activeKey, (cur) => {
                                        if (val === "") delete cur.label;
                                        else cur.label = val;
                                        return cur;
                                    })
                                }
                            />
                        </SettingRow>

                        <SettingRow label="Description" configKey="description" description="Tooltip shown on hover.">
                            <TextControl
                                value={String(activeEntry.description ?? "")}
                                placeholder="Shortcut description"
                                onChange={(val) =>
                                    updateEntry(activeKey, (cur) => {
                                        if (val === "") delete cur.description;
                                        else cur.description = val;
                                        return cur;
                                    })
                                }
                            />
                        </SettingRow>

                        <SettingRow label="Icon (FontAwesome)" configKey="icon" description="Icon name without 'fa-' prefix.">
                            <div className="flex flex-col items-end gap-1.5">
                                <TextControl
                                    value={String(activeEntry.icon ?? "")}
                                    placeholder="terminal"
                                    onChange={(val) =>
                                        updateEntry(activeKey, (cur) => {
                                            if (val === "") delete cur.icon;
                                            else cur.icon = val;
                                            return cur;
                                        })
                                    }
                                />
                                <div className="flex flex-wrap gap-1 justify-end max-w-xs">
                                    {ICON_PRESETS.map((ic) => (
                                        <button
                                            key={ic}
                                            type="button"
                                            onClick={() => updateEntry(activeKey, (cur) => ({ ...cur, icon: ic }))}
                                            title={ic}
                                            className={cn(
                                                "w-6 h-6 rounded flex items-center justify-center text-xs cursor-pointer transition-colors",
                                                activeEntry.icon === ic
                                                    ? "bg-accent text-primary"
                                                    : "bg-secondary/50 text-secondary hover:text-primary"
                                            )}
                                        >
                                            <i className={`fa fa-solid fa-${ic}`} />
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </SettingRow>

                        <SettingRow label="Icon Color" configKey="color" description="CSS color for the sidebar icon.">
                            <div className="flex items-center gap-1.5">
                                {COLOR_PRESETS.map((c) => (
                                    <button
                                        key={c}
                                        type="button"
                                        onClick={() => updateEntry(activeKey, (cur) => ({ ...cur, color: c }))}
                                        className="w-5 h-5 rounded-full border border-white/20 cursor-pointer"
                                        style={{ backgroundColor: c }}
                                        title={c}
                                    />
                                ))}
                                <TextControl
                                    value={String(activeEntry.color ?? "")}
                                    placeholder="#58c142"
                                    className="w-28"
                                    onChange={(val) =>
                                        updateEntry(activeKey, (cur) => {
                                            if (val === "") delete cur.color;
                                            else cur.color = val;
                                            return cur;
                                        })
                                    }
                                />
                            </div>
                        </SettingRow>

                        <SettingRow label="Display Order" configKey="display:order" description="Lower numbers appear higher in the sidebar.">
                            <NumberControl
                                value={typeof activeEntry["display:order"] === "number" ? activeEntry["display:order"] : ""}
                                onChange={(val) =>
                                    updateEntry(activeKey, (cur) => {
                                        if (val === undefined) delete cur["display:order"];
                                        else cur["display:order"] = val;
                                        return cur;
                                    })
                                }
                            />
                        </SettingRow>

                        <SettingRow label="Hide Widget" configKey="display:hidden" description="Hide this widget from the sidebar without deleting it.">
                            <ToggleControl
                                checked={Boolean(activeEntry["display:hidden"])}
                                onChange={(val) =>
                                    updateEntry(activeKey, (cur) => {
                                        if (!val) delete cur["display:hidden"];
                                        else cur["display:hidden"] = true;
                                        return cur;
                                    })
                                }
                            />
                        </SettingRow>

                        <SettingRow label="Open Magnified" configKey="magnified" description="Open the block maximized when clicked.">
                            <ToggleControl
                                checked={Boolean(activeEntry.magnified)}
                                onChange={(val) =>
                                    updateEntry(activeKey, (cur) => {
                                        if (!val) delete cur.magnified;
                                        else cur.magnified = true;
                                        return cur;
                                    })
                                }
                            />
                        </SettingRow>

                        <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-secondary bg-secondary/20 border-b border-border">
                            Block Action (blockdef.meta)
                        </div>

                        <SettingRow label="Block View Type" configKey="blockdef.meta.view">
                            <SelectControl
                                value={activeView}
                                options={VIEW_OPTIONS}
                                onChange={(val) => updateMeta(activeKey, "view", val)}
                            />
                        </SettingRow>

                        {activeView === "term" && (
                            <>
                                <SettingRow label="Controller" configKey="blockdef.meta.controller">
                                    <SelectControl
                                        value={String(activeMeta.controller ?? "shell")}
                                        options={CONTROLLER_OPTIONS}
                                        onChange={(val) => updateMeta(activeKey, "controller", val)}
                                    />
                                </SettingRow>
                                <SettingRow label="Working Directory" configKey="blockdef.meta.cmd:cwd" description="Initial folder (e.g. N:/Wave or ~).">
                                    <TextControl
                                        value={String(activeMeta["cmd:cwd"] ?? "")}
                                        placeholder="N:/Wave"
                                        onChange={(val) => updateMeta(activeKey, "cmd:cwd", val)}
                                    />
                                </SettingRow>
                                {activeMeta.controller === "cmd" && (
                                    <>
                                        <SettingRow label="Command" configKey="blockdef.meta.cmd" description="Executable or script to run.">
                                            <TextControl
                                                value={String(activeMeta.cmd ?? "")}
                                                placeholder="agy"
                                                onChange={(val) => updateMeta(activeKey, "cmd", val)}
                                            />
                                        </SettingRow>
                                        <SettingRow label="Run on Start" configKey="blockdef.meta.cmd:runonstart">
                                            <ToggleControl
                                                checked={Boolean(activeMeta["cmd:runonstart"])}
                                                onChange={(val) => updateMeta(activeKey, "cmd:runonstart", val || undefined)}
                                            />
                                        </SettingRow>
                                        <SettingRow label="Interactive PTY" configKey="blockdef.meta.cmd:interactive">
                                            <ToggleControl
                                                checked={Boolean(activeMeta["cmd:interactive"])}
                                                onChange={(val) => updateMeta(activeKey, "cmd:interactive", val || undefined)}
                                            />
                                        </SettingRow>
                                    </>
                                )}
                                <SettingRow label="Connection" configKey="blockdef.meta.connection" description="Optional SSH/WSL connection name.">
                                    <TextControl
                                        value={String(activeMeta.connection ?? "")}
                                        placeholder="local"
                                        onChange={(val) => updateMeta(activeKey, "connection", val)}
                                    />
                                </SettingRow>
                            </>
                        )}

                        {activeView === "web" && (
                            <SettingRow label="URL" configKey="blockdef.meta.url" description="Web address to open.">
                                <TextControl
                                    value={String(activeMeta.url ?? "")}
                                    placeholder="https://github.com"
                                    onChange={(val) => updateMeta(activeKey, "url", val)}
                                />
                            </SettingRow>
                        )}

                        {activeView === "preview" && (
                            <SettingRow label="File or Folder Path" configKey="blockdef.meta.file" description="Path opened in Preview block.">
                                <TextControl
                                    value={String(activeMeta.file ?? "")}
                                    placeholder="~"
                                    onChange={(val) => updateMeta(activeKey, "file", val)}
                                />
                            </SettingRow>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
});

WidgetsVisualContent.displayName = "WidgetsVisualContent";
