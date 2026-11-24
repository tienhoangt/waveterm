// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import {
    adaptFromElectronKeyEvent,
    adaptFromReactOrNativeKeyEvent,
    isImeComposingEvent,
    isInputEvent,
    keydownWrapper,
} from "../keyutil";

describe("keyutil IME composition guards", () => {
    it("detects IME composition via isComposing, keyCode 229, Process, and Dead", () => {
        expect(isImeComposingEvent({ type: "keydown", key: "a", code: "KeyA", isComposing: true })).toBe(true);
        expect(isImeComposingEvent({ type: "keydown", key: "a", code: "KeyA", keyCode: 229 })).toBe(true);
        expect(isImeComposingEvent({ type: "keydown", key: "Process", code: "KeyA" })).toBe(true);
        expect(isImeComposingEvent({ type: "keydown", key: "Dead", code: "Quote" })).toBe(true);
        expect(isImeComposingEvent({ type: "keydown", key: "a", code: "KeyA", isComposing: false, keyCode: 65 })).toBe(
            false
        );
    });

    it("treats IME Process/Dead/composing events as input events so shouldDispatchToBlock does not leak them", () => {
        expect(isInputEvent({ type: "keydown", key: "Process", code: "KeyA" })).toBe(true);
        expect(isInputEvent({ type: "keydown", key: "Dead", code: "Quote" })).toBe(true);
        expect(isInputEvent({ type: "keydown", key: "Enter", code: "Enter", isComposing: true })).toBe(true);
    });

    it("preserves isComposing and keyCode in adaptFromReactOrNativeKeyEvent and adaptFromElectronKeyEvent", () => {
        const nativeEvt = {
            type: "keydown",
            key: "Process",
            code: "KeyE",
            ctrlKey: false,
            shiftKey: false,
            altKey: false,
            metaKey: false,
            location: 0,
            repeat: false,
            isComposing: true,
            keyCode: 229,
        } as unknown as KeyboardEvent;
        const adapted = adaptFromReactOrNativeKeyEvent(nativeEvt);
        expect(adapted.isComposing).toBe(true);
        expect(adapted.keyCode).toBe(229);

        const electronAdapted = adaptFromElectronKeyEvent({
            type: "keyDown",
            key: "Process",
            code: "KeyE",
            control: false,
            shift: false,
            alt: false,
            meta: false,
            isAutoRepeat: false,
            location: 0,
            isComposing: true,
        });
        expect(electronAdapted.isComposing).toBe(true);
    });

    it("keydownWrapper short-circuits during IME composition without calling handler or preventDefault", () => {
        const handler = vi.fn(() => true);
        const preventDefault = vi.fn();
        const stopPropagation = vi.fn();
        const wrapped = keydownWrapper(handler);
        wrapped({
            type: "keydown",
            key: "Process",
            code: "KeyK",
            ctrlKey: false,
            shiftKey: false,
            altKey: true,
            metaKey: false,
            location: 0,
            repeat: false,
            isComposing: true,
            keyCode: 229,
            preventDefault,
            stopPropagation,
        } as unknown as KeyboardEvent);

        expect(handler).not.toHaveBeenCalled();
        expect(preventDefault).not.toHaveBeenCalled();
        expect(stopPropagation).not.toHaveBeenCalled();
    });
});
