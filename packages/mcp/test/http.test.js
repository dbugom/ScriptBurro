import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/cli.js');
const TOKEN = 'h'.repeat(64);
const freePort = () => new Promise((ok) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); }); });

let child;
let url;

before(async () => {
  const [bridgePort, httpPort] = [await freePort(), await freePort()];
  url = `http://127.0.0.1:${httpPort}/mcp`;
  child = spawn(process.execPath, [CLI, '--port', String(bridgePort), '--http', String(httpPort)], { env: { ...process.env, TAMPERDONKEY_TOKEN: TOKEN }, stdio: ['ignore', 'ignore', 'pipe'] });
  await new Promise((ok, fail) => {
    child.stderr.on('data', (d) => { if (String(d).includes('MCP over HTTP')) ok(); });
    child.on('exit', (c) => fail(new Error(`companion exited with ${c}`)));
  });
});

after(() => child?.kill());

test('HTTP mode needs the pairing token and refuses web pages', async () => {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  assert.equal((await fetch(url, { method: 'POST', headers, body })).status, 401);
  assert.equal((await fetch(url, { method: 'POST', headers: { ...headers, authorization: 'Bearer wrong' }, body })).status, 401);
  assert.equal((await fetch(url, { method: 'POST', headers: { ...headers, authorization: `Bearer ${TOKEN}`, origin: 'https://evil.example' }, body })).status, 403);
});

test('an MCP client can list and call tools over HTTP', async () => {
  const client = new Client({ name: 'http-test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { authorization: `Bearer ${TOKEN}` } } }));
  assert.equal((await client.listTools()).tools.length, 11);
  // No browser is paired in this test, so the tool reports that clearly.
  const r = await client.callTool({ name: 'status', arguments: {} });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /not connected/);
  await client.close();
});
