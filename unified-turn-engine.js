/**
 * Unified Turn Engine.
 *
 * This is deliberately narrow: it owns the durable, revision-bound lifecycle
 * of analyzer output. Legacy modules may still render projections, but they do
 * not become authoritative in unified mode.
 */
import { getContext } from '../../../st-context.js';
import { getSettings } from './tree-store.js';
import { getBookPolicy } from './book-policy.js';
import { analyzeContinuityTurn } from './continuity-analyzer.js';
import { createWriteJournal } from './write-journal.js';
import { continuityKey, getContinuityStore, listContinuityRecords } from './continuity-store.js';
import { applyContinuityStatePatch, getContinuityState, setContinuityState } from './continuity-state.js';
import { isContinuitySnapshotCurrent } from './turn-coordinator.js';
import { addBackgroundEvent } from './background-events.js';

const PATCH_COLLECTION = 'patches';

function clone(value) {
    return structuredClone(value);
}

function patchKey(chatId, transactionId) {
    return continuityKey(chatId, PATCH_COLLECTION, transactionId);
}

function isUnified(settings = getSettings()) {
    return settings.continuityEngineMode === 'unified' && settings.continuitySafetyKillSwitch !== true;
}

function responseIsCurrent(context, record) {
    const response = context?.chat?.[record.snapshot?.responseMessageIndex];
    if (!response) return false;
    const text = String(response.mes ?? response.text ?? response.content ?? '');
    return record.snapshot?.responseFingerprint === `${text.length}:${(() => {
        let hash = 2166136261;
        for (let index = 0; index < text.length; index++) {
            hash ^= text.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return hash >>> 0;
    })()}`;
}

