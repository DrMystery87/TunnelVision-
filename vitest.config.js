import path from 'node:path';
import { defineConfig } from 'vitest/config';

const hostModuleStubs = new Map([
    ['D:/SillyTavern/TunnelVision/TunnelVision-/index.js', 'tests/stubs/index-test.js'],
    ['D:/extensions.js', 'tests/stubs/extensions-host.js'],
    ['D:/script.js', 'tests/stubs/script-host.js'],
    ['D:/st-context.js', 'tests/stubs/st-context-host.js'],
    ['D:/tool-calling.js', 'tests/stubs/tool-calling-host.js'],
    ['D:/group-chats.js', 'tests/stubs/group-chats-host.js'],
    ['D:/utils.js', 'tests/stubs/utils-host.js'],
    ['D:/popup.js', 'tests/stubs/popup-host.js'],
    ['D:/power-user.js', 'tests/stubs/power-user-host.js'],
    ['D:/chats.js', 'tests/stubs/chats-host.js'],
    ['D:/world-info.js', 'tests/stubs/world-info-host.js'],
]);

export default defineConfig({
    test: {
        fileParallelism: false,
    },
    plugins: [{
        name: 'tunnelvision-standalone-host-stubs',
        enforce: 'pre',
        resolveId(source, importer) {
            if (!importer || !source.startsWith('.')) return null;
            const resolved = path.resolve(path.dirname(importer), source).replace(/\\/g, '/');
            const stub = hostModuleStubs.get(resolved);
            return stub ? path.resolve(stub) : null;
        },
    }],
});
