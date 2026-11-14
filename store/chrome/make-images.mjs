// Regenerates the store screenshots and promo tile from the built extension.
// Run "npm run build" first, then: node store/chrome/make-images.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve, PAGE } from '../../tests/e2e/helpers.mjs';

const out = path.dirname(fileURLToPath(import.meta.url));
const icon = fs.readFileSync(path.join(out, '../../packages/extension/static/icons/icon.svg'), 'utf8');

const script = (name, version, desc, match, grants, extra = '') => `// ==UserScript==
// @name         ${name}
// @namespace    https://example.org/demo
// @version      ${version}
// @description  ${desc}
// @match        ${match}
${grants.map((g) => `// @grant        ${g}`).join('\n')}
${extra}// ==/UserScript==

(function () {
  'use strict';
  console.log('${name} is running');
})();
`;

const web = await serve({
  '/': PAGE,
  '/reading-mode.user.js': script('Reading mode for wikis', '1.4.0', 'Hides the sidebar and widens the article text', 'https://*.wikipedia.org/wiki/*',
    ['GM_addStyle', 'GM_getValue', 'GM_setValue', 'GM_xmlhttpRequest'], '// @connect      api.wikimedia.org\n')
});
const b = await launch();
await b.call('settings.set', { patch: { allowHttp: true, theme: 'light' } });
const add = async (src, tags, enabled = true) => {
  const s = await b.call('scripts.install', { source: src });
  await b.call('scripts.patch', { id: s.id, tags, enabled });
  return s;
};
await add(script('Wide code review', '2.1.0', 'Uses the full window width on pull request pages', 'https://github.com/*', ['GM_addStyle']), ['dev']);
await add(script('Video speed keys', '1.0.3', 'Adds [ and ] keys to change playback speed', 'https://www.youtube.com/*', ['none']), ['video']);
await add(script('Dark docs', '0.9.1', 'Applies a dark theme to documentation sites', 'https://docs.example.org/*', ['GM_addStyle', 'GM_getValue', 'GM_setValue']), ['theme']);
const price = await add(script('Price history note', '1.2.0', 'Remembers the last price you saw on a product page', 'https://*.example-shop.com/*', ['GM_getValue', 'GM_setValue']), ['shopping'], false);
await b.call('values.set', { id: price.id, key: 'lastPrice', value: { sku: 'A-1042', price: 19.99, seen: '2026-11-02' } });
await b.call('values.set', { id: price.id, key: 'currency', value: 'EUR' });

const p = b.dashboard;
await p.setViewportSize({ width: 1280, height: 800 });
const shot = (name) => p.screenshot({ path: path.join(out, name) });

await p.goto(b.url('dashboard.html#scripts'));
await p.reload();
await p.waitForSelector('tbody tr .sname');
await shot('screenshot-1-dashboard.png');

await p.goto(b.url(`review.html?url=${encodeURIComponent(`${web.origin}/reading-mode.user.js`)}`));
await p.waitForSelector('dl.facts');
await shot('screenshot-2-review.png');

await p.goto(b.url(`dashboard.html#edit/${price.id}`));
await p.reload();
await p.waitForSelector('.cm-editor');
await shot('screenshot-3-editor.png');

await p.getByRole('tab', { name: 'Storage' }).click();
await p.getByRole('textbox', { name: 'Value of lastPrice' }).waitFor();
await shot('screenshot-4-storage.png');

await b.call('settings.set', { patch: { theme: 'dark' } });
await p.goto(b.url('dashboard.html#integrations'));
await p.reload();
await p.waitForSelector('#bridge-url');
await shot('screenshot-5-integrations.png');

// Promo tile and the store icon (96px artwork with 16px transparent padding).
const t = await b.context.newPage();
await t.setViewportSize({ width: 440, height: 280 });
await t.setContent(`<style>
  html,body{margin:0;height:100%}
  body{background:#0d6b58;color:#f4efe6;font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px}
  svg{width:92px;height:92px}
  h1{margin:0;font-size:34px;font-weight:700;letter-spacing:-.01em}
  p{margin:0;font-size:16px;opacity:.9}
</style>${icon.replace('fill="#0d6b58"/>', 'fill="#0a5646"/>')}<h1>TamperDonkey</h1><p>Userscripts, with real permissions</p>`);
await t.screenshot({ path: path.join(out, 'promo-small-440x280.png') });
await t.setViewportSize({ width: 128, height: 128 });
await t.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:96px;height:96px;margin:16px}</style>${icon}`);
await t.screenshot({ path: path.join(out, '../../packages/extension/static/icons/icon-128.png'), omitBackground: true });

await b.context.close();
await web.close();
console.log('Wrote store images to', out);
