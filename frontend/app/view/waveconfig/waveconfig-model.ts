// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockNodeModel } from "@/app/block/blocktypes";
import { globalStore } from "@/app/store/jotaiStore";
import type { TabModel } from "@/app/store/tab-model";
import { makeORef } from "@/app/store/wos";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { BackgroundsVisualContent } from "@/app/view/waveconfig/backgroundsvisual";
import { ConnectionsVisualContent } from "@/app/view/waveconfig/connectionsvisual";
import { SecretsContent } from "@/app/view/waveconfig/secretscontent";
import { SettingsVisualContent } from "@/app/view/waveconfig/settingsvisual";
import { isUnsafeObjectKey } from "@/app/view/waveconfig/visual-config-utils";
import { WaveAIVisualContent } from "@/app/view/waveconfig/waveaivisual";
import { WaveConfigView } from "@/app/view/waveconfig/waveconfig";
import type { WaveConfigEnv } from "@/app/view/waveconfig/waveconfigenv";
import { base64ToString, stringToBase64 } from "@/util/util";
import { atom, type Atom, type PrimitiveAtom } from "jotai";
import type * as MonacoTypes from "monaco-editor";
import * as React from "react";

type ValidationResult = { success: true } | { error: string };
type ConfigValidator = (parsed: any) => ValidationResult;

export type ConfigFile = {
    name: string;
    path: string;
    language?: string;
    deprecated?: boolean;
    description?: string;
    docsUrl?: string;
    validator?: ConfigValidator;
    isSecrets?: boolean;
    hasJsonView?: boolean;
    visualComponent?: React.ComponentType<{ model: WaveConfigViewModel }>;
};

export const SecretNameRegex = /^[A-Za-z][A-Za-z0-9_]*$/;

function validateAiJson(parsed: any): ValidationResult {
    const keys = Object.keys(parsed);
    for (const key of keys) {
        if (!key.startsWith("ai@")) {
            return { error: `Invalid key "${key}": all top-level keys must start with "ai@"` };
        }
    }
    return { success: true };
}

function validateSettingsJson(parsed: any): ValidationResult {
    const intKeys = ["term:scrollback", "window:maxtabcachesize", "term:fontsize", "editor:fontsize"];
    for (const key of intKeys) {
        if (Object.hasOwn(parsed, key)) {
            const val = parsed[key];
            if (typeof val === "number" && !Number.isInteger(val)) {
                return { error: `"${key}" must be an integer` };
            }
        }
    }
    return { success: true };
}

function validateConnectionsJson(parsed: any): ValidationResult {
    for (const key of Object.keys(parsed)) {
        if (isUnsafeObjectKey(key)) {
            return { error: `Reserved key "${key}" is not allowed` };
        }
        const entry = parsed[key];
        if (entry != null && (typeof entry !== "object" || Array.isArray(entry))) {
            return { error: `Connection "${key}" must be an object` };
        }
        if (entry && Object.hasOwn(entry, "ssh:port") && typeof entry["ssh:port"] !== "string") {
            return { error: `Connection "${key}": "ssh:port" must be a string (e.g. "22")` };
        }
    }
    return { success: true };
}

function validateBackgroundsJson(parsed: any): ValidationResult {
    for (const key of Object.keys(parsed)) {
        if (isUnsafeObjectKey(key)) {
            return { error: `Reserved key "${key}" is not allowed` };
        }
        const entry = parsed[key];
        if (entry === null) {
            continue;
        }
        if (typeof entry !== "object" || Array.isArray(entry)) {
            return { error: `Background "${key}" must be an object or null` };
        }
        if (typeof entry["display:name"] !== "string" || entry["display:name"].trim() === "") {
            return { error: `Background "${key}" requires a non-empty "display:name"` };
        }
        if (Object.hasOwn(entry, "bg:opacity")) {
            const op = entry["bg:opacity"];
            if (typeof op !== "number" || op < 0 || op > 1) {
                return { error: `Background "${key}": "bg:opacity" must be a number between 0 and 1` };
            }
        }
    }
    return { success: true };
}

const VALID_THINKING_LEVELS = new Set(["low", "medium", "high"]);

