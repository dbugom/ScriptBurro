/**
 * Userscript metadata parser.
 *
 * Derived from src/parser.js of Tampermonkey 2.9 (Jan Biniok, GPLv3). It keeps the
 * tag set and the "HTML page is not a script" rule of the original and adds the
 * modern tags (@grant, @connect, @antifeature, ...). Unlike the original it does
 * not strip quote characters from the header.
 */

export const HEADER_START = '==UserScript==';
export const HEADER_STOP = '==/UserScript==';

export const RUN_AT = ['document-start', 'document-body', 'document-end', 'document-idle', 'context-menu'];

const SINGLE = {
  name: 'name',
  namespace: 'namespace',
  version: 'version',
  author: 'author',
  copyright: 'copyright',
  description: 'description',
  license: 'license',
  icon: 'icon',
  iconurl: 'icon',
  defaulticon: 'icon',
  icon64: 'icon64',
  icon64url: 'icon64',
  homepage: 'homepage',
  homepageurl: 'homepage',
  website: 'homepage',
  source: 'homepage',
  supporturl: 'supportURL',
  updateurl: 'updateURL',
  downloadurl: 'downloadURL',
  'inject-into': 'injectInto'
};

const LISTS = {
  include: 'includes',
  match: 'matches',
  exclude: 'excludes',
  'exclude-match': 'excludeMatches',
  require: 'requires',
  grant: 'grants',
  connect: 'connects',
  antifeature: 'antifeatures'
};

export function emptyMeta() {
  return {
    name: '',
    namespace: '',
    version: '',
    author: '',
    copyright: '',
    description: '',
    license: '',
    icon: '',
    icon64: '',
    homepage: '',
    supportURL: '',
    updateURL: '',
    downloadURL: '',
    injectInto: '',
    runAt: 'document-idle',
    noframes: false,
    includes: [],
    matches: [],
    excludes: [],
    excludeMatches: [],
    requires: [],
    resources: [],
    grants: [],
    connects: [],
    antifeatures: []
  };
}

/** Returns the lines between the header markers, or null when there is no header. */
export function getHeader(src) {
  const text = String(src).replace(/\r\n?/g, '\n');
  const start = text.indexOf(HEADER_START);
  if (start === -1) return null;
  const stop = text.indexOf(HEADER_STOP, start);
  if (stop === -1) return null;
  // A page that only mentions a header inside HTML is not a userscript.
  const before = text.slice(0, start).toLowerCase();
  if (before.includes('<html') || before.includes('<body')) return null;
  return text.slice(start + HEADER_START.length, stop);
}

/**
 * @param {string} src full userscript source
 * @returns {{ok: boolean, meta: ReturnType<typeof emptyMeta>, errors: string[], warnings: string[]}}
 */
export function parseUserscript(src) {
  const meta = emptyMeta();
  const errors = [];
  const warnings = [];
  const header = getHeader(src);
  if (header === null) {
    return { ok: false, meta, errors: ['No ==UserScript== header found.'], warnings };
  }

  for (const raw of header.split('\n')) {
    const m = /^\s*\/\/\s*@([\w:-]+)(?:[ \t]+(.*))?$/.exec(raw);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = (m[2] || '').trim();

    if (key === 'noframes') {
      meta.noframes = true;
    } else if (key === 'run-at') {
      if (RUN_AT.includes(value)) meta.runAt = value;
      else warnings.push(`Unknown @run-at value "${value}"; using document-idle.`);
    } else if (key === 'resource') {
      const parts = value.split(/\s+/);
      if (parts.length >= 2) meta.resources.push({ name: parts[0], url: parts[1] });
      else warnings.push(`Ignored malformed @resource "${value}".`);
    } else if (key in LISTS) {
      if (value && !meta[LISTS[key]].includes(value)) meta[LISTS[key]].push(value);
    } else if (key in SINGLE) {
      // First occurrence wins; localized variants such as @name:de use another key.
      if (value && !meta[SINGLE[key]]) meta[SINGLE[key]] = value;
    }
  }

  if (!meta.version) meta.version = '0.0';
  if (!meta.name) errors.push('The script has no @name.');
  return { ok: errors.length === 0, meta, errors, warnings };
}

/** Identity used to decide whether an install replaces an existing script. */
export function scriptIdentity(meta) {
  return `${meta.namespace || ''}\n${meta.name}`;
}

/**
 * Compares dotted version strings ("1.10" > "1.9", "1.0" == "1", "1.0b" < "1.0").
 * @returns {-1|0|1}
 */
export function compareVersions(a, b) {
  const split = (v) => String(v || '0').trim().split('.');
  const pa = split(a);
  const pb = split(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const [, na = '0', sa = ''] = /^(\d*)(.*)$/.exec(pa[i] || '0');
    const [, nb = '0', sb = ''] = /^(\d*)(.*)$/.exec(pb[i] || '0');
    const da = Number(na || 0) - Number(nb || 0);
    if (da !== 0) return da < 0 ? -1 : 1;
    if (sa !== sb) {
      // A suffix marks a pre-release: "1.0b" sorts before "1.0".
      if (!sa) return 1;
      if (!sb) return -1;
      return sa < sb ? -1 : 1;
    }
  }
  return 0;
}
