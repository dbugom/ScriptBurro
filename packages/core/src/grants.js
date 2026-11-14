/**
 * @grant and @connect rules. Tampermonkey 2.9 had neither: every script received every
 * GM function and could request any host.
 */

export const API_NAMES = [
  'addStyle', 'addElement', 'getValue', 'setValue', 'deleteValue', 'listValues',
  'getValues', 'setValues', 'deleteValues',
  'addValueChangeListener', 'removeValueChangeListener', 'log', 'registerMenuCommand',
  'unregisterMenuCommand', 'openInTab', 'xmlhttpRequest', 'download', 'getResourceText',
  'getResourceURL', 'notification', 'setClipboard', 'getTab', 'saveTab', 'getTabs', 'cookie'
];

const ALIASES = { xmlHttpRequest: 'xmlhttpRequest', getResourceUrl: 'getResourceURL' };

/** Maps a @grant value ("GM_getValue", "GM.getValue") to the internal API name, or null. */
export function grantToApi(grant) {
  const m = /^GM[_.](\w+)$/.exec(grant);
  if (!m) return null;
  const name = ALIASES[m[1]] || m[1];
  return API_NAMES.includes(name) ? name : null;
}

/**
 * @returns {{sandbox: boolean, apis: string[], unsafeWindow: boolean, unknown: string[]}}
 * sandbox=false means "@grant none" (or no @grant at all): the script runs in the page's
 * own JavaScript world with no privileged API.
 */
export function resolveGrants(meta) {
  const grants = meta.grants || [];
  const apis = new Set();
  const unknown = [];
  let unsafeWindow = false;
  for (const g of grants) {
    if (g === 'none') continue;
    if (g === 'unsafeWindow') unsafeWindow = true;
    else if (g === 'window.close' || g === 'window.focus' || g === 'window.onurlchange') continue;
    else {
      const api = grantToApi(g);
      if (api) apis.add(api);
      else unknown.push(g);
    }
  }
  const real = grants.filter((g) => g !== 'none');
  const sandbox = real.length > 0 && meta.injectInto !== 'page';
  return { sandbox, apis: [...apis], unsafeWindow, unknown };
}

/**
 * Decides whether a script may send a request to a URL.
 * Allowed: hosts listed in @connect (and their subdomains), "self" for hosts the script
 * itself matches, and "*" when the user has approved it.
 * @returns {{allowed: boolean, reason?: string, host?: string}}
 */
export function checkConnect(meta, url, { pageUrl = '', allowHttp = false, extraHosts = [] } = {}) {
  let u;
  try {
    u = new URL(url, pageUrl || undefined);
  } catch {
    return { allowed: false, reason: 'Invalid URL.' };
  }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && (allowHttp || isLocal(u.hostname)))) {
    return { allowed: false, reason: `Only https requests are allowed (got ${u.protocol}//).`, host: u.hostname };
  }
  const host = u.hostname.toLowerCase();
  const rules = [...(meta.connects || []), ...extraHosts].map((c) => c.toLowerCase());
  for (const rule of rules) {
    if (rule === '*') return { allowed: true, host };
    if (rule === 'self' && pageUrl) {
      try {
        if (new URL(pageUrl).hostname.toLowerCase() === host) return { allowed: true, host };
      } catch { /* ignore */ }
    }
    if (rule === 'localhost' && isLocal(host)) return { allowed: true, host };
    if (host === rule || host.endsWith(`.${rule}`)) return { allowed: true, host };
  }
  return { allowed: false, reason: `The host "${host}" is not listed in @connect.`, host };
}

function isLocal(host) {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}
