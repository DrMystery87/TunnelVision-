/**
 * Permission-checked compatibility projection for accepted Unified claims.
 * The continuity store remains authoritative; World Info receives only an
 * explicitly enabled, provenance-labelled projection.
 */
import { getBookPolicy } from './book-policy.js';

export function createWorldInfoAdapter({ getPolicyImpl = getBookPolicy, createEntryImpl, forgetEntryImpl = null } = {}) {
    if (typeof createEntryImpl !== 'function') throw new Error('World Info adapter requires a createEntry implementation.');

    async function projectAcceptedPatch(bookName, patch, { transactionId = null } = {}) {
        const policy = getPolicyImpl(bookName);
        if (!policy?.canWrite || policy.ownership === 'host') {
            return { projected: 0, skipped: patch?.changes?.length || 0, reason: policy?.reason || 'No writable managed lorebook selected.' };
        }
        const created = [];
        try {
            for (const change of patch?.changes || []) {
                const result = await createEntryImpl(bookName, {
                    comment: `[Continuity: ${change.kind}]`,
                    content: `${change.summary}\n\nEvidence: “${change.evidence}”\nTransaction: ${transactionId || 'manual'}`,
                    keys: [],
                });
                created.push({ bookName, uid: result.uid });
            }
        } catch (error) {
            if (forgetEntryImpl) await Promise.allSettled(created.map(entry => forgetEntryImpl(entry.bookName, entry.uid, true)));
            throw error;
        }
        return { projected: created.length, skipped: 0, created };
    }

    return { projectAcceptedPatch };
}
