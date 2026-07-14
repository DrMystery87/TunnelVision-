/**
 * Write-ahead journal for continuity mutations.
 *
 * World Info and IndexedDB do not share a database transaction. This journal
 * supplies visible atomicity: a transaction is not eligible for use until a
 * commit marker is written, and interrupted operations can be compensated
 * from their captured preimages.
 */
import {
    continuityKey,
    createMemoryStore,
    getContinuityStore,
    listContinuityRecords,
} from './continuity-store.js';

const JOURNAL_COLLECTION = 'journal';

function defaultIdFactory() {
    const random = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
    return `tx_${Date.now()}_${random}`;
}

function clone(value) {
    return structuredClone(value);
}

/** @param {{store?: ReturnType<typeof createMemoryStore>, now?: () => number, idFactory?: () => string}} [deps] */
export function createWriteJournal({ store = getContinuityStore(), now = () => Date.now(), idFactory = defaultIdFactory } = {}) {
    const keyFor = (chatId, transactionId) => continuityKey(chatId, JOURNAL_COLLECTION, transactionId);

    async function load(chatId, transactionId) {
        return store.getItem(keyFor(chatId, transactionId));
    }

    async function save(transaction) {
        await store.setItem(keyFor(transaction.chatId, transaction.transactionId), transaction);
        return transaction;
    }

    async function begin({ chatId, basis, policyRevision = 0, operations = [] }) {
        if (!chatId) throw new Error('A journal transaction requires a chatId.');
        const transaction = {
            schemaVersion: 1,
            transactionId: idFactory(),
            chatId,
            basis: clone(basis || {}),
            policyRevision,
            state: 'intent',
            operations: operations.map(payload => ({ payload: clone(payload), applied: false, preimage: null })),
            createdAt: now(),
            committedAt: null,
            compensatedAt: null,
        };
        return save(transaction);
    }

    async function stage(chatId, transactionId, payload) {
        const transaction = await load(chatId, transactionId);
        if (!transaction) throw new Error(`Unknown journal transaction: ${transactionId}`);
        if (transaction.state !== 'intent') throw new Error('Only an intent transaction can be staged.');
        transaction.operations.push({ payload: clone(payload), applied: false, preimage: null });
        return save(transaction);
    }

    /** Apply staged operations in order. applyOperation returns a preimage. */
    async function commit(chatId, transactionId, applyOperation) {
        const transaction = await load(chatId, transactionId);
        if (!transaction) throw new Error(`Unknown journal transaction: ${transactionId}`);
        if (transaction.state === 'committed') return transaction;
        if (!['intent', 'applying'].includes(transaction.state)) {
            throw new Error(`Cannot commit a ${transaction.state} transaction.`);
        }
        transaction.state = 'applying';
        await save(transaction);

        for (const operation of transaction.operations) {
            if (operation.applied) continue;
            const preimage = await applyOperation(clone(operation.payload), clone(transaction));
            operation.preimage = clone(preimage ?? null);
            operation.applied = true;
            operation.appliedAt = now();
            await save(transaction);
        }

        transaction.state = 'committed';
        transaction.committedAt = now();
        return save(transaction);
    }

    /** Reverse applied operations in reverse order using their preimages. */
    async function compensate(chatId, transactionId, revertOperation) {
        const transaction = await load(chatId, transactionId);
        if (!transaction) throw new Error(`Unknown journal transaction: ${transactionId}`);
        if (transaction.state === 'compensated') return transaction;
        if (!['intent', 'applying', 'committed', 'compensating'].includes(transaction.state)) {
            throw new Error(`Cannot compensate a ${transaction.state} transaction.`);
        }
        transaction.state = 'compensating';
        await save(transaction);
        for (const operation of [...transaction.operations].reverse()) {
            if (!operation.applied || operation.reverted) continue;
            await revertOperation(clone(operation.payload), clone(operation.preimage), clone(transaction));
            operation.reverted = true;
            operation.revertedAt = now();
            await save(transaction);
        }
        transaction.state = 'compensated';
        transaction.compensatedAt = now();
        return save(transaction);
    }

    /** Compensate incomplete transactions after a reload or interrupted write. */
    async function recover(chatId, revertOperation) {
        const records = await listContinuityRecords(chatId, JOURNAL_COLLECTION, { store });
        const unfinished = records.filter(transaction => ['applying', 'compensating'].includes(transaction.state));
        const recovered = [];
        for (const transaction of unfinished) {
            recovered.push(await compensate(chatId, transaction.transactionId, revertOperation));
        }
        return recovered;
    }

    return { begin, stage, commit, compensate, recover, load };
}

export { JOURNAL_COLLECTION };
