export const METADATA_KEY = 'world_info';
export const selected_world_info = null;
export const world_info = {};
export const world_names = ['Book A', 'Book B'];

export async function loadWorldInfo(...args) {
    if (typeof globalThis.__tunnelvisionVitestWorldInfo?.loadWorldInfo === 'function') {
        return globalThis.__tunnelvisionVitestWorldInfo.loadWorldInfo(...args);
    }
    return null;
}

export function createWorldInfoEntry(...args) {
    if (typeof globalThis.__tunnelvisionVitestWorldInfo?.createWorldInfoEntry === 'function') {
        return globalThis.__tunnelvisionVitestWorldInfo.createWorldInfoEntry(...args);
    }
    return { uid: 0, key: [], keysecondary: [], content: '', comment: '' };
}

export async function saveWorldInfo(...args) {
    if (typeof globalThis.__tunnelvisionVitestWorldInfo?.saveWorldInfo === 'function') {
        return globalThis.__tunnelvisionVitestWorldInfo.saveWorldInfo(...args);
    }
    return undefined;
}
