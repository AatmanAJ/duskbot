/** CapacitorHttp 8.6 (`native-bridge.js`, its fetch patch) sends every request but GET, HEAD, OPTIONS and TRACE through
 * URLSession without the request's AbortSignal, with a 600 s timeout (`HttpRequestHandler.swift`). On a connection that
 * died under it a send waited up to ten minutes and no timeout of ours could end it. The page's promise now settles
 * when its signal aborts; the native request runs on unheard. */
export function honorAbort(send: typeof fetch): typeof fetch {
  return (input, init) => {
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    if (!signal) return send(input, init);
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise<Response>((resolve, reject) => {
      const onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
      send(input, init).then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
    });
  };
}

const wrapped = new WeakSet<object>();

/** Once per page, on the native app only: the browser's own fetch already honours its signal. */
export function installNativeAbort(target: { fetch: typeof fetch } = window): void {
  if (wrapped.has(target.fetch)) return;
  const next = honorAbort(target.fetch.bind(target));
  wrapped.add(next);
  target.fetch = next;
}
