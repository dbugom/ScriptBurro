import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, serve, PAGE, mark, until } from './helpers.mjs';

let b;
let web;

const header = (name, lines) => `// ==UserScript==\n// @name ${name}\n// @namespace e2e\n// @version 1.0\n${lines.map((l) => `// ${l}`).join('\n')}\n// ==/UserScript==\n`;

before(async () => {
  web = await serve({
    '/': PAGE,
    '/private/x': PAGE,
    '/other': PAGE,
    '/api': (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'x-test': 'yes' });
      res.end(JSON.stringify({ hello: 'world', method: req.method }));
    },
    '/lib.js': 'var libValue = 41;',
    '/hop': (req, res, u) => { res.writeHead(302, { location: `http://localhost:${u.searchParams.get('port')}/api` }); res.end(); },
    '/note.txt': (req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('resource text'); },
    '/opened': PAGE,
    '/misc': PAGE,
    '/badge-page': PAGE,
    '/badge-iso': PAGE,
    '/hello.user.js': `${header('Hello from URL', ['@match http://127.0.0.1/*', '@grant none'])}document.documentElement.dataset.hello = '1';`
  });
  b = await launch();
  await b.call('settings.set', { patch: { allowHttp: true } });
});

after(async () => {
  await b?.context.close();
  await web?.close();
});

test('user scripts are available after the browser switch is on', async () => {
  const s = await b.call('status');
  assert.equal(s.userScripts, true);
});

test('a script runs on matching pages only and honours @exclude', async () => {
  await b.call('scripts.install', {
    source: `${header('Matcher', ['@match http://127.0.0.1/*', '@exclude */private/*', '@grant none', '@run-at document-end'])}document.documentElement.dataset.matcher = location.pathname;`
  });
  const p = await b.context.newPage();
  await p.goto(`${web.origin}/`);
  assert.equal(await mark(p, 'matcher'), '/');
  await p.goto(`${web.origin}/private/x`);
  assert.equal(await mark(p, 'matcher', 800), undefined);
  // "localhost" is a different host from the 127.0.0.1 in @match.
  await p.goto(`http://localhost:${web.port}/`);
  assert.equal(await mark(p, 'matcher', 800), undefined);
  await p.close();
});

test('@grant none runs in the page world; a granted script is isolated from it', async () => {
  await b.call('scripts.install', {
    source: `${header('PageWorld', ['@match http://127.0.0.1/*', '@grant none'])}document.documentElement.dataset.pw = String(window.pageSecret) + '|' + typeof GM_setValue + '|' + GM_info.scriptHandler;`
  });
  await b.call('scripts.install', {
    source: `${header('Sandboxed', ['@match http://127.0.0.1/*', '@grant GM_getValue'])}document.documentElement.dataset.sb = String(window.pageSecret) + '|' + typeof GM_getValue + '|' + typeof GM_setValue + '|' + typeof GM_xmlhttpRequest;`
  });
  const p = await b.context.newPage();
  await p.goto(`${web.origin}/`);
  assert.equal(await mark(p, 'pw'), 'from-page|undefined|ScriptBurro');
  // Only the granted function exists, and the page's variable is not visible.
  assert.equal(await mark(p, 'sb'), 'undefined|function|undefined|undefined');
  await p.close();
});

