const context = {
    chat: [],
    chatId: null,
    chatMetadata: {},
    chatCompletionSettings: {},
    getRequestHeaders: () => ({}),
    saveMetadataDebounced() {},
};

export function getContext() {
    const configured = globalThis.__tunnelvisionVitestContext;
    return typeof configured === 'function' ? configured() : (configured || context);
}

export function setTestContext(nextContext) {
    globalThis.__tunnelvisionVitestContext = nextContext;
}
