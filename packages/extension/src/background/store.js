import { api } from '../shared/browser.js';
import { DEFAULT_SETTINGS } from '../shared/defaults.js';

/**
 * All persistent state lives in storage.local:
 *   index            -> [scriptId, ...]
 *   script:<id>      -> script record (source, parsed meta, fetched @require text, ...)
 *   values:<id>      -> the script's GM values. One key per script, so one script can
 *                       never address another script's data (it could in 2.9).
 *   settings, log
 * The background is the only writer and keeps an in-memory copy of the script records.
 */
let cache = null;

async function load() {
  if (cache) return cache;
  const { index = [] } = await api.storage.local.get('index');
  const got = index.length ? await api.storage.local.get(index.map((id) => `script:${id}`)) : {};
  cache = new Map();
  for (const id of index) if (got[`script:${id}`]) cache.set(id, got[`script:${id}`]);
  return cache;
}

export async function allScripts() {
  return [...(await load()).values()];
}

export async function getScript(id) {
  return (await load()).get(id) || null;
}

export async function findByToken(token) {
  for (const s of (await load()).values()) if (s.token === token) return s;
  return null;
}

export async function putScript(script) {
  const map = await load();
  map.set(script.id, script);
  await api.storage.local.set({ [`script:${script.id}`]: script, index: [...map.keys()] });
  return script;
}

export async function removeScript(id) {
  const map = await load();
  map.delete(id);
  await api.storage.local.remove([`script:${id}`, `values:${id}`]);
  await api.storage.local.set({ index: [...map.keys()] });
}

export async function getValues(id) {
  const key = `values:${id}`;
  return (await api.storage.local.get(key))[key] || {};
}

export async function setValues(id, values) {
  await api.storage.local.set({ [`values:${id}`]: values });
}

/**
 * Changes a script's values one caller at a time. Without the queue, two GM_setValue
 * calls sent in the same tick would both read the old object and one write would be lost.
 */
const valueQueues = new Map();
export function updateValues(id, change) {
  const run = (valueQueues.get(id) || Promise.resolve()).then(async () => {
    const values = await getValues(id);
    change(values);
    await setValues(id, values);
    return values;
  });
  valueQueues.set(id, run.catch(() => {}));
  return run;
}

export async function getSettings() {
  const { settings = {} } = await api.storage.local.get('settings');
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    bridge: { ...DEFAULT_SETTINGS.bridge, ...settings.bridge },
    external: { ...DEFAULT_SETTINGS.external, ...settings.external },
    ai: { ...DEFAULT_SETTINGS.ai, ...settings.ai }
  };
}

export async function setSettings(patch) {
  const cur = await getSettings();
  const next = { ...cur, ...patch };
  for (const k of ['bridge', 'external', 'ai']) if (patch[k]) next[k] = { ...cur[k], ...patch[k] };
  await api.storage.local.set({ settings: next });
  return next;
}

const LOG_MAX = 300;

/** Records what an outside client (MCP, another extension) or the updater did. */
export async function addLog(entry) {
  const { log = [] } = await api.storage.local.get('log');
  log.push({ time: Date.now(), ...entry });
  await api.storage.local.set({ log: log.slice(-LOG_MAX) });
}

export async function getLog() {
  return ((await api.storage.local.get('log')).log || []).slice().reverse();
}

export function newId() {
  return crypto.randomUUID();
}

export function newToken() {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** Session-scoped state that must survive a background restart (falls back to memory). */
const mem = {};
export async function sessionGet(key, fallback) {
  if (api.storage.session) return (await api.storage.session.get(key))[key] ?? fallback;
  return mem[key] ?? fallback;
}
export async function sessionSet(key, value) {
  if (api.storage.session) await api.storage.session.set({ [key]: value });
  else mem[key] = value;
}
