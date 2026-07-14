import { beforeEach, describe, expect, it } from 'vitest';
import { extension_settings } from './stubs/extensions-host.js';
import { bookQualifiedKey, canInjectBook, canMaintainBook, getBookPolicy } from '../book-policy.js';

beforeEach(() => {
    extension_settings.tunnelvision = {
        trees: {},
        trackerUids: {},
        bookPermissions: {},
        bookInjectionModes: {},
    };
});

describe('book policy', () => {
    it('keeps native injection and automated maintenance host-owned', () => {
        extension_settings.tunnelvision.bookInjectionModes = { Canon: 'native' };

        expect(getBookPolicy('Canon')).toMatchObject({
            canRead: true,
            canWrite: true,
            canInject: false,
            canMaintain: false,
        });
    });

    it('does not inject or maintain write-only books', () => {
        extension_settings.tunnelvision.bookPermissions = { Archive: 'write_only' };

        expect(getBookPolicy('Archive')).toMatchObject({
            canRead: false,
            canWrite: true,
            canInject: false,
            canMaintain: false,
        });
        expect(canInjectBook('Archive')).toBe(false);
        expect(canMaintainBook('Archive')).toBe(false);
    });

    it('creates collision-safe keys for identical UIDs in different books', () => {
        expect(bookQualifiedKey('Characters', 7)).toBe('Characters:7');
        expect(bookQualifiedKey('Locations', 7)).toBe('Locations:7');
    });
});
