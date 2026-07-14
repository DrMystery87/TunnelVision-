import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '../continuity-store.js';
import { createWriteJournal } from '../write-journal.js';
import { createUnifiedTurnEngine } from '../unified-turn-engine.js';

function fingerprint(text) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `${text.length}:${hash >>> 0}`;
}

describe('unified turn engine', () => {
    it('keeps a patch provisional until the next user turn accepts it', async () => {
        const store = createMemoryStore();
        const response = 'Mara raised her lantern.';
        const context = { chatId: 'chat-a', chat: [{ is_user: true, mes: 'Where are we?' }, { mes: response }], chatMetadata: {}, saveMetadataDebounced() {} };
        const engine = createUnifiedTurnEngine({
            getContextImpl: () => context,
            getSettingsImpl: () => ({ continuityEngineMode: 'unified', continuitySafetyKillSwitch: false }),
            getStoreImpl: () => store,
            createJournalImpl: options => createWriteJournal(options),
            isSnapshotCurrentImpl: () => true,
            onEvent: () => {},
        });
        const snapshot = { mode: 'unified', chatId: 'chat-a', sourceMessageIndex: 0, responseMessageIndex: 1, responseFingerprint: fingerprint(response), policyRevision: 0 };
        await engine.commitProvisional(snapshot, { changes: [{ kind: 'fact', summary: 'Mara has a lantern.', evidence: response, confidence: 1 }] });
        expect(await engine.getAcceptedPatches()).toEqual([]);
        await engine.acceptProvisional();
        expect(await engine.getAcceptedPatches()).toEqual([expect.objectContaining({ status: 'accepted' })]);
        await engine.revertResponse('chat-a', 1, 'edited');
        expect(await engine.getAcceptedPatches()).toEqual([]);
    });

    it('compensates provisional work when its response or source is edited', async () => {
        const store = createMemoryStore();
        const response = 'Mara raised her lantern.';
        const context = { chatId: 'chat-b', chat: [{ is_user: true, mes: 'Where are we?' }, { mes: response }], chatMetadata: {}, saveMetadataDebounced() {} };
        const engine = createUnifiedTurnEngine({
            getContextImpl: () => context,
            getSettingsImpl: () => ({ continuityEngineMode: 'unified', continuitySafetyKillSwitch: false }),
            getStoreImpl: () => store,
            createJournalImpl: options => createWriteJournal(options),
            isSnapshotCurrentImpl: () => true,
            onEvent: () => {},
        });
        const snapshot = { mode: 'unified', chatId: 'chat-b', sourceMessageIndex: 0, responseMessageIndex: 1, responseFingerprint: fingerprint(response), policyRevision: 0 };
        await engine.commitProvisional(snapshot, { changes: [] });
        expect(await engine.revertResponse('chat-b', 0, 'edited')).toHaveLength(1);
        expect(await engine.getAcceptedPatches('chat-b')).toEqual([]);
    });
});
