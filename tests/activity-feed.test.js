import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
    context: {
        chatId: 'chat-1',
        chatMetadata: {},
        chat: [],
        saveMetadataDebounced: vi.fn(),
    },
}));

vi.mock('../../../../script.js', () => ({
    chat: [],
    eventSource: { on: vi.fn() },
    event_types: {},
    saveChatConditional: vi.fn(),
}));
vi.mock('../../../st-context.js', () => ({ getContext: () => state.context }));
vi.mock('../tool-registry.js', () => ({ ALL_TOOL_NAMES: [], getActiveTunnelVisionBooks: () => [] }));
vi.mock('../tree-store.js', () => ({ getSettings: () => ({}), isLorebookEnabled: () => false, getTree: () => null }));
vi.mock('../ui-controller.js', () => ({ openTreeEditorForBook: vi.fn() }));
vi.mock('../llm-sidecar.js', () => ({ getSidecarModelLabel: () => 'custom/test-model' }));

import {
    clearFeed,
    getFeedItems,
    logConditionalEvaluations,
    logSidecarRetrieval,
    logSidecarWrite,
    logToolCallStarted,
} from '../activity-feed.js';

beforeEach(() => {
    state.context.chatMetadata = {};
    state.context.saveMetadataDebounced.mockClear();
    clearFeed();
});

describe('activity feed public API', () => {
    it('records recognized in-progress tool calls and ignores unknown tools', () => {
        logToolCallStarted('Unknown_Tool');
        logToolCallStarted('TunnelVision_Remember', { title: 'Character fact' });

        expect(getFeedItems()).toMatchObject([{
            type: 'tool',
            verb: 'Remembering…',
            summary: '"Character fact"',
            _inProgress: true,
        }]);
    });

    it('records sidecar writes with model provenance and reasoning', () => {
        logSidecarWrite('update', {
            lorebook: 'Characters',
            uid: 7,
            summary: 'Updated relationship',
            reasoning: 'The conversation established a new alliance.',
        });

        expect(getFeedItems()).toMatchObject([{
            verb: 'Sidecar Updated',
            summary: 'Updated relationship',
            isSidecar: true,
            sidecarModel: 'custom/test-model',
            reasoning: 'The conversation established a new alliance.',
        }]);
    });

    it('summarizes selected retrieval nodes using their readable labels', () => {
        logSidecarRetrieval({
            nodeIds: ['n1', 'n2', 'n3', 'n4'],
            nodeLabels: ['People', 'Places', 'Factions', 'Events'],
            charCount: 480,
        });

        expect(getFeedItems()[0]).toMatchObject({
            verb: 'Sidecar Retrieved',
            summary: '"People", "Places" +2 more',
            isSidecar: true,
        });
    });

    it('records accepted and rejected conditional evaluations separately', () => {
        logConditionalEvaluations(
            [
                { uid: 1, accepted: true, reason: 'location matched' },
                { uid: 2, accepted: false, reason: 'wrong mood' },
            ],
            [
                { uid: 1, title: 'Forest rule', primaryConditions: [{ type: 'location', value: 'forest' }] },
                { uid: 2, title: 'Castle rule', secondaryConditions: [{ type: 'mood', value: 'tense' }] },
            ],
        );

        expect(getFeedItems()).toMatchObject([
            { verb: 'Conditional Accepted', summary: '"Forest rule" [location:forest]' },
            { verb: 'Conditional Rejected', summary: '"Castle rule" [mood:tense]' },
        ]);
    });
});