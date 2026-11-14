/* global __TD_RUNTIME__, __TD_VERSION__ */
import { api } from '../shared/browser.js';
import { compileRules, resolveGrants, toRegistration, getHeader } from '@tamperdonkey/core';
import { allScripts, getSettings } from './store.js';

const RUN_AT = {
  'document-start': 'document_start',
  'document-body': 'document_start',
  'document-end': 'document_end',
  'document-idle': 'document_idle'
};
const VALUE_APIS = ['getValue', 'setValue', 'deleteValue', 'listValues', 'getValues', 'setValues', 'deleteValues', 'addValueChangeListener'];

export function userScriptsAvailable() {
  try {
    return typeof api.userScripts?.register === 'function';
  } catch {
    return false; // Chrome throws until the user allows user scripts for the extension
  }
}

export function worldOf(script) {
  return resolveGrants(script.meta).sandbox ? 'USER_SCRIPT' : 'MAIN';
}

/** Builds the JavaScript handed to the browser for one script. */
export function buildCode(script, settings, { skipRules = false } = {}) {
  const g = resolveGrants(script.meta);
  const reg = toRegistration(script.meta, script.overrides);
  const overrides = { ...script.overrides, excludes: [...(script.overrides?.excludes || []), ...(settings.blacklist || [])] };
  const needRules = !skipRules && (!reg?.exact || overrides.excludes.length > 0 || (script.meta.excludes || []).length > 0);
  const params = ['GM', 'GM_info', 'unsafeWindow', ...(g.sandbox ? g.apis.map((a) => `GM_${a}`) : [])];
  const resources = {};
  for (const r of script.meta.resources || []) {
    const got = script.resources?.[r.name];
    if (got) resources[r.name] = { text: got.text, dataUrl: got.dataUrl };
  }
  const cfg = {
    id: script.id,
    token: g.sandbox ? script.token : undefined,
    sandbox: g.sandbox,
    apis: g.apis,
    params,
    meta: publicMeta(script.meta),
    metaStr: `// ==UserScript==${getHeader(script.source) ?? '\n'}==/UserScript==`,
    handlerVersion: __TD_VERSION__,
    runAt: script.meta.runAt,
    noframes: script.meta.noframes,
    rules: needRules ? compileRules(script.meta, overrides) : null,
    resources,
    preloadValues: g.sandbox && g.apis.some((a) => VALUE_APIS.includes(a)),
    urlchange: g.sandbox && (script.meta.grants || []).includes('window.onurlchange')
  };
  const requires = (script.meta.requires || []).map((u) => script.requires?.[u] ?? '').join('\n;\n');
  return `(function(){${__TD_RUNTIME__}\n__td_boot(${JSON.stringify(cfg)},function(${params.join(',')}){\n${requires}\n;\n${script.source}\n});})();`;
}

function publicMeta(m) {
  return {
    name: m.name, namespace: m.namespace, version: m.version, description: m.description, author: m.author,
    homepage: m.homepage, icon: m.icon, includes: m.includes, matches: m.matches, excludes: m.excludes,
    grant: m.grants, connects: m.connects, resources: m.resources, 'run-at': m.runAt, noframes: m.noframes
  };
}

export function worldIdOf(script) {
  return `td-${script.id}`;
}

async function configureWorld(worldId) {
  const cfg = { messaging: true, csp: "script-src 'self' 'unsafe-eval'" };
  try {
    await api.userScripts.configureWorld(worldId ? { ...cfg, worldId } : cfg);
    return true;
  } catch {
    return false; // browsers without per-script worlds share the default one
  }
}

/**
 * Makes the browser's registered user scripts equal to the enabled scripts in the store.
 * Runs are queued, and scripts that stay registered are updated in place, so a page that
 * loads during a sync still gets every script.
 */
let syncing = Promise.resolve();
export function syncRegistrations() {
  const run = syncing.then(doSync);
  syncing = run.catch(() => {});
  return run;
}

async function doSync() {
  if (!userScriptsAvailable()) return { available: false, registered: 0 };
  const settings = await getSettings();
  const scripts = (await allScripts()).filter((s) => s.enabled && !s.trashedAt && s.meta.runAt !== 'context-menu');
  await configureWorld();

  const wanted = [];
  for (const s of scripts) {
    const reg = toRegistration(s.meta, s.overrides);
    if (!reg) continue;
    const world = worldOf(s);
    const entry = {
      id: s.id,
      matches: reg.matches,
      excludeMatches: reg.excludeMatches,
      allFrames: !s.meta.noframes,
      runAt: RUN_AT[s.meta.runAt] || 'document_idle',
      world,
      js: [{ code: buildCode(s, settings) }]
    };
    if (world === 'USER_SCRIPT' && (await configureWorld(worldIdOf(s)))) entry.worldId = worldIdOf(s);
    wanted.push(entry);
  }

  const existing = new Set((await api.userScripts.getScripts()).map((e) => e.id));
  const gone = [...existing].filter((id) => !wanted.some((w) => w.id === id));
  if (gone.length) await api.userScripts.unregister({ ids: gone });
  const failed = [];
  for (const entry of wanted) {
    try {
      if (existing.has(entry.id)) await api.userScripts.update([entry]);
      else await api.userScripts.register([entry]);
    } catch (e) {
      // An update can fail when the world changed; replace the registration instead.
      try {
        await api.userScripts.unregister({ ids: [entry.id] }).catch(() => {});
        await api.userScripts.register([entry]);
      } catch (e2) {
        failed.push({ id: entry.id, error: String(e2.message || e.message || e2) });
      }
    }
  }
  return { available: true, registered: wanted.length - failed.length, failed };
}

/** Runs a script once in a tab (context-menu scripts, "run now", MCP run_script_on_tab). */
export async function runInTab(script, tabId, frameId) {
  if (!userScriptsAvailable() || typeof api.userScripts.execute !== 'function') {
    throw new Error('This browser cannot run a script on demand.');
  }
  const settings = await getSettings();
  const world = worldOf(script);
  const injection = {
    target: frameId ? { tabId, frameIds: [frameId] } : { tabId },
    world,
    js: [{ code: buildCode(script, settings, { skipRules: true }) }]
  };
  if (world === 'USER_SCRIPT') {
    await configureWorld();
    if (await configureWorld(worldIdOf(script))) injection.worldId = worldIdOf(script);
  }
  const res = await api.userScripts.execute(injection);
  const err = res.find((r) => r.error);
  if (err) throw new Error(err.error);
  return { frames: res.length };
}
