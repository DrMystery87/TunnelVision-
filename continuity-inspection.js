import { getContext } from '../../../st-context.js';
import { getSettings } from './tree-store.js';
import { getContinuityState } from './continuity-state.js';

const DRAFTS_KEY = 'tunnelvision_continuity_drafts';
const APPLIED_KEY = 'tunnelvision_continuity_applied';

export function buildContinuityInspection({ context = getContext(), settings = getSettings(), now = () => Date.now() } = {}) {
    const state = getContinuityState(context);
    const includeDiagnostics = settings.continuityEvaluationDiagnostics === true;
    const drafts = [...(context?.chatMetadata?.[DRAFTS_KEY] || [])];
    const appliedTransactions = [...(context?.chatMetadata?.[APPLIED_KEY] || [])];
    return {
        schemaVersion: 1,
        generatedAt: now(),
        chatId: context?.chatId || null,
        paused: settings.continuitySafetyKillSwitch === true,
        settings: {
            engineMode: settings.continuityEngineMode,
            analyzerMode: settings.continuityAnalyzerMode,
            typedStateMode: settings.continuityStateMode,
            contextBundleMode: settings.contextBundleMode,
            maintenanceMode: settings.continuityMaintenanceMode,
        },
        counts: {
            drafts: drafts.length,
            appliedTransactions: appliedTransactions.length,
            records: Object.fromEntries(Object.entries(state.records || {}).map(([type, records]) => [type, records.length])),
            reflections: state.reflections?.length || 0,
        },
        ...(includeDiagnostics ? {
            drafts,
            appliedTransactions,
            state,
        } : {}),
    };
}

export function downloadContinuityInspection(options = {}) {
    const payload = buildContinuityInspection(options);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `tunnelvision-continuity-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    return payload;
}
