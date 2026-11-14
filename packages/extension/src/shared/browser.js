/** One place that touches the browser namespace, so feature code works in Chrome and Firefox. */
export const api = globalThis.browser ?? globalThis.chrome;
export const isFirefox = typeof globalThis.browser !== 'undefined' && typeof api?.runtime?.getBrowserInfo === 'function';

/** Sends a command to the background and returns its result, or throws its error. */
export async function call(cmd, args = {}) {
  const r = await api.runtime.sendMessage({ cmd, args });
  if (!r) throw new Error('The extension background did not answer.');
  if (!r.ok) throw new Error(r.error);
  return r.result;
}