function validateWaveAiJson(parsed: any): ValidationResult {
    const keys = Object.keys(parsed);
    const keyPattern = /^[a-zA-Z0-9_@.-]+$/;
    for (const key of keys) {
        if (isUnsafeObjectKey(key)) {
            return { error: `Reserved key "${key}" is not allowed` };
        }
        if (!keyPattern.test(key)) {
            return {
                error: `Invalid key "${key}": keys must only contain letters, numbers, underscores, @, dots, and hyphens`,
            };
        }
        const entry = parsed[key];
        if (typeof entry !== "object" || entry == null || Array.isArray(entry)) {
            return { error: `AI mode "${key}" must be an object` };
        }
        if (typeof entry["display:name"] !== "string" || entry["display:name"].trim() === "") {
            return { error: `AI mode "${key}" requires a non-empty "display:name"` };
        }
        if (
            Object.hasOwn(entry, "ai:thinkinglevel") &&
            typeof entry["ai:thinkinglevel"] === "string" &&
            !VALID_THINKING_LEVELS.has(entry["ai:thinkinglevel"])
        ) {
            return { error: `AI mode "${key}": "ai:thinkinglevel" must be one of low, medium, high` };
        }
    }
    return { success: true };
}

function makeConfigFiles(isWindows: boolean): ConfigFile[] {
    return [
        {
            name: "General",
            path: "settings.json",
            language: "json",
            docsUrl: "https://docs.waveterm.dev/config",
            validator: validateSettingsJson,
            hasJsonView: true,
            visualComponent: SettingsVisualContent,
        },
        {
            name: "Connections",
            path: "connections.json",
            language: "json",
            docsUrl: "https://docs.waveterm.dev/connections",
            description: isWindows ? "SSH hosts and WSL distros" : "SSH hosts",
            validator: validateConnectionsJson,
            hasJsonView: true,
            visualComponent: ConnectionsVisualContent,
        },
        {
            name: "Sidebar Widgets",
            path: "widgets.json",
            language: "json",
            docsUrl: "https://docs.waveterm.dev/customwidgets",
            hasJsonView: true,
        },
        {
            name: "Wave AI Modes",
            path: "waveai.json",
            language: "json",
            description: "Local models and BYOK",
            docsUrl: "https://docs.waveterm.dev/waveai-modes",
            validator: validateWaveAiJson,
            hasJsonView: true,
            visualComponent: WaveAIVisualContent,
        },
        {
            name: "Tab Backgrounds",
            path: "backgrounds.json",
            language: "json",
            docsUrl: "https://docs.waveterm.dev/tab-backgrounds",
            validator: validateBackgroundsJson,
            hasJsonView: true,
            visualComponent: BackgroundsVisualContent,
        },
        {
            name: "Secrets",
            path: "secrets",
            isSecrets: true,
            hasJsonView: false,
            visualComponent: SecretsContent,
        },
    ];
}

const deprecatedConfigFiles: ConfigFile[] = [
    {
        name: "Presets",
        path: "presets.json",
        language: "json",
        deprecated: true,
        hasJsonView: true,
    },
    {
        name: "AI Presets",
        path: "presets/ai.json",
        language: "json",
        deprecated: true,
        docsUrl: "https://docs.waveterm.dev/ai-presets",
        validator: validateAiJson,
        hasJsonView: true,
    },
];

export class WaveConfigViewModel implements ViewModel {
    blockId: string;
    viewType = "waveconfig";
    viewIcon = atom("gear");
    viewName = atom("Wave Config");
    viewComponent = WaveConfigView;
    noPadding = atom(true);
    nodeModel: BlockNodeModel;
    tabModel: TabModel;
    env: WaveConfigEnv;

