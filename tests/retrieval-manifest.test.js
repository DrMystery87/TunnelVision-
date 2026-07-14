import { beforeEach, describe, expect, it } from 'vitest';
import { isInRetrievalManifest, markRetrievalEntries, resetRetrievalManifest } from '../retrieval-manifest.js';

describe('retrieval manifest', () => {
    beforeEach(() => resetRetrievalManifest());
    it('tracks an entry by lorebook and UID for one generation', () => {
        markRetrievalEntries([{ bookName: 'Main', uid: 42 }]);
        expect(isInRetrievalManifest('Main', 42)).toBe(true);
        expect(isInRetrievalManifest('Other', 42)).toBe(false);
        resetRetrievalManifest();
        expect(isInRetrievalManifest('Main', 42)).toBe(false);
    });
});
