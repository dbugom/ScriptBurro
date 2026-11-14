#!/usr/bin/env node
import http from 'node:http';
import { createRequire } from 'node:module';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Bridge } from './bridge.js';
import { createServer } from './server.js';
import { loadToken, sameToken, tokenFile } from './token.js';

const { version } = createRequire(import.meta.url)('../package.json');
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};

if (flag('--help') || flag('-h')) {
  process.stdout.write(`tamperdonkey-mcp ${version}

Lets MCP clients manage TamperDonkey userscripts in your browser.

Usage:
  tamperdonkey-mcp                 MCP over stdio (what most MCP clients start)
  tamperdonkey-mcp --http [port]   MCP over HTTP at http://127.0.0.1:<port>/mcp (default 8766)
  tamperdonkey-mcp --token         Print the pairing token and exit

Options:
  --port <n>   Port the browser extension connects to (default 8765)

Pairing: open TamperDonkey > Integrations in the browser, turn on
"Connect to the companion" and paste the pairing token.
`);
  process.exit(0);
}

const token = loadToken();
if (flag('--token')) {
  process.stdout.write(`${token}\n`);
  process.exit(0);
}

// stdout carries the MCP protocol in stdio mode, so all notes go to stderr.
const log = (m) => process.stderr.write(`[tamperdonkey-mcp] ${m}\n`);
const bridge = new Bridge({ port: Number(value('--port', process.env.TAMPERDONKEY_PORT || 8765)), token, log });
await bridge.start();
log(`pairing token: ${token}`);
log(`(stored in ${process.env.TAMPERDONKEY_TOKEN ? 'TAMPERDONKEY_TOKEN' : tokenFile()})`);

if (flag('--http')) {
  const port = Number(value('--http', 8766));
  const httpServer = http.createServer(async (req, res) => {
    if (new URL(req.url, 'http://x').pathname !== '/mcp') return res.writeHead(404).end();
    // Browsers always send Origin; refusing it keeps web pages from using this endpoint.
    if (req.headers.origin) return res.writeHead(403).end('Requests from web pages are not accepted.');
    const auth = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (!auth || !sameToken(auth[1], token)) return res.writeHead(401, { 'www-authenticate': 'Bearer' }).end('Send the pairing token as a Bearer token.');
    if (req.method !== 'POST') return res.writeHead(405, { allow: 'POST' }).end();
    const server = createServer(bridge, { version });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (e) {
      log(`http error: ${e.message}`);
      if (!res.headersSent) res.writeHead(500).end();
    }
  });
  httpServer.listen(port, '127.0.0.1', () => log(`MCP over HTTP at http://127.0.0.1:${port}/mcp (Authorization: Bearer <pairing token>)`));
} else {
  const server = createServer(bridge, { version });
  await server.connect(new StdioServerTransport());
  process.stdin.on('close', async () => {
    await bridge.stop();
    process.exit(0);
  });
}
