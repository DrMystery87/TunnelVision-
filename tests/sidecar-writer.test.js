import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    settings: { sidecarWriteDrafts: [] },
    reorganizeResult: 'Moved entry UID 7.',
}));

vi.mock('../tree-store.js', () => ({
    getSettings: () => mocks.settings,
    getTree: () => null,
    findNodeById: () => null,
    getAllEntryUids: () => [],
}));
vi.mock('../tool-registry.js', () => ({
    getReadableBooks: () => [],
    getWritableBooks: () => [],
    getBookListWithDescriptions: () => '',
    checkToolConfirmation: async () => true,
    REMEMBER_NAME: 'remember',
    UPDATE_NAME: 'update',
    FORGET_NAME: 'forget',
    SUMMARIZE_NAME: 'summarize',
    REORGANIZE_NAME: 'reorganize',
    MERGESPLIT_NAME: 'merge_split',
}));
vi.mock('../llm-sidecar.js', () => ({
    isSidecarConfigured: () => false,
    sidecarGenerate: vi.fn(),
    getSidecarModelLabel: () => '',
}));
vi.mock('../tools/remember.js', () => ({ getDefinition: () => ({ action: vi.fn() }) }));
vi.mock('../tools/update.js', () => ({ getDefinition: () => ({ action: vi.fn() }) }));
vi.mock('../tools/summarize.js', () => ({ getDefinition: () => ({ action: vi.fn() }) }));
vi.mock('../tools/forget.js', () => ({ getDefinition: () => ({ action: vi.fn() }) }));
vi.mock('../tools/reorganize.js', () => ({
    getDefinition: () => ({ action: async () => mocks.reorganizeResult }),
}));
vi.mock('../tools/merge-split.js', () => ({ getDefinition: () => ({ action: vi.fn() }) }));
vi.mock('../activity-feed.js', () => ({ logSidecarWrite: vi.fn() }));
vi.mock('../agent-utils.js', () => ({
    applyBackgroundPromptAddendum: value => value,
    buildLanguageDirective: () => '',
}));

import {
    approveSidecarWriteDraft,
    parseWriteOps,
} from '../sidecar-writer.js';
import {
    enqueueSidecarWriteDraft,
    getSidecarWriteDrafts,
} from '../sidecar-drafts.js';

beforeEach(() => {
    mocks.settings = { sidecarWriteDrafts: [] };
    mocks.reorganizeResult = 'Moved entry UID 7.';
    vi.clearAllMocks();
});

describe('sidecar writer draft safety', () => {
    it('rejects unsupported or malformed reorganize operations before queueing', () => {
        const { ops } = parseWriteOps(JSON.stringify({
            reorganize: [
                { lorebook: 'Facts', action: 'move', uid: 7, target_node_id: 'people' },
                { lorebook: 'Facts', action: 'delete_everything' },
                { lorebook: 'Facts', action: 'move', uid: 7 },
                { lorebook: 'Facts', action: 'create_category' },
            ],
        }));

        expect(ops).toEqual([{
            type: 'reorganize',
            lorebook: 'Facts',
            action: 'move',
            uid: 7,
            target_node_id: 'people',
            title: undefined,
        }]);
    });

    it('keeps a draft queued when the tool reports an unknown action failure', async () => {
        mocks.reorganizeResult = 'Unknown action "move".';
        const draft = enqueueSidecarWriteDraft({
            type: 'reorganize',
            lorebook: 'Facts',
            action: 'move',
            uid: 7,
            target_node_id: 'people',
        });

        await expect(approveSidecarWriteDraft(draft.id)).rejects.toThrow('Unknown action');
        expect(getSidecarWriteDrafts()).toEqual([draft]);
    });
});
