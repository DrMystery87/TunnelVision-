import { describe, expect, it } from 'vitest';
import { createReplayHarness } from '../replay-harness.js';

describe('continuity replay harness', () => {
    it('models edits, swipes, and controlled async completion deterministically', async () => {
        const harness = createReplayHarness({ chat: [{ is_user: true, mes: 'Start' }, { mes: 'First reply' }] });
        const delayed = harness.defer();
        harness.edit(0, { mes: 'Edited start' });
        harness.swipe(1, { mes: 'Replacement reply' });
        delayed.resolve('done');
        await expect(delayed.promise).resolves.toBe('done');
        expect(harness.context.chat).toEqual([
            expect.objectContaining({ mes: 'Edited start' }),
            expect.objectContaining({ mes: 'Replacement reply', swipe_id: 1 }),
        ]);
    });
});
