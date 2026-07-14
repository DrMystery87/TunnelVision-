import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
    bookData: null,
    saved: [],
    nextNode: 0,
}));

vi.mock('../../../../script.js', () => ({ generateRaw: vi.fn() }));
vi.mock('../../../st-context.js', () => ({ getContext: () => ({}) }));
vi.mock('../../../world-info.js', () => ({ loadWorldInfo: () => state.bookData }));
vi.mock('../llm-sidecar.js', () => ({ isSidecarConfigured: () => false, sidecarGenerate: vi.fn() }));
vi.mock('../entry-manager.js', () => ({ createEntry: vi.fn(), findEntryByUid: vi.fn() }));
vi.mock('../agent-utils.js', () => ({ applyBackgroundPromptAddendum: prompt => prompt }));
vi.mock('../tree-store.js', () => ({
    createEmptyTree: lorebookName => ({
        lorebookName,
        root: { id: 'root', label: 'Root', summary: '', entryUids: [], children: [] },
        version: 1,
        lastBuilt: 0,
    }),
    createTreeNode: (label, summary) => ({
        id: `node-${++state.nextNode}`,
        label,
        summary,
        entryUids: [],
        children: [],
        collapsed: false,
    }),
    addEntryToNode: (node, uid) => node.entryUids.push(uid),
    saveTree: (lorebookName, tree) => state.saved.push({ lorebookName, tree }),
    getAllEntryUids: node => node.entryUids,
    getSettings: () => ({ treeGranularity: 2 }),
    findConnectionProfile: () => null,
}));

import { buildTreeFromMetadata } from '../tree-builder.js';

beforeEach(() => {
    state.bookData = null;
    state.saved = [];
    state.nextNode = 0;
    globalThis.__tunnelvisionVitestWorldInfo = {
        loadWorldInfo: () => state.bookData,
    };
});

describe('buildTreeFromMetadata', () => {
    it('groups enabled entries by explicit group and primary key', async () => {
        state.bookData = {
            entries: {
                peopleA: { uid: 1, group: 'People', key: ['alice'] },
                peopleB: { uid: 2, group: 'People, Allies', key: ['bob'] },
                item: { uid: 3, key: ['Artifacts'] },
                disabled: { uid: 4, group: 'People', key: ['hidden'], disable: true },
            },
        };

        const tree = await buildTreeFromMetadata('Campaign');
        const nodes = Object.fromEntries(tree.root.children.map(node => [node.label, node.entryUids]));

        expect(nodes).toEqual({
            People: [1, 2],
            Allies: [2],
            Artifacts: [3],
        });
        expect(state.saved).toEqual([{ lorebookName: 'Campaign', tree }]);
        expect(tree.lastBuilt).toBeGreaterThan(0);
    });

    it('falls back to an Uncategorized node when an enabled entry has no primary key', async () => {
        state.bookData = { entries: { note: { uid: 5, key: [] } } };

        const tree = await buildTreeFromMetadata('Campaign');

        expect(tree.root.children).toMatchObject([{ label: 'Uncategorized', entryUids: [5] }]);
    });

    it('persists an empty tree for a valid lorebook with no entries', async () => {
        state.bookData = { entries: {} };

        const tree = await buildTreeFromMetadata('Campaign');

        expect(tree.root.children).toEqual([]);
        expect(state.saved).toEqual([{ lorebookName: 'Campaign', tree }]);
    });

    it('groups more than twenty ungrouped primary keys into General', async () => {
        state.bookData = {
            entries: Object.fromEntries(Array.from({ length: 21 }, (_, index) => [
                `entry-${index}`,
                { uid: index + 1, key: [`Key ${index + 1}`] },
            ])),
        };

        const tree = await buildTreeFromMetadata('Campaign');

        expect(tree.root.children).toMatchObject([{ label: 'General' }]);
        expect(tree.root.children[0].entryUids).toEqual(Array.from({ length: 21 }, (_, index) => index + 1));
    });

    it('rejects missing lorebooks rather than persisting an empty tree', async () => {
        await expect(buildTreeFromMetadata('Missing')).rejects.toThrow('not found or has no entries');
        expect(state.saved).toEqual([]);
    });
});