import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    settings: { sidecarWriteDrafts: [] },
    saveSettingsDebounced: vi.fn(),
}));

vi.mock('../tree-store.js', () => ({
    getSettings: vi.fn(() => mocks.settings),
}));

vi.mock('../../../../script.js', () => ({
    saveSettingsDebounced: mocks.saveSettingsDebounced,
}));

import {
    enqueueSidecarWriteDraft,
    getSidecarWriteDrafts,
    removeSidecarWriteDraft,
} from '../sidecar-drafts.js';

beforeEach(() => {
    mocks.settings = { sidecarWriteDrafts: [] };
    mocks.saveSettingsDebounced.mockClear();
});

describe('sidecar write drafts', () => {
    it('queues a model-proposed mutation without executing it', () => {
        const draft = enqueueSidecarWriteDraft(
            { type: 'update', lorebook: 'Characters', uid: 7, content: 'Updated fact' },
            'The relationship changed.',
        );

        expect(draft).toMatchObject({
            op: { type: 'update', lorebook: 'Characters', uid: 7, content: 'Updated fact' },
            reasoning: 'The relationship changed.',
        });
        expect(getSidecarWriteDrafts()).toHaveLength(1);
        expect(mocks.saveSettingsDebounced).toHaveBeenCalledOnce();
    });

    it('removes only the approved or rejected draft requested by ID', () => {
        const first = enqueueSidecarWriteDraft({ type: 'remember', lorebook: 'Facts' });
        const second = enqueueSidecarWriteDraft({ type: 'forget', lorebook: 'Facts', uid: 3 });

        expect(removeSidecarWriteDraft(first.id)).toBe(true);
        expect(getSidecarWriteDrafts()).toEqual([second]);
        expect(removeSidecarWriteDraft('missing')).toBe(false);
    });
});
