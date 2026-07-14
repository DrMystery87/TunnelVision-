import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
    settings: { connectionProfile: null, sidecarTemperature: 0.2, sidecarMaxTokens: 2048 },
    profiles: new Map(),
}));

vi.mock('../../../st-context.js', () => ({
    getContext: () => ({ getRequestHeaders: () => ({ 'X-Test': 'TunnelVision' }) }),
}));

vi.mock('../tree-store.js', () => ({
    getSettings: () => state.settings,
    findConnectionProfile: profileId => state.profiles.get(profileId) || null,
}));

vi.mock('../sidecar-safety.js', () => ({
    resolveTaskSampler: settings => ({
        temperature: settings.sidecarTemperature,
        maxTokens: settings.sidecarMaxTokens,
    }),
}));

import {
    fetchSecretKey,
    getSidecarModelLabel,
    isEmbeddingSupported,
    isSidecarConfigured,
    isSidecarKeyAvailable,
    sidecarGenerate,
} from '../llm-sidecar.js';

beforeEach(() => {
    state.settings = { connectionProfile: null, sidecarTemperature: 0.2, sidecarMaxTokens: 2048 };
    state.profiles = new Map();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

function selectProfile(profile = {}) {
    state.settings.connectionProfile = 'sidecar';
    state.profiles.set('sidecar', {
        name: 'Sidecar',
        api: 'custom',
        model: 'test-model',
        'api-url': 'https://sidecar.example/v1',
        ...profile,
    });
}

describe('Connection Manager sidecar configuration', () => {
    it('reports embeddings as unavailable until a dedicated embedding profile is implemented', () => {
        expect(isEmbeddingSupported()).toBe(false);
    });

    it('is unavailable until a selected profile has both provider and model', () => {
        expect(isSidecarConfigured()).toBe(false);

        selectProfile({ api: '', model: '' });
        expect(isSidecarConfigured()).toBe(false);
    });

    it('resolves the selected profile into a display label', () => {
        selectProfile({ api: 'openrouter', model: 'qwen/qwen3' });

        expect(isSidecarConfigured()).toBe(true);
        expect(getSidecarModelLabel()).toBe('openrouter/qwen/qwen3');
        expect(isSidecarKeyAvailable()).toBe(true);
    });
});

describe('direct sidecar calls', () => {
    it('returns null without a configured secret identifier', async () => {
        expect(await fetchSecretKey(null)).toBeNull();
    });

    it('fetches the selected profile key then uses the task sampler for OpenAI-compatible generation', async () => {
        selectProfile();
        state.settings.sidecarTemperature = 0.1;
        state.settings.sidecarMaxTokens = 1024;
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({ ok: true, json: async () => ({ value: 'test-key' }) })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ choices: [{ message: { content: '<think>hidden</think> visible' } }] }),
            });
        vi.stubGlobal('fetch', fetchMock);

        await expect(sidecarGenerate({ prompt: 'hello', systemPrompt: 'be concise', task: 'retrieval' }))
            .resolves.toBe('visible');

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[0][0]).toBe('/api/secrets/find');
        const [endpoint, options] = fetchMock.mock.calls[1];
        expect(endpoint).toBe('https://sidecar.example/v1/chat/completions');
        expect(options.headers.Authorization).toBe('Bearer test-key');
        expect(JSON.parse(options.body)).toMatchObject({
            model: 'test-model',
            temperature: 0.1,
            max_tokens: 1024,
            messages: [
                { role: 'system', content: 'be concise' },
                { role: 'user', content: 'hello' },
            ],
        });
    });

    it('fails before network activity when no selected profile is configured', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(sidecarGenerate({ prompt: 'hello' })).rejects.toThrow('Sidecar not configured');
        expect(fetchMock).not.toHaveBeenCalled();
    });
});