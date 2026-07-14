/**
 * Durable storage primitives for the unified continuity engine.
 *
 * Large transaction records belong in localforage/IndexedDB rather than
 * extension settings or chat metadata. A memory fallback keeps the extension
 * usable on hosts where localforage is unavailable and makes the layer easy to
 * test in isolation.
 */

const STORE_NAME = 'TunnelVisionContinuity';
const KEY_PREFIX = 'tv-continuity:v1';

/** @returns {{getItem: Function, setItem: Function, removeItem: Function, keys: Function}} */
export function createMemoryStore() {
    const values = new Map();
    return {
        async getItem(key) { return values.has(key) ? structuredClone(values.get(key)) : null; },
        async setItem(key, value) { values.set(key, structuredClone(value)); return value; },
        async removeItem(key) { values.delete(key); },
        async keys() { return [...values.keys()]; },
    };
}

let _store = null;
const _memoryFallback = createMemoryStore();

/**
 * Get the extension-owned durable store. This intentionally does not use
 * extensionSettings: it is loaded eagerly and saved frequently by the host.
 */
export function getContinuityStore() {
    if (_store) return _store;
    try {
        const localforage = globalThis.SillyTavern?.libs?.localforage;
        if (localforage) {
            _store = localforage.createInstance({ name: STORE_NAME });
            return _store;
        }
    } catch (error) {
        console.warn('[TunnelVision] Continuity storage fell back to memory:', error?.message || error);
    }
    _store = _memoryFallback;
    return _store;
}

/** @param {string} chatId @param {string} collection @param {string} id */
export function continuityKey(chatId, collection, id) {
    return `${KEY_PREFIX}:${encodeURIComponent(String(chatId || 'global'))}:${collection}:${encodeURIComponent(String(id))}`;
}

/** @param {string} chatId @param {string} collection */
export function continuityCollectionPrefix(chatId, collection) {
    return `${KEY_PREFIX}:${encodeURIComponent(String(chatId || 'global'))}:${collection}:`;
}

/** List opaque records in one chat-scoped collection. */
export async function listContinuityRecords(chatId, collection, { store = getContinuityStore() } = {}) {
    const prefix = continuityCollectionPrefix(chatId, collection);
    const keys = await store.keys();
    const matchingKeys = keys.filter(key => String(key).startsWith(prefix));
    const records = await Promise.all(matchingKeys.map(key => store.getItem(key)));
    return records.filter(Boolean);
}

/** Test-only/reset hook. */
export function resetContinuityStoreForTests() {
    _store = null;
}
