import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Bridge } from '../src/bridge.js';
import { createServer } from '../src/server.js';

const TOKEN = 'a'.repeat(64);

/** Stand-in for the browser extension. */
function fakeExtension(port, { token = TOKEN, origin = 'chrome-extension://abcdefghijklmnop', handler } = {}) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin });
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', token, browser: 'chrome', version: 'test' })));
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'ready' || msg.type === 'denied') resolve({ ws, first: msg });
      if (msg.type === 'call') {
        Promise.resolve().then(() => handler(msg)).then(
          (result) => ws.send(JSON.stringify({ type: 'result', id: msg.id, ok: true, result })),
          (e) => ws.send(JSON.stringify({ type: 'result', id: msg.id, ok: false, error: e.message })));
      }
    });
    ws.on('error', () => resolve({ ws, first: { type: 'error' } }));
  });
}

test('rejects a wrong token and a web page origin', async () => {
  const bridge = new Bridge({ port: 0, token: TOKEN });
  await bridge.start();
  const bad = await fakeExtension(bridge.port, { token: 'wrong' });
  assert.equal(bad.first.type, 'denied');
  const page = await fakeExtension(bridge.port, { origin: 'https://evil.example' });
  assert.equal(page.first.type, 'denied');
  assert.equal(bridge.connected(), false);
  await assert.rejects(bridge.call('status'), /not connected/);
  await bridge.stop();
});

test('forwards calls to the extension and returns results and errors', async () => {
  const bridge = new Bridge({ port: 0, token: TOKEN });
  await bridge.start();
  const seen = [];
  const ext = await fakeExtension(bridge.port, {
    handler: (m) => {
      seen.push(m);
      if (m.cmd === 'scripts.trash') throw new Error('The user refused the request.');
      return { echo: m.cmd, args: m.args };
    }
  });
  assert.equal(ext.first.type, 'ready');
  assert.deepEqual(await bridge.call('scripts.list', { trashed: true }, 'tester'), { echo: 'scripts.list', args: { trashed: true } });
  assert.equal(seen[0].client, 'tester');
  await assert.rejects(bridge.call('scripts.trash', { id: 'x' }), /refused/);
  ext.ws.close();
  await bridge.stop();
});

test('a second companion on the same port relays through the first', async () => {
  const host = new Bridge({ port: 0, token: TOKEN });
  assert.equal(await host.start(), 'host');
  const ext = await fakeExtension(host.port, { handler: (m) => ({ via: 'host', cmd: m.cmd }) });
  const peer = new Bridge({ port: host.port, token: TOKEN });
  assert.equal(await peer.start(), 'peer');
  assert.deepEqual(await peer.call('status'), { via: 'host', cmd: 'status' });
  const stranger = new Bridge({ port: host.port, token: 'b'.repeat(64) });
  await assert.rejects(stranger.start(), /refused/);
  ext.ws.close();
  await peer.stop();
  await host.stop();
});

test('MCP tools map to extension commands', async () => {
  const calls = [];
  const bridge = { call: async (cmd, args, client) => { calls.push({ cmd, args, client }); if (cmd === 'scripts.run') throw new Error('nope'); return [{ id: '1', name: 'A' }]; } };
  const server = createServer(bridge);
  const client = new Client({ name: 'unit-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);

  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(tools, ['delete_script', 'get_script', 'get_values', 'install_script', 'list_scripts', 'list_tabs', 'run_script_on_tab', 'set_enabled', 'set_value', 'status', 'update_script']);

  const res = await client.callTool({ name: 'list_scripts', arguments: {} });
  assert.deepEqual(JSON.parse(res.content[0].text), [{ id: '1', name: 'A' }]);
  assert.deepEqual(calls[0], { cmd: 'scripts.list', args: {}, client: 'unit-test' });

  const run = await client.callTool({ name: 'run_script_on_tab', arguments: { id: '1', tab_id: 7 } });
  assert.equal(run.isError, true);
  assert.deepEqual(calls[1].args, { id: '1', tabId: 7 });
  await client.close();
});