/** Factory allows deterministic lifecycle tests without SillyTavern globals. */
export function createUnifiedTurnEngine({
    getContextImpl = getContext,
    getSettingsImpl = getSettings,
    getStoreImpl = getContinuityStore,
    createJournalImpl = createWriteJournal,
    analyzeImpl = analyzeContinuityTurn,
    isSnapshotCurrentImpl = isContinuitySnapshotCurrent,
    applyStateImpl = applyContinuityStatePatch,
    getStateImpl = getContinuityState,
    setStateImpl = setContinuityState,
    createEntryImpl = null,
    getPolicyImpl = getBookPolicy,
    getSelectedLorebookImpl = null,
    onEvent = addBackgroundEvent,
} = {}) {
    const store = getStoreImpl();
    const journal = createJournalImpl({ store });

    async function saveRecord(record) {
        await store.setItem(patchKey(record.chatId, record.transactionId), clone(record));
        return record;
    }

    async function loadRecords(chatId) {
        return listContinuityRecords(chatId, PATCH_COLLECTION, { store });
    }

    async function revertOperation(operation, preimage) {
        if (operation.type !== 'provisional-patch') return;
        const key = patchKey(operation.record.chatId, operation.record.transactionId);
        if (preimage) await store.setItem(key, preimage);
        else await store.removeItem(key);
    }

    async function commitProvisional(snapshot, patch) {
        const settings = getSettingsImpl();
        if (!isUnified(settings) || !snapshot || snapshot.mode !== 'unified') return null;
        if (!isSnapshotCurrentImpl(snapshot)) {
            onEvent({ icon: 'fa-triangle-exclamation', verb: 'Continuity skipped', color: '#fdcb6e', summary: 'Analyzer result was stale before commit' });
            return { accepted: false, reason: 'stale' };
        }
        if (snapshot.continuationOf) {
            await revertResponse(snapshot.chatId, snapshot.responseMessageIndex, 'continuation-superseded');
        }
        const transaction = await journal.begin({
            chatId: snapshot.chatId,
            basis: snapshot,
            policyRevision: snapshot.policyRevision,
            operations: [],
        });
        const record = {
            schemaVersion: 1,
            chatId: snapshot.chatId,
            transactionId: transaction.transactionId,
            status: 'provisional',
            patch: clone(patch),
            snapshot: clone(snapshot),
            createdAt: Date.now(),
            acceptedAt: null,
            revertedAt: null,
        };
        await journal.stage(snapshot.chatId, transaction.transactionId, { type: 'provisional-patch', record });
        const committed = await journal.commit(snapshot.chatId, transaction.transactionId, async operation => {
            const key = patchKey(operation.record.chatId, operation.record.transactionId);
            const preimage = await store.getItem(key);
            await saveRecord(operation.record);
            return preimage;
        });
        onEvent({ icon: 'fa-clock', verb: 'Continuity provisional', color: '#6c5ce7', summary: `${patch.changes?.length || 0} evidence-linked change(s)` });
        return { accepted: true, transaction: committed, record };
    }

    async function analyzeAndCommit(snapshot, { messageId = null } = {}) {
        if (!isUnified(getSettingsImpl()) || !snapshot) return null;
        const result = await analyzeImpl({ messageId, force: true, saveDraft: false });
        if (!result?.valid) return result;
        return commitProvisional(snapshot, result.patch);
    }

    async function projectAcceptedRecord(record, context) {
        const settings = getSettingsImpl();
        if (settings.unifiedProjectAcceptedFacts !== true || !record.patch?.changes?.length) return { projected: 0, created: [] };
        const selectedBook = getSelectedLorebookImpl || (await import('./tree-store.js')).getSelectedLorebook;
        const bookName = settings.unifiedProjectionBook || selectedBook();
        const policy = bookName ? getPolicyImpl(bookName) : null;
        if (!policy?.canWrite) {
            onEvent({ icon: 'fa-shield-halved', verb: 'Continuity projection skipped', color: '#fdcb6e', summary: 'No writable managed lorebook selected' });
            return { projected: 0, created: [] };
        }
        const entryModule = createEntryImpl ? null : await import('./entry-manager.js');
        const writeEntry = createEntryImpl || entryModule.createEntry;
        const { createWorldInfoAdapter } = await import('./world-info-adapter.js');
        const adapter = createWorldInfoAdapter({ getPolicyImpl, createEntryImpl: writeEntry, forgetEntryImpl: entryModule?.forgetEntry || null });
        const result = await adapter.projectAcceptedPatch(bookName, record.patch, { transactionId: record.transactionId });
        return result;
    }

    /** Promote only still-current provisional work when the user advances the conversation. */
    async function acceptProvisional(chatId = getContextImpl()?.chatId) {
        const context = getContextImpl();
        if (!isUnified(getSettingsImpl()) || !chatId || context?.chatId !== chatId) return [];
        const records = await loadRecords(chatId);
        const accepted = [];
        for (const record of records.filter(item => item.status === 'provisional')) {
            if (!responseIsCurrent(context, record)) continue;
            const previousState = record.patch?.state ? getStateImpl(context) : null;
            const projection = await projectAcceptedRecord(record, context);
            record.status = 'accepted';
            record.acceptedAt = Date.now();
            record.projection = projection;
            if (record.patch?.state) {
                const settings = getSettingsImpl();
                record.statePreimage = clone(previousState);
                const reduced = applyStateImpl(previousState, record.patch.state, {
                    messageId: record.snapshot.responseMessageIndex,
                    moodInertia: settings.continuityStateMoodInertia,
                    sceneBoundarySignals: settings.continuityStateBoundarySignals,
                    arcHibernationTurns: settings.continuityArcHibernationTurns,
                    arcAutoReactivate: settings.continuityArcAutoReactivate !== false,
                });
                setStateImpl(reduced.state, context);
            }
            record.projectedCount = projection.projected;
            await saveRecord(record);
            accepted.push(record);
        }
        if (accepted.length) onEvent({ icon: 'fa-check', verb: 'Continuity accepted', color: '#00b894', summary: `${accepted.length} response batch(es) accepted` });
        return accepted;
    }

    async function revertResponse(chatId, messageId, reason = 'response-rejected') {
        if (!chatId || !Number.isInteger(messageId)) return [];
        const records = await loadRecords(chatId);
        const targets = records.filter(item => ['provisional', 'accepted'].includes(item.status) && (
            item.snapshot?.responseMessageIndex === messageId
            || item.snapshot?.sourceMessageIndex === messageId
        ));
        const reverted = [];
        for (const record of targets) {
            if (record.projection?.created?.length) {
                const { forgetEntry } = await import('./entry-manager.js');
                await Promise.allSettled(record.projection.created.map(entry => forgetEntry(entry.bookName, entry.uid, true)));
            }
            await journal.compensate(chatId, record.transactionId, revertOperation);
            reverted.push(record.transactionId);
        }
        const acceptedWithState = records
            .filter(item => item.status === 'accepted' && item.patch?.state && !targets.some(target => target.transactionId === item.transactionId))
            .sort((a, b) => a.createdAt - b.createdAt);
        if (acceptedWithState.length && getContextImpl()?.chatId === chatId) {
            const settings = getSettingsImpl();
            let rebuilt = clone(acceptedWithState[0].statePreimage || getStateImpl(getContextImpl()));
            for (const record of acceptedWithState) {
                rebuilt = applyStateImpl(rebuilt, record.patch.state, {
                    messageId: record.snapshot.responseMessageIndex,
                    moodInertia: settings.continuityStateMoodInertia,
                    sceneBoundarySignals: settings.continuityStateBoundarySignals,
                    arcHibernationTurns: settings.continuityArcHibernationTurns,
                    arcAutoReactivate: settings.continuityArcAutoReactivate !== false,
                }).state;
            }
            setStateImpl(rebuilt, getContextImpl());
        } else if (targets.some(record => record.statePreimage) && getContextImpl()?.chatId === chatId) {
            const first = targets.find(record => record.statePreimage);
            setStateImpl(first.statePreimage, getContextImpl());
        }
        if (reverted.length) onEvent({ icon: 'fa-rotate-left', verb: 'Continuity reverted', color: '#fdcb6e', summary: `${reverted.length} rejected batch(es): ${reason}` });
        return reverted;
    }

    async function recover(chatId = getContextImpl()?.chatId) {
        if (!chatId) return [];
        return journal.recover(chatId, revertOperation);
    }

    async function getAcceptedPatches(chatId = getContextImpl()?.chatId) {
        if (!chatId) return [];
        const records = await loadRecords(chatId);
        return records.filter(item => item.status === 'accepted');
    }

    /** Explicit, read-only migration: source World Info is never modified. */
    async function importLegacyClaims(bookName, { limit = 100 } = {}) {
        const context = getContextImpl();
        if (!context?.chatId) throw new Error('Open a chat before importing legacy continuity.');
        const { readLegacyClaimCandidates } = await import('./legacy-adapter.js');
        const candidates = await readLegacyClaimCandidates(bookName, { limit });
        const imported = [];
        for (const candidate of candidates) {
            const transaction = await journal.begin({ chatId: context.chatId, basis: { kind: 'legacy-import', ...candidate }, policyRevision: Number(getSettingsImpl().continuityPolicyRevision || 0) });
            const record = {
                schemaVersion: 1,
                chatId: context.chatId,
                transactionId: transaction.transactionId,
                status: 'accepted',
                imported: true,
                patch: { schemaVersion: 1, changes: [{ kind: 'legacy', summary: candidate.summary, evidence: candidate.provenance, confidence: 1 }] },
                snapshot: { chatId: context.chatId, policyRevision: transaction.policyRevision, sourceBookId: candidate.sourceBookId, sourceUid: candidate.sourceUid },
                createdAt: Date.now(),
                acceptedAt: Date.now(),
            };
            await journal.stage(context.chatId, transaction.transactionId, { type: 'provisional-patch', record });
            await journal.commit(context.chatId, transaction.transactionId, async operation => {
                const key = patchKey(operation.record.chatId, operation.record.transactionId);
                const preimage = await store.getItem(key);
                await saveRecord(operation.record);
                return preimage;
            });
            imported.push(record);
        }
        onEvent({ icon: 'fa-file-import', verb: 'Legacy continuity imported', color: '#6c5ce7', summary: `${imported.length} provenance-linked claim(s)` });
        return imported;
    }

    return { isUnified: () => isUnified(getSettingsImpl()), analyzeAndCommit, commitProvisional, acceptProvisional, revertResponse, recover, getAcceptedPatches, importLegacyClaims };
}

const engine = createUnifiedTurnEngine();
export const isUnifiedContinuityEnabled = () => engine.isUnified();
export const analyzeUnifiedTurn = (...args) => engine.analyzeAndCommit(...args);
export const acceptUnifiedProvisional = (...args) => engine.acceptProvisional(...args);
export const revertUnifiedResponse = (...args) => engine.revertResponse(...args);
export const recoverUnifiedContinuity = (...args) => engine.recover(...args);
export const getAcceptedUnifiedPatches = (...args) => engine.getAcceptedPatches(...args);
export const importUnifiedLegacyClaims = (...args) => engine.importLegacyClaims(...args);