    selectedFileAtom: PrimitiveAtom<ConfigFile>;
    fileContentAtom: PrimitiveAtom<string>;
    originalContentAtom: PrimitiveAtom<string>;
    hasEditedAtom: PrimitiveAtom<boolean>;
    isLoadingAtom: PrimitiveAtom<boolean>;
    isSavingAtom: PrimitiveAtom<boolean>;
    errorMessageAtom: PrimitiveAtom<string>;
    validationErrorAtom: PrimitiveAtom<string>;
    isMenuOpenAtom: PrimitiveAtom<boolean>;
    presetsJsonExistsAtom: PrimitiveAtom<boolean>;
    activeTabAtom: PrimitiveAtom<"visual" | "json">;
    autoSaveVisualAtom: PrimitiveAtom<boolean>;
    configErrorFilesAtom: Atom<Set<string>>;
    configDir: string;
    saveShortcut: string;
    editorRef: React.RefObject<MonacoTypes.editor.IStandaloneCodeEditor>;
    private loadSeq = 0;
    private autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
    private saveInFlight = false;
    private pendingTrailingSave = false;

    secretNamesAtom: PrimitiveAtom<string[]>;
    selectedSecretAtom: PrimitiveAtom<string | null>;
    secretValueAtom: PrimitiveAtom<string>;
    secretShownAtom: PrimitiveAtom<boolean>;
    isAddingNewAtom: PrimitiveAtom<boolean>;
    newSecretNameAtom: PrimitiveAtom<string>;
    newSecretValueAtom: PrimitiveAtom<string>;
    storageBackendErrorAtom: PrimitiveAtom<string | null>;
    secretValueRef: HTMLTextAreaElement | null = null;

    constructor({ blockId, nodeModel, tabModel, waveEnv }: ViewModelInitType) {
        this.blockId = blockId;
        this.nodeModel = nodeModel;
        this.tabModel = tabModel;
        this.env = waveEnv as WaveConfigEnv;
        this.configDir = this.env.electron.getConfigDir();
        const platform = this.env.electron.getPlatform();
        this.saveShortcut = platform === "darwin" ? "Cmd+S" : "Alt+S";

        this.selectedFileAtom = atom(null) as PrimitiveAtom<ConfigFile>;
        this.fileContentAtom = atom("");
        this.originalContentAtom = atom("");
        this.hasEditedAtom = atom(false);
        this.isLoadingAtom = atom(false);
        this.isSavingAtom = atom(false);
        this.errorMessageAtom = atom(null) as PrimitiveAtom<string>;
        this.validationErrorAtom = atom(null) as PrimitiveAtom<string>;
        this.isMenuOpenAtom = atom(false);
        this.presetsJsonExistsAtom = atom(false);
        this.activeTabAtom = atom<"visual" | "json">("visual");
        this.autoSaveVisualAtom = atom<boolean>(false);
        this.configErrorFilesAtom = atom((get) => {
            const fullConfig = get(this.env.atoms.fullConfigAtom);
            const errorSet = new Set<string>();
            for (const cerr of fullConfig?.configerrors ?? []) {
                errorSet.add(cerr.file);
            }
            return errorSet;
        });
        this.editorRef = React.createRef();

        this.secretNamesAtom = atom<string[]>([]);
        this.selectedSecretAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;
        this.secretValueAtom = atom<string>("");
        this.secretShownAtom = atom<boolean>(false);
        this.isAddingNewAtom = atom<boolean>(false);
        this.newSecretNameAtom = atom<string>("");
        this.newSecretValueAtom = atom<string>("");
        this.storageBackendErrorAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

        this.checkPresetsJsonExists();
        this.initialize();
    }

    async checkPresetsJsonExists() {
        try {
            const fullPath = `${this.configDir}/presets.json`;
            const fileInfo = await this.env.rpc.FileInfoCommand(TabRpcClient, {
                info: { path: fullPath },
            });
            if (!fileInfo.notfound) {
                globalStore.set(this.presetsJsonExistsAtom, true);
            }
        } catch {
            // File doesn't exist
        }
    }

    initialize() {
        const selectedFile = globalStore.get(this.selectedFileAtom);
        if (!selectedFile) {
            const metaFileAtom = this.env.getBlockMetaKeyAtom(this.blockId, "file");
            const savedFilePath = globalStore.get(metaFileAtom);
            const configFiles = this.getConfigFiles();
            const deprecatedConfigFiles = this.getDeprecatedConfigFiles();

            let fileToLoad: ConfigFile | null = null;
            if (savedFilePath) {
                fileToLoad =
                    configFiles.find((f) => f.path === savedFilePath) ||
                    deprecatedConfigFiles.find((f) => f.path === savedFilePath) ||
                    null;
            }

            if (!fileToLoad) {
                fileToLoad = configFiles[0];
            }

            if (fileToLoad) {
                this.loadFile(fileToLoad);
            }
        }
    }

