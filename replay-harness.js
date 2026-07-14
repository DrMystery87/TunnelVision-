/** Deterministic lifecycle harness for revision and async-order regression tests. */
export function createReplayHarness({ chatId = 'replay-chat', chat = [] } = {}) {
    const context = {
        chatId,
        chat: structuredClone(chat),
        chatMetadata: {},
        saveMetadataDebounced() {},
    };
    const deferred = [];

    function defer() {
        let resolve;
        let reject;
        const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
        deferred.push({ promise, resolve, reject });
        return deferred.at(-1);
    }

    function append(message) {
        context.chat.push(structuredClone(message));
        return context.chat.length - 1;
    }

    function edit(index, message) {
        context.chat[index] = { ...context.chat[index], ...structuredClone(message) };
    }

    function swipe(index, message) {
        context.chat[index] = { ...context.chat[index], ...structuredClone(message), swipe_id: Number(context.chat[index]?.swipe_id || 0) + 1 };
    }

    return { context, defer, append, edit, swipe };
}
