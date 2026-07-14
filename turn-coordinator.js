/**
 * Revision-bound turn coordination for the unified continuity engine.
 *
 * Phase 2 exposes shadow mode only: it validates the exact source response
 * lifecycle without changing prompts or lorebooks. The journal and adapters
 * will attach to this coordinator in unified mode after replay coverage lands.
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
        if (dryRun || getSettingsImpl().continuityEngineMode !== 'shadow') return null;
        const context = getContextImpl();
        const chat = context?.chat || [];
        const chatId = context?.chatId;
        if (!chatId || chat.length === 0) return null;
        const sourceMessageIndex = chat.length - 1;
        const sourceMessage = chat[sourceMessageIndex];
        const snapshot = {
            generationId: `shadow_${now()}_${++nextId}`,
            chatId,
            generationType: type,
            sourceMessageIndex,
            sourceFingerprint: messageFingerprint(sourceMessage),
            sourceRole: sourceMessage?.is_user ? 'user' : sourceMessage?.is_system ? 'system' : 'assistant',
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
        if (!source || messageFingerprint(source) !== snapshot.sourceFingerprint) {
            snapshot.status = 'stale';
            turns.delete(snapshot.chatId);
            diagnostic({ kind: 'stale', snapshot, reason: 'source-revision-changed' });
            return { accepted: false, reason: 'source-revision-changed' };
        }
        const responseMessageIndex = Number.isInteger(messageId) ? messageId : chat.length - 1;
        if (responseMessageIndex <= snapshot.sourceMessageIndex || !chat[responseMessageIndex]) {
            snapshot.status = 'stale';
            turns.delete(snapshot.chatId);
            diagnostic({ kind: 'stale', snapshot, reason: 'response-missing' });
            return { accepted: false, reason: 'response-missing' };
        }
        snapshot.status = 'completed';
        snapshot.responseMessageIndex = responseMessageIndex;
        snapshot.responseFingerprint = messageFingerprint(chat[responseMessageIndex]);
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

    return { begin, complete, cancel, cancelAll };
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
