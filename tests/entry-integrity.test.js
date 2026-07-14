import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    state: {
        book: null,
        tree: null,
    },
    saveWorldInfo: vi.fn(async () => {}),
    createWorldInfoEntry: vi.fn(),
    saveTree: vi.fn(),
    setTrackerUid: vi.fn(),
}));

vi.mock('../../../world-info.js', () => ({
    loadWorldInfo: vi.fn(async () => mocks.state.book),
    createWorldInfoEntry: mocks.createWorldInfoEntry,
    saveWorldInfo: mocks.saveWorldInfo,
}));

vi.mock('../tree-store.js', () => ({
    getTree: vi.fn(() => mocks.state.tree),
    saveTree: mocks.saveTree,
    findNodeById: vi.fn((node, id) => {
        if (!node) return null;
        if (node.id === id) return node;
        for (const child of node.children || []) {
            const found = child.id === id ? child : null;
            if (found) return found;
        }
        return null;
    }),
    addEntryToNode: vi.fn((node, uid) => {
        node.entryUids ??= [];
        if (!node.entryUids.includes(uid)) node.entryUids.push(uid);
    }),
    removeEntryFromTree: vi.fn((node, uid) => {
        node.entryUids = (node.entryUids || []).filter(entryUid => entryUid !== uid);
        for (const child of node.children || []) {
            child.entryUids = (child.entryUids || []).filter(entryUid => entryUid !== uid);
        }
    }),
    createTreeNode: vi.fn(),
    isTrackerTitle: vi.fn(() => false),
    isTrackerUid: vi.fn(() => false),
    setTrackerUid: mocks.setTrackerUid,
}));

import {
    assertEntryUid,
    moveEntry,
    splitEntry,
    updateEntry,
} from '../entry-manager.js';

function makeBook() {
    return {
        entries: {
            entry_7: {
                uid: 7,
                comment: 'Original entry',
                content: 'Original content',
                key: ['original'],
                disable: false,
            },
        },
    };
}

function makeTree() {
    return {
        root: {
            id: 'root',
            label: 'Root',
            entryUids: [7],
            children: [{ id: 'target', label: 'Target', entryUids: [], children: [] }],
        },
    };
}

beforeEach(() => {
    mocks.state.book = makeBook();
    mocks.state.tree = makeTree();
    mocks.createWorldInfoEntry.mockReset();
    mocks.saveWorldInfo.mockClear();
    mocks.saveTree.mockClear();
    mocks.setTrackerUid.mockClear();
    globalThis.__tunnelvisionVitestWorldInfo = {
        loadWorldInfo: () => mocks.state.book,
        createWorldInfoEntry: (...args) => mocks.createWorldInfoEntry(...args),
        saveWorldInfo: (...args) => mocks.saveWorldInfo(...args),
    };
});

describe('entry UID integrity', () => {
    it.each([undefined, null, '', '7', 7.5, -1, Number.POSITIVE_INFINITY])(
        'rejects invalid UID %p before a mutation can run',
        (uid) => {
            expect(() => assertEntryUid(uid)).toThrow('UID must be a non-negative safe integer');
        },
    );

    it('does not move a UID that is absent from the lorebook', async () => {
        await expect(moveEntry('Book', 99, 'target')).rejects.toThrow('Entry UID 99 not found');

        expect(mocks.state.tree.root.entryUids).toEqual([7]);
        expect(mocks.state.tree.root.children[0].entryUids).toEqual([]);
        expect(mocks.saveTree).not.toHaveBeenCalled();
    });

    it('does not save a split original when the new entry cannot be created', async () => {
        mocks.createWorldInfoEntry.mockReturnValue(undefined);

        await expect(splitEntry('Book', 7, {
            keepContent: 'Retained content',
            keepTitle: 'Retained title',
            newContent: 'New content',
            newTitle: 'New title',
            newKeys: ['new'],
        })).rejects.toThrow('Failed to create new lorebook entry');

        expect(mocks.state.book.entries.entry_7).toMatchObject({
            content: 'Original content',
            comment: 'Original entry',
        });
        expect(mocks.saveWorldInfo).not.toHaveBeenCalled();
        expect(mocks.saveTree).not.toHaveBeenCalled();
    });

    it('rejects an invalid UID before loading or updating an entry', async () => {
        await expect(updateEntry('Book', '7', { content: 'Changed' }))
            .rejects.toThrow('UID must be a non-negative safe integer');

        expect(mocks.saveWorldInfo).not.toHaveBeenCalled();
    });
});