test('values persist, @require is loaded, and scripts cannot read each other\'s data', async () => {
  const a = await b.call('scripts.install', {
    source: `${header('StoreA', ['@match http://127.0.0.1/*', '@grant GM_getValue', '@grant GM_setValue', '@grant GM_listValues', `@require ${web.origin}/lib.js`])}
const n = GM_getValue('count', 0) + 1;
GM_setValue('count', n);
GM_setValue('secret', { token: 'A-only' });
document.documentElement.dataset.storea = n + '|' + libValue + '|' + GM_listValues().sort().join(',');`
  });
  await b.call('scripts.install', {
    source: `${header('StoreB', ['@match http://127.0.0.1/*', '@grant GM_getValue', '@grant GM_listValues', '@grant GM.getValue'])}
GM.getValue('secret', 'nothing').then((v) => { document.documentElement.dataset.storeb = JSON.stringify(v) + '|' + GM_listValues().length; });`
  });
  const p = await b.context.newPage();
  await p.goto(`${web.origin}/`);
  assert.equal(await mark(p, 'storea'), '1|41|count,secret');
  assert.equal(await mark(p, 'storeb'), '"nothing"|0');
  await p.reload();
  assert.equal(await mark(p, 'storea'), '2|41|count,secret');
  assert.deepEqual(await b.call('values.get', { id: a.id }), { count: 2, secret: { token: 'A-only' } });
  await p.close();
});

test('the background refuses calls without a grant or with an unknown token', async () => {
  await b.call('scripts.install', {
    source: `${header('Forger', ['@match http://127.0.0.1/*', '@grant GM_getValue'])}
(async () => {
  const rt = chrome.runtime;
  const bad = await rt.sendMessage({ td: 'not-a-real-token', m: 'init', a: [] });
  document.documentElement.dataset.forger = JSON.stringify(bad);
})();`
  });
  const p = await b.context.newPage();
  await p.goto(`${web.origin}/`);
  assert.deepEqual(JSON.parse(await mark(p, 'forger')), { ok: false, error: 'Unknown script.' });
  await p.close();
});

test('GM_xmlhttpRequest reaches @connect hosts and nothing else', async () => {
  await b.call('scripts.install', {
    source: `${header('Net', ['@match http://127.0.0.1/*', '@grant GM_xmlhttpRequest', '@grant GM.xmlHttpRequest', '@connect 127.0.0.1'])}
GM_xmlhttpRequest({ url: '/api', method: 'POST', data: 'x=1', responseType: 'json',
  onload: (r) => { document.documentElement.dataset.netok = r.status + '|' + r.response.hello + '|' + r.response.method + '|' + /x-test: yes/i.test(r.responseHeaders); } });
GM_xmlhttpRequest({ url: 'http://localhost:${web.port}/api',
  onload: () => { document.documentElement.dataset.netdenied = 'LOADED'; },
  onerror: (r) => { document.documentElement.dataset.netdenied = r.error; } });
GM.xmlHttpRequest({ url: '/api' }).then((r) => { document.documentElement.dataset.netpromise = r.responseText; });
GM_xmlhttpRequest({ url: '/hop?port=${web.port}',
  onload: (r) => { document.documentElement.dataset.nethop = 'LOADED ' + r.responseText; },
  onerror: (r) => { document.documentElement.dataset.nethop = r.error; } });`
  });
  const p = await b.context.newPage();
  const before = web.hits.length;
  await p.goto(`${web.origin}/`);
  assert.equal(await mark(p, 'netok'), '200|world|POST|true');
  assert.match(await mark(p, 'netdenied'), /not listed in @connect/);
  assert.equal(JSON.parse(await mark(p, 'netpromise')).hello, 'world');
  // An allowed host that redirects elsewhere does not get the other host's answer through.
  assert.match(await mark(p, 'nethop'), /Redirected to a host that is not allowed/);
  // The directly refused request never left the browser. /api was reached by the two
  // allowed calls and by the redirect, whose response was withheld from the script.
  assert.equal(web.hits.slice(before).filter((h) => h.path === '/api').length, 3);
  await p.close();
});

test('value changes reach other open tabs', async () => {
  await b.call('scripts.install', {
    source: `${header('Sync', ['@match http://127.0.0.1/other*', '@grant GM_getValue', '@grant GM_setValue', '@grant GM_addValueChangeListener'])}
GM_addValueChangeListener('ping', (k, o, n, remote) => { document.documentElement.dataset.heard = n + '|' + remote; });
if (location.search === '?send') GM_setValue('ping', 'hi');
document.documentElement.dataset.syncready = '1';`
  });
  const listener = await b.context.newPage();
  await listener.goto(`${web.origin}/other`);
  await mark(listener, 'syncready');
  const sender = await b.context.newPage();
  await sender.goto(`${web.origin}/other?send`);
  assert.equal(await mark(listener, 'heard'), 'hi|true');
  await listener.close();
  await sender.close();
});

