import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUserscript, getHeader, compareVersions, scriptIdentity } from '../src/index.js';

const SAMPLE = `// ==UserScript==
// @name         Hello "World" script
// @namespace    https://example.com/ns
// @version      1.2.3
// @description  Says it's working
// @match        https://*.example.com/*
// @include      http://localhost:*/*
// @exclude      *://example.com/private/*
// @exclude-match https://example.com/admin/*
// @require      https://cdn.example.com/lib.js
// @resource     css https://cdn.example.com/a.css
// @grant        GM_getValue
// @grant        GM.xmlHttpRequest
// @connect      api.example.com
// @run-at       document-start
// @noframes
// @updateURL    https://example.com/s.meta.js
// @homepageURL  https://example.com/home
// @antifeature  ads
// ==/UserScript==
console.log('hi');
`;

test('parses a full header', () => {
  const { ok, meta, errors } = parseUserscript(SAMPLE);
  assert.equal(ok, true, errors.join());
  assert.equal(meta.name, 'Hello "World" script');
  assert.equal(meta.description, "Says it's working");
  assert.equal(meta.version, '1.2.3');
  assert.deepEqual(meta.matches, ['https://*.example.com/*']);
  assert.deepEqual(meta.includes, ['http://localhost:*/*']);
  assert.deepEqual(meta.excludes, ['*://example.com/private/*']);
  assert.deepEqual(meta.excludeMatches, ['https://example.com/admin/*']);
  assert.deepEqual(meta.requires, ['https://cdn.example.com/lib.js']);
  assert.deepEqual(meta.resources, [{ name: 'css', url: 'https://cdn.example.com/a.css' }]);
  assert.deepEqual(meta.grants, ['GM_getValue', 'GM.xmlHttpRequest']);
  assert.deepEqual(meta.connects, ['api.example.com']);
  assert.equal(meta.runAt, 'document-start');
  assert.equal(meta.noframes, true);
  assert.equal(meta.updateURL, 'https://example.com/s.meta.js');
  assert.equal(meta.homepage, 'https://example.com/home');
  assert.deepEqual(meta.antifeatures, ['ads']);
});

test('defaults', () => {
  const { meta } = parseUserscript('// ==UserScript==\n// @name A\n// ==/UserScript==');
  assert.equal(meta.version, '0.0');
  assert.equal(meta.runAt, 'document-idle');
  assert.equal(meta.noframes, false);
});

test('handles CRLF and tabs', () => {
  const { ok, meta } = parseUserscript('// ==UserScript==\r\n//\t@name\tTabbed\r\n// @match\thttps://a.b/*\r\n// ==/UserScript==\r\n');
  assert.equal(ok, true);
  assert.equal(meta.name, 'Tabbed');
  assert.deepEqual(meta.matches, ['https://a.b/*']);
});

test('rejects missing header, missing name and HTML pages', () => {
  assert.equal(parseUserscript('alert(1)').ok, false);
  assert.equal(parseUserscript('// ==UserScript==\n// @version 1\n// ==/UserScript==').ok, false);
  assert.equal(getHeader('<html><body>// ==UserScript==\n// @name x\n// ==/UserScript==</body></html>'), null);
});

test('unknown run-at gives a warning', () => {
  const r = parseUserscript('// ==UserScript==\n// @name A\n// @run-at whenever\n// ==/UserScript==');
  assert.equal(r.meta.runAt, 'document-idle');
  assert.equal(r.warnings.length, 1);
});

test('localized names do not replace the name', () => {
  const { meta } = parseUserscript('// ==UserScript==\n// @name:de Hallo\n// @name Hello\n// ==/UserScript==');
  assert.equal(meta.name, 'Hello');
});

test('identity uses namespace and name', () => {
  assert.notEqual(scriptIdentity({ name: 'a', namespace: 'x' }), scriptIdentity({ name: 'a', namespace: 'y' }));
});

test('compareVersions', () => {
  assert.equal(compareVersions('1.10', '1.9'), 1);
  assert.equal(compareVersions('1.0', '1'), 0);
  assert.equal(compareVersions('1.0b', '1.0'), -1);
  assert.equal(compareVersions('2', '10'), -1);
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
  assert.equal(compareVersions('', '0.1'), -1);
});
