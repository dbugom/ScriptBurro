import { api } from '../shared/browser.js';
import { checkConnect, resolveGrants } from '@tamperdonkey/core';
import { hasPermission, PERMISSION_LABEL } from '../shared/permissions.js';
import { findByToken, getValues, updateValues, getSettings, sessionGet, sessionSet } from './store.js';

/** Events waiting for a page instance, keyed by "tabId:frameId:scriptId". */
const queues = new Map();
const aborts = new Map();

const key = (tabId, frameId, scriptId) => `${tabId}:${frameId}:${scriptId}`;

async function push(tabId, frameId, scriptId, event) {
  const k = key(tabId, frameId, scriptId);
  if (!queues.has(k)) queues.set(k, []);
  queues.get(k).push(event);
  try {
    await api.tabs.sendMessage(tabId, { tdPoke: scriptId }, { frameId });
    return true;
  } catch {
    queues.delete(k);
    return false;
  }
}

async function remember(scriptId, sender) {
  const inst = await sessionGet('instances', {});
  const list = inst[scriptId] || [];
  if (!list.some(([t, f]) => t === sender.tab.id && f === sender.frameId)) {
    inst[scriptId] = [...list, [sender.tab.id, sender.frameId]];
    await sessionSet('instances', inst);
  }
}

/** Tells every other page running the script that a value changed. */
export async function broadcastValue(scriptId, change, except) {
  const inst = await sessionGet('instances', {});
  const list = inst[scriptId] || [];
  const alive = [];
  for (const [tabId, frameId] of list) {
    if (except && except.tab.id === tabId && except.frameId === frameId) {
      alive.push([tabId, frameId]);
    } else if (await push(tabId, frameId, scriptId, { t: 'value', ...change })) {
      alive.push([tabId, frameId]);
    }
  }
  if (alive.length !== list.length) {
    inst[scriptId] = alive;
    await sessionSet('instances', inst);
  }
}

export async function clickMenu(tabId, commandId) {
  const menus = await sessionGet('menus', {});
  const cmd = (menus[tabId] || []).find((c) => c.id === commandId);
  if (!cmd) throw new Error('That menu command is no longer available.');
  await push(tabId, cmd.frameId, cmd.scriptId, { t: 'menu', id: cmd.id });
}

export async function menusForTab(tabId) {
  return (await sessionGet('menus', {}))[tabId] || [];
}

export async function badgesForTab(tabId) {
  return (await sessionGet('badges', {}))[tabId] || {};
}

export async function forgetFrame(tabId, frameId) {
  if (frameId === 0) {
    const badges = await sessionGet('badges', {});
    if (badges[tabId]) {
      delete badges[tabId];
      await sessionSet('badges', badges);
      // The browser clears a tab's badge on navigation; the tooltip is reset here.
      api.action.setTitle({ tabId, title: 'TamperDonkey' }).catch(() => {});
    }
  }
  // Events queued for the document that just went away will never be collected.
  const prefix = frameId === 0 ? `${tabId}:` : `${tabId}:${frameId}:`;
  for (const k of queues.keys()) if (k.startsWith(prefix)) queues.delete(k);
  const menus = await sessionGet('menus', {});
  if (menus[tabId]) {
    menus[tabId] = frameId === 0 ? [] : menus[tabId].filter((c) => c.frameId !== frameId);
    if (!menus[tabId].length) delete menus[tabId];
    await sessionSet('menus', menus);
  }
}

export async function forgetTab(tabId) {
  for (const name of ['menus', 'tabdata', 'badges']) {
    const m = await sessionGet(name, {});
    if (m[tabId]) {
      delete m[tabId];
      await sessionSet(name, m);
    }
  }
  const opened = await sessionGet('opened', {});
  if (opened[tabId]) {
    const o = opened[tabId];
    delete opened[tabId];
    await sessionSet('opened', opened);
    await push(o.tabId, o.frameId, o.scriptId, { t: 'tabClosed', id: tabId });
  }
}

