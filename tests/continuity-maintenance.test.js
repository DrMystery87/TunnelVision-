import { describe, expect, it } from 'vitest';
import { maintainContinuityState } from '../continuity-maintenance.js';
import { buildContinuityStatePrompt, createContinuityState } from '../continuity-state.js';

describe('continuity maintenance', () => {
    it('creates provenance-linked reflections without removing source records', () => {
        const state = createContinuityState();
        state.records.relationship.push(
            { id: 'rel-1', subject: 'Mara', target: 'Ivo', summary: 'shares a secret' },
            { id: 'rel-2', subject: 'Mara', target: 'Ivo', summary: 'shares a secret' },
        );
        const result = maintainContinuityState(state, { reflectionLimit: 3, now: () => 10 });
        expect(result.created).toHaveLength(1);
        expect(result.created[0].sourceIds).toEqual(['rel-1', 'rel-2']);
        expect(result.state.records.relationship).toHaveLength(2);
    });

    it('is idempotent and keeps reflections out of prompts unless explicitly included', () => {
        const state = createContinuityState();
        state.records.persona.push(
            { id: 'p-1', subject: 'Mara', summary: 'values honesty' },
            { id: 'p-2', subject: 'Mara', summary: 'values honesty' },
        );
        const first = maintainContinuityState(state, { now: () => 10 });
        const second = maintainContinuityState(first.state, { now: () => 11 });
        expect(second.created).toHaveLength(0);
        expect(buildContinuityStatePrompt(first.state)).not.toContain('Reflection:');
        expect(buildContinuityStatePrompt(first.state, { includeReflections: true })).toContain('Reflection:');
    });
});
