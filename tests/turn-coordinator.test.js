import { describe, expect, it, vi } from 'vitest';
import { createTurnCoordinator } from '../turn-coordinator.js';

function createHarness(mode = 'shadow') {
    const context = {
        chatId: 'chat-1',
        chat: [{ is_user: true, mes: 'Where were we?' }],
    };
    const diagnostics = [];
    const coordinator = createTurnCoordinator({
        getContextImpl: () => context,
        getSettingsImpl: () => ({ continuityEngineMode: mode, continuityShadowDiagnostics: true }),
        onDiagnostic: diagnostic => diagnostics.push(diagnostic),
        now: vi.fn(() => 1234),
    });
    return { context, diagnostics, coordinator };
}

describe('turn coordinator shadow mode', () => {
    it('accepts a response only when its source message is unchanged', () => {
        const { context, diagnostics, coordinator } = createHarness();
        const snapshot = coordinator.begin({ type: 'normal' });
        context.chat.push({ is_user: false, mes: 'At the harbor.' });

        const result = coordinator.complete({ messageId: 1, type: 'normal' });
        expect(result.accepted).toBe(true);
        expect(result.snapshot.generationId).toBe(snapshot.generationId);
        expect(diagnostics.at(-1).kind).toBe('completed');
    });

    it('rejects stale work after its source message is edited', () => {
        const { context, diagnostics, coordinator } = createHarness();
        coordinator.begin({ type: 'normal' });
        context.chat[0].mes = 'Actually, start from the tavern.';
        context.chat.push({ is_user: false, mes: 'Late response' });

        expect(coordinator.complete({ messageId: 1 }).reason).toBe('source-revision-changed');
        expect(diagnostics.at(-1)).toMatchObject({ kind: 'stale', reason: 'source-revision-changed' });
    });

    it('does not allocate continuity work in legacy mode', () => {
        const { coordinator } = createHarness('legacy');
        expect(coordinator.begin({ type: 'normal' })).toBeNull();
    });
});