test('menu commands show up for the tab and run when clicked', async () => {
  await b.call('scripts.install', {
    source: `${header('Menu', ['@match http://127.0.0.1/other*', '@grant GM_registerMenuCommand'])}
GM_registerMenuCommand('Say hi', () => { document.documentElement.dataset.menu = 'clicked'; });
document.documentElement.dataset.menuready = '1';`
  });
  const p = await b.context.newPage();
  await p.goto(`${web.origin}/other`);
  await mark(p, 'menuready');
  const tab = (await b.call('tabs.list')).find((t) => t.url.endsWith('/other'));
  let menu = [];
  for (let i = 0; i < 20 && !menu.length; i++) {
    menu = (await b.call('scripts.forTab', { tabId: tab.id, url: tab.url })).menu;
    if (!menu.length) await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(menu[0]?.name, 'Say hi');
  await b.call('menu.click', { tabId: tab.id, id: menu[0].id });
  assert.equal(await mark(p, 'menu'), 'clicked');
  await p.close();
});

test('disabling and trashing stop a script; restoring brings it back', async () => {
  const s = await b.call('scripts.install', {
    source: `${header('Toggle', ['@match http://127.0.0.1/*', '@grant none'])}document.documentElement.dataset.toggle = '1';`
  });
  const p = await b.context.newPage();
  await p.goto(`${web.origin}/`);
  assert.equal(await mark(p, 'toggle'), '1');
  await b.call('scripts.patch', { id: s.id, enabled: false });
  await p.reload();
  assert.equal(await mark(p, 'toggle', 800), undefined);
  await b.call('scripts.patch', { id: s.id, enabled: true });
  await b.call('scripts.trash', { id: s.id });
  await p.reload();
  assert.equal(await mark(p, 'toggle', 800), undefined);
  assert.ok((await b.call('scripts.list', { trashed: true })).some((x) => x.id === s.id));
  await b.call('scripts.restore', { id: s.id });
  await p.reload();
  assert.equal(await mark(p, 'toggle'), '1');
  await p.close();
});

test('the blocked-pages setting stops every script on those pages', async () => {
  await b.call('settings.set', { patch: { blacklist: [`${web.origin}/other*`] } });
  const p = await b.context.newPage();
  await p.goto(`${web.origin}/other`);
  assert.equal(await mark(p, 'toggle', 800), undefined);
  await b.call('settings.set', { patch: { blacklist: [] } });
  await p.reload();
  assert.equal(await mark(p, 'toggle'), '1');
  await p.close();
});

test('opening a .user.js link shows the review page, and Install installs it', async () => {
  const p = await b.context.newPage();
  // The extension replaces this navigation with its review page, so goto() itself is aborted.
  await p.goto(`${web.origin}/hello.user.js`).catch(() => {});
  await p.getByRole('heading', { name: 'Install this userscript?' }).waitFor();
  assert.ok(await p.getByText('Hello from URL').first().isVisible());
  await p.getByRole('button', { name: 'Install', exact: true }).click();
  await p.getByRole('heading', { name: 'Script installed' }).waitFor();
  assert.ok((await b.call('scripts.list')).some((s) => s.name === 'Hello from URL'));
  await p.goto(`${web.origin}/`);
  assert.equal(await mark(p, 'hello'), '1');
  await p.close();
});

test('a script can be run on demand in a tab', async () => {
  const s = await b.call('scripts.install', {
    source: `${header('OnDemand', ['@match http://127.0.0.1/never-visited', '@grant none'])}document.documentElement.dataset.ondemand = '1';`
  });
  const p = await b.context.newPage();
  await p.goto(`${web.origin}/other`);
  assert.equal(await mark(p, 'ondemand', 500), undefined);
  const tab = (await b.call('tabs.list')).find((t) => t.url.endsWith('/other'));
  await b.call('scripts.run', { id: s.id, tabId: tab.id });
  assert.equal(await mark(p, 'ondemand'), '1');
  await p.close();
});

test('the remaining GM functions work: styles, resources, tab data, cookies, new tabs, promise API', async () => {
  await b.call('scripts.install', {
    source: `${header('Misc', ['@match http://127.0.0.1/misc*', '@run-at document-body',
      '@grant GM_addStyle', '@grant GM_getResourceText', '@grant GM_getResourceURL', '@grant GM_getTab', '@grant GM_saveTab',
      '@grant GM_cookie', '@grant GM_openInTab', '@grant GM.setValue', '@grant GM.getValue', '@grant GM.listValues', '@grant GM_addElement',
      `@resource note ${web.origin}/note.txt`])}
const d = document.documentElement.dataset;
d.body = String(!!document.body);
GM_addStyle('h1 { color: rgb(1, 2, 3) }');
GM_addElement(document.body, 'p', { id: 'added', textContent: 'added' });
d.res = GM_getResourceText('note') + '|' + GM_getResourceURL('note').slice(0, 15);
d.info = GM_info.script.name + '|' + GM_info.script.version + '|' + GM_info.scriptHandler;
GM_getTab((t) => { t.visits = (t.visits || 0) + 1; GM_saveTab(t, () => { d.tab = String(t.visits); }); });
(async () => {
  await GM.setValue('a', [1, 2]);
  d.promise = JSON.stringify(await GM.getValue('a')) + '|' + (await GM.listValues()).join();
})();
GM_cookie.set({ name: 'td', value: 'yes' }, (err) => {
  GM_cookie.list({ name: 'td' }, (list, e) => { d.cookie = e || err || list.map((c) => c.name + '=' + c.value).join(); });
});
if (location.search === '?open') GM_openInTab('/opened', { active: false });`
  });
  const p = await b.context.newPage();
  await p.goto(`${web.origin}/misc`);
  assert.equal(await mark(p, 'body'), 'true');
  assert.equal(await mark(p, 'res'), 'resource text|data:text/plain');
  assert.equal(await mark(p, 'info'), 'Misc|1.0|ScriptBurro');
  assert.equal(await mark(p, 'tab'), '1');
  assert.equal(await mark(p, 'promise'), '[1,2]|a');
  // The browser permission for cookies is optional and has not been granted yet.
  assert.match(await mark(p, 'cookie'), /may not read and change cookies yet/);
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('h1')).color), 'rgb(1, 2, 3)');
  assert.equal(await p.locator('#added').textContent(), 'added');
  // Tab data stays with the tab across a reload.
  await p.reload();
  assert.equal(await mark(p, 'tab'), '2');

  const opened = b.context.waitForEvent('page');
  await p.goto(`${web.origin}/misc?open`);
  const tab = await opened;
  await tab.waitForURL(/\/opened$/);
  await tab.close();
  await p.close();
});

