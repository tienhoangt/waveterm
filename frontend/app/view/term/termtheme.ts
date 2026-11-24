// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { TermViewModel } from "@/app/view/term/term-model";
import { computeTheme } from "@/app/view/term/termutil";
import { TermWrap } from "@/app/view/term/termwrap";
import { atoms } from "@/store/global";
import { useAtomValue } from "jotai";
import { useEffect } from "react";

interface TermThemeProps {
    blockId: string;
    termRef: React.RefObject<TermWrap>;
    model: TermViewModel;
    allowTransparency?: boolean;
}

const TermThemeUpdater = ({ blockId, model, termRef, allowTransparency = true }: TermThemeProps) => {
    const fullConfig = useAtomValue(atoms.fullConfigAtom);
    const blockTermTheme = useAtomValue(model.termThemeNameAtom);
    const transparency = useAtomValue(model.termTransparencyAtom);
    const [theme, bgcolor] = computeTheme(fullConfig, blockTermTheme, transparency, allowTransparency);
    useEffect(() => {
        if (termRef.current?.terminal) {
            termRef.current.terminal.options.theme = theme;
            termRef.current.setBgColor(bgcolor);
        }
    }, [theme, bgcolor]);
    return null;
};

export { TermThemeUpdater };
