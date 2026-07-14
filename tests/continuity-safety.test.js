import { describe, expect, it } from 'vitest';
import { buildContextBundle } from '../context-bundle.js';
import { buildContinuityInspection } from '../continuity-inspection.js';
import { previewLegacyContinuityImport } from '../legacy-continuity-import.js';
import { isContinuityPaused } from '../continuity-safety.js';

describe('continuity rollout safeguards', () => {
    it('pauses only the unified continuity pipeline', async () => {
        expect(isContinuityPaused({ continuitySafetyKillSwitch: true })).toBe(true);
        const bundle = await buildContextBundle({ settings: { continuitySafetyKillSwitch: true } });
        expect(bundle).toMatchObject({ text: '', paused: true });
    });

    it('exports private continuity details only when diagnostics are enabled', () => {
        const context = { chatId: 'chat', chatMetadata: {}, saveMetadataDebounced() {} };
        const settings = { continuitySafetyKillSwitch: false, continuityEngineMode: 'shadow', continuityAnalyzerMode: 'drafts', continuityStateMode: 'drafts', contextBundleMode: 'shadow', continuityMaintenanceMode: 'off', continuityEvaluationDiagnostics: false };
        const compact = buildContinuityInspection({ context, settings, now: () => 1 });
        const detailed = buildContinuityInspection({ context, settings: { ...settings, continuityEvaluationDiagnostics: true }, now: () => 1 });
        expect(compact.state).toBeUndefined();
        expect(detailed.state.schemaVersion).toBe(1);
    });

    it('previews legacy entries without mutating the source lorebook', async () => {
        const source = { entries: { a: { uid: 1, comment: 'Old fact', content: 'Mara hid the key.' }, b: { uid: 2, comment: '[Continuity: fact]', content: 'New fact.' } } };
        const preview = await previewLegacyContinuityImport('Book', { loadWorldInfoImpl: async () => source });
        expect(preview.entries).toEqual([expect.objectContaining({ sourceUid: 1, action: 'would-import-as-provenance-claim' })]);
        expect(source.entries.a.content).toBe('Mara hid the key.');
    });
});
