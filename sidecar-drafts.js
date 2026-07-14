/**
 * Persistent review queue for sidecar-proposed lorebook mutations.
 *
 * The queue intentionally stores proposals separately from execution so a
 * background model cannot mutate durable lore without a user decision.
 */

import { saveSettingsDebounced } from '../../../../script.js';
import { getSettings } from './tree-store.js';

const MAX_DRAFTS = 100;

function clone(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

function getMutableDrafts() {
    const settings = getSettings();
    if (!Array.isArray(settings.sidecarWriteDrafts)) {
        settings.sidecarWriteDrafts = [];
    }
    return settings.sidecarWriteDrafts;
}

function createDraftId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `tv_draft_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * @returns {Array<{ id: string, op: object, reasoning: string, createdAt: number }>}
 */
export function getSidecarWriteDrafts() {
    return getMutableDrafts().map(clone);
}

/**
 * @param {object} op
 * @param {string} [reasoning]
 * @returns {{ id: string, op: object, reasoning: string, createdAt: number }}
 */
export function enqueueSidecarWriteDraft(op, reasoning = '') {
    const drafts = getMutableDrafts();
    const draft = {
        id: createDraftId(),
        op: clone(op),
        reasoning: typeof reasoning === 'string' ? reasoning : '',
        createdAt: Date.now(),
    };
    drafts.push(draft);
    if (drafts.length > MAX_DRAFTS) {
        drafts.splice(0, drafts.length - MAX_DRAFTS);
    }
    saveSettingsDebounced();
    return clone(draft);
}

/**
 * @param {string} draftId
 * @returns {boolean}
 */
export function removeSidecarWriteDraft(draftId) {
    const drafts = getMutableDrafts();
    const index = drafts.findIndex(draft => draft.id === draftId);
    if (index < 0) return false;
    drafts.splice(index, 1);
    saveSettingsDebounced();
    return true;
}

/**
 * @param {string} draftId
 * @returns {{ id: string, op: object, reasoning: string, createdAt: number }|null}
 */
export function getSidecarWriteDraft(draftId) {
    const draft = getMutableDrafts().find(item => item.id === draftId);
    return draft ? clone(draft) : null;
}