    getConfigFiles(): ConfigFile[] {
        return makeConfigFiles(this.env.isWindows());
    }

    getDeprecatedConfigFiles(): ConfigFile[] {
        const presetsJsonExists = globalStore.get(this.presetsJsonExistsAtom);
        return deprecatedConfigFiles.filter((f) => {
            if (f.path === "presets.json") {
                return presetsJsonExists;
            }
            return true;
        });
    }

    hasChanges(): boolean {
        return globalStore.get(this.hasEditedAtom);
    }

    confirmDiscardChanges(): boolean {
        if (!this.hasChanges()) {
            return true;
        }
        return window.confirm("You have unsaved changes. Discard and continue?");
    }

    cancelPendingAutoSave() {
        if (this.autoSaveTimer != null) {
            clearTimeout(this.autoSaveTimer);
            this.autoSaveTimer = null;
        }
        this.pendingTrailingSave = false;
    }

    scheduleAutoSave() {
        if (!globalStore.get(this.autoSaveVisualAtom)) {
            return;
        }
        if (this.autoSaveTimer != null) {
            clearTimeout(this.autoSaveTimer);
        }
        this.autoSaveTimer = setTimeout(() => {
            this.autoSaveTimer = null;
            this.saveFile({ fromAutoSave: true });
        }, 400);
    }

    updateContentFromVisual(newContent: string, opts?: { skipAutoSave?: boolean }) {
        globalStore.set(this.fileContentAtom, newContent);
        globalStore.set(this.hasEditedAtom, true);
        globalStore.set(this.validationErrorAtom, null);
        if (!opts?.skipAutoSave) {
            this.scheduleAutoSave();
        }
    }

    discardChanges() {
        this.cancelPendingAutoSave();
        const originalContent = globalStore.get(this.originalContentAtom);
        globalStore.set(this.fileContentAtom, originalContent);
        globalStore.set(this.hasEditedAtom, false);
        globalStore.set(this.validationErrorAtom, null);
        globalStore.set(this.errorMessageAtom, null);
    }

    markAsEdited() {
        globalStore.set(this.hasEditedAtom, true);
    }

    async loadFile(file: ConfigFile, opts?: { silent?: boolean }) {
        this.cancelPendingAutoSave();
        const seq = ++this.loadSeq;
        if (!opts?.silent) {
            globalStore.set(this.isLoadingAtom, true);
        }
        globalStore.set(this.errorMessageAtom, null);
        globalStore.set(this.validationErrorAtom, null);
        globalStore.set(this.hasEditedAtom, false);

        if (file.isSecrets) {
            globalStore.set(this.selectedFileAtom, file);
            this.env.rpc.SetMetaCommand(TabRpcClient, {
                oref: makeORef("block", this.blockId),
                meta: { file: file.path },
            });
            globalStore.set(this.isLoadingAtom, false);
            this.checkStorageBackend();
            this.refreshSecrets();
            return;
        }

        try {
            const fullPath = `${this.configDir}/${file.path}`;
            const fileInfo = await this.env.rpc.FileInfoCommand(TabRpcClient, {
                info: { path: fullPath },
            });
            if (seq !== this.loadSeq) {
                return;
            }
            let content = "";
            if (!fileInfo?.notfound) {
                const fileData = await this.env.rpc.FileReadCommand(TabRpcClient, {
                    info: { path: fullPath },
                });
                if (seq !== this.loadSeq) {
                    return;
                }
                content = fileData?.data64 ? base64ToString(fileData.data64) : "";
            }
            if (opts?.silent && globalStore.get(this.hasEditedAtom)) {
                return;
            }
            globalStore.set(this.originalContentAtom, content);
            if (content.trim() === "") {
                globalStore.set(this.fileContentAtom, "{\n\n}");
            } else {
                globalStore.set(this.fileContentAtom, content);
            }
            globalStore.set(this.selectedFileAtom, file);
            if (!opts?.silent) {
                globalStore.set(this.activeTabAtom, file.visualComponent ? "visual" : "json");
                this.env.rpc.SetMetaCommand(TabRpcClient, {
                    oref: makeORef("block", this.blockId),
                    meta: { file: file.path },
                });
            }
        } catch (err) {
            if (seq !== this.loadSeq) {
                return;
            }
            globalStore.set(this.errorMessageAtom, `Failed to load ${file.name}: ${err.message || String(err)}`);
            globalStore.set(this.fileContentAtom, "");
            globalStore.set(this.originalContentAtom, "");
        } finally {
            if (seq === this.loadSeq && !opts?.silent) {
                globalStore.set(this.isLoadingAtom, false);
            }
        }
    }