export async function noteEvent(noteId, kind) {
  const notes = await sessionGet('notes', {});
  const n = notes[noteId];
  if (!n) return;
  if (kind === 'click') {
    n.clicked = true;
    await push(n.tabId, n.frameId, n.scriptId, { t: 'note', id: noteId, kind: 'click' });
    if (n.url) api.tabs.create({ url: n.url });
    api.notifications.clear(noteId);
    await sessionSet('notes', notes);
  } else {
    delete notes[noteId];
    await sessionSet('notes', notes);
    await push(n.tabId, n.frameId, n.scriptId, { t: 'note', id: noteId, kind: 'done', clicked: !!n.clicked });
  }
}

function httpUrl(url) {
  const u = new URL(url);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http(s) URLs are allowed.');
  return u.href;
}

function decodeBody(body, headers) {
  if (!body) return undefined;
  const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  if (body.t === 'text') {
    if (body.type && !headers.has('content-type')) headers.set('content-type', body.type);
    return body.v;
  }
  if (body.t === 'b64') {
    if (body.type && !headers.has('content-type')) headers.set('content-type', body.type);
    return fromB64(body.v);
  }
  if (body.t === 'form') {
    const fd = new FormData();
    for (const f of body.v) {
      if (f.b64 !== undefined) fd.append(f.k, new Blob([fromB64(f.b64)], { type: f.type }), f.name);
      else fd.append(f.k, f.v);
    }
    headers.delete('content-type'); // fetch sets the multipart boundary
    return fd;
  }
  return undefined;
}

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

async function needPermission(name, script) {
  if (await hasPermission(name)) return;
  throw new Error(`TamperDonkey may not ${PERMISSION_LABEL[name]} yet. Open "${script.meta.name}" in the dashboard, Settings tab, and allow it.`);
}

async function connectAllowed(script, url, sender) {
  const settings = await getSettings();
  const chk = checkConnect(script.meta, url, { pageUrl: sender.url, allowHttp: settings.allowHttp, extraHosts: script.connectApproved });
  if (!chk.allowed) throw new Error(chk.reason);
}

