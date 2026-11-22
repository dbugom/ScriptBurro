import { api } from '../shared/browser.js';
import { getSettings, addLog, sessionGet, sessionSet, getScript } from './store.js';

/**
 * Requests from outside the extension: the MCP bridge and other extensions.
 *
 * These callers can put code on every page the user visits, so:
 *  - reading needs a paired bridge or an allow-listed extension id;
 *  - changing anything needs the "allow changes" setting as well;
 *  - while "confirm" is on, each change waits for the user to accept it on a review page.
 */
export const READ = ['status', 'scripts.list', 'scripts.get', 'tabs.list', 'values.get'];
export const WRITE = ['scripts.install', 'scripts.patch', 'scripts.trash', 'scripts.run', 'values.set'];

const waiters = new Map();
let run = null;
export function setRunner(fn) {
  run = fn;
}

export async function handleExternal(client, cmd, args) {
  const settings = await getSettings();
  if (READ.includes(cmd)) return run(cmd, args, { by: client.name });
  if (!WRITE.includes(cmd)) throw new Error(`"${cmd}" is not available to outside clients.`);
  if (!settings.external.allowWrites) {
    throw new Error('Changes from outside clients are turned off. Enable "Allow changes" in ScriptBurro settings > Integrations.');
  }
  if (!settings.external.confirm) return run(cmd, args, { by: client.name });

  const id = crypto.randomUUID();
  const pending = await sessionGet('pending', {});
  pending[id] = { id, client: client.name, cmd, args, createdAt: Date.now(), summary: await describe(cmd, args) };
  await sessionSet('pending', pending);
  await api.tabs.create({ url: api.runtime.getURL(`review.html?pending=${id}`) });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiters.delete(id);
      resolvePending(id, false).catch(() => {});
      reject(new Error('The user did not answer the confirmation within 5 minutes.'));
    }, 5 * 60 * 1000);
    waiters.set(id, { resolve, reject, timer });
  });
}

async function describe(cmd, args) {
  const name = args?.id ? (await getScript(args.id))?.meta.name || args.id : '';
  switch (cmd) {
    case 'scripts.install': return args.id ? `Replace the source of "${name}"` : 'Install a userscript';
    case 'scripts.patch': return `Change settings of "${name}"${typeof args.enabled === 'boolean' ? (args.enabled ? ' (enable)' : ' (disable)') : ''}`;
    case 'scripts.trash': return `Move "${name}" to the trash`;
    case 'scripts.run': return `Run "${name}" on tab ${args.tabId}`;
    case 'values.set': return `Set stored value "${args.key}" of "${name}"`;
    default: return cmd;
  }
}

export async function listPending() {
  return Object.values(await sessionGet('pending', {}));
}

export async function resolvePending(id, accept) {
  const pending = await sessionGet('pending', {});
  const p = pending[id];
  if (!p) throw new Error('This request was already answered or has expired.');
  delete pending[id];
  await sessionSet('pending', pending);
  const w = waiters.get(id);
  if (w) {
    clearTimeout(w.timer);
    waiters.delete(id);
  }
  if (!accept) {
    await addLog({ by: p.client, action: `was refused: ${p.summary}`, script: '' });
    w?.reject(new Error('The user refused the request.'));
    return { accepted: false };
  }
  try {
    const result = await run(p.cmd, p.args, { by: p.client });
    w?.resolve(result);
    return { accepted: true, result };
  } catch (e) {
    w?.reject(e);
    throw e;
  }
}
