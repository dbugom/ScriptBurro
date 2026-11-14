/* global __TD_TARGET__ */
import { api, call } from '../shared/browser.js';
import { h } from '../shared/dom.js';

/**
 * Banner shown while the browser does not let the extension run user scripts.
 * Chrome: the user turns on "Allow User Scripts" on the extension's details page.
 * Firefox: userScripts is an optional permission that must be requested from a click.
 */
export function accessBanner(onChange) {
  if (__TD_TARGET__ === 'firefox') {
    const grant = async (perm) => {
      try {
        await api.permissions.request(perm);
        await call('registrations.sync');
        onChange();
      } catch (e) {
        alert(e.message);
      }
    };
    return h('div', { class: 'banner', role: 'alert' },
      h('div', null, h('strong', null, 'Scripts cannot run yet. '), 'Firefox needs your permission for user scripts and for access to web pages.'),
      h('button', { class: 'primary', onClick: () => grant({ permissions: ['userScripts'] }) }, 'Allow user scripts'),
      h('button', { onClick: () => grant({ origins: ['<all_urls>'] }) }, 'Allow access to all sites'));
  }
  return h('div', { class: 'banner', role: 'alert' },
    h('div', null, h('strong', null, 'Scripts cannot run yet. '),
      'Open this extension\'s details page and turn on "Allow User Scripts" (on older Chrome versions: turn on Developer mode).'),
    h('button', { class: 'primary', onClick: () => api.tabs.create({ url: `chrome://extensions/?id=${api.runtime.id}` }) }, 'Open details page'),
    h('button', { onClick: async () => { await call('registrations.sync'); onChange(); } }, 'Check again'));
}

export function openDashboard(hash = '') {
  api.tabs.create({ url: api.runtime.getURL(`dashboard.html${hash}`) });
}