/** method -> [required grant or null, handler]. The grant is checked for every call. */
const METHODS = {
  init: [null, async (s, a, sender) => {
    await remember(s.id, sender);
    return getValues(s.id);
  }],
  poll: [null, async (s, a, sender) => {
    const k = key(sender.tab.id, sender.frameId, s.id);
    const events = queues.get(k) || [];
    queues.delete(k);
    return events;
  }],
  // Toolbar badge for the tab the script runs in. Needs no grant: it only changes
  // TamperDonkey's own icon. Only the top frame may set it.
  badge: [null, async (s, [o], sender) => {
    if (sender.frameId !== 0) return;
    const tabId = sender.tab.id;
    const text = String(o?.text ?? '').slice(0, 4);
    const title = String(o?.title ?? '').slice(0, 200);
    await api.action.setBadgeText({ tabId, text });
    const color = /^#[0-9a-f]{6}$/i.test(o?.color || '') ? o.color : '#0d6b58';
    await api.action.setBadgeBackgroundColor({ tabId, color });
    try { await api.action.setBadgeTextColor?.({ tabId, color: '#ffffff' }); } catch { /* not in every browser */ }
    await api.action.setTitle({ tabId, title: title ? `TamperDonkey\n${s.meta.name}: ${title}` : 'TamperDonkey' });
    const badges = await sessionGet('badges', {});
    badges[tabId] = { ...badges[tabId], [s.id]: { text, title } };
    await sessionSet('badges', badges);
  }],
  setValue: ['setValue', async (s, [name, value], sender) => {
    await updateValues(s.id, (values) => { values[String(name)] = value; });
    await broadcastValue(s.id, { key: String(name), value }, sender);
  }],
  deleteValue: ['deleteValue', async (s, [name], sender) => {
    await updateValues(s.id, (values) => { delete values[String(name)]; });
    await broadcastValue(s.id, { key: String(name), deleted: true }, sender);
  }],
  xhr: ['xmlhttpRequest', async (s, [d], sender) => {
    await connectAllowed(s, d.url, sender);
    const ctrl = new AbortController();
    let timedOut = false;
    aborts.set(d.id, ctrl);
    const timer = d.timeout > 0 ? setTimeout(() => { timedOut = true; ctrl.abort(); }, d.timeout) : null;
    try {
      const headers = new Headers();
      for (const [k, v] of Object.entries(d.headers || {})) {
        try { headers.set(k, String(v)); } catch { /* invalid header name */ }
      }
      if (d.user) headers.set('authorization', `Basic ${btoa(`${d.user}:${d.password || ''}`)}`);
      const init = { method: d.method, headers, signal: ctrl.signal, credentials: d.anonymous ? 'omit' : 'include', redirect: 'follow' };
      if (!['GET', 'HEAD'].includes(d.method)) init.body = decodeBody(d.body, headers);
      const res = await fetch(d.url, init);
      // A redirect must not carry the response of a host outside @connect back to the script.
      if (res.url && res.url !== d.url) {
        try {
          await connectAllowed(s, res.url, sender);
        } catch (e) {
          return { failed: 'error', message: `Redirected to a host that is not allowed. ${e.message}` };
        }
      }
      const mime = d.overrideMimeType || res.headers.get('content-type') || '';
      const out = {
        status: res.status,
        statusText: res.statusText,
        finalUrl: res.url || d.url,
        mime,
        headers: [...res.headers].map(([k, v]) => `${k}: ${v}`).join('\r\n')
      };
      const buf = await res.arrayBuffer();
      if (d.binary) out.b64 = toBase64(buf);
      else {
        const charset = /charset=([^;]+)/i.exec(mime)?.[1]?.trim().replace(/^"|"$/g, '') || 'utf-8';
        let dec;
        try { dec = new TextDecoder(charset); } catch { dec = new TextDecoder(); }
        out.text = dec.decode(buf);
      }
      return out;
    } catch (e) {
      if (e.name === 'AbortError') return { failed: timedOut ? 'timeout' : 'abort', message: timedOut ? 'timeout' : 'aborted' };
      return { failed: 'error', message: String(e.message || e) };
    } finally {
      if (timer) clearTimeout(timer);
      aborts.delete(d.id);
    }
  }],
  xhrAbort: ['xmlhttpRequest', async (s, [id]) => {
    if (String(id).startsWith(`${s.id}:`)) aborts.get(id)?.abort();
  }],
  download: ['download', async (s, [d], sender) => {
    await needPermission('downloads', s);
    await connectAllowed(s, d.url, sender);
    const opts = { url: d.url, saveAs: !!d.saveAs };
    if (d.name) opts.filename = String(d.name).replace(/^[/\\.]+/, '').replace(/\.\.[/\\]/g, '').replace(/[<>:"|?*]/g, '_');
    return api.downloads.download(opts);
  }],
  menuRegister: ['registerMenuCommand', async (s, [id, name, accessKey], sender) => {
    const menus = await sessionGet('menus', {});
    const list = (menus[sender.tab.id] || []).filter((c) => c.id !== id);
    list.push({ id, name: String(name).slice(0, 200), key: accessKey, scriptId: s.id, script: s.meta.name, frameId: sender.frameId });
    menus[sender.tab.id] = list;
    await sessionSet('menus', menus);
  }],
  menuUnregister: ['unregisterMenuCommand', async (s, [id], sender) => {
    const menus = await sessionGet('menus', {});
    menus[sender.tab.id] = (menus[sender.tab.id] || []).filter((c) => !(c.id === id && c.scriptId === s.id));
    await sessionSet('menus', menus);
  }],
  openInTab: ['openInTab', async (s, [url, o], sender) => {
    const create = { url: httpUrl(url), active: !!o.active, openerTabId: sender.tab.id };
    if (o.insert) create.index = sender.tab.index + 1;
    const tab = await api.tabs.create(create);
    const opened = await sessionGet('opened', {});
    opened[tab.id] = { tabId: sender.tab.id, frameId: sender.frameId, scriptId: s.id };
    await sessionSet('opened', opened);
    return tab.id;
  }],
  closeTab: ['openInTab', async (s, [tabId]) => {
    const opened = await sessionGet('opened', {});
    if (opened[tabId]?.scriptId !== s.id) throw new Error('A script can only close tabs it opened.');
    await api.tabs.remove(tabId);
  }],
  notify: ['notification', async (s, [d], sender) => {
    const id = `td-${crypto.randomUUID()}`;
    const image = typeof d.image === 'string' && /^(https:|data:image\/)/.test(d.image) ? d.image : api.runtime.getURL('icons/icon-128.png');
    await api.notifications.create(id, { type: 'basic', iconUrl: image, title: String(d.title).slice(0, 200), message: String(d.text).slice(0, 2000) });
    const notes = await sessionGet('notes', {});
    notes[id] = { tabId: sender.tab.id, frameId: sender.frameId, scriptId: s.id, url: d.url && /^https?:/.test(d.url) ? d.url : '' };
    await sessionSet('notes', notes);
    if (d.timeout > 0) setTimeout(() => api.notifications.clear(id), d.timeout);
    return id;
  }],
  getTab: ['getTab', async (s, a, sender) => (await sessionGet('tabdata', {}))[sender.tab.id]?.[s.id] || {}],
  saveTab: ['saveTab', async (s, [obj], sender) => {
    const data = await sessionGet('tabdata', {});
    data[sender.tab.id] = { ...data[sender.tab.id], [s.id]: obj };
    await sessionSet('tabdata', data);
  }],
  // Only this script's own entries: in 2.9 getTabs returned every script's tab data.
  getTabs: ['getTabs', async (s) => {
    const data = await sessionGet('tabdata', {});
    const out = {};
    for (const [tabId, per] of Object.entries(data)) if (per[s.id]) out[tabId] = per[s.id];
    return out;
  }],
  // Cookies are limited to the page the script runs on, and HttpOnly cookies stay hidden.
  cookieList: ['cookie', async (s, [d], sender) => {
    await needPermission('cookies', s);
    const q = { url: sender.url };
    if (d.name) q.name = String(d.name);
    return (await api.cookies.getAll(q)).filter((c) => !c.httpOnly);
  }],
  cookieSet: ['cookie', async (s, [d], sender) => {
    await needPermission('cookies', s);
    const c = { url: sender.url, name: String(d.name), value: String(d.value ?? '') };
    for (const k of ['path', 'secure', 'expirationDate', 'sameSite']) if (d[k] !== undefined) c[k] = d[k];
    await api.cookies.set(c);
  }],
  cookieDelete: ['cookie', async (s, [d], sender) => {
    await needPermission('cookies', s);
    await api.cookies.remove({ url: sender.url, name: String(d.name) });
  }]
};

/** Entry point for messages coming from the userscript world. */
export async function handleUserScriptMessage(msg, sender) {
  try {
    if (!msg || typeof msg.td !== 'string' || !sender.tab) throw new Error('Bad request.');
    const script = await findByToken(msg.td);
    if (!script || !script.enabled || script.trashedAt) throw new Error('Unknown script.');
    const entry = METHODS[msg.m];
    if (!entry) throw new Error(`Unknown method ${msg.m}.`);
    const [grant, fn] = entry;
    if (grant && !resolveGrants(script.meta).apis.includes(grant)) {
      throw new Error(`"${script.meta.name}" has no @grant for GM_${grant}.`);
    }
    return { ok: true, value: await fn(script, Array.isArray(msg.a) ? msg.a : [], sender) };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}