    async saveFile(opts?: { fromAutoSave?: boolean }) {
        if (!opts?.fromAutoSave) {
            this.cancelPendingAutoSave();
        }
        const selectedFile = globalStore.get(this.selectedFileAtom);
        if (!selectedFile || selectedFile.isSecrets) return;

        if (this.saveInFlight) {
            this.pendingTrailingSave = true;
            return;
        }

        const targetFilePath = selectedFile.path;
        const contentSnapshot = globalStore.get(this.fileContentAtom);

        if (contentSnapshot.trim() === "") {
            this.saveInFlight = true;
            globalStore.set(this.isSavingAtom, true);
            globalStore.set(this.errorMessageAtom, null);
            globalStore.set(this.validationErrorAtom, null);

            try {
                const fullPath = `${this.configDir}/${targetFilePath}`;
                await this.env.rpc.FileWriteCommand(TabRpcClient, {
                    info: { path: fullPath },
                    data64: stringToBase64(""),
                });
                const curFile = globalStore.get(this.selectedFileAtom);
                const curContent = globalStore.get(this.fileContentAtom);
                if (curFile?.path === targetFilePath && curContent === contentSnapshot) {
                    globalStore.set(this.fileContentAtom, "");
                    globalStore.set(this.originalContentAtom, "");
                    globalStore.set(this.hasEditedAtom, false);
                }
            } catch (err) {
                globalStore.set(
                    this.errorMessageAtom,
                    `Failed to save ${selectedFile.name}: ${err.message || String(err)}`
                );
            } finally {
                this.saveInFlight = false;
                globalStore.set(this.isSavingAtom, false);
                if (this.pendingTrailingSave) {
                    this.pendingTrailingSave = false;
                    this.saveFile({ fromAutoSave: true });
                }
            }
            return;
        }

        try {
            const parsed = JSON.parse(contentSnapshot);

            if (typeof parsed !== "object" || parsed == null || Array.isArray(parsed)) {
                globalStore.set(this.validationErrorAtom, "JSON must be an object, not an array, primitive, or null");
                return;
            }

            if (selectedFile.validator) {
                const validationResult = selectedFile.validator(parsed);
                if ("error" in validationResult) {
                    globalStore.set(this.validationErrorAtom, validationResult.error);
                    return;
                }
            }

            const formatted = JSON.stringify(parsed, null, 2);

            this.saveInFlight = true;
            globalStore.set(this.isSavingAtom, true);
            globalStore.set(this.errorMessageAtom, null);
            globalStore.set(this.validationErrorAtom, null);

            try {
                const fullPath = `${this.configDir}/${targetFilePath}`;
                await this.env.rpc.FileWriteCommand(TabRpcClient, {
                    info: { path: fullPath },
                    data64: stringToBase64(formatted),
                });
                const curFile = globalStore.get(this.selectedFileAtom);
                const curContent = globalStore.get(this.fileContentAtom);
                if (curFile?.path === targetFilePath && curContent === contentSnapshot) {
                    globalStore.set(this.fileContentAtom, formatted);
                    globalStore.set(this.originalContentAtom, formatted);
                    globalStore.set(this.hasEditedAtom, false);
                } else if (curFile?.path === targetFilePath) {
                    this.pendingTrailingSave = true;
                }
            } catch (err) {
                globalStore.set(
                    this.errorMessageAtom,
                    `Failed to save ${selectedFile.name}: ${err.message || String(err)}`
                );
            } finally {
                this.saveInFlight = false;
                globalStore.set(this.isSavingAtom, false);
                if (this.pendingTrailingSave && globalStore.get(this.autoSaveVisualAtom)) {
                    this.pendingTrailingSave = false;
                    this.saveFile({ fromAutoSave: true });
                } else {
                    this.pendingTrailingSave = false;
                }
            }
        } catch (err) {
            globalStore.set(this.validationErrorAtom, `Invalid JSON: ${err.message || String(err)}`);
        }
    }

