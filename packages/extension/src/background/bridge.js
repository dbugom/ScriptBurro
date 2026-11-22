/* global __TD_VERSION__ */
import { api, isFirefox } from '../shared/browser.js';
import { getSettings } from './store.js';
import { handleExternal } from './external.js';

/**
 * Connection to the local scriptburro-mcp companion. An extension cannot listen on a
 * port, so it dials out to the companion's WebSocket on this machine and presents the
 * pairing token the user copied from it.
 */
let ws = null;
let state = { connected: false, error: '', url: '' };
let ping = null;

export function bridgeStatus() {
  return { ...state };
}

function close() {
  if (ping) clearInterval(ping);
  ping = null;
  if (ws) {
    ws.onclose = null;
    try { ws.close(); } catch { /* already closed */ }
  }
  ws = null;
  state.connected = false;
}

export async function connectBridge() {
  const { bridge } = await getSettings();
  if (!bridge.enabled) {
    close();
    state = { connected: false, error: '', url: '' };
    return;
  }
  if (ws && ws.readyState <= 1) return;
  let url;
  try {
    url = new URL(bridge.url);
    if (!/^wss?:$/.test(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
      throw new Error('The bridge address must be a ws:// address on this computer.');
    }
  } catch (e) {
    state = { connected: false, error: String(e.message || e), url: bridge.url };
    return;
  }
  state = { connected: false, error: '', url: url.href };
  try {
    ws = new WebSocket(url.href);
  } catch (e) {
    state.error = String(e.message || e);
    return;
  }
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'hello', token: bridge.token, browser: isFirefox ? 'firefox' : 'chrome', version: __TD_VERSION__, extensionId: api.runtime.id }));
    // Regular traffic also keeps a Chrome service worker from being suspended.
    ping = setInterval(() => ws?.readyState === 1 && ws.send(JSON.stringify({ type: 'ping' })), 20000);
  };
  ws.onmessage = async (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'ready') {
      state.connected = true;
      state.error = '';
    } else if (msg.type === 'denied') {
      state.error = msg.reason || 'The companion refused the pairing token.';
    } else if (msg.type === 'call') {
      let reply;
      try {
        reply = { type: 'result', id: msg.id, ok: true, result: await handleExternal({ name: `MCP (${msg.client || 'client'})` }, msg.cmd, msg.args) };
      } catch (e) {
        reply = { type: 'result', id: msg.id, ok: false, error: String(e.message || e) };
      }
      if (ws?.readyState === 1) ws.send(JSON.stringify(reply));
    }
  };
  ws.onerror = () => {
    if (!state.connected && !state.error) state.error = 'Could not reach the companion. Is scriptburro-mcp running?';
  };
  ws.onclose = () => {
    const err = state.error;
    close();
    state.error = err || 'Disconnected.';
  };
}

export function restartBridge() {
  close();
  connectBridge();
}
