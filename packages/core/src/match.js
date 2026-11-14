/**
 * URL matching for @match, @include and @exclude.
 *
 * The @include handling (glob with "*", "/regex/" literals, the ".tld" shortcut and the
 * rule that "*.example.com" in a @match also covers "example.com") follows
 * Helper.getRegExpFromUrl in Tampermonkey 2.9 (Jan Biniok, GPLv3).
 */

const SCHEMES = ['http', 'https', 'file', 'ftp', 'ws', 'wss'];
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/**
 * Parses a match pattern (https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns).
 * @returns {{scheme: string, host: string, path: string}|null} null when the pattern is invalid
 */
export function parseMatchPattern(pattern) {
  if (pattern === '<all_urls>') return { scheme: '*', host: '*', path: '/*', all: true };
  const m = /^(\*|[a-z][a-z0-9+.-]*):\/\/([^/]*)(\/.*)$/i.exec(pattern);
  if (!m) return null;
  const scheme = m[1].toLowerCase();
  const host = m[2].toLowerCase();
  if (scheme !== '*' && !SCHEMES.includes(scheme)) return null;
  if (scheme === 'file') {
    if (host !== '') return null;
  } else {
    if (host === '') return null;
    // "*" is only allowed alone or as a leading "*." label.
    if (host !== '*' && host.replace(/^\*\./, '').includes('*')) return null;
    if (host.includes(':') && !/^\[.*\](:\d+|:\*)?$/.test(host) && !/:(\d+|\*)$/.test(host)) return null;
  }
  return { scheme, host, path: m[3] };
}

export function matchPatternToRegExp(pattern) {
  const p = parseMatchPattern(pattern);
  if (!p) return null;
  if (p.all) return /^(https?|file|ftp|wss?):\/\/.*/i;
  const scheme = p.scheme === '*' ? 'https?' : escapeRe(p.scheme);
  let host;
  if (p.scheme === 'file') host = '';
  else if (p.host === '*') host = '[^/]+';
  else if (p.host.startsWith('*.')) host = `(?:[^/]+\\.)?${escapeRe(p.host.slice(2))}`;
  else host = escapeRe(p.host);
  // A pattern without a port matches any port, as Chrome does.
  const port = p.scheme === 'file' || /:(\d+|\*)$/.test(p.host) ? '' : '(?::\\d+)?';
  const path = p.path.split('*').map(escapeRe).join('.*');
  return new RegExp(`^${scheme}:\\/\\/${host.replace(/\\:\\\*$/, '(?::\\d+)?')}${port}${path}$`, 'i');
}

// Approximation of the public-suffix list used for the ".tld" shortcut.
const TLD = '\\.(?:[a-z]{2,}|(?:com?|net|org|gov|edu|ac)\\.[a-z]{2})';

/** Converts an @include / @exclude value to a regular expression, or null if it is unusable. */
export function includeToRegExp(value) {
  const v = String(value).trim();
  if (!v) return null;
  const lit = /^\/(.+)\/([a-z]*)$/.exec(v);
  if (lit) {
    try {
      return new RegExp(lit[1], lit[2].replace(/[^imsu]/g, ''));
    } catch {
      return null;
    }
  }
  if (v === '*') return /^https?:\/\/.*/i; // a bare "*" never reaches file: or extension pages
  let re = v.split('*').map(escapeRe).join('.*');
  re = re.replace(/\\\.tld(\\\/|$)/, `${TLD}$1`);
  return new RegExp(`^${re}$`, 'i');
}

/**
 * Compiles the URL rules of a script into regular expression sources that can be shipped
 * to the page and evaluated there.
 */
export function compileRules(meta, overrides = {}) {
  const src = (r) => (r ? { source: r.source, flags: r.flags } : null);
  const includes = [...(meta.includes || []), ...(overrides.includes || [])];
  const matches = [...(meta.matches || []), ...(overrides.matches || [])];
  const excludes = [...(meta.excludes || []), ...(overrides.excludes || [])];
  const excludeMatches = meta.excludeMatches || [];
  return {
    include: [...includes.map(includeToRegExp), ...matches.map(matchPatternToRegExp)].filter(Boolean).map(src),
    exclude: [...excludes.map(includeToRegExp), ...excludeMatches.map(matchPatternToRegExp)].filter(Boolean).map(src)
  };
}

export function rulesMatch(rules, url) {
  const test = (r) => new RegExp(r.source, r.flags).test(url);
  return rules.include.some(test) && !rules.exclude.some(test);
}

/** True when the script should run on the URL. A script with no @match/@include runs nowhere. */
export function scriptMatchesUrl(meta, url, overrides) {
  return rulesMatch(compileRules(meta, overrides), url);
}

/**
 * Chooses what to hand to the browser's userScripts.register(). Only valid match patterns
 * can be registered; anything else (@include globs and regexes) registers on all http(s)
 * pages and relies on the exact check done by the injected code.
 */
export function toRegistration(meta, overrides = {}) {
  const includes = [...(meta.includes || []), ...(overrides.includes || [])];
  const matches = [...(meta.matches || []), ...(overrides.matches || [])];
  const valid = matches.filter((m) => parseMatchPattern(m));
  const exact = includes.length === 0 && valid.length === matches.length && matches.length > 0;
  const excludeMatches = (meta.excludeMatches || []).filter((m) => parseMatchPattern(m));
  if (includes.length === 0 && matches.length === 0) return null;
  return {
    matches: exact ? valid : ['*://*/*', ...(needsFile(includes, matches) ? ['file:///*'] : [])],
    excludeMatches,
    exact
  };
}

function needsFile(includes, matches) {
  return [...includes, ...matches].some((p) => /^file:|^<all_urls>$|^\//.test(p));
}
