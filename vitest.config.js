import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const normalizePath = (value) => path.resolve(value).replace(/\\/g, '/');
const projectRootPath = normalizePath(projectRoot);
const localIndexPath = normalizePath(path.join(projectRoot, 'index.js'));
const testsRootPath = normalizePath(path.join(projectRoot, 'tests'));
const hostModuleStubs = new Map([
    ['extensions.js', 'tests/stubs/extensions-host.js'],
    ['script.js', 'tests/stubs/script-host.js'],
    ['st-context.js', 'tests/stubs/st-context-host.js'],
    ['tool-calling.js', 'tests/stubs/tool-calling-host.js'],
    ['group-chats.js', 'tests/stubs/group-chats-host.js'],
    ['utils.js', 'tests/stubs/utils-host.js'],
    ['popup.js', 'tests/stubs/popup-host.js'],
    ['power-user.js', 'tests/stubs/power-user-host.js'],
    ['chats.js', 'tests/stubs/chats-host.js'],
    ['world-info.js', 'tests/stubs/world-info-host.js'],
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
            const importerPath = normalizePath(importer);
            const resolved = normalizePath(path.resolve(path.dirname(importer), source));
            const resolvedParent = normalizePath(path.dirname(resolved));
            const resolvedRoot = normalizePath(path.parse(resolved).root);
            if (
                (importerPath === testsRootPath || importerPath.startsWith(`${testsRootPath}/`))
                && resolvedParent !== resolvedRoot
            ) return null;
            if (resolved === localIndexPath) {
                return path.resolve('tests/stubs/index-test.js');
            }
            if (resolved === projectRootPath || resolved.startsWith(`${projectRootPath}/`)) return null;
            const stub = hostModuleStubs.get(path.basename(resolved));
            return stub ? path.resolve(stub) : null;
        },
    }],
});