test('GM_cookie works once the user allows the optional cookie permission', async () => {
  const misc = (await b.call('scripts.list')).find((s) => s.name === 'Misc');
  const d = b.dashboard;
  await d.goto(b.url(`dashboard.html#edit/${misc.id}`));
  await d.reload();
  await d.getByRole('tab', { name: 'Settings' }).click();
  await d.getByText('This script needs one more permission.').waitFor();
  await d.getByRole('button', { name: 'Allow', exact: true }).click();
  await d.getByText('This script needs one more permission.').waitFor({ state: 'detached' });

  const p = await b.context.newPage();
  await p.goto(`${web.origin}/misc`);
  assert.equal(await mark(p, 'cookie'), 'td=yes');
  await p.close();
});

test('a context-menu script is not injected on load but is offered for the page', async () => {
  const s = await b.call('scripts.install', {
    source: `${header('Ctx', ['@match http://127.0.0.1/*', '@run-at context-menu', '@grant none'])}document.documentElement.dataset.ctx = '1';`
  });
  const p = await b.context.newPage();
  await p.goto(`${web.origin}/other`);
  assert.equal(await mark(p, 'ctx', 600), undefined);
  const tab = (await b.call('tabs.list')).find((t) => t.url.endsWith('/other'));
  const forTab = await b.call('scripts.forTab', { tabId: tab.id, url: tab.url });
  assert.ok(forTab.scripts.some((x) => x.id === s.id));
  await b.call('scripts.run', { id: s.id, tabId: tab.id });
  assert.equal(await mark(p, 'ctx'), '1');
  await p.close();
});

