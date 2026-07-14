/** Local, no-lorebook-write shadow evaluation for replay and current chats. */
import { getContext } from '../../../st-context.js';
import { getSettings } from './tree-store.js';
import { buildContextBundle } from './context-bundle.js';
import { validateContinuityPatch } from './continuity-analyzer.js';

const META_KEY = 'tunnelvision_shadow_evaluations';

export function evaluateShadowReplay(fixtures, { stateMode = 'off' } = {}) {
    const results = (fixtures || []).map((fixture, index) => {
        const validation = validateContinuityPatch(fixture.patch, {
            assistantText: String(fixture.assistantText || ''),
            maxChanges: fixture.maxChanges ?? 10,
            stateMode,
        });
        return { id: fixture.id || `fixture-${index + 1}`, valid: validation.valid, errors: validation.errors || [], changeCount: validation.patch?.changes?.length || 0, typedStateCount: validation.patch?.state?.records?.length || 0 };
    });
    return {
        schemaVersion: 1,
        fixtures: results.length,
        valid: results.filter(result => result.valid).length,
        invalid: results.filter(result => !result.valid).length,
        results,
    };
}

export function runCurrentChatShadowEvaluation({ context = getContext(), settings = getSettings(), buildBundle = buildContextBundle, now = () => Date.now() } = {}) {
    const drafts = [...(context?.chatMetadata?.tunnelvision_continuity_drafts || [])];
    const fixtures = drafts.map(draft => ({
        id: draft.id,
        patch: draft.patch,
        assistantText: String(context?.chat?.[draft.messageId]?.mes || ''),
        maxChanges: 10,
    }));
    const replay = evaluateShadowReplay(fixtures, { stateMode: settings.continuityStateMode });
    const bundle = buildBundle({ settings });
    const report = {
        schemaVersion: 1,
        generatedAt: now(),
        chatId: context?.chatId || null,
        messages: context?.chat?.length || 0,
        drafts: replay.fixtures,
        validDrafts: replay.valid,
        staleDrafts: replay.invalid,
        appliedTransactions: (context?.chatMetadata?.tunnelvision_continuity_applied || []).length,
        bundleChars: bundle.text.length,
        bundleItems: bundle.manifest.length,
        paused: bundle.paused === true,
        ready: replay.invalid === 0,
    };
    if (settings.continuityEvaluationDiagnostics === true && context?.chatMetadata) {
        const history = context.chatMetadata[META_KEY] || [];
        context.chatMetadata[META_KEY] = [...history, report].slice(-20);
        context.saveMetadataDebounced?.();
    }
    return report;
}
