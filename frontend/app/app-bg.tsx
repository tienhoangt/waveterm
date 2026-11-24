// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { MetaKeyAtomFnType, useWaveEnv, WaveEnv, WaveEnvSubset } from "@/app/waveenv/waveenv";
import { PLATFORM, PlatformMacOS } from "@/util/platformutil";
import { computeBgStyleFromMeta } from "@/util/waveutil";
import useResizeObserver from "@react-hook/resize-observer";
import { colord } from "colord";
import { useAtomValue } from "jotai";
import { CSSProperties, useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { debounce } from "throttle-debounce";
import { atoms, getApi, WOS } from "./store/global";
import { useWaveObjectValue } from "./store/wos";

type AppBgEnv = WaveEnvSubset<{
    getTabMetaKeyAtom: MetaKeyAtomFnType<"tab:background">;
    getConfigBackgroundAtom: WaveEnv["getConfigBackgroundAtom"];
}>;

export function AppBackground() {
    const bgRef = useRef<HTMLDivElement>(null);
    const tabId = useAtomValue(atoms.staticTabId);
    const [tabData] = useWaveObjectValue<Tab>(WOS.makeORef("tab", tabId));
    const env = useWaveEnv<AppBgEnv>();
    const tabBg = useAtomValue(env.getTabMetaKeyAtom(tabId, "tab:background"));
    const configBg = useAtomValue(env.getConfigBackgroundAtom(tabBg));
    const resolvedMeta: Omit<BackgroundConfigType, "display:name"> = tabBg && configBg ? configBg : tabData?.meta;
    const bgVal = resolvedMeta?.["bg"];
    const bgOpacity = resolvedMeta?.["bg:opacity"];
    const bgBlendMode = resolvedMeta?.["bg:blendmode"];
    const style: CSSProperties = useMemo(
        () =>
            computeBgStyleFromMeta(
                {
                    bg: bgVal,
                    "bg:opacity": bgOpacity,
                    "bg:blendmode": bgBlendMode,
                },
                0.5
            ) ?? {},
        [bgVal, bgOpacity, bgBlendMode]
    );
    const hasBgImage = useMemo(() => {
        if (typeof style.background !== "string") {
            return false;
        }
        return style.background.includes("url(") || style.background.includes("gradient(");
    }, [style.background]);
    const getAvgColor = useCallback(
        debounce(250, () => {
            if (
                bgRef.current &&
                PLATFORM !== PlatformMacOS &&
                "windowControlsOverlay" in window.navigator
            ) {
                if (!hasBgImage) {
                    const bgStr = typeof style.background === "string" ? style.background.trim() : "";
                    const parsedBg = bgStr ? colord(bgStr) : null;
                    if (parsedBg && parsedBg.isValid()) {
                        getApi().updateWindowControlsOverlay({
                            color: parsedBg.toRgbString(),
                            isDark: parsedBg.isDark(),
                        });
                        return;
                    }
                    const cssMainBg =
                        getComputedStyle(document.body).getPropertyValue("--main-bg-color").trim() || "#222222";
                    const parsedMain = colord(cssMainBg);
                    const finalColor = parsedMain.isValid() ? parsedMain : colord("#222222");
                    getApi().updateWindowControlsOverlay({
                        color: finalColor.toRgbString(),
                        isDark: finalColor.isDark(),
                    });
                    return;
                }
                const titlebarRect: Dimensions = (window.navigator.windowControlsOverlay as any).getTitlebarAreaRect();
                const bgRect = bgRef.current.getBoundingClientRect();
                if (titlebarRect && bgRect) {
                    const windowControlsLeft = titlebarRect.width - titlebarRect.height;
                    const windowControlsRect: Dimensions = {
                        top: titlebarRect.top,
                        left: windowControlsLeft,
                        height: titlebarRect.height,
                        width: bgRect.width - bgRect.left - windowControlsLeft,
                    };
                    getApi().updateWindowControlsOverlay(windowControlsRect);
                }
            }
        }),
        [hasBgImage, style.background]
    );
    useLayoutEffect(() => {
        getAvgColor();
        return () => {
            getAvgColor.cancel();
        };
    }, [getAvgColor]);
    useResizeObserver(bgRef, getAvgColor);

    return (
        <div
            ref={bgRef}
            className="pointer-events-none absolute top-0 left-0 w-full h-full z-[var(--zindex-app-background)]"
            style={style}
        />
    );
}
