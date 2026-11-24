// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { useAtomValue } from "jotai";
import { useCallback, useMemo } from "react";

const UNSAFE_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function isUnsafeObjectKey(key: string): boolean {
    return UNSAFE_OBJECT_KEYS.has(key);
}

export function isEnvMacroValue(val: unknown): val is string {
    return typeof val === "string" && val.startsWith("$ENV:");
}

export function isSensitiveKeyName(key: string): boolean {
    return /token|secret|password/i.test(key);
}

export type ParseConfigResult =
    | { ok: true; data: Record<string, any> }
    | { ok: false; error: string };

export function parseConfigObject(raw: string): ParseConfigResult {
    const trimmed = (raw ?? "").trim();
    if (trimmed === "") {
        return { ok: true, data: {} };
    }
    try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            return { ok: false, error: "JSON must be an object, not an array, primitive, or null." };
        }
        return { ok: true, data: parsed as Record<string, any> };
    } catch (err: any) {
        return { ok: false, error: `Invalid JSON: ${err?.message || String(err)}` };
    }
}

export function updateConfigKey(
    data: Record<string, any>,
    key: string,
    value: any
): Record<string, any> {
    if (isUnsafeObjectKey(key)) {
        return data;
    }
    const next: Record<string, any> = {};
    for (const k of Object.keys(data)) {
        if (!isUnsafeObjectKey(k)) {
            next[k] = data[k];
        }
    }
    next[key] = value;
    return next;
}

export function deleteConfigKey(data: Record<string, any>, key: string): Record<string, any> {
    if (isUnsafeObjectKey(key) || !Object.hasOwn(data, key)) {
        return data;
    }
    const next: Record<string, any> = {};
    for (const k of Object.keys(data)) {
        if (k !== key && !isUnsafeObjectKey(k)) {
            next[k] = data[k];
        }
    }
    return next;
}

export function renameConfigKey(
    data: Record<string, any>,
    oldKey: string,
    newKey: string
): Record<string, any> {
    if (
        !oldKey ||
        !newKey ||
        oldKey === newKey ||
        isUnsafeObjectKey(newKey) ||
        !Object.hasOwn(data, oldKey) ||
        Object.hasOwn(data, newKey)
    ) {
        return data;
    }
    const next: Record<string, any> = {};
    for (const k of Object.keys(data)) {
        if (isUnsafeObjectKey(k)) {
            continue;
        }
        if (k === oldKey) {
            next[newKey] = data[oldKey];
        } else {
            next[k] = data[k];
        }
    }
    return next;
}

export function serializeConfigObject(data: Record<string, any>): string {
    return JSON.stringify(data, null, 2);
}

export interface VisualConfigJsonHandle {
    parsed: Record<string, any> | null;
    parseError: string | null;
    setField: (key: string, value: any, opts?: { skipAutoSave?: boolean }) => void;
    deleteField: (key: string, opts?: { skipAutoSave?: boolean }) => void;
    replaceData: (nextData: Record<string, any>, opts?: { skipAutoSave?: boolean }) => void;
}

export function useVisualConfigJson(model: WaveConfigViewModel): VisualConfigJsonHandle {
    const fileContent = useAtomValue(model.fileContentAtom);

    const parseResult = useMemo(() => parseConfigObject(fileContent), [fileContent]);
    const parsed = parseResult.ok ? parseResult.data : null;
    const parseError = parseResult.ok ? null : parseResult.error;

    const replaceData = useCallback(
        (nextData: Record<string, any>, opts?: { skipAutoSave?: boolean }) => {
            const serialized = serializeConfigObject(nextData);
            model.updateContentFromVisual(serialized, opts);
        },
        [model]
    );

    const setField = useCallback(
        (key: string, value: any, opts?: { skipAutoSave?: boolean }) => {
            if (!parsed || isUnsafeObjectKey(key)) {
                return;
            }
            const next = updateConfigKey(parsed, key, value);
            const skipAutoSave = opts?.skipAutoSave || key === "ai:apitoken";
            replaceData(next, { skipAutoSave });
        },
        [parsed, replaceData]
    );

    const deleteField = useCallback(
        (key: string, opts?: { skipAutoSave?: boolean }) => {
            if (!parsed || isUnsafeObjectKey(key)) {
                return;
            }
            const next = deleteConfigKey(parsed, key);
            replaceData(next, opts);
        },
        [parsed, replaceData]
    );

    return { parsed, parseError, setField, deleteField, replaceData };
}
