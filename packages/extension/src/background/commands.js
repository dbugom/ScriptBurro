/* global __TD_VERSION__ */
import { api, isFirefox } from '../shared/browser.js';
import { scriptMatchesUrl, resolveGrants, parseUserscript } from '@scriptburro/core';
import {
  allScripts, getScript, putScript, removeScript, getValues, setValues, updateValues, getSettings, setSettings, getLog, addLog
} from './store.js';
import { syncRegistrations, userScriptsAvailable, runInTab } from './registrar.js';
import { install, prepare, findExisting, findUpdate, fetchText } from './installer.js';
import { broadcastValue, clickMenu, menusForTab, badgesForTab } from './gm.js';
import { bridgeStatus, restartBridge } from './bridge.js';
import { listPending, resolvePending } from './external.js';
import { scheduleUpdates } from './updater.js';

export function summary(s) {
  const g = resolveGrants(s.meta);
  return {
    id: s.id,
    name: s.meta.name,
    namespace: s.meta.namespace,
    version: s.meta.version,
    description: s.meta.description,
    author: s.meta.author,
    icon: s.meta.icon,
    homepage: s.meta.homepage,
    enabled: s.enabled,
    trashedAt: s.trashedAt,
    installedAt: s.installedAt,
    updatedAt: s.updatedAt,
    origin: s.origin,
    tags: s.tags,
    runAt: s.meta.runAt,
    matches: s.meta.matches,
    includes: s.meta.includes,
    excludes: [...s.meta.excludes, ...s.meta.excludeMatches],
    grants: s.meta.grants,
    connects: s.meta.connects,
    antifeatures: s.meta.antifeatures,
    world: g.sandbox ? 'sandbox' : 'page',
    autoUpdate: s.autoUpdate,
    overrides: s.overrides,
    pendingUpdate: s.pendingUpdate ? { version: s.pendingUpdate.version, foundAt: s.pendingUpdate.foundAt } : null,
    lastCheck: s.lastCheck || null,
    lastCheckError: s.lastCheckError || ''
  };
}

async function need(id) {
  const s = await getScript(id);
  if (!s) throw new Error(`No script with id ${id}.`);
  return s;
}

async function changed() {
  const r = await syncRegistrations();
  await refreshContextMenus();
  return r;
}

export async function refreshContextMenus() {
  if (!api.contextMenus) return;
  await api.contextMenus.removeAll();
  const scripts = (await allScripts()).filter((s) => s.enabled && !s.trashedAt && s.meta.runAt === 'context-menu');
  for (const s of scripts) {
    api.contextMenus.create({ id: `run:${s.id}`, title: s.meta.name, contexts: ['page', 'selection', 'link', 'image'] });
  }
}

async function blacklistOverrides(s) {
  const { blacklist } = await getSettings();
  return { ...s.overrides, excludes: [...(s.overrides?.excludes || []), ...blacklist] };
}

