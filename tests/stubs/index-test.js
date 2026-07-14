export function applyRecurseLimit(limit) {
    return Number.isFinite(Number(limit)) ? Number(limit) : 5;
}