test('GM.setBadge shows a status on the toolbar icon, from page-world and isolated scripts', async () => {
  const badge = (tabId) => b.dashboard.evaluate(async (id) => ({ text: await chrome.action.getBadgeText({ tabId: id }), title: await chrome.action.getTitle({ tabId: id }) }), tabId);
  const pageWorld = await b.call('scripts.install', {
    source: `${header('BadgePage', ['@match http://127.0.0.1/badge-page', '@grant none', '@run-at document-start'])}
document.documentElement.dataset.badgeworld = String(window.pageSecret === undefined) + '|' + typeof GM.setBadge;
window.addEventListener('load', () => { GM.setBadge({ text: '2/7', title: '2 strings found, 7 replaced' }); document.documentElement.dataset.badgesent = String(window.pageSecret); });`
  });
  await b.call('scripts.install', {
    source: `${header('BadgeIso', ['@match http://127.0.0.1/badge-iso', '@grant GM_getValue'])}
GM_setBadge('ok'); document.documentElement.dataset.badgeiso = '1';`
  });

  const p = await b.context.newPage();
  await p.goto(`${web.origin}/badge-page`);
  // Still a page-world script: it sees the page's own variable.
  assert.equal(await mark(p, 'badgesent'), 'from-page');
  const tab = (await b.call('tabs.list')).find((t) => t.url.endsWith('/badge-page'));
  const shown = await until(async () => { const x = await badge(tab.id); return x.text ? x : null; });
  assert.equal(shown.text, '2/7');
  assert.match(shown.title, /BadgePage: 2 strings found, 7 replaced/);
  const forTab = await b.call('scripts.forTab', { tabId: tab.id, url: tab.url });
  assert.deepEqual(forTab.badges[pageWorld.id], { text: '2/7', title: '2 strings found, 7 replaced' });

  // Leaving the page clears the badge and its tooltip.
  await p.goto(`${web.origin}/other`);
  await until(async () => (await badge(tab.id)).text === '');
  assert.deepEqual((await b.call('scripts.forTab', { tabId: tab.id, url: `${web.origin}/other` })).badges, {});

  await p.goto(`${web.origin}/badge-iso`);
  await mark(p, 'badgeiso');
  assert.equal((await until(async () => { const x = await badge(tab.id); return x.text ? x : null; })).text, 'ok');
  await p.close();
});

test('a page cannot set the badge by guessing: the event name is private to the script', async () => {
  const p = await b.context.newPage();
  await p.goto(`${web.origin}/badge-page`);
  await mark(p, 'badgesent');
  const tab = (await b.call('tabs.list')).find((t) => t.url.endsWith('/badge-page'));
  await until(async () => (await b.dashboard.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tab.id)) === '2/7');
  await p.evaluate(() => {
    for (const name of ['td-badge', 'td-badge-undefined', 'scriptburro:badge']) document.dispatchEvent(new CustomEvent(name, { detail: JSON.stringify({ text: 'HACK' }) }));
  });
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(await b.dashboard.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tab.id), '2/7');
  await p.close();
});
