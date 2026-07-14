import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '../continuity-store.js';
import { createWriteJournal } from '../write-journal.js';

function makeJournal() {
    let time = 100;
    let nextId = 0;
    return createWriteJournal({
        store: createMemoryStore(),
        now: () => ++time,
        idFactory: () => `tx-${++nextId}`,
    });
}

describe('write journal', () => {
    it('commits staged operations with durable preimages and compensates in reverse order', async () => {
        const journal = makeJournal();
        const transaction = await journal.begin({
            chatId: 'chat-a',
            basis: { generationId: 'g1' },
            operations: [{ id: 'first' }, { id: 'second' }],
        });
        const applied = [];
        const committed = await journal.commit('chat-a', transaction.transactionId, async operation => {
            applied.push(operation.id);
            return { previous: operation.id };
        });

        expect(committed.state).toBe('committed');
        expect(committed.operations.map(operation => operation.preimage)).toEqual([
            { previous: 'first' }, { previous: 'second' },
        ]);

        const reverted = [];
        const compensated = await journal.compensate('chat-a', transaction.transactionId, async (operation, preimage) => {
            reverted.push(`${operation.id}:${preimage.previous}`);
        });
        expect(applied).toEqual(['first', 'second']);
        expect(reverted).toEqual(['second:second', 'first:first']);
        expect(compensated.state).toBe('compensated');
    });

    it('recovers a partially applied transaction by compensating completed operations', async () => {
        const journal = makeJournal();
        const transaction = await journal.begin({
            chatId: 'chat-b',
            basis: { generationId: 'g2' },
            operations: [{ id: 'saved' }, { id: 'fails' }],
        });

        await expect(journal.commit('chat-b', transaction.transactionId, async operation => {
            if (operation.id === 'fails') throw new Error('simulated interruption');
            return { previous: 'before-saved' };
        })).rejects.toThrow('simulated interruption');

        const recovered = await journal.recover('chat-b', async () => {});
        expect(recovered).toHaveLength(1);
        expect(recovered[0].state).toBe('compensated');
        expect(recovered[0].operations[0].reverted).toBe(true);
        expect(recovered[0].operations[1].applied).toBe(false);
    });
});
