// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { throttle } from "throttle-debounce";
import { AIMessage } from "./aimessage";
import { AIModeDropdown } from "./aimode";
import { type WaveUIMessage } from "./aitypes";
import { WaveAIModel } from "./waveai-model";

interface AIPanelMessagesProps {
    messages: WaveUIMessage[];
    status: string;
    onContextMenu?: (e: React.MouseEvent) => void;
}

export const AIPanelMessages = memo(({ messages, status, onContextMenu }: AIPanelMessagesProps) => {
    const model = WaveAIModel.getInstance();
    const isPanelOpen = useAtomValue(model.getPanelVisibleAtom());
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const prevStatusRef = useRef<string>(status);
    const scrollRafRef = useRef<number | null>(null);
    const [shouldAutoScroll, setShouldAutoScroll] = useState(true);

    const checkIfAtBottom = useCallback(() => {
        const container = messagesContainerRef.current;
        if (!container) return true;

        const threshold = 50;
        const scrollBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        return scrollBottom <= threshold;
    }, []);

    const scrollToBottom = useCallback(() => {
        if (scrollRafRef.current != null) {
            return;
        }
        scrollRafRef.current = requestAnimationFrame(() => {
            scrollRafRef.current = null;
            const container = messagesContainerRef.current;
            if (container) {
                container.scrollTop = container.scrollHeight;
                container.scrollLeft = 0;
                setShouldAutoScroll(true);
            }
        });
    }, []);

    useEffect(() => {
        return () => {
            if (scrollRafRef.current != null) {
                cancelAnimationFrame(scrollRafRef.current);
                scrollRafRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        const container = messagesContainerRef.current;
        if (!container) return;

        const throttledScroll = throttle(100, () => {
            const atBottom = checkIfAtBottom();
            setShouldAutoScroll(atBottom);
        });

        container.addEventListener("scroll", throttledScroll, { passive: true });
        return () => {
            container.removeEventListener("scroll", throttledScroll);
            throttledScroll.cancel();
        };
    }, [checkIfAtBottom]);

    useEffect(() => {
        model.registerScrollToBottom(scrollToBottom);
    }, [model, scrollToBottom]);

    useEffect(() => {
        if (shouldAutoScroll) {
            scrollToBottom();
        }
    }, [messages, shouldAutoScroll, scrollToBottom]);

    useEffect(() => {
        if (isPanelOpen) {
            scrollToBottom();
        }
    }, [isPanelOpen, scrollToBottom]);

    useEffect(() => {
        const wasStreaming = prevStatusRef.current === "streaming";
        const isNowNotStreaming = status !== "streaming";

        if (wasStreaming && isNowNotStreaming) {
            scrollToBottom();
        }

        prevStatusRef.current = status;
    }, [status, scrollToBottom]);

    return (
        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-2 space-y-4" onContextMenu={onContextMenu}>
            <div className="mb-2">
                <AIModeDropdown compatibilityMode={true} />
            </div>
            {messages.map((message, index) => {
                const isLastMessage = index === messages.length - 1;
                const isStreaming = status === "streaming" && isLastMessage && message.role === "assistant";
                return <AIMessage key={message.id} message={message} isStreaming={isStreaming} />;
            })}

            {status === "streaming" &&
                (messages.length === 0 || messages[messages.length - 1].role !== "assistant") && (
                    <AIMessage
                        key="last-message"
                        message={{ role: "assistant", parts: [], id: "last-message" } as any}
                        isStreaming={true}
                    />
                )}

            <div ref={messagesEndRef} />
        </div>
    );
});

AIPanelMessages.displayName = "AIPanelMessages";
