import { getContext } from '../../../st-context.js';
import { getSettings } from './tree-store.js';
import { generateAnalytical, formatChatExcerpt } from './agent-utils.js';
import { parseJsonFromLLM } from './entry-manager.js';
import { addBackgroundEvent } from './background-events.js';
import { createWriteJournal } from './write-journal.js';
import { createEntry, forgetEntry } from './entry-manager.js';
import { canWriteBook, getSelectedLorebook } from './tree-store.js';
import { applyContinuityStatePatch, getContinuityState, setContinuityState, validateContinuityStatePatch } from './continuity-state.js';
import { scheduleContinuityMaintenance } from './continuity-maintenance.js';
import { isContinuityPaused } from './continuity-safety.js';

const META_KEY = 'tunnelvision_continuity_drafts';
const APPLIED_META_KEY = 'tunnelvision_continuity_applied';

export function getContinuityDrafts() {
    return [...(getContext().chatMetadata?.[META_KEY] || [])];
}

export function getAppliedContinuityTransactions() {
    return [...(getContext().chatMetadata?.[APPLIED_META_KEY] || [])];
}

export function rejectContinuityDraft(draftId) {
    const context = getContext();
    if (!context.chatMetadata) return false;
    const drafts = context.chatMetadata[META_KEY] || [];
    const remaining = drafts.filter(draft => draft.id !== draftId);
    if (remaining.length === drafts.length) return false;
    context.chatMetadata[META_KEY] = remaining;
    context.saveMetadataDebounced?.();
    return true;
}

export async function approveContinuityDraft(draftId, { bookName = getSelectedLorebook() } = {}) {
    if (isContinuityPaused()) throw new Error('Continuity safeguards are paused by the kill switch.');
    const context = getContext();
    const draft = (context.chatMetadata?.[META_KEY] || []).find(item => item.id === draftId);
    if (!draft) throw new Error('Continuity draft not found.');
    const assistantText = String(context.chat?.[draft.messageId]?.mes || '');
    const settings = getSettings();
    const validation = validateContinuityPatch(draft.patch, { assistantText, maxChanges: 10, stateMode: settings.continuityStateMode });
    if (!validation.valid) throw new Error(`Draft is stale: ${validation.errors.join(', ')}`);
    if (validation.patch.changes.length > 0 && (!bookName || !canWriteBook(bookName))) throw new Error('Select a writable lorebook before applying this draft.');

    const journal = createWriteJournal();
    const operations = validation.patch.changes.map(change => ({ type: 'lorebook', change }));
    if (validation.patch.state) operations.push({ type: 'typed-state', patch: validation.patch.state });
    const transaction = await journal.begin({ chatId: context.chatId, basis: { messageId: draft.messageId, draftId }, operations });
    let committed;
    try {
        committed = await journal.commit(context.chatId, transaction.transactionId, async operation => {
            if (operation.type === 'typed-state') {
                const previous = getContinuityState(context);
                const reduced = applyContinuityStatePatch(previous, operation.patch, {
                    messageId: draft.messageId,
                    moodInertia: settings.continuityStateMoodInertia,
                    sceneBoundarySignals: settings.continuityStateBoundarySignals,
                    arcHibernationTurns: settings.continuityArcHibernationTurns,
                    arcAutoReactivate: settings.continuityArcAutoReactivate !== false,
                });
                setContinuityState(reduced.state, context);
                return { kind: 'typed-state', state: previous };
            }
            const change = operation.change;
            const result = await createEntry(bookName, {
                comment: `[Continuity: ${change.kind}]`,
                content: `${change.summary}\n\nEvidence: “${change.evidence}”`,
                keys: [],
            });
            return { kind: 'lorebook', bookName, uid: result.uid };
        });
    } catch (error) {
        await journal.compensate(context.chatId, transaction.transactionId, async (_change, preimage) => {
            if (preimage?.kind === 'typed-state') setContinuityState(preimage.state, context);
            else if (preimage?.bookName && Number.isFinite(preimage.uid)) await forgetEntry(preimage.bookName, preimage.uid, true);
        }).catch(() => {});
        throw error;
    }
    rejectContinuityDraft(draftId);
    const applied = context.chatMetadata?.[APPLIED_META_KEY] || [];
    applied.push({
        transactionId: committed.transactionId,
        bookName,
        changeCount: validation.patch.changes.length,
        createdAt: committed.committedAt || Date.now(),
    });
    context.chatMetadata[APPLIED_META_KEY] = applied.slice(-20);
    context.saveMetadataDebounced?.();
    if (validation.patch.state) scheduleContinuityMaintenance({ chatId: context.chatId });
    addBackgroundEvent({ icon: 'fa-check', verb: 'Continuity draft applied', color: '#00b894', summary: `${validation.patch.changes.length} journaled change(s)` });
    return committed;
}

