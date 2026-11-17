import { api, call } from '../shared/browser.js';
import { h, fill, applyTheme } from '../shared/dom.js';
import { accessBanner, openDashboard } from './common.js';

const app = document.getElementById('app');

async function render() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  const settings = await call('settings.get');
  applyTheme(settings.theme);
  const url = tab?.url || '';
  const web = /^https?:|^file:/.test(url);
  const data = web ? await call('scripts.forTab', { tabId: tab.id, url }) : { scripts: [], menu: [], badges: {}, userScripts: (await call('status')).userScripts };

  const toggle = (s) => h('label', { class: 'switch', title: s.enabled ? 'Enabled' : 'Disabled' },
    h('input', {
      type: 'checkbox', checked: s.enabled, 'aria-label': `Enable ${s.name}`,
      onChange: async (e) => { await call('scripts.patch', { id: s.id, enabled: e.target.checked }); }
    }), h('span'));

  fill(app,
    h('header', null, h('img', { src: 'icons/icon-48.png', alt: '' }), h('strong', null, 'TamperDonkey'),
      h('button', { onClick: () => { openDashboard(); window.close(); } }, 'Dashboard')),
    !data.userScripts && h('section', null, accessBanner(render)),
    h('section', null,
      h('h3', null, web ? 'Scripts for this page' : 'Scripts'),
      !web && h('p', { class: 'muted' }, 'Scripts do not run on this kind of page.'),
      web && data.scripts.length === 0 && h('p', { class: 'muted' }, 'No installed script matches this page.'),
      data.scripts.map((s) => h('div', { class: 'item' }, toggle(s),
        h('span', { class: 'name', title: s.name }, s.name,
          data.badges[s.id]?.title && h('div', { class: 'muted small' }, data.badges[s.id].title)),
        s.runAt === 'context-menu' && s.enabled && h('button', {
          title: 'Run now', onClick: async () => { try { await call('scripts.run', { id: s.id, tabId: tab.id }); window.close(); } catch (e) { alert(e.message); } }
        }, 'Run'),
        h('button', { class: 'link', onClick: () => { openDashboard(`#edit/${s.id}`); window.close(); } }, 'Edit')))),
    data.menu.length > 0 && h('section', null, h('h3', null, 'Script commands'),
      data.menu.map((c) => h('button', {
        class: 'cmd', title: c.script,
        onClick: async () => { await call('menu.click', { tabId: tab.id, id: c.id }); window.close(); }
      }, c.name))),
    h('footer', null,
      h('button', { onClick: () => { openDashboard(web ? `#new/${encodeURIComponent(new URL(url).origin)}` : '#new'); window.close(); } }, 'New script'),
      web && data.scripts.some((s) => s.enabled) && h('span', { class: 'muted small' }, 'Reload the page after changes.')));
}

render().catch((e) => { app.textContent = e.message; });
