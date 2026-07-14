import { describe, expect, it } from 'vitest';
import { applyContinuityStatePatch, buildContinuityStatePrompt, createContinuityState, validateContinuityStatePatch } from '../continuity-state.js';

const response = 'Mara tells Ivo that she hid the key. Mara remains wary. They leave the inn at dawn.';

describe('typed continuity state', () => {
    it('rejects private knowledge without a subject and directed state without a target', () => {
        expect(validateContinuityStatePatch({ records: [{ type: 'knowledge', summary: 'The key is hidden.', evidence: 'she hid the key.' }] }, { assistantText: response }).valid).toBe(false);
        expect(validateContinuityStatePatch({ records: [{ type: 'relationship', subject: 'Mara', summary: 'trusts Ivo', evidence: 'Mara tells Ivo' }] }, { assistantText: response }).valid).toBe(false);
    });

    it('keeps relationship direction, private knowledge, and physical/scene scope explicit', () => {
        const patch = validateContinuityStatePatch({ records: [
            { type: 'relationship', subject: 'Mara', target: 'Ivo', summary: 'shares a secret', evidence: 'Mara tells Ivo', confidence: 0.9 },
            { type: 'knowledge', subject: 'Ivo', summary: 'Mara hid the key', evidence: 'she hid the key', confidence: 0.9 },
            { type: 'physical', subject: 'Mara', summary: 'is carrying a lantern', evidence: 'Mara remains wary', confidence: 0.7, scope: 'scene' },
            { type: 'scene', subject: 'scene', summary: 'The group moves from the inn at dawn', evidence: 'leave the inn at dawn', confidence: 0.9, boundarySignals: ['location', 'time'] },
        ] }, { assistantText: response });
        expect(patch.valid).toBe(true);
        const result = applyContinuityStatePatch(createContinuityState(), patch.patch, { messageId: 4, moodInertia: 2, sceneBoundarySignals: 2 });
        expect(result.state.records.relationship[0]).toMatchObject({ subject: 'Mara', target: 'Ivo' });
        expect(result.state.records.knowledge[0].subject).toBe('Ivo');
        expect(result.state.records.physical[0].scope).toBe('scene');
        expect(result.state.boundaries).toHaveLength(1);
    });

    it('requires repeated independent affect evidence before persisting mood', () => {
        const patch = { records: [{ type: 'affect', subject: 'Mara', summary: 'is wary', evidence: 'Mara remains wary', confidence: 0.8, scope: 'scene', boundarySignals: [] }] };
        const first = applyContinuityStatePatch(createContinuityState(), patch, { messageId: 1, moodInertia: 2 });
        expect(first.applied).toHaveLength(0);
        expect(first.deferred).toHaveLength(1);
        const second = applyContinuityStatePatch(first.state, patch, { messageId: 2, moodInertia: 2 });
        expect(second.state.records.affect).toHaveLength(1);
    });

    it('renders approved records as compact natural-language constraints', () => {
        const state = createContinuityState();
        state.records.relationship.push({ subject: 'Mara', target: 'Ivo', summary: 'shares a secret' });
        state.records.knowledge.push({ subject: 'Ivo', summary: 'Mara hid the key' });
        const text = buildContinuityStatePrompt(state);
        expect(text).toContain('Mara toward Ivo');
        expect(text).toContain('Ivo knows');
        expect(text).not.toContain('stat');
    });

    it('hibernates inactive arcs and reactivates only on matching reviewed evidence', () => {
        const arc = { records: [{ type: 'arc', subject: 'Mara', arcKey: 'missing-key', summary: 'Mara is looking for the missing key', evidence: 'Mara tells Ivo', confidence: 0.9, arcStatus: 'active', boundarySignals: [] }] };
        const first = applyContinuityStatePatch(createContinuityState(), arc, { messageId: 1, arcHibernationTurns: 2 });
        const idle = applyContinuityStatePatch(first.state, { records: [] }, { messageId: 3, arcHibernationTurns: 2 });
        expect(idle.state.records.arc[0].arcStatus).toBe('hibernated');
        const revived = applyContinuityStatePatch(idle.state, arc, { messageId: 4, arcAutoReactivate: true });
        expect(revived.state.records.arc).toHaveLength(1);
        expect(revived.state.records.arc[0].arcStatus).toBe('active');
        const disabled = applyContinuityStatePatch(idle.state, arc, { messageId: 4, arcAutoReactivate: false });
        expect(disabled.state.records.arc[0].arcStatus).toBe('hibernated');
        expect(disabled.deferred).toHaveLength(1);
    });
});