export const COMMANDS = {
  'status': async () => ({
    version: __TD_VERSION__,
    browser: isFirefox ? 'firefox' : 'chrome',
    userScripts: userScriptsAvailable(),
    bridge: bridgeStatus(),
    scripts: (await allScripts()).filter((s) => !s.trashedAt).length
  }),

  'scripts.list': async ({ trashed = false } = {}) =>
    (await allScripts()).filter((s) => !!s.trashedAt === !!trashed).map(summary)
      .sort((a, b) => a.name.localeCompare(b.name)),

  'scripts.get': async ({ id }) => {
    const s = await need(id);
    return { ...summary(s), source: s.source, requires: Object.keys(s.requires || {}), pendingSource: s.pendingUpdate?.source || null };
  },

  /** Parses a source (or downloads it first) without installing anything. */
  'scripts.preview': async ({ source, url }) => {
    if (!source && url) source = await fetchText(url);
    const parsed = parseUserscript(source);
    if (!parsed.ok) throw new Error(parsed.errors.join(' '));
    const existing = await findExisting(parsed.meta);
    const g = resolveGrants(parsed.meta);
    return {
      source,
      url: url || '',
      meta: parsed.meta,
      warnings: [...parsed.warnings, ...g.unknown.map((u) => `Unknown @grant "${u}" is ignored.`)],
      world: g.sandbox ? 'sandbox' : 'page',
      existing: existing ? { id: existing.id, version: existing.meta.version, source: existing.source, trashed: !!existing.trashedAt } : null
    };
  },

  'scripts.install': async ({ source, url, id, enabled }, ctx) => {
    if (!source && url) source = await fetchText(url);
    const r = await install({ source, url, id, enabled, by: ctx?.by || 'user' });
    await changed();
    return { ...summary(r.script), replaced: r.replaced, warnings: r.warnings };
  },

  'scripts.patch': async ({ id, enabled, tags, overrides, autoUpdate, connectApproved }, ctx) => {
    const s = await need(id);
    if (typeof enabled === 'boolean') s.enabled = enabled;
    if (Array.isArray(tags)) s.tags = [...new Set(tags.map((t) => String(t).trim()).filter(Boolean))];
    if (overrides) s.overrides = { includes: [], matches: [], excludes: [], ...overrides };
    if (typeof autoUpdate === 'boolean') s.autoUpdate = autoUpdate;
    if (Array.isArray(connectApproved)) s.connectApproved = connectApproved.map(String);
    await putScript(s);
    if (ctx?.by && ctx.by !== 'user') await addLog({ by: ctx.by, action: 'changed settings of', script: s.meta.name });
    await changed();
    return summary(s);
  },

  'scripts.trash': async ({ id }, ctx) => {
    const s = await need(id);
    s.trashedAt = Date.now();
    await putScript(s);
    if (ctx?.by && ctx.by !== 'user') await addLog({ by: ctx.by, action: 'moved to trash', script: s.meta.name });
    await changed();
    return summary(s);
  },

  'scripts.restore': async ({ id }) => {
    const s = await need(id);
    s.trashedAt = null;
    await putScript(s);
    await changed();
    return summary(s);
  },

  'scripts.purge': async ({ id }) => {
    const s = await need(id);
    if (!s.trashedAt) throw new Error('Only scripts in the trash can be deleted for good.');
    await removeScript(id);
    return { id };
  },

  'scripts.checkUpdates': async ({ id } = {}) => {
    const list = id ? [await need(id)] : (await allScripts()).filter((s) => !s.trashedAt && s.autoUpdate);
    const { updateMode } = await getSettings();
    const out = [];
    for (const s of list) {
      s.lastCheck = Date.now();
      s.lastCheckError = '';
      try {
        const upd = await findUpdate(s);
        if (upd && updateMode === 'auto') {
          await install({ source: upd.source, id: s.id, by: 'updater' });
          out.push({ id: s.id, name: s.meta.name, version: upd.version, installed: true });
          continue;
        }
        if (upd) {
          s.pendingUpdate = upd;
          out.push({ id: s.id, name: s.meta.name, version: upd.version, installed: false });
        }
      } catch (e) {
        s.lastCheckError = String(e.message || e);
      }
      await putScript(s);
    }
    await changed();
    return out;
  },

  'scripts.applyUpdate': async ({ id, accept }) => {
    const s = await need(id);
    if (!s.pendingUpdate) throw new Error('No update is waiting for this script.');
    if (!accept) {
      s.pendingUpdate = null;
      await putScript(s);
      return summary(s);
    }
    const r = await install({ source: s.pendingUpdate.source, id });
    await changed();
    return summary(r.script);
  },

  'scripts.refetch': async ({ id }) => {
    const s = await need(id);
    const p = await prepare(s.source, null);
    Object.assign(s, { requires: p.requires, resources: p.resources });
    await putScript(s);
    await changed();
    return summary(s);
  },

  'scripts.run': async ({ id, tabId }, ctx) => {
    const s = await need(id);
    if (s.trashedAt || !s.enabled) throw new Error('The script is disabled or in the trash.');
    const r = await runInTab(s, tabId);
    if (ctx?.by && ctx.by !== 'user') await addLog({ by: ctx.by, action: `ran on tab ${tabId}`, script: s.meta.name });
    return r;
  },

  'scripts.forTab': async ({ tabId, url }) => {
    const out = [];
    for (const s of await allScripts()) {
      if (s.trashedAt) continue;
      if (s.meta.runAt === 'context-menu' || scriptMatchesUrl(s.meta, url, await blacklistOverrides(s))) out.push(summary(s));
    }
    return { scripts: out, menu: await menusForTab(tabId), badges: await badgesForTab(tabId), userScripts: userScriptsAvailable() };
  },

  'menu.click': async ({ tabId, id }) => clickMenu(tabId, id),

  'values.get': async ({ id }) => {
    await need(id);
    return getValues(id);
  },

  'values.set': async ({ id, key, value }, ctx) => {
    const s = await need(id);
    const values = await updateValues(id, (v) => { v[String(key)] = value; });
    await broadcastValue(id, { key: String(key), value });
    if (ctx?.by && ctx.by !== 'user') await addLog({ by: ctx.by, action: `set value "${key}" of`, script: s.meta.name });
    return values;
  },

  'values.delete': async ({ id, key }) => {
    await need(id);
    const values = await updateValues(id, (v) => { delete v[String(key)]; });
    await broadcastValue(id, { key: String(key), deleted: true });
    return values;
  },

  'tabs.list': async () =>
    (await api.tabs.query({})).filter((t) => /^https?:|^file:/.test(t.url || ''))
      .map((t) => ({ id: t.id, title: t.title, url: t.url, active: t.active, windowId: t.windowId })),

  'settings.get': async () => getSettings(),

  'settings.set': async ({ patch }) => {
    const s = await setSettings(patch);
    if (patch.bridge) restartBridge();
    if ('updateIntervalHours' in patch) await scheduleUpdates();
    if ('blacklist' in patch) await changed();
    return s;
  },

  'log.list': async () => getLog(),

  'backup.export': async () => {
    const scripts = [];
    for (const s of await allScripts()) {
      if (s.trashedAt) continue;
      scripts.push({
        name: s.meta.name, source: s.source, enabled: s.enabled, origin: s.origin, tags: s.tags,
        overrides: s.overrides, autoUpdate: s.autoUpdate, values: await getValues(s.id)
      });
    }
    return { format: 'scriptburro-backup', version: 1, created: new Date().toISOString(), scripts };
  },

  'backup.import': async ({ scripts }) => {
    const done = [];
    const failed = [];
    for (const item of scripts || []) {
      try {
        const r = await install({ source: item.source, url: item.origin || '', enabled: item.enabled });
        if (item.values && typeof item.values === 'object') await setValues(r.script.id, item.values);
        if (item.tags || item.overrides) {
          Object.assign(r.script, { tags: item.tags || r.script.tags, overrides: item.overrides || r.script.overrides });
          await putScript(r.script);
        }
        done.push(r.script.meta.name);
      } catch (e) {
        failed.push({ name: item.name || '(unnamed)', error: String(e.message || e) });
      }
    }
    await changed();
    return { imported: done, failed };
  },

  'registrations.sync': async () => changed(),
  'pending.list': async () => listPending(),
  'pending.resolve': async ({ id, accept }) => resolvePending(id, accept),
  'bridge.reconnect': async () => {
    restartBridge();
    return bridgeStatus();
  }
};

export async function runCommand(cmd, args, ctx) {
  const fn = COMMANDS[cmd];
  if (!fn) throw new Error(`Unknown command "${cmd}".`);
  return fn(args || {}, ctx);
}

/** Empties the trash of scripts that have been there longer than the configured time. */
export async function purgeOldTrash() {
  const { trashDays } = await getSettings();
  const limit = Date.now() - trashDays * 86400000;
  for (const s of await allScripts()) if (s.trashedAt && s.trashedAt < limit) await removeScript(s.id);
}
