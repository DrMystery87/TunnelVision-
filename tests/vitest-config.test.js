import path from 'node:path';
import { describe, expect, it } from 'vitest';

import config from '../vitest.config.js';

const resolver = config.plugins.find(plugin => plugin.name === 'tunnelvision-standalone-host-stubs');

describe('standalone Vitest host resolver', () => {
    it('resolves host imports from a relocated checkout', () => {
        const resolved = resolver.resolveId(
            '../../../../script.js',
            'E:/work/TunnelVision/index.js',
        );

        expect(resolved).toBe(path.resolve('tests/stubs/script-host.js'));
    });

    it('does not rewrite test-only intermediate paths that would collide with fixtures', () => {
        const resolved = resolver.resolveId(
            '../../../st-context.js',
            path.resolve('tests/feed-storage.test.js'),
        );

        expect(resolved).toBeNull();
    });
});
