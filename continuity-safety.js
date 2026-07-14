import { getSettings } from './tree-store.js';

/** True only for the new continuity pipeline; legacy features are unaffected. */
export function isContinuityPaused(settings = getSettings()) {
    return settings.continuitySafetyKillSwitch === true;
}
