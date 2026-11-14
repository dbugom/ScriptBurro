import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMatchPattern, matchPatternToRegExp, includeToRegExp, scriptMatchesUrl, toRegistration
} from '../src/index.js';

const m = (p, url) => matchPatternToRegExp(p).test(url);

test('match pattern validation', () => {
  assert.ok(parseMatchPattern('https://*.example.com/*'));
  assert.ok(parseMatchPattern('*://*/*'));
  assert.ok(parseMatchPattern('file:///tmp/*'));
  assert.ok(parseMatchPattern('<all_urls>'));
  assert.equal(parseMatchPattern('https://exa*mple.com/*'), null);
  assert.equal(parseMatchPattern('https://example.com'), null);
  assert.equal(parseMatchPattern('foo://example.com/*'), null);
  assert.equal(parseMatchPattern('*'), null);
});

test('match pattern semantics', () => {
  assert.ok(m('https://*.example.com/*', 'https://example.com/'));
  assert.ok(m('https://*.example.com/*', 'https://a.b.example.com/x?y#z'));
  assert.ok(!m('https://*.example.com/*', 'https://evil.com/#.example.com/'));
  assert.ok(!m('https://*.example.com/*', 'https://notexample.com/'));
  assert.ok(!m('https://*.example.com/*', 'http://example.com/'));
  assert.ok(m('*://example.com/*', 'http://example.com/a'));
  assert.ok(!m('*://example.com/*', 'ftp://example.com/a'));
  assert.ok(m('https://example.com/foo*', 'https://example.com/foobar'));
  assert.ok(!m('https://example.com/foo', 'https://example.com/foobar'));
  assert.ok(m('https://example.com/*', 'https://example.com:8443/a'));
  assert.ok(m('file:///tmp/*', 'file:///tmp/a.html'));
  assert.ok(m('<all_urls>', 'https://x.y/'));
  assert.ok(!m('<all_urls>', 'chrome-extension://abc/x.html'));
});

test('@include globs, regex literals and .tld', () => {
  assert.ok(includeToRegExp('http*://example.com/*').test('https://example.com/a'));
  assert.ok(includeToRegExp('*').test('https://anything.example/'));
  assert.ok(!includeToRegExp('*').test('file:///etc/passwd'));
  assert.ok(includeToRegExp('/^https:\\/\\/a\\.com\\/\\d+$/').test('https://a.com/42'));
  assert.ok(!includeToRegExp('/^https:\\/\\/a\\.com\\/\\d+$/').test('https://a.com/x'));
  assert.equal(includeToRegExp('/(/'), null);
  const tld = includeToRegExp('https://www.google.tld/*');
  assert.ok(tld.test('https://www.google.de/search'));
  assert.ok(tld.test('https://www.google.co.uk/search'));
  assert.ok(!tld.test('https://www.google.evil.example.com/search'));
  assert.ok(!includeToRegExp('https://a.com/x.y').test('https://a.com/xzy'));
});

test('include / exclude combination', () => {
  const meta = { matches: ['https://example.com/*'], includes: [], excludes: ['*/private/*'], excludeMatches: [] };
  assert.ok(scriptMatchesUrl(meta, 'https://example.com/a'));
  assert.ok(!scriptMatchesUrl(meta, 'https://example.com/private/a'));
  assert.ok(!scriptMatchesUrl(meta, 'https://other.com/a'));
  assert.ok(!scriptMatchesUrl({ matches: [], includes: [], excludes: [] }, 'https://example.com/'));
  assert.ok(scriptMatchesUrl({ matches: [], includes: [] }, 'https://b.com/', { includes: ['https://b.com/*'] }));
});

test('registration: exact for pure @match, broad otherwise', () => {
  assert.deepEqual(toRegistration({ matches: ['https://a.com/*'], includes: [], excludeMatches: ['https://a.com/x/*'] }), {
    matches: ['https://a.com/*'], excludeMatches: ['https://a.com/x/*'], exact: true
  });
  const broad = toRegistration({ matches: [], includes: ['http*://a.com/*'] });
  assert.equal(broad.exact, false);
  assert.deepEqual(broad.matches, ['*://*/*']);
  assert.equal(toRegistration({ matches: ['bad pattern'], includes: [] }).exact, false);
  assert.ok(toRegistration({ matches: [], includes: ['file:///tmp/*'] }).matches.includes('file:///*'));
  assert.equal(toRegistration({ matches: [], includes: [] }), null);
});