export async function undoContinuityTransaction(transactionId) {
    const context = getContext();
    const applied = context.chatMetadata?.[APPLIED_META_KEY] || [];
    const record = applied.find(item => item.transactionId === transactionId);
    if (!record) throw new Error('Continuity transaction is not available to undo.');

    const journal = createWriteJournal();
    const transaction = await journal.compensate(context.chatId, transactionId, async (_change, preimage) => {
        if (preimage?.kind === 'typed-state') {
            setContinuityState(preimage.state, context);
            return;
        }
        if (!preimage?.bookName || !Number.isFinite(preimage.uid)) throw new Error('Transaction is missing a reversible entry reference.');
        await forgetEntry(preimage.bookName, preimage.uid, true);
    });
    context.chatMetadata[APPLIED_META_KEY] = applied.filter(item => item.transactionId !== transactionId);
    context.saveMetadataDebounced?.();
    addBackgroundEvent({ icon: 'fa-rotate-left', verb: 'Continuity changes undone', color: '#fdcb6e', summary: `${record.changeCount} journaled change(s) removed` });
    return transaction;
}

export function validateContinuityPatch(raw, { assistantText = '', maxChanges = 5, stateMode = 'off' } = {}) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.changes)) return { valid: false, errors: ['changes must be an array'] };
    if (raw.changes.length > maxChanges) return { valid: false, errors: ['too many changes'] };
    const changes = [];
    for (const change of raw.changes) {
        if (!change || typeof change !== 'object' || !['fact', 'scene', 'relationship', 'arc'].includes(change.kind)) return { valid: false, errors: ['invalid change kind'] };
        if (typeof change.summary !== 'string' || !change.summary.trim()) return { valid: false, errors: ['missing summary'] };
        if (typeof change.evidence !== 'string' || !change.evidence.trim() || !assistantText.includes(change.evidence)) return { valid: false, errors: ['evidence must be an exact assistant-text span'] };
        changes.push({ kind: change.kind, summary: change.summary.trim(), evidence: change.evidence.trim(), confidence: Math.min(Math.max(Number(change.confidence) || 0, 0), 1) });
    }
    let state = null;
    if (stateMode === 'drafts' && raw.state) {
        const stateValidation = validateContinuityStatePatch(raw.state, { assistantText });
        if (!stateValidation.valid) return stateValidation;
        state = stateValidation.patch;
    }
    return { valid: true, patch: { schemaVersion: 1, changes, ...(state ? { state } : {}) } };
}

export async function analyzeContinuityTurn({ messageId = null } = {}) {
    const settings = getSettings();
    if (isContinuityPaused(settings)) return null;
    if (!['shadow', 'drafts'].includes(settings.continuityAnalyzerMode)) return null;
    const context = getContext();
    const chat = context.chat || [];
    const index = Number.isInteger(messageId) ? messageId : chat.length - 1;
    const assistant = chat[index];
    if (!assistant || assistant.is_user || assistant.is_system) return null;
    const assistantText = String(assistant.mes || '');
    if (!assistantText.trim()) return null;
    const stateInstruction = settings.continuityStateMode === 'drafts'
        ? ` Also include optional "state":{"records":[{"type":"persona|relationship|knowledge|physical|intimacy|affect|scene|arc","subject":"character","target":"required only for directed relationship/intimacy","arcKey":"required only for arc; stable lowercase label","arcStatus":"active|resolved","summary":"supported constraint","evidence":"exact assistant substring","confidence":0.0,"boundarySignals":["location|participants|time|goal"]}]}. Only record explicit evidence; knowledge is private to its subject, relationships are directed, affect/intimacy are scene-scoped, and an arc may reactivate only when new evidence explicitly names the same arc.`
        : '';
    const prompt = `Analyze this roleplay exchange. Return JSON only: {"changes":[{"kind":"fact|scene|relationship|arc","summary":"short supported claim","evidence":"exact substring from the assistant response","confidence":0.0}]}${stateInstruction} Do not infer unknown time, consent, or intent.\n\n${formatChatExcerpt(chat, 4)}`;
    const raw = await generateAnalytical({ prompt });
    const result = validateContinuityPatch(parseJsonFromLLM(raw), { assistantText, maxChanges: settings.continuityAnalyzerMaxChanges ?? 5, stateMode: settings.continuityStateMode });
    if (!result.valid) {
        addBackgroundEvent({ icon: 'fa-triangle-exclamation', verb: 'Continuity analysis rejected', color: '#fdcb6e', summary: result.errors.join(', ') });
        return result;
    }
    if (settings.continuityAnalyzerMode === 'drafts' && context.chatMetadata) {
        const drafts = context.chatMetadata[META_KEY] || [];
        drafts.push({ id: `patch_${Date.now()}`, messageId: index, patch: result.patch, createdAt: Date.now() });
        context.chatMetadata[META_KEY] = drafts.slice(-20);
        context.saveMetadataDebounced?.();
    }
    addBackgroundEvent({ icon: 'fa-wand-magic-sparkles', verb: 'Continuity analysis', color: '#6c5ce7', summary: `${result.patch.changes.length} validated change(s)${settings.continuityAnalyzerMode === 'drafts' ? ' saved as draft' : ' (shadow)'}` });
    return result;
}
