/**
 * Revision-bound turn coordination for the unified continuity engine.
 *
 * Shadow mode validates the lifecycle without changing prompts or lorebooks.
 * Unified mode uses the same snapshots as the authority for every asynchronous
 * result, journal transaction, acceptance decision, and compensating rollback.
 */
import { getContext } from '../../../st-context.js';
import { getSettings } from './tree-store.js';
import { addBackgroundEvent } from './background-events.js';

function getMessageText(message) {
    if (!message || typeof message !== 'object') return '';
    return String(message.mes ?? message.text ?? message.content ?? '');
}

function messageFingerprint(message) {
    const text = getMessageText(message);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `${text.length}:${hash >>> 0}`;
}

function messageRevision(message) {
    return `${messageFingerprint(message)}:${Number(message?.swipe_id ?? message?.extra?.swipe_id ?? 0)}`;
}

export function createTurnCoordinator({
    getContextImpl = getContext,
    getSettingsImpl = getSettings,
    onDiagnostic = null,
    now = () => Date.now(),
} = {}) {
    const turns = new Map();
    let nextId = 0;
    const diagnostic = payload => {
        if (getSettingsImpl().continuityShadowDiagnostics === true) onDiagnostic?.(payload);
    };

    function begin({ type = 'normal', dryRun = false } = {}) {
        const mode = getSettingsImpl().continuityEngineMode;
        if (dryRun || !['shadow', 'unified'].includes(mode)) return null;
        const context = getContextImpl();
        const chat = context?.chat || [];
        const chatId = context?.chatId;
        if (!chatId || chat.length === 0) return null;
        const sourceMessageIndex = chat.length - 1;
        const sourceMessage = chat[sourceMessageIndex];
        const snapshot = {
            generationId: `${mode}_${now()}_${++nextId}`,
            chatId,
            mode,
            generationType: type,
            sourceMessageIndex,
            sourceFingerprint: messageFingerprint(sourceMessage),
            sourceRevision: messageRevision(sourceMessage),
            sourceRole: sourceMessage?.is_user ? 'user' : sourceMessage?.is_system ? 'system' : 'assistant',
            chatLength: chat.length,
            policyRevision: Number(getSettingsImpl().continuityPolicyRevision || 0),
            startedAt: now(),
            status: 'generating',
        };
        turns.set(chatId, snapshot);
        return { ...snapshot };
    }

    function complete({ messageId = null, type = 'normal' } = {}) {
        const context = getContextImpl();
        const chatId = context?.chatId;
        const snapshot = chatId ? turns.get(chatId) : null;
        if (!snapshot || snapshot.status !== 'generating') return { accepted: false, reason: 'no-active-turn' };
        const chat = context?.chat || [];
        const source = chat[snapshot.sourceMessageIndex];
        const responseMessageIndex = Number.isInteger(messageId) ? messageId : chat.length - 1;
        const continuation = snapshot.generationType === 'continue' || type === 'continue';
        const appendsExistingResponse = continuation && responseMessageIndex === snapshot.sourceMessageIndex;
        if (!source || (!appendsExistingResponse && messageRevision(source) !== snapshot.sourceRevision)) {
            snapshot.status = 'stale';
            turns.delete(snapshot.chatId);
            diagnostic({ kind: 'stale', snapshot, reason: 'source-revision-changed' });
            return { accepted: false, reason: 'source-revision-changed' };
        }
        if ((!appendsExistingResponse && responseMessageIndex <= snapshot.sourceMessageIndex) || !chat[responseMessageIndex]) {
            snapshot.status = 'stale';
            turns.delete(snapshot.chatId);
            diagnostic({ kind: 'stale', snapshot, reason: 'response-missing' });
            return { accepted: false, reason: 'response-missing' };
        }
        snapshot.status = 'completed';
        snapshot.responseMessageIndex = responseMessageIndex;
        snapshot.responseFingerprint = messageFingerprint(chat[responseMessageIndex]);
        snapshot.responseRevision = messageRevision(chat[responseMessageIndex]);
        snapshot.continuationOf = appendsExistingResponse ? snapshot.sourceRevision : null;
        snapshot.completedAt = now();
        snapshot.responseType = type;
        turns.delete(snapshot.chatId);
        diagnostic({ kind: 'completed', snapshot });
        return { accepted: true, snapshot: { ...snapshot } };
    }

    function cancel(chatId = getContextImpl()?.chatId, reason = 'cancelled') {
        const snapshot = chatId ? turns.get(chatId) : null;
        if (!snapshot || snapshot.status !== 'generating') return false;
        snapshot.status = 'cancelled';
        turns.delete(chatId);
        diagnostic({ kind: 'cancelled', snapshot, reason });
        return true;
    }

    function cancelAll(reason = 'chat-changed') {
        return [...turns.keys()].filter(chatId => cancel(chatId, reason)).length;
    }

    function getActive(chatId = getContextImpl()?.chatId) {
        const snapshot = chatId ? turns.get(chatId) : null;
        return snapshot ? { ...snapshot } : null;
    }

    /** Verify a deferred result still belongs to the exact response it was derived from. */
    function isCurrent(snapshot) {
        if (!snapshot?.chatId || snapshot.policyRevision !== Number(getSettingsImpl().continuityPolicyRevision || 0)) return false;
        const context = getContextImpl();
        if (context?.chatId !== snapshot.chatId) return false;
        const chat = context?.chat || [];
        const source = chat[snapshot.sourceMessageIndex];
        const response = chat[snapshot.responseMessageIndex];
        if (snapshot.continuationOf) return messageRevision(response) === snapshot.responseRevision;
        return messageRevision(source) === snapshot.sourceRevision && messageRevision(response) === snapshot.responseRevision;
    }

    /** Rebind a completed group batch to its final speaker response after settle. */
    function refreshResponse(snapshot, messageId = getContextImpl()?.chat?.length - 1) {
        if (!snapshot?.chatId) return null;
        const context = getContextImpl();
        const chat = context?.chat || [];
        const source = chat[snapshot.sourceMessageIndex];
        const response = chat[messageId];
        if (context?.chatId !== snapshot.chatId || !source || !response || messageId <= snapshot.sourceMessageIndex) return null;
        if (!snapshot.continuationOf && messageRevision(source) !== snapshot.sourceRevision) return null;
        const refreshed = { ...snapshot, responseMessageIndex: messageId, responseFingerprint: messageFingerprint(response), responseRevision: messageRevision(response) };
        return refreshed;
    }

    return { begin, complete, cancel, cancelAll, getActive, isCurrent, refreshResponse };
}

const coordinator = createTurnCoordinator({
    onDiagnostic({ kind, snapshot, reason }) {
        const label = kind === 'completed' ? 'validated' : kind;
        addBackgroundEvent({
            icon: kind === 'completed' ? 'fa-shield-halved' : 'fa-triangle-exclamation',
            verb: 'Continuity shadow',
            color: kind === 'completed' ? '#00b894' : '#fdcb6e',
            summary: `${label}: ${reason || snapshot.generationType}`,
            details: [`generation ${snapshot.generationId}`, `source ${snapshot.sourceMessageIndex}`],
        });
    },
});

export function beginContinuityTurn(options) { return coordinator.begin(options); }
export function completeContinuityTurn(options) { return coordinator.complete(options); }
export function cancelContinuityTurn(reason) { return coordinator.cancel(undefined, reason); }
export function cancelAllContinuityTurns(reason) { return coordinator.cancelAll(reason); }
export function isContinuitySnapshotCurrent(snapshot) { return coordinator.isCurrent(snapshot); }
export function refreshContinuityResponse(snapshot, messageId) { return coordinator.refreshResponse(snapshot, messageId); }
