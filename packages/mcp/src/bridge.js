import { WebSocketServer, WebSocket } from 'ws';
import crypto from 'node:crypto';
import { sameToken } from './token.js';

const EXTENSION_ORIGIN = /^(chrome|moz)-extension:\/\/[a-z0-9-]+$/i;
// Long enough for the user to read and answer a confirmation in the browser.
const CALL_TIMEOUT = 6 * 60 * 1000;

/**
 * Local link between MCP clients and the browser extension.
 *
 * The first companion process on a port is the "host": it listens on 127.0.0.1 and the
 * extension connects to it. MCP clients usually start one companion each, so a later
 * process that finds the port taken becomes a "peer" and sends its calls through the host.
 * Both the extension and peers must present the pairing token.
 */
export class Bridge {
  constructor({ port = 8765, token, log = () => {} }) {
    this.port = port;
    this.token = token;
    this.log = log;
    this.mode = 'idle';
    this.extensions = new Set();
    this.pending = new Map();
    this.server = null;
    this.peer = null;
  }

  async start() {
    try {
      await this.#listen();
      this.mode = 'host';
    } catch (e) {
      if (e.code !== 'EADDRINUSE') throw e;
      await this.#joinAsPeer();
      this.mode = 'peer';
    }
    this.log(`bridge: ${this.mode} on 127.0.0.1:${this.port}`);
    return this.mode;
  }

  #listen() {
    return new Promise((resolve, reject) => {
      const server = new WebSocketServer({ host: '127.0.0.1', port: this.port, maxPayload: 32 * 1024 * 1024 });
      server.once('error', reject);
      server.once('listening', () => {
        server.off('error', reject);
        this.server = server;
        this.port = server.address().port;
        server.on('connection', (ws, req) => this.#accept(ws, req));
        resolve();
      });
    });
  }

  #accept(ws, req) {
    const origin = req.headers.origin || '';
    let role = null;
    const timer = setTimeout(() => ws.close(), 5000);
    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (!role) {
        clearTimeout(timer);
        if (!sameToken(msg.token, this.token)) {
          ws.send(JSON.stringify({ type: 'denied', reason: 'Wrong pairing token.' }));
          return ws.close();
        }
        if (msg.type === 'hello' && EXTENSION_ORIGIN.test(origin)) {
          role = 'extension';
          ws.info = { browser: msg.browser, version: msg.version, extensionId: msg.extensionId };
          this.extensions.add(ws);
          ws.send(JSON.stringify({ type: 'ready' }));
          this.log(`bridge: ${msg.browser} extension ${msg.version} connected`);
        } else if (msg.type === 'peer' && !origin) {
          // Peers are local Node processes; a web page always sends an Origin header.
          role = 'peer';
          ws.send(JSON.stringify({ type: 'ready' }));
        } else {
          ws.send(JSON.stringify({ type: 'denied', reason: 'Connection not allowed from this origin.' }));
          ws.close();
        }
        return;
      }
      if (role === 'extension' && msg.type === 'result') {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.ok) p.resolve(msg.result); else p.reject(new Error(msg.error));
      } else if (role === 'peer' && msg.type === 'call') {
        let reply;
        try {
          reply = { type: 'result', id: msg.id, ok: true, result: await this.call(msg.cmd, msg.args, msg.client) };
        } catch (e) {
          reply = { type: 'result', id: msg.id, ok: false, error: e.message };
        }
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(reply));
      }
    });
    ws.on('close', () => {
      clearTimeout(timer);
      this.extensions.delete(ws);
    });
    ws.on('error', () => {});
  }

  #joinAsPeer() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${this.port}`);
      ws.once('error', reject);
      ws.once('open', () => ws.send(JSON.stringify({ type: 'peer', token: this.token })));
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'ready') {
          this.peer = ws;
          resolve();
        } else if (msg.type === 'denied') {
          reject(new Error(`Another program is using port ${this.port} and refused this companion: ${msg.reason}`));
        } else if (msg.type === 'result') {
          const p = this.pending.get(msg.id);
          if (!p) return;
          this.pending.delete(msg.id);
          clearTimeout(p.timer);
          if (msg.ok) p.resolve(msg.result); else p.reject(new Error(msg.error));
        }
      });
      ws.on('close', () => {
        this.peer = null;
        for (const p of this.pending.values()) p.reject(new Error('The companion that owns the bridge port stopped.'));
        this.pending.clear();
      });
    });
  }

  connected() {
    return this.mode === 'peer' ? !!this.peer : this.extensions.size > 0;
  }

  browsers() {
    return [...this.extensions].map((ws) => ws.info);
  }

  /** Sends one command to the extension and waits for its answer. */
  async call(cmd, args = {}, client = 'client') {
    if (this.mode === 'peer' && !this.peer) {
      // The host process went away: take over the port, or join the new host.
      await this.start();
    }
    const target = this.mode === 'peer' ? this.peer : [...this.extensions].at(-1);
    if (!target) {
      throw new Error('The TamperDonkey extension is not connected. In the browser open TamperDonkey > Integrations, turn on "Connect to the companion" and paste the pairing token.');
    }
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('The extension did not answer in time.'));
      }, CALL_TIMEOUT);
      this.pending.set(id, { resolve, reject, timer });
      target.send(JSON.stringify({ type: 'call', id, cmd, args, client }));
    });
  }

  async stop() {
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.pending.clear();
    this.peer?.close();
    for (const ws of this.extensions) ws.terminate();
    if (this.server) await new Promise((r) => this.server.close(r));
    this.server = null;
    this.mode = 'idle';
  }
}
