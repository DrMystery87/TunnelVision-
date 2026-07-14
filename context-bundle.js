/** Local, bounded continuity prompt assembly. */
import { getSettings } from './tree-store.js';
import { buildWorldStatePrompt } from './world-state.js';
import { buildSmartContextPrompt } from './smart-context.js';
import { buildNotebookPrompt } from './tools/notebook.js';
import { buildContinuityStatePrompt, getContinuityState } from './continuity-state.js';
import { isContinuityPaused } from './continuity-safety.js';

function trim(text, remaining) {
    if (text.length <= remaining) return { text, truncated: false };
    if (remaining < 80) return { text: '', truncated: true };
    const cut = text.lastIndexOf('\n', remaining);
    return { text: `${text.slice(0, cut > remaining * 0.5 ? cut : remaining)}\n[...bundle limit reached]`, truncated: true };
}

export async function buildContextBundle({
    settings = getSettings(),
    buildWorldStatePromptImpl = buildWorldStatePrompt,
    buildSmartContextPromptImpl = buildSmartContextPrompt,
    buildNotebookPromptImpl = buildNotebookPrompt,
    buildContinuityStatePromptImpl = buildContinuityStatePrompt,
    getContinuityStateImpl = getContinuityState,
    getAcceptedPatchesImpl = null,
} = {}) {
    if (isContinuityPaused(settings)) return { text: '', manifest: [], maxChars: 0, paused: true };
    const maxChars = Math.min(Math.max(Number(settings.contextBundleMaxChars) || 8000, 500), 32000);
    let accepted = [];
    if (settings.continuityEngineMode === 'unified') {
        const deadlineMs = Math.min(Math.max(Number(settings.contextBundleDeadlineMs) || 75, 10), 250);
        try {
            const loadAccepted = getAcceptedPatchesImpl || (await import('./unified-turn-engine.js')).getAcceptedUnifiedPatches;
            accepted = await Promise.race([
                loadAccepted(),
                new Promise(resolve => setTimeout(() => resolve([]), deadlineMs)),
            ]);
        } catch {
            // Context assembly must remain local and non-blocking. A later
            // generation can use the accepted record once storage recovers.
            accepted = [];
        }
    }
    const acceptedText = accepted.flatMap(record => record.patch?.changes || [])
        .slice(-12)
        .map(change => `- ${change.summary}`)
        .join('\n');
    const candidates = [
        { source: 'world-state', tier: 'current-continuity', text: settings.worldStateEnabled ? buildWorldStatePromptImpl() : '' },
        { source: 'typed-continuity', tier: 'current-continuity', text: settings.continuityStateMode === 'drafts' && settings.continuityStateInBundle !== false ? buildContinuityStatePromptImpl(getContinuityStateImpl(), { includeReflections: settings.continuityReflectionsInBundle === true }) : '' },
        { source: 'accepted-claims', tier: 'relevant-episodes', text: acceptedText ? `[Accepted continuity claims]\n${acceptedText}` : '' },
        { source: 'smart-context', tier: 'retrieved-evidence', text: settings.smartContextEnabled ? buildSmartContextPromptImpl() : '' },
        { source: 'notebook', tier: 'notes', text: settings.notebookEnabled !== false ? buildNotebookPromptImpl() : '' },
    ].filter(item => item.text?.trim());
    const header = '[TunnelVision Continuity Bundle]';
    let remaining = maxChars - header.length;
    const selected = [];
    const manifest = [];
    for (const candidate of candidates) {
        const separator = selected.length ? '\n\n---\n\n' : '\n';
        const rendered = trim(candidate.text.trim(), remaining - separator.length);
        if (!rendered.text) continue;
        selected.push(rendered.text);
        manifest.push({ source: candidate.source, tier: candidate.tier, sourceChars: candidate.text.length, renderedChars: rendered.text.length, truncated: rendered.truncated });
        remaining -= rendered.text.length + separator.length;
    }
    return {
        text: selected.length ? `${header}\n${selected.join('\n\n---\n\n')}` : '',
        manifest,
        maxChars,
    };
}
