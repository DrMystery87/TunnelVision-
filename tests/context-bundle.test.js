import { describe, expect, it } from 'vitest';
import { buildContextBundle } from '../context-bundle.js';

describe('context bundle', () => {
    it('combines local continuity sources within one hard cap and records a manifest', () => {
        const bundle = buildContextBundle({
            settings: { worldStateEnabled: true, smartContextEnabled: true, notebookEnabled: true, contextBundleMaxChars: 100 },
            buildWorldStatePromptImpl: () => 'WORLD',
            buildSmartContextPromptImpl: () => 'SMART',
            buildNotebookPromptImpl: () => 'NOTE',
        });
        expect(bundle.text).toContain('WORLD');
        expect(bundle.text).toContain('SMART');
        expect(bundle.manifest.map(item => item.source)).toEqual(['world-state', 'smart-context', 'notebook']);
    });

    it('truncates low-priority content rather than exceeding the configured cap', () => {
        const bundle = buildContextBundle({
            settings: { worldStateEnabled: true, smartContextEnabled: true, notebookEnabled: false, contextBundleMaxChars: 500 },
            buildWorldStatePromptImpl: () => 'W'.repeat(300),
            buildSmartContextPromptImpl: () => 'S'.repeat(450),
            buildNotebookPromptImpl: () => '',
        });
        expect(bundle.text.length).toBeLessThanOrEqual(560);
        expect(bundle.manifest.some(item => item.truncated)).toBe(true);
    });

    it('places approved typed continuity ahead of retrieved and notebook context', () => {
        const bundle = buildContextBundle({
            settings: { worldStateEnabled: true, smartContextEnabled: true, notebookEnabled: true, contextBundleMaxChars: 500, continuityStateMode: 'drafts', continuityStateInBundle: true },
            buildWorldStatePromptImpl: () => 'WORLD',
            buildContinuityStatePromptImpl: () => 'STATE',
            getContinuityStateImpl: () => ({}),
            buildSmartContextPromptImpl: () => 'SMART',
            buildNotebookPromptImpl: () => 'NOTE',
        });
        expect(bundle.manifest.map(item => item.source)).toEqual(['world-state', 'typed-continuity', 'smart-context', 'notebook']);
    });
});