    clearError() {
        globalStore.set(this.errorMessageAtom, null);
    }

    clearValidationError() {
        globalStore.set(this.validationErrorAtom, null);
    }

    async checkStorageBackend() {
        try {
            const backend = await this.env.rpc.GetSecretsLinuxStorageBackendCommand(TabRpcClient);
            if (backend === "basic_text" || backend === "unknown") {
                globalStore.set(
                    this.storageBackendErrorAtom,
                    "No appropriate secret manager found. Cannot manage secrets securely."
                );
            } else {
                globalStore.set(this.storageBackendErrorAtom, null);
            }
        } catch (error) {
            globalStore.set(this.storageBackendErrorAtom, `Error checking storage backend: ${error.message}`);
        }
    }

    async fetchSecretNamesQuietly(): Promise<string[]> {
        try {
            await this.checkStorageBackend();
            const names = await this.env.rpc.GetSecretsNamesCommand(TabRpcClient);
            const list = names || [];
            globalStore.set(this.secretNamesAtom, list);
            return list;
        } catch {
            return globalStore.get(this.secretNamesAtom);
        }
    }

    async createSecretInline(name: string, value: string): Promise<{ ok: true } | { ok: false; error: string }> {
        const trimmed = name.trim();
        if (!trimmed) {
            return { ok: false, error: "Secret name cannot be empty" };
        }
        if (!SecretNameRegex.test(trimmed)) {
            return {
                ok: false,
                error: "Invalid secret name: must start with a letter and contain only letters, numbers, and underscores",
            };
        }
        await this.checkStorageBackend();
        const backendErr = globalStore.get(this.storageBackendErrorAtom);
        if (backendErr) {
            return { ok: false, error: backendErr };
        }
        const existingNames = await this.fetchSecretNamesQuietly();
        if (existingNames.includes(trimmed)) {
            return { ok: false, error: `Secret "${trimmed}" already exists` };
        }
        try {
            await this.env.rpc.SetSecretsCommand(TabRpcClient, { [trimmed]: value });
            await this.fetchSecretNamesQuietly();
            return { ok: true };
        } catch (error: any) {
            return { ok: false, error: `Failed to save secret: ${error?.message || String(error)}` };
        }
    }

    async refreshSecrets() {
        globalStore.set(this.isLoadingAtom, true);
        globalStore.set(this.errorMessageAtom, null);

        try {
            const names = await this.env.rpc.GetSecretsNamesCommand(TabRpcClient);
            globalStore.set(this.secretNamesAtom, names || []);
        } catch (error) {
            globalStore.set(this.errorMessageAtom, `Failed to load secrets: ${error.message}`);
        } finally {
            globalStore.set(this.isLoadingAtom, false);
        }
    }

    async viewSecret(name: string) {
        globalStore.set(this.errorMessageAtom, null);
        globalStore.set(this.selectedSecretAtom, name);
        globalStore.set(this.secretShownAtom, false);
        globalStore.set(this.secretValueAtom, "");
    }

    closeSecretView() {
        globalStore.set(this.selectedSecretAtom, null);
        globalStore.set(this.secretValueAtom, "");
        globalStore.set(this.errorMessageAtom, null);
    }

    async showSecret() {
        const selectedSecret = globalStore.get(this.selectedSecretAtom);
        if (!selectedSecret) {
            return;
        }

        globalStore.set(this.isLoadingAtom, true);
        globalStore.set(this.errorMessageAtom, null);

        try {
            const secrets = await this.env.rpc.GetSecretsCommand(TabRpcClient, [selectedSecret]);
            const value = secrets[selectedSecret];
            if (value !== undefined) {
                globalStore.set(this.secretValueAtom, value);
                globalStore.set(this.secretShownAtom, true);
            } else {
                globalStore.set(this.errorMessageAtom, `Secret not found: ${selectedSecret}`);
            }
        } catch (error) {
            globalStore.set(this.errorMessageAtom, `Failed to load secret: ${error.message}`);
        } finally {
            globalStore.set(this.isLoadingAtom, false);
        }
    }

