/** Read-only bridge from existing World Info to provenance-tagged claims. */
import { loadWorldInfo } from '../../../world-info.js';

function text(value, limit = 1200) {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim();
    return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}…`;
}

export async function readLegacyClaimCandidates(bookName, { loadWorldInfoImpl = loadWorldInfo, limit = 100 } = {}) {
    if (!bookName) throw new Error('Select a lorebook before importing legacy continuity.');
    const book = await loadWorldInfoImpl(bookName);
    const entries = Object.values(book?.entries || {});
    return entries
        .filter(entry => entry && text(entry.content))
        .slice(0, Math.min(Math.max(Number(limit) || 100, 1), 500))
        .map(entry => ({
            sourceBookId: bookName,
            sourceUid: entry.uid,
            sourceComment: text(entry.comment, 180),
            summary: text(entry.content),
            provenance: `Legacy World Info ${bookName}:${entry.uid}`,
        }));
}
