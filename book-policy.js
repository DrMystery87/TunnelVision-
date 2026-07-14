/**
 * Central policy decisions for lorebook access.
 *
 * Keep permission and injection semantics in one place so retrieval, tools,
 * post-turn automation, and maintenance do not silently disagree.
 */
import { canReadBook, canWriteBook, getBookInjectionMode, getBookPermission } from './tree-store.js';

/**
 * Return the current policy for one book. Callers still decide whether the
 * book is active; this module answers what the operation is allowed to do.
 *
 * @param {string} bookName
 * @returns {{bookName: string, permission: string, injectionMode: string, canRead: boolean, canWrite: boolean, canInject: boolean, canMaintain: boolean, reason: string}}
 */
export function getBookPolicy(bookName) {
    const permission = getBookPermission(bookName);
    const injectionMode = getBookInjectionMode(bookName);
    const readable = canReadBook(bookName);
    const writable = canWriteBook(bookName);
    const native = injectionMode === 'native';

    return {
        bookName,
        permission,
        injectionMode,
        canRead: readable,
        canWrite: writable,
        canInject: readable && !native,
        // Automated maintenance must not mutate a host-native book. Explicit
        // user/tool writes retain the existing write permission behavior.
        canMaintain: readable && writable && !native,
        reason: !readable && !writable
            ? 'Book access is denied.'
            : !readable
                ? 'Book is write-only.'
                : !writable
                    ? 'Book is read-only.'
                    : native
                        ? 'Native SillyTavern injection is host-owned.'
                        : 'Read/write managed book.',
    };
}

/** @param {string} bookName */
export function canInjectBook(bookName) {
    return getBookPolicy(bookName).canInject;
}

/** @param {string} bookName */
export function canMaintainBook(bookName) {
    return getBookPolicy(bookName).canMaintain;
}

/**
 * Stable identity for in-memory maps and manifests. World Info UIDs are only
 * unique inside their book.
 *
 * @param {string} bookName
 * @param {string|number} uid
 */
export function bookQualifiedKey(bookName, uid) {
    return `${String(bookName)}:${String(uid)}`;
}
