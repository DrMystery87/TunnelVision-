import { loadWorldInfo } from '../../../world-info.js';

/** Read-only migration preview. It never alters legacy World Info. */
export async function previewLegacyContinuityImport(bookName, { loadWorldInfoImpl = loadWorldInfo, limit = 30 } = {}) {
    if (!bookName) throw new Error('Select a lorebook to preview legacy continuity import.');
    const book = await loadWorldInfoImpl(bookName);
    const entries = Object.values(book?.entries || {})
        .filter(entry => entry?.content?.trim() && !String(entry.comment || '').startsWith('[Continuity:'))
        .slice(0, Math.min(Math.max(Number(limit) || 30, 1), 100))
        .map(entry => ({ sourceUid: entry.uid, comment: entry.comment || `Entry #${entry.uid}`, excerpt: String(entry.content).trim().slice(0, 220), action: 'would-import-as-provenance-claim' }));
    return { schemaVersion: 1, bookName, entries, truncated: Object.keys(book?.entries || {}).length > entries.length };
}
