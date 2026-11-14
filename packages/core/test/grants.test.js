import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveGrants, grantToApi, checkConnect } from '../src/index.js';

test('grant names', () => {
  assert.equal(grantToApi('GM_getValue'), 'getValue');
  assert.equal(grantToApi('GM.xmlHttpRequest'), 'xmlhttpRequest');
  assert.equal(grantToApi('GM_xmlhttpRequest'), 'xmlhttpRequest');
  assert.equal(grantToApi('GM_nope'), null);
});

test('no grant or "none" means page world without APIs', () => {
  assert.equal(resolveGrants({ grants: [] }).sandbox, false);
  assert.equal(resolveGrants({ grants: ['none'] }).sandbox, false);
  const r = resolveGrants({ grants: ['GM_setValue', 'unsafeWindow', 'GM_bogus'] });
  assert.equal(r.sandbox, true);
  assert.deepEqual(r.apis, ['setValue']);
  assert.equal(r.unsafeWindow, true);
  assert.deepEqual(r.unknown, ['GM_bogus']);
});

test('@connect enforcement', () => {
  const meta = { connects: ['api.example.com', 'self'] };
  assert.equal(checkConnect(meta, 'https://api.example.com/x').allowed, true);
  assert.equal(checkConnect(meta, 'https://v2.api.example.com/x').allowed, true);
  assert.equal(checkConnect(meta, 'https://evilapi.example.com.attacker.net/x').allowed, false);
  assert.equal(checkConnect(meta, 'https://example.com/x').allowed, false);
  assert.equal(checkConnect(meta, '/rel', { pageUrl: 'https://page.test/a' }).allowed, true);
  assert.equal(checkConnect(meta, 'https://other.test/', { pageUrl: 'https://page.test/a' }).allowed, false);
  assert.equal(checkConnect({ connects: ['*'] }, 'https://anything.test/').allowed, true);
  assert.equal(checkConnect({ connects: [] }, 'https://anything.test/').allowed, false);
});

test('plain http is refused unless allowed or local', () => {
  assert.equal(checkConnect({ connects: ['*'] }, 'http://a.test/').allowed, false);
  assert.equal(checkConnect({ connects: ['*'] }, 'http://a.test/', { allowHttp: true }).allowed, true);
  assert.equal(checkConnect({ connects: ['localhost'] }, 'http://127.0.0.1:8080/').allowed, true);
  assert.equal(checkConnect({ connects: ['*'] }, 'file:///etc/passwd').allowed, false);
});
