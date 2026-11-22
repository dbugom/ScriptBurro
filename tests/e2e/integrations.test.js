import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { launch, serve, PAGE, mark, freePort, until } from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, '../../packages/mcp/src/cli.js');
const OTHER = path.join(here, 'fixtures/other-extension');
const TOKEN = 'e2e'.padEnd(64, '0');

const SCRIPT = `// ==UserScript==
// @name From MCP
// @namespace e2e
// @version 1.0
// @match http://127.0.0.1/*
// @grant none
// ==/UserScript==
document.documentElement.dataset.mcp = 'ran';
`;

let b;
let web;
let mcp;
let port;

const tool = async (name, args = {}) => {
  const r = await mcp.callTool({ name, arguments: args });
  return { error: !!r.isError, text: r.content[0].text, json: r.isError ? null : JSON.parse(r.content[0].text) };
};

/** Starts a tool call that needs confirmation and returns the review page it opens. */
async function withReview(name, args) {
  const opened = b.context.waitForEvent('page', (p) => p.url().includes('review.html?pending='));
  const result = tool(name, args);
  const page = await opened;
  await page.getByRole('heading', { name: 'An outside tool wants to make a change' }).waitFor();
  return { page, result };
}

before(async () => {
  web = await serve({ '/': PAGE });
  port = await freePort();
  b = await launch({ extraExtensions: [OTHER] });
  mcp = new Client({ name: 'e2e-client', version: '1' });
  await mcp.connect(new StdioClientTransport({
    command: process.execPath,
    args: [CLI, '--port', String(port)],
    env: { ...process.env, SCRIPTBURRO_TOKEN: TOKEN },
    stderr: 'ignore'
  }));
});

after(async () => {
  await mcp?.close();
  await b?.context.close();
  await web?.close();
});

test('tools report that the extension is not connected before pairing', async () => {
  const r = await tool('list_scripts');
  assert.equal(r.error, true);
  assert.match(r.text, /not connected/);
});

test('a wrong pairing token is refused', async () => {
  await b.call('settings.set', { patch: { bridge: { enabled: true, url: `ws://127.0.0.1:${port}`, token: 'wrong' } } });
  const s = await until(async () => { const x = await b.call('status'); return x.bridge.error ? x : null; });
  assert.equal(s.bridge.connected, false);
  assert.match(s.bridge.error, /token/i);
});

test('pairing with the right token connects, and read tools work', async () => {
  await b.call('settings.set', { patch: { bridge: { token: TOKEN } } });
  await until(async () => (await b.call('status')).bridge.connected);
  const status = await tool('status');
  assert.equal(status.json.userScripts, true);
  assert.equal(status.json.bridge.connected, true);
  assert.deepEqual((await tool('list_scripts')).json, []);
  assert.ok(Array.isArray((await tool('list_tabs')).json));
});

test('changes are refused while "allow changes" is off', async () => {
  const r = await tool('install_script', { source: SCRIPT });
  assert.equal(r.error, true);
  assert.match(r.text, /turned off/);
  assert.deepEqual(await b.call('scripts.list'), []);
});

test('an install waits for the user; nothing is installed until they allow it', async () => {
  await b.call('settings.set', { patch: { external: { allowWrites: true } } });
  const { page, result } = await withReview('install_script', { source: SCRIPT });
  assert.ok(await page.getByText('MCP (e2e-client)').isVisible());
  assert.ok(await page.getByText("document.documentElement.dataset.mcp = 'ran';").isVisible());
  // Still waiting: the script is not there yet.
  assert.deepEqual(await b.call('scripts.list'), []);
  await page.getByRole('button', { name: 'Allow' }).click();
  const r = await result;
  assert.equal(r.error, false, r.text);
  assert.equal(r.json.name, 'From MCP');
  await page.close();

  const p = await b.context.newPage();
  await b.call('settings.set', { patch: { allowHttp: true } });
  await p.goto(`${web.origin}/`);
  assert.equal(await mark(p, 'mcp'), 'ran');
  await p.close();
});

test('refusing a request leaves everything unchanged and tells the client', async () => {
  const [s] = (await tool('list_scripts')).json;
  const { page, result } = await withReview('delete_script', { id: s.id });
  await page.getByRole('button', { name: 'Refuse' }).click();
  const r = await result;
  assert.equal(r.error, true);
  assert.match(r.text, /refused/);
  assert.equal((await b.call('scripts.list')).length, 1);
  await page.close();
});

test('with confirmation off a trusted setup can change things directly, and it is logged', async () => {
  await b.call('settings.set', { patch: { external: { confirm: false } } });
  const [s] = (await tool('list_scripts')).json;
  assert.equal((await tool('set_enabled', { id: s.id, enabled: false })).json.enabled, false);
  assert.deepEqual((await tool('set_value', { id: s.id, key: 'k', value: { n: 1 } })).json, { k: { n: 1 } });
  assert.deepEqual((await tool('get_values', { id: s.id })).json, { k: { n: 1 } });
  assert.match((await tool('get_script', { id: s.id })).json.source, /From MCP/);
  const log = await b.call('log.list');
  assert.ok(log.some((l) => l.by === 'MCP (e2e-client)' && l.action === 'installed'));
  assert.ok(log.some((l) => /was refused/.test(l.action)));
  await b.call('settings.set', { patch: { external: { confirm: true } } });
});

test('another extension is ignored until its id is on the allow list', async () => {
  const p = await b.context.newPage();
  // Find the helper extension's id from chrome://extensions.
  await p.goto('chrome://extensions');
  const otherId = await p.evaluate(async () => (await chrome.developerPrivate.getExtensionsInfo()).find((e) => e.name === 'ScriptBurro test caller').id);
  await p.goto(`chrome-extension://${otherId}/page.html`);
  const send = (cmd, args) => p.evaluate(([id, c, a]) => chrome.runtime.sendMessage(id, { cmd: c, args: a }), [b.id, cmd, args]);

  const denied = await send('scripts.list');
  assert.equal(denied.ok, false);
  assert.match(denied.error, /allow list/);

  await b.call('settings.set', { patch: { external: { extensions: [otherId] } } });
  const ok = await send('scripts.list');
  assert.equal(ok.ok, true);
  assert.equal(ok.result[0].name, 'From MCP');
  // Commands outside the published set stay unavailable even to listed extensions.
  const internal = await send('settings.get');
  assert.equal(internal.ok, false);
  await p.close();
});
