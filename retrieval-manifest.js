/**
 * Per-generation retrieval manifest.
 *
 * Smart Context runs after optional sidecar retrieval.  Keeping a small,
 * in-memory manifest lets it avoid injecting an entry that is already present
 * in the sidecar prompt during the same generation.
 */

const injectedEntryKeys = new Set();

export function entryManifestKey(bookName, uid) {
    return `${String(bookName)}:${Number(uid)}`;
}

export function resetRetrievalManifest() {
    injectedEntryKeys.clear();
}

export function markRetrievalEntries(entries) {
    for (const entry of entries || []) {
        if (!entry || entry.bookName == null || !Number.isFinite(Number(entry.uid))) continue;
        injectedEntryKeys.add(entryManifestKey(entry.bookName, entry.uid));
    }
}

export function isInRetrievalManifest(bookName, uid) {
    return injectedEntryKeys.has(entryManifestKey(bookName, uid));
}

