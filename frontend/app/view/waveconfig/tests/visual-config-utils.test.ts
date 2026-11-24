// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    deleteConfigKey,
    isEnvMacroValue,
    isSensitiveKeyName,
    isUnsafeObjectKey,
    parseConfigObject,
    renameConfigKey,
    updateConfigKey,
} from "../visual-config-utils";

describe("visual-config-utils", () => {
    it("parses empty string as empty object and rejects arrays/primitives/null", () => {
        expect(parseConfigObject("")).toEqual({ ok: true, data: {} });
        expect(parseConfigObject("   \n  ")).toEqual({ ok: true, data: {} });
        expect(parseConfigObject('{"term:fontsize": 14}')).toEqual({ ok: true, data: { "term:fontsize": 14 } });

        expect(parseConfigObject("[]").ok).toBe(false);
        expect(parseConfigObject("null").ok).toBe(false);
        expect(parseConfigObject('"hello"').ok).toBe(false);
        expect(parseConfigObject("{bad json").ok).toBe(false);
    });

    it("blocks prototype pollution keys (__proto__, constructor, prototype)", () => {
        expect(isUnsafeObjectKey("__proto__")).toBe(true);
        expect(isUnsafeObjectKey("constructor")).toBe(true);
        expect(isUnsafeObjectKey("prototype")).toBe(true);
        expect(isUnsafeObjectKey("toString")).toBe(false);

        const base = { "term:fontsize": 12 };
        expect(updateConfigKey(base, "__proto__", { polluted: true })).toBe(base);
        expect(updateConfigKey(base, "constructor", "bad")).toBe(base);
        expect(renameConfigKey(base, "term:fontsize", "__proto__")).toBe(base);
    });

    it("preserves unknown keys on update, delete, and rename", () => {
        const base = { "term:fontsize": 12, "custom:extra": "keep-me", "bg:text": "rgb(200,200,200)" };
        const updated = updateConfigKey(base, "term:fontsize", 15);
        expect(updated).toEqual({ "term:fontsize": 15, "custom:extra": "keep-me", "bg:text": "rgb(200,200,200)" });

        const deleted = deleteConfigKey(updated, "term:fontsize");
        expect(deleted).toEqual({ "custom:extra": "keep-me", "bg:text": "rgb(200,200,200)" });

        const renamed = renameConfigKey({ a: 1, b: 2 }, "a", "c");
        expect(renamed).toEqual({ c: 1, b: 2 });
        expect(renameConfigKey({ a: 1, b: 2 }, "a", "b")).toEqual({ a: 1, b: 2 });
    });

    it("detects $ENV: macro values and sensitive key names", () => {
        expect(isEnvMacroValue("$ENV:OPENAI_API_KEY")).toBe(true);
        expect(isEnvMacroValue("$ENV:FOO:default")).toBe(true);
        expect(isEnvMacroValue("sk-1234")).toBe(false);
        expect(isEnvMacroValue(123)).toBe(false);

        expect(isSensitiveKeyName("ai:apitoken")).toBe(true);
        expect(isSensitiveKeyName("ssh:passwordsecretname")).toBe(true);
        expect(isSensitiveKeyName("term:fontsize")).toBe(false);
    });
});
