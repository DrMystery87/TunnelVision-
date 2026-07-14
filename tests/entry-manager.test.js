import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../st-context.js', () => ({ getContext: () => ({}) }));
vi.mock('../../../world-info.js', () => ({
    loadWorldInfo: vi.fn(),
    createWorldInfoEntry: vi.fn(),
    saveWorldInfo: vi.fn(),
}));
vi.mock('../tree-store.js', () => ({
    getTree: vi.fn(),
    saveTree: vi.fn(),
    findNodeById: vi.fn(),
    addEntryToNode: vi.fn(),
    removeEntryFromTree: vi.fn(),
    createTreeNode: vi.fn(),
    isTrackerTitle: vi.fn(() => false),
    isTrackerUid: vi.fn(() => false),
    setTrackerUid: vi.fn(),
}));

import {
    assertEntryUid,
    buildSummaryKeys,
    buildUidMap,
    escapeHtml,
    findEntryByUid,
    getEntryTemporal,
    getEntrySupersedes,
    getEntryTurnIndex,
    getEntryVersions,
    getTurnEntryCount,
    incrementTurnEntryCount,
    parseJsonFromLLM,
    recordEntryTemporal,
    recordEntryVersion,
    resetTurnEntryCount,
    setEntrySupersedes,
    setEntryTurnIndex,
} from '../entry-manager.js';

beforeEach(() => {
    resetTurnEntryCount();
});

describe('entry identifiers and lookup helpers', () => {
    it('accepts only canonical non-negative safe integer UIDs', () => {
        expect(assertEntryUid(0)).toBe(0);
        expect(assertEntryUid(42)).toBe(42);
        for (const invalid of ['', '42', -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(() => assertEntryUid(invalid)).toThrow('non-negative safe integer');
        }
    });

    it('builds UID maps and rejects coercive entry lookups', () => {
        const entries = {
            alpha: { uid: 3, comment: 'Alpha' },
            beta: { uid: 9, comment: 'Beta' },
        };

        expect(buildUidMap(entries)).toEqual(new Map([[3, entries.alpha], [9, entries.beta]]));
        expect(findEntryByUid(entries, 9)).toBe(entries.beta);
        expect(findEntryByUid(entries, '9')).toBeNull();
        expect(findEntryByUid(entries, -1)).toBeNull();
    });
});

describe('LLM output and entry metadata helpers', () => {
    it('extracts a fenced object or array from surrounding model prose', () => {
        expect(parseJsonFromLLM('Result:\n```json\n{"title":"Fact"}\n```')).toEqual({ title: 'Fact' });
        expect(parseJsonFromLLM('Use [1, 2, 3] only.', { type: 'array' })).toEqual([1, 2, 3]);
        expect(parseJsonFromLLM('not JSON')).toBeNull();
    });

    it('rejects malformed JSON instead of attempting heuristic repair', () => {
        expect(parseJsonFromLLM('{"title":"Fact",}')).toBeNull();
        expect(parseJsonFromLLM('[1, 2,]', { type: 'array' })).toBeNull();
    });

    it('retains temporal and bounded version history by book and UID', () => {
        recordEntryTemporal('Book', 1, { source: 'tool', turnIndex: 7 });
        expect(getEntryTemporal('Book', 1)).toMatchObject({ source: 'tool', turnIndex: 7 });

        for (let index = 0; index < 12; index++) {
            recordEntryVersion('Book', 1, { comment: `Version ${index}`, content: `${index}` });
        }
        const versions = getEntryVersions('Book', 1);
        expect(versions).toHaveLength(10);
        expect(versions[0]).toMatchObject({ comment: 'Version 2', content: '2' });
        expect(versions.at(-1)).toMatchObject({ comment: 'Version 11', content: '11' });
    });

    it('tracks per-turn entry counts explicitly', () => {
        expect(getTurnEntryCount()).toBe(0);
        expect(incrementTurnEntryCount()).toBe(1);
        expect(incrementTurnEntryCount()).toBe(2);
        resetTurnEntryCount();
        expect(getTurnEntryCount()).toBe(0);
    });

    it('builds a deduplicated summary-key set from current summary metadata', () => {
        expect(buildSummaryKeys(
            { arc: 'Alliance', when: 'Day 4' },
            ['Alice', 'Alice'],
            'major',
        )).toEqual(['Alice', 'Alliance', 'Day 4', 'major']);
    });

    it('keeps turn and supersession metadata book-qualified and escapes display text', () => {
        setEntryTurnIndex('Book A', 1, 9);
        setEntrySupersedes('Book A', 1, 0);

        expect(getEntryTurnIndex('Book A', 1)).toBe(9);
        expect(getEntryTurnIndex('Book B', 1)).toBe(-1);
        expect(getEntrySupersedes('Book A', 1)).toBe(0);
        expect(escapeHtml('<script>"&\'')).toBe('&lt;script&gt;&quot;&amp;&#39;');
    });
});
