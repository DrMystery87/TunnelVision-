import { beforeEach, describe, expect, it } from 'vitest';
import { getContinuityDrafts, rejectContinuityDraft, validateContinuityPatch } from '../continuity-analyzer.js';

beforeEach(() => {
    globalThis.__tunnelvisionVitestContext = {
        chat: [], chatId: 'continuity-test', chatMetadata: {}, saveMetadataDebounced() {},
    };
});

describe('continuity patch validation', () => {
    it('accepts bounded evidence-linked changes', () => {
        const result = validateContinuityPatch({ changes: [{ kind: 'fact', summary: 'Mara carries a lantern.', evidence: 'Mara raised her lantern.', confidence: 0.9 }] }, { assistantText: 'Mara raised her lantern.', maxChanges: 2 });
        expect(result).toMatchObject({ valid: true, patch: { schemaVersion: 1 } });
    });
    it('rejects claims without an exact assistant evidence span', () => {
        const result = validateContinuityPatch({ changes: [{ kind: 'fact', summary: 'Mara owns a castle.', evidence: 'castle', confidence: 1 }] }, { assistantText: 'Mara raised her lantern.' });
        expect(result.valid).toBe(false);
    });
    it('removes a rejected draft from chat metadata', () => {
        globalThis.__tunnelvisionVitestContext.chatMetadata.tunnelvision_continuity_drafts = [
            { id: 'keep' }, { id: 'reject' },
        ];
        expect(rejectContinuityDraft('reject')).toBe(true);
        expect(getContinuityDrafts()).toEqual([{ id: 'keep' }]);
        expect(rejectContinuityDraft('missing')).toBe(false);
    });
    it('retains typed state only when review-gated state mode is enabled', () => {
        const raw = { changes: [], state: { records: [{ type: 'knowledge', subject: 'Mara', summary: 'knows the route', evidence: 'Mara knows the route.', confidence: 1 }] } };
        const disabled = validateContinuityPatch(raw, { assistantText: 'Mara knows the route.' });
        const enabled = validateContinuityPatch(raw, { assistantText: 'Mara knows the route.', stateMode: 'drafts' });
        expect(disabled.patch.state).toBeUndefined();
        expect(enabled.patch.state.records).toHaveLength(1);
    });
});
