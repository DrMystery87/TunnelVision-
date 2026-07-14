/** Deterministic, non-destructive maintenance for approved typed state. */
import { getContext } from '../../../st-context.js';
import { addBackgroundEvent } from './background-events.js';
import { getSettings } from './tree-store.js';
import { getContinuityState, setContinuityState } from './continuity-state.js';
import { isContinuityPaused } from './continuity-safety.js';

let idleTimer = null;

function clone(value) {
    return structuredClone(value);
}

function sourceId(record, type, index) {
    return record.id || `${type}:${index}`;
}

/** Consolidates repeated approved records into provenance-linked reflections. */
export function maintainContinuityState(current, { reflectionLimit = 6, now = () => Date.now() } = {}) {
    const state = clone(current);
    state.reflections ||= [];
    const existing = new Set(state.reflections.map(reflection => reflection.fingerprint));
    const groups = new Map();
    for (const type of ['persona', 'relationship', 'knowledge', 'physical']) {
        for (const [index, record] of (state.records?.[type] || []).entries()) {
            const key = [type, record.subject, record.target || '', record.summary.toLocaleLowerCase()].join('|');
            const group = groups.get(key) || { type, records: [] };
            group.records.push({ record, id: sourceId(record, type, index) });
            groups.set(key, group);
        }
    }
    const created = [];
    const cap = Math.min(Math.max(Math.round(Number(reflectionLimit) || 6), 1), 20);
    for (const group of groups.values()) {
        if (created.length >= cap || group.records.length < 2) continue;
        const sourceIds = group.records.map(item => item.id).sort();
        const fingerprint = `${group.type}:${sourceIds.join(',')}`;
        if (existing.has(fingerprint)) continue;
        const latest = group.records.at(-1).record;
        const subject = latest.target ? `${latest.subject} toward ${latest.target}` : latest.subject;
        const reflection = {
            id: `reflection_${now()}_${created.length}`,
            fingerprint,
            summary: `${subject}: ${latest.summary}`,
            sourceIds,
            createdAt: now(),
        };
        state.reflections.push(reflection);
        existing.add(fingerprint);
        created.push(reflection);
    }
    state.reflections = state.reflections.slice(-100);
    return { state, created };
}

export function runContinuityMaintenance({ context = getContext(), settings = getSettings() } = {}) {
    if (isContinuityPaused(settings)) return { created: [], skipped: 'paused' };
    if (!context?.chatMetadata) return { created: [], skipped: 'metadata-unavailable' };
    const current = getContinuityState(context);
    const result = maintainContinuityState(current, { reflectionLimit: settings.continuityMaintenanceReflectionLimit });
    if (result.created.length) {
        setContinuityState(result.state, context);
        addBackgroundEvent({ icon: 'fa-broom', verb: 'Continuity maintenance', color: '#6c5ce7', summary: `${result.created.length} evidence-linked reflection(s)` });
    }
    return result;
}

export function scheduleContinuityMaintenance({ chatId = getContext()?.chatId } = {}) {
    const settings = getSettings();
    if (isContinuityPaused(settings)) return false;
    if (settings.continuityMaintenanceMode !== 'idle' || !chatId) return false;
    if (idleTimer) clearTimeout(idleTimer);
    const delay = Math.min(Math.max(Math.round(Number(settings.continuityMaintenanceIdleMs) || 60000), 5000), 900000);
    idleTimer = setTimeout(() => {
        idleTimer = null;
        if (getContext()?.chatId === chatId) runContinuityMaintenance();
    }, delay);
    return true;
}

export function cancelScheduledContinuityMaintenance() {
    if (!idleTimer) return false;
    clearTimeout(idleTimer);
    idleTimer = null;
    return true;
}