    async saveSecret() {
        const selectedSecret = globalStore.get(this.selectedSecretAtom);
        const secretValue = globalStore.get(this.secretValueAtom);

        if (!selectedSecret) {
            return;
        }

        globalStore.set(this.isLoadingAtom, true);
        globalStore.set(this.errorMessageAtom, null);

        try {
            await this.env.rpc.SetSecretsCommand(TabRpcClient, { [selectedSecret]: secretValue });
            this.env.rpc.RecordTEventCommand(
                TabRpcClient,
                {
                    event: "action:other",
                    props: {
                        "action:type": "waveconfig:savesecret",
                    },
                },
                { noresponse: true }
            );
            this.closeSecretView();
        } catch (error) {
            globalStore.set(this.errorMessageAtom, `Failed to save secret: ${error.message}`);
        } finally {
            globalStore.set(this.isLoadingAtom, false);
        }
    }

    async deleteSecret() {
        const selectedSecret = globalStore.get(this.selectedSecretAtom);

        if (!selectedSecret) {
            return;
        }

        globalStore.set(this.isLoadingAtom, true);
        globalStore.set(this.errorMessageAtom, null);

        try {
            await this.env.rpc.SetSecretsCommand(TabRpcClient, { [selectedSecret]: null });
            this.closeSecretView();
            await this.refreshSecrets();
        } catch (error) {
            globalStore.set(this.errorMessageAtom, `Failed to delete secret: ${error.message}`);
        } finally {
            globalStore.set(this.isLoadingAtom, false);
        }
    }

    startAddingSecret() {
        globalStore.set(this.isAddingNewAtom, true);
        globalStore.set(this.newSecretNameAtom, "");
        globalStore.set(this.newSecretValueAtom, "");
        globalStore.set(this.errorMessageAtom, null);
    }

    cancelAddingSecret() {
        globalStore.set(this.isAddingNewAtom, false);
        globalStore.set(this.newSecretNameAtom, "");
        globalStore.set(this.newSecretValueAtom, "");
        globalStore.set(this.errorMessageAtom, null);
    }

    async addNewSecret() {
        const name = globalStore.get(this.newSecretNameAtom).trim();
        const value = globalStore.get(this.newSecretValueAtom);

        if (!name) {
            globalStore.set(this.errorMessageAtom, "Secret name cannot be empty");
            return;
        }

        if (!SecretNameRegex.test(name)) {
            globalStore.set(
                this.errorMessageAtom,
                "Invalid secret name: must start with a letter and contain only letters, numbers, and underscores"
            );
            return;
        }

        const existingNames = globalStore.get(this.secretNamesAtom);
        if (existingNames.includes(name)) {
            globalStore.set(this.errorMessageAtom, `Secret "${name}" already exists`);
            return;
        }

        globalStore.set(this.isLoadingAtom, true);
        globalStore.set(this.errorMessageAtom, null);

        try {
            await this.env.rpc.SetSecretsCommand(TabRpcClient, { [name]: value });
            this.env.rpc.RecordTEventCommand(
                TabRpcClient,
                {
                    event: "action:other",
                    props: {
                        "action:type": "waveconfig:savesecret",
                    },
                },
                { noresponse: true }
            );
            globalStore.set(this.isAddingNewAtom, false);
            globalStore.set(this.newSecretNameAtom, "");
            globalStore.set(this.newSecretValueAtom, "");
            await this.refreshSecrets();
        } catch (error) {
            globalStore.set(this.errorMessageAtom, `Failed to add secret: ${error.message}`);
        } finally {
            globalStore.set(this.isLoadingAtom, false);
        }
    }

    giveFocus(): boolean {
        const selectedFile = globalStore.get(this.selectedFileAtom);
        if (selectedFile?.isSecrets && this.secretValueRef) {
            this.secretValueRef.focus();
            return true;
        }
        if (this.editorRef?.current) {
            this.editorRef.current.focus();
            return true;
        }
        return false;
    }
}
