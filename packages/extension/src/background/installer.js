import { parseUserscript, scriptIdentity, resolveGrants, compareVersions } from '@scriptburro/core';
import { allScripts, getScript, putScript, getSettings, newId, newToken, addLog } from './store.js';

const MAX_BYTES = 10 * 1024 * 1024;

function checkUrl(url, settings) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol === 'https:' || (u.protocol === 'http:' && (settings.allowHttp || local))) return u;
  throw new Error(`Refused to load ${u.protocol}//${u.host}: only https is allowed (see Settings).`);
}

async function fetchBytes(url, settings) {
  const u = checkUrl(url, settings);
  const sri = /^(sha256|sha384|sha512)[=-](.+)$/i.exec(decodeURIComponent(u.hash.slice(1)).split(/[,;]/)[0] || '');
  u.hash = '';
  const res = await fetch(u.href, { credentials: 'omit', cache: 'no-store' });
  if (!res.ok) throw new Error(`${u.href} answered ${res.status}`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) throw new Error(`${u.href} is larger than 10 MB`);
  if (sri) await verifyIntegrity(buf, sri[1].toLowerCase(), sri[2], u.href);
  return { buf, mime: (res.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim() };
}

async function verifyIntegrity(buf, algo, expected, url) {
  const digest = new Uint8Array(await crypto.subtle.digest({ sha256: 'SHA-256', sha384: 'SHA-384', sha512: 'SHA-512' }[algo], buf));
  const hex = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
  const b64 = btoa(String.fromCharCode(...digest));
  const want = expected.trim();
  if (want.toLowerCase() !== hex && want.replace(/=+$/, '') !== b64.replace(/=+$/, '')) {
    throw new Error(`Integrity check failed for ${url} (${algo}).`);
  }
}

export async function fetchText(url) {
  const { buf } = await fetchBytes(url, await getSettings());
  return new TextDecoder().decode(buf);
}

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

/** Parses a source and downloads its @require and @resource files. */
export async function prepare(source, previous) {
  const parsed = parseUserscript(source);
  if (!parsed.ok) throw new Error(parsed.errors.join(' '));
  const { meta } = parsed;
  const warnings = [...parsed.warnings];
  const settings = await getSettings();
  const g = resolveGrants(meta);
  for (const u of g.unknown) warnings.push(`Unknown @grant "${u}" is ignored.`);
  if (meta.matches.length === 0 && meta.includes.length === 0) warnings.push('The script has no @match or @include, so it will not run on any page.');

  const requires = {};
  for (const url of meta.requires) {
    if (previous?.requires?.[url] !== undefined) requires[url] = previous.requires[url];
    else requires[url] = new TextDecoder().decode((await fetchBytes(url, settings)).buf);
  }
  const resources = {};
  for (const r of meta.resources) {
    const old = previous?.resources?.[r.name];
    if (old && old.url === r.url) {
      resources[r.name] = old;
      continue;
    }
    const { buf, mime } = await fetchBytes(r.url, settings);
    const textual = /^text\/|json|xml|javascript|svg/.test(mime);
    resources[r.name] = { url: r.url, text: textual ? new TextDecoder().decode(buf) : '', dataUrl: `data:${mime};base64,${toBase64(buf)}` };
  }
  return { meta, warnings, requires, resources };
}

export async function findExisting(meta) {
  const identity = scriptIdentity(meta);
  return (await allScripts()).find((s) => scriptIdentity(s.meta) === identity) || null;
}

/**
 * Installs a new script or replaces an existing one. A script is replaced when `id` is
 * given (saving from the editor) or when a script with the same @namespace and @name exists.
 */
export async function install({ source, url = '', id = null, enabled, by = 'user' }) {
  source = String(source).replace(/\r\n?/g, '\n');
  const parsed = parseUserscript(source);
  if (!parsed.ok) throw new Error(parsed.errors.join(' '));
  const previous = id ? await getScript(id) : await findExisting(parsed.meta);
  if (id && !previous) throw new Error(`No script with id ${id}.`);
  const { meta, warnings, requires, resources } = await prepare(source, previous);
  const now = Date.now();
  const script = {
    id: previous?.id || newId(),
    token: previous?.token || newToken(),
    badgeKey: previous?.badgeKey || newToken().slice(0, 24),
    source,
    meta,
    requires,
    resources,
    enabled: enabled ?? previous?.enabled ?? true,
    installedAt: previous?.installedAt || now,
    updatedAt: now,
    origin: url || previous?.origin || '',
    overrides: previous?.overrides || { includes: [], matches: [], excludes: [] },
    tags: previous?.tags || [],
    connectApproved: previous?.connectApproved || [],
    autoUpdate: previous?.autoUpdate ?? true,
    trashedAt: null,
    pendingUpdate: null
  };
  await putScript(script);
  if (by !== 'user') await addLog({ by, action: previous ? 'updated' : 'installed', script: meta.name, version: meta.version });
  return { script, replaced: !!previous, warnings };
}

/** Looks for a newer version. Returns null when there is none. */
export async function findUpdate(script) {
  const downloadURL = script.meta.downloadURL || script.origin;
  const metaURL = script.meta.updateURL || downloadURL;
  if (!metaURL) return null;
  const head = parseUserscript(await fetchText(metaURL));
  if (!head.meta.version || compareVersions(head.meta.version, script.meta.version) <= 0) return null;
  const source = metaURL === downloadURL ? await fetchText(metaURL) : await fetchText(downloadURL || metaURL);
  const full = parseUserscript(source);
  if (!full.ok || compareVersions(full.meta.version, script.meta.version) <= 0) return null;
  return { version: full.meta.version, source: source.replace(/\r\n?/g, '\n'), url: downloadURL || metaURL, foundAt: Date.now() };
}
