import { describe, expect, it } from 'vitest';
import { evaluateShadowReplay, runCurrentChatShadowEvaluation } from '../continuity-evaluation.js';

describe('continuity shadow evaluation', () => {
    it('reports evidence-valid and stale replay patches without applying anything', () => {
        const report = evaluateShadowReplay([
            { id: 'valid', assistantText: 'Mara raised her lantern.', patch: { changes: [{ kind: 'fact', summary: 'Mara has a lantern', evidence: 'Mara raised her lantern.', confidence: 1 }] } },
            { id: 'stale', assistantText: 'Mara raised her lantern.', patch: { changes: [{ kind: 'fact', summary: 'Mara owns a castle', evidence: 'castle', confidence: 1 }] } },
        ]);
        expect(report).toMatchObject({ fixtures: 2, valid: 1, invalid: 1 });
    });

    it('records current-chat diagnostics only when the diagnostics toggle is enabled', async () => {
        const context = { chatId: 'chat', chat: [], chatMetadata: {}, saveMetadataDebounced() {} };
        const settings = { continuityStateMode: 'off', continuityEvaluationDiagnostics: true };
        const report = await runCurrentChatShadowEvaluation({ context, settings, buildBundle: () => ({ text: 'bundle', manifest: [{ source: 'local' }] }), now: () => 7 });
        expect(report).toMatchObject({ bundleChars: 6, bundleItems: 1, ready: true });
        expect(context.chatMetadata.tunnelvision_shadow_evaluations).toHaveLength(1);
    });
});
