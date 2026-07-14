import { describe, expect, it } from 'vitest';
import { readLegacyClaimCandidates } from '../legacy-adapter.js';

describe('legacy continuity adapter', () => {
    it('reads World Info as provenance-linked candidates without mutating it', async () => {
        const source = { entries: { a: { uid: 7, comment: 'Lantern', content: 'Mara carries a lantern.' } } };
        const result = await readLegacyClaimCandidates('Canon', { loadWorldInfoImpl: async () => source });
        expect(result).toEqual([expect.objectContaining({ sourceBookId: 'Canon', sourceUid: 7, summary: 'Mara carries a lantern.' })]);
        expect(source.entries.a.content).toBe('Mara carries a lantern.');
    });
});
