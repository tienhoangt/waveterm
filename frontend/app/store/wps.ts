// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { WshClient } from "@/app/store/wshclient";
import { RpcApi } from "@/app/store/wshclientapi";
import { isPreviewWindow } from "@/app/store/windowtype";
import { isBlank } from "@/util/util";
import { Subject } from "rxjs";

let WpsRpcClient: WshClient;

function setWpsRpcClient(client: WshClient) {
    WpsRpcClient = client;
}

type WaveEventSubject<T extends WaveEventName = WaveEventName> = {
    handler: (event: Extract<WaveEvent, { event: T }>) => void;
    scope?: string;
};

type WaveEventSubjectContainer = {
    handler: (event: WaveEvent) => void;
    scope?: string;
    id: string;
};

type WaveEventSubscription<T extends WaveEventName = WaveEventName> = WaveEventSubject<T> & {
    eventType: T;
};

type WaveEventUnsubscribe = {
    id: string;
    eventType: string;
};

// key is "eventType" or "eventType|oref"
const fileSubjects = new Map<string, SubjectWithRef<WSFileEventData>>();
const waveEventSubjects = new Map<string, WaveEventSubjectContainer[]>();
const blockFileScopeSubs = new Map<string, string>();
const blockFileSubPromises = new Map<string, Promise<void>>();

function wpsReconnectHandler() {
    for (const eventType of waveEventSubjects.keys()) {
        updateWaveEventSub(eventType);
    }
}

async function updateWaveEventSub(eventType: string, awaitResponse = false): Promise<void> {
    if (isPreviewWindow()) {
        return;
    }
    const subjects = waveEventSubjects.get(eventType);
    if (subjects == null) {
        if (awaitResponse) {
            await RpcApi.EventUnsubCommand(WpsRpcClient, eventType);
        } else {
            RpcApi.EventUnsubCommand(WpsRpcClient, eventType, { noresponse: true });
        }
        return;
    }
    const subreq: SubscriptionRequest = { event: eventType, scopes: [], allscopes: false };
    for (const scont of subjects) {
        if (isBlank(scont.scope)) {
            subreq.allscopes = true;
            subreq.scopes = [];
            break;
        }
        subreq.scopes.push(scont.scope);
    }
    if (awaitResponse) {
        await RpcApi.EventSubCommand(WpsRpcClient, subreq);
    } else {
        RpcApi.EventSubCommand(WpsRpcClient, subreq, { noresponse: true });
    }
}

function waveEventSubscribeSingle<T extends WaveEventName>(subscription: WaveEventSubscription<T>): () => void {
    // console.log("waveEventSubscribeSingle", subscription);
    if (subscription.handler == null) {
        return () => {};
    }
    const id: string = crypto.randomUUID();
    let subjects = waveEventSubjects.get(subscription.eventType);
    if (subjects == null) {
        subjects = [];
        waveEventSubjects.set(subscription.eventType, subjects);
    }
    const subcont: WaveEventSubjectContainer = {
        id,
        handler: subscription.handler as (event: WaveEvent) => void,
        scope: subscription.scope,
    };
    subjects.push(subcont);
    updateWaveEventSub(subscription.eventType);
    return () => waveEventUnsubscribe({ id, eventType: subscription.eventType });
}

function waveEventUnsubscribe(...unsubscribes: WaveEventUnsubscribe[]) {
    const eventTypeSet = new Set<string>();
    for (const unsubscribe of unsubscribes) {
        const subjects = waveEventSubjects.get(unsubscribe.eventType);
        if (subjects == null) {
            return;
        }
        const idx = subjects.findIndex((s) => s.id === unsubscribe.id);
        if (idx === -1) {
            return;
        }
        subjects.splice(idx, 1);
        if (subjects.length === 0) {
            waveEventSubjects.delete(unsubscribe.eventType);
        }
        eventTypeSet.add(unsubscribe.eventType);
    }

    for (const eventType of eventTypeSet) {
        updateWaveEventSub(eventType);
    }
}

function peekFileSubject(zoneId: string, fileName: string): SubjectWithRef<WSFileEventData> | undefined {
    const subjectKey = zoneId + "|" + fileName;
    return fileSubjects.get(subjectKey);
}

function handleBlockFileEvent(event: WaveEvent) {
    if (event.event !== "blockfile" || event.data == null) {
        return;
    }
    const fileSubject = peekFileSubject(event.data.zoneid, event.data.filename);
    if (fileSubject != null) {
        fileSubject.next(event.data);
    }
}

async function ensureBlockFileSubscribed(blockId: string): Promise<void> {
    if (isBlank(blockId) || isPreviewWindow()) {
        return;
    }
    const existingPromise = blockFileSubPromises.get(blockId);
    if (existingPromise != null) {
        await existingPromise;
        return;
    }
    if (blockFileScopeSubs.has(blockId)) {
        return;
    }
    const id = crypto.randomUUID();
    let subjects = waveEventSubjects.get("blockfile");
    if (subjects == null) {
        subjects = [];
        waveEventSubjects.set("blockfile", subjects);
    }
    subjects.push({
        id,
        handler: handleBlockFileEvent,
        scope: "block:" + blockId,
    });
    blockFileScopeSubs.set(blockId, id);
    const subPromise = updateWaveEventSub("blockfile", true).finally(() => {
        blockFileSubPromises.delete(blockId);
    });
    blockFileSubPromises.set(blockId, subPromise);
    await subPromise;
}

function maybeUnsubscribeBlockFileScope(zoneId: string) {
    const subId = blockFileScopeSubs.get(zoneId);
    if (subId == null) {
        return;
    }
    const prefix = zoneId + "|";
    for (const key of fileSubjects.keys()) {
        if (key.startsWith(prefix)) {
            return;
        }
    }
    blockFileScopeSubs.delete(zoneId);
    blockFileSubPromises.delete(zoneId);
    waveEventUnsubscribe({ id: subId, eventType: "blockfile" });
}

function getFileSubject(zoneId: string, fileName: string): SubjectWithRef<WSFileEventData> {
    const subjectKey = zoneId + "|" + fileName;
    let subject = fileSubjects.get(subjectKey);
    if (subject == null) {
        subject = new Subject<any>() as any;
        subject.refCount = 0;
        subject.release = () => {
            subject.refCount--;
            if (subject.refCount <= 0) {
                subject.complete();
                fileSubjects.delete(subjectKey);
                maybeUnsubscribeBlockFileScope(zoneId);
            }
        };
        fileSubjects.set(subjectKey, subject);
    }
    subject.refCount++;
    return subject;
}

function handleWaveEvent(event: WaveEvent) {
    // console.log("handleWaveEvent", event);
    const subjects = waveEventSubjects.get(event.event);
    if (subjects == null) {
        return;
    }
    for (const scont of subjects) {
        if (isBlank(scont.scope)) {
            scont.handler(event);
            continue;
        }
        if (event.scopes == null) {
            continue;
        }
        if (event.scopes.includes(scont.scope)) {
            scont.handler(event);
        }
    }
}

export {
    ensureBlockFileSubscribed,
    getFileSubject,
    handleWaveEvent,
    peekFileSubject,
    setWpsRpcClient,
    waveEventSubscribeSingle,
    waveEventUnsubscribe,
    wpsReconnectHandler,
};
