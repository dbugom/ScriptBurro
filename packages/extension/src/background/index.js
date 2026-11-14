import { api } from '../shared/browser.js';
import { runCommand, refreshContextMenus, purgeOldTrash } from './commands.js';
import { handleUserScriptMessage, forgetTab, forgetFrame, noteEvent } from './gm.js';
import { syncRegistrations } from './registrar.js';
import { handleExternal, setRunner } from './external.js';
import { connectBridge } from './bridge.js';
import { scheduleUpdates, UPDATE_ALARM, HOUSEKEEPING_ALARM } from './updater.js';
import { getSettings, getScript } from './store.js';
import { runInTab } from './registrar.js';

setRunner(runCommand);

// Messages from the extension's own pages (dashboard, popup, review page).
api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.cmd !== 'string') return false;
  const ownPage = sender.id === api.runtime.id && (sender.url || '').startsWith(api.runtime.getURL(''));
  if (!ownPage) {
    sendResponse({ ok: false, error: 'Not allowed.' });
    return false;
  }
  runCommand(msg.cmd, msg.args, { by: 'user' })
    .then((result) => sendResponse({ ok: true, result }), (e) => sendResponse({ ok: false, error: String(e.message || e) }));
  return true;
});

// Messages from userscripts (the GM API).
const onUserScript = (msg, sender, sendResponse) => {
  handleUserScriptMessage(msg, sender).then(sendResponse);
  return true;
};
api.runtime.onUserScriptMessage?.addListener(onUserScript);

// Other extensions. Only ids the user listed may talk to us.
api.runtime.onMessageExternal?.addListener((msg, sender, sendResponse) => {
  (async () => {
    const { external } = await getSettings();
    if (!sender.id || !external.extensions.includes(sender.id)) throw new Error('This extension is not on the TamperDonkey allow list.');
    if (!msg || typeof msg.cmd !== 'string') throw new Error('Expected { cmd, args }.');
    return handleExternal({ name: `extension ${sender.id}` }, msg.cmd, msg.args);
  })().then((result) => sendResponse({ ok: true, result }), (e) => sendResponse({ ok: false, error: String(e.message || e) }));
  return true;
});

// A navigation to a *.user.js file opens the review page instead of showing the source.
api.webNavigation?.onBeforeNavigate.addListener((d) => {
  if (d.frameId !== 0) return;
  let u;
  try { u = new URL(d.url); } catch { return; }
  if (!/^https?:$/.test(u.protocol) || !/\.user\.js$/i.test(u.pathname)) return;
  api.tabs.update(d.tabId, { url: api.runtime.getURL(`review.html?url=${encodeURIComponent(d.url)}`) });
});

api.webNavigation?.onCommitted.addListener((d) => forgetFrame(d.tabId, d.frameId));
api.tabs.onRemoved.addListener((tabId) => forgetTab(tabId));

api.notifications?.onClicked.addListener((id) => noteEvent(id, 'click'));
api.notifications?.onClosed.addListener((id) => noteEvent(id, 'done'));

api.contextMenus?.onClicked.addListener(async (info, tab) => {
  const id = String(info.menuItemId);
  if (!id.startsWith('run:') || !tab) return;
  const script = await getScript(id.slice(4));
  if (script) runInTab(script, tab.id, info.frameId).catch((e) => console.warn(e));
});

api.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPDATE_ALARM) runCommand('scripts.checkUpdates', {}, { by: 'updater' }).catch(() => {});
  if (alarm.name === HOUSEKEEPING_ALARM) {
    connectBridge();
    purgeOldTrash();
  }
});

// Granting or revoking the user-script permission changes what can be registered.
api.permissions?.onAdded?.addListener(() => syncRegistrations());

async function boot() {
  await syncRegistrations();
  await refreshContextMenus();
  await scheduleUpdates();
  await connectBridge();
}
api.runtime.onInstalled.addListener((d) => {
  boot();
  if (d.reason === 'install') api.tabs.create({ url: api.runtime.getURL('dashboard.html#welcome') });
});
api.runtime.onStartup.addListener(boot);
connectBridge();
