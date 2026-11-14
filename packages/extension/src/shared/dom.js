/** Tiny DOM builder. Text is always set as text, never parsed as HTML. */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && k !== 'list' && k !== 'form') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  return add(el, children);
}

/** Appends children, flattening arrays and skipping null, undefined and false. */
export function add(el, ...children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

/** Replaces the content of an element. */
export function fill(el, ...children) {
  return add(clear(el), children);
}

export function timeAgo(ts) {
  if (!ts) return 'never';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return new Date(ts).toLocaleDateString();
}

export function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

let toastTimer;
export function toast(text, kind = 'info') {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(el);
  }
  el.textContent = text;
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, kind === 'error' ? 6000 : 2500);
}

/** Plain-language description of a @grant value, shown before installing. */
export function explainGrant(g) {
  const map = {
    GM_xmlhttpRequest: 'Send requests to the sites listed under "Connects to"',
    'GM.xmlHttpRequest': 'Send requests to the sites listed under "Connects to"',
    GM_download: 'Download files', 'GM.download': 'Download files',
    GM_cookie: 'Read and change cookies of the page it runs on', 'GM.cookie': 'Read and change cookies of the page it runs on',
    GM_setClipboard: 'Write to the clipboard', 'GM.setClipboard': 'Write to the clipboard',
    GM_notification: 'Show desktop notifications', 'GM.notification': 'Show desktop notifications',
    GM_openInTab: 'Open new tabs', 'GM.openInTab': 'Open new tabs',
    GM_getTab: 'Keep data for a tab', GM_saveTab: 'Keep data for a tab', GM_getTabs: 'Keep data for a tab',
    GM_registerMenuCommand: 'Add commands to the TamperDonkey menu', 'GM.registerMenuCommand': 'Add commands to the TamperDonkey menu',
    unsafeWindow: 'Use unsafeWindow',
    'window.onurlchange': 'Notice when the page address changes'
  };
  if (map[g]) return map[g];
  if (/Value/.test(g)) return 'Store its own settings and data';
  if (/addStyle|addElement/.test(g)) return 'Add styles or elements to the page';
  if (/Resource/.test(g)) return 'Use files bundled with the script';
  return g;
}
