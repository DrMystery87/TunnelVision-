/** Review-gated, evidence-linked role and scene continuity state. */
import { getContext } from '../../../st-context.js';

export const CONTINUITY_STATE_META_KEY = 'tunnelvision_continuity_state';
export const CONTINUITY_STATE_TYPES = ['persona', 'relationship', 'knowledge', 'physical', 'intimacy', 'affect', 'scene', 'arc'];

function copy(value) {
    return structuredClone(value);
}

export function createContinuityState() {
    return {
        schemaVersion: 1,
        records: Object.fromEntries(CONTINUITY_STATE_TYPES.map(type => [type, []])),
        pendingAffect: {},
        boundaries: [],
        reflections: [],
    };
}

export function getContinuityState(context = getContext()) {
    const saved = context?.chatMetadata?.[CONTINUITY_STATE_META_KEY];
    return saved?.schemaVersion === 1 ? copy(saved) : createContinuityState();
}

export function setContinuityState(state, context = getContext()) {
    if (!context?.chatMetadata) throw new Error('Chat metadata is unavailable for continuity state.');
    context.chatMetadata[CONTINUITY_STATE_META_KEY] = copy(state);
    context.saveMetadataDebounced?.();
}

export function validateContinuityStatePatch(raw, { assistantText = '', maxRecords = 8 } = {}) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.records)) return { valid: false, errors: ['state.records must be an array'] };
    if (raw.records.length > maxRecords) return { valid: false, errors: ['too many typed state records'] };
    const records = [];
    for (const record of raw.records) {
        if (!record || !CONTINUITY_STATE_TYPES.includes(record.type)) return { valid: false, errors: ['invalid typed state type'] };
        if (typeof record.subject !== 'string' || !record.subject.trim()) return { valid: false, errors: ['typed state requires a subject'] };
        if (typeof record.summary !== 'string' || !record.summary.trim()) return { valid: false, errors: ['typed state requires a summary'] };
        if (typeof record.evidence !== 'string' || !record.evidence.trim() || !assistantText.includes(record.evidence)) return { valid: false, errors: ['typed state evidence must be an exact assistant-text span'] };
        if (['relationship', 'intimacy'].includes(record.type) && (typeof record.target !== 'string' || !record.target.trim())) return { valid: false, errors: ['directed state requires a target'] };
        if (record.type === 'arc' && (typeof record.arcKey !== 'string' || !record.arcKey.trim())) return { valid: false, errors: ['arc state requires an arc key'] };
        const signals = Array.isArray(record.boundarySignals)
            ? [...new Set(record.boundarySignals.filter(signal => ['location', 'participants', 'time', 'goal'].includes(signal)))].slice(0, 4)
            : [];
        records.push({
            type: record.type,
            subject: record.subject.trim(),
            target: typeof record.target === 'string' ? record.target.trim() : '',
            summary: record.summary.trim(),
            evidence: record.evidence.trim(),
            confidence: Math.min(Math.max(Number(record.confidence) || 0, 0), 1),
            scope: record.type === 'affect' || record.type === 'intimacy' || record.type === 'scene' ? 'scene' : (record.scope === 'scene' ? 'scene' : 'durable'),
            boundarySignals: signals,
            arcKey: typeof record.arcKey === 'string' ? record.arcKey.trim() : '',
            arcStatus: ['active', 'resolved'].includes(record.arcStatus) ? record.arcStatus : 'active',
        });
    }
    return { valid: true, patch: { schemaVersion: 1, records } };
}

export function applyContinuityStatePatch(current, patch, { messageId = null, moodInertia = 2, sceneBoundarySignals = 2, arcHibernationTurns = 12, arcAutoReactivate = true } = {}) {
    const state = copy(current?.schemaVersion === 1 ? current : createContinuityState());
    const applied = [];
    const deferred = [];
    const boundaryThreshold = Math.min(Math.max(Math.round(Number(sceneBoundarySignals) || 2), 2), 4);
    const inertia = Math.min(Math.max(Math.round(Number(moodInertia) || 2), 1), 5);
    for (const source of patch?.records || []) {
        const record = { ...source, id: `state_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, messageId, appliedAt: Date.now() };
        if (record.type === 'affect' && inertia > 1) {
            const key = record.subject.toLocaleLowerCase();
            const pending = state.pendingAffect[key];
            const sameSignal = pending?.summary === record.summary && pending?.messageId !== messageId;
            const count = sameSignal ? pending.count + 1 : 1;
            if (count < inertia) {
                state.pendingAffect[key] = { summary: record.summary, count, messageId, evidence: record.evidence };
                deferred.push(record);
                continue;
            }
            delete state.pendingAffect[key];
        }
        if (record.type === 'arc') {
            const prior = state.records.arc.find(item => item.arcKey === record.arcKey && item.arcStatus !== 'resolved');
            if (prior?.arcStatus === 'hibernated' && !arcAutoReactivate) {
                deferred.push(record);
                continue;
            }
            if (prior?.arcStatus === 'hibernated') record.arcStatus = 'active';
            state.records.arc = state.records.arc.filter(item => item.arcKey !== record.arcKey || item.arcStatus === 'resolved');
        }
        state.records[record.type].push(record);
        state.records[record.type] = state.records[record.type].slice(-80);
        if (record.type === 'scene' && record.boundarySignals.length >= boundaryThreshold) {
            state.boundaries.push({ messageId, summary: record.summary, signals: record.boundarySignals, evidence: record.evidence, createdAt: record.appliedAt });
            state.boundaries = state.boundaries.slice(-40);
        }
        applied.push(record);
    }
    const hibernationTurns = Math.min(Math.max(Math.round(Number(arcHibernationTurns) || 12), 2), 200);
    for (const arc of state.records.arc) {
        if (arc.arcStatus !== 'active' || !Number.isInteger(messageId) || !Number.isInteger(arc.messageId)) continue;
        if (messageId - arc.messageId >= hibernationTurns) arc.arcStatus = 'hibernated';
    }
    return { state, applied, deferred };
}

export function buildContinuityStatePrompt(state, { maxChars = 1400, includeReflections = false } = {}) {
    if (!state?.records) return '';
    const records = state.records;
    const lines = [];
    const add = (label, values, render) => {
        for (const value of values.slice(-3).reverse()) lines.push(`${label}: ${render(value)}`);
    };
    add('Persona', records.persona || [], value => `${value.subject} — ${value.summary}`);
    add('Relationship', records.relationship || [], value => `${value.subject} toward ${value.target} — ${value.summary}`);
    add('Private knowledge', records.knowledge || [], value => `${value.subject} knows: ${value.summary}`);
    add('Physical continuity', records.physical || [], value => `${value.subject} — ${value.summary}`);
    add('Scene continuity', [...(records.scene || []), ...(records.intimacy || []), ...(records.affect || [])], value => `${value.subject}${value.target ? ` and ${value.target}` : ''} — ${value.summary}`);
    add('Open arc', (records.arc || []).filter(value => value.arcStatus === 'active'), value => `${value.summary}`);
    if (includeReflections) add('Reflection', state.reflections || [], value => value.summary);
    if (!lines.length) return '';
    const text = `[Approved continuity constraints]\n${lines.join('\n')}`;
    return text.length <= maxChars ? text : `${text.slice(0, Math.max(0, maxChars - 28))}\n[...state limit reached]`;
}
