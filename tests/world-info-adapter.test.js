import { describe, expect, it, vi } from 'vitest';
import { createWorldInfoAdapter } from '../world-info-adapter.js';

describe('world info adapter', () => {
    it('projects only to an explicitly writable managed book with transaction provenance', async () => {
        const createEntry = vi.fn(async () => ({ uid: 9 }));
        const adapter = createWorldInfoAdapter({
            getPolicyImpl: () => ({ canWrite: true, ownership: 'managed' }),
            createEntryImpl: createEntry,
        });
        const result = await adapter.projectAcceptedPatch('Memory', { changes: [{ kind: 'fact', summary: 'Mara has a lantern.', evidence: 'Mara raised it.' }] }, { transactionId: 'tx-1' });
        expect(result).toMatchObject({ projected: 1, created: [{ bookName: 'Memory', uid: 9 }] });
        expect(createEntry.mock.calls[0][1].content).toContain('Transaction: tx-1');
    });

    it('does not write to host-owned or denied books', async () => {
        const createEntry = vi.fn();
        const adapter = createWorldInfoAdapter({
            getPolicyImpl: () => ({ canWrite: false, ownership: 'host', reason: 'Host owns injection.' }),
            createEntryImpl: createEntry,
        });
        await expect(adapter.projectAcceptedPatch('Native', { changes: [{ summary: 'x' }] })).resolves.toMatchObject({ projected: 0, skipped: 1 });
        expect(createEntry).not.toHaveBeenCalled();
    });
});
