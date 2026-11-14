import { api, call } from '../shared/browser.js';
import { h, fill, applyTheme, explainGrant } from '../shared/dom.js';
import { diffLines } from '../shared/diff.js';

const app = document.getElementById('app');
const q = new URLSearchParams(location.search);

function diffView(oldSrc, newSrc) {
  const lines = diffLines(oldSrc, newSrc);
  const out = h('div', { class: 'diff', tabindex: 0, 'aria-label': 'Changes' });
  // Show changed lines with three lines of context around them.
  const keep = new Uint8Array(lines.length);
  lines.forEach((l, i) => {
    if (l.type !== 'same') for (let k = Math.max(0, i - 3); k <= Math.min(lines.length - 1, i + 3); k++) keep[k] = 1;
  });
  let gap = false;
  lines.forEach((l, i) => {
    if (!keep[i]) {
      if (!gap) out.append(h('div', { class: 'gap' }, '···'));
      gap = true;
      return;
    }
    gap = false;
    out.append(h('div', { class: l.type === 'add' ? 'add' : l.type === 'del' ? 'del' : '' }, `${l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' '} ${l.text}`));
  });
  if (!lines.some((l) => l.type !== 'same')) out.append(h('div', { class: 'gap' }, 'No changes: the source is identical.'));
  return out;
}

function facts(p) {
  const m = p.meta;
  const everywhere = [...m.matches, ...m.includes].some((x) => ['*', '<all_urls>', '*://*/*', 'http*://*/*', 'https://*/*'].includes(x));
  const grants = m.grants.filter((g) => g !== 'none');
  return [
    h('dl', { class: 'facts' },
      h('dt', null, 'Name'), h('dd', null, h('strong', null, m.name), ` ${m.version}`),
      m.description && [h('dt', null, 'Description'), h('dd', null, m.description)],
      m.author && [h('dt', null, 'Author'), h('dd', null, m.author)],
      p.url && [h('dt', null, 'Source'), h('dd', { class: 'mono' }, p.url)],
      h('dt', null, 'Runs on'), h('dd', null, [...m.matches, ...m.includes].length
        ? h('ul', { class: 'plain mono' }, [...m.matches, ...m.includes].map((x) => h('li', null, x)))
        : 'No page (it has no @match or @include)'),
      h('dt', null, 'Can'), h('dd', null, grants.length
        ? h('ul', { class: 'plain' }, [...new Set(grants.map(explainGrant))].map((x) => h('li', null, x)))
        : 'Run in the page like the page\'s own scripts, with no extra permissions'),
      m.connects.length > 0 && [h('dt', null, 'Connects to'), h('dd', { class: 'mono' }, m.connects.join(', '))],
      m.requires.length > 0 && [h('dt', null, 'Loads'), h('dd', null, h('ul', { class: 'plain mono' }, m.requires.map((x) => h('li', null, x))))]),
    everywhere && h('div', { class: 'banner' }, h('div', null, h('strong', null, 'This script runs on every website. '), 'Install it only if you trust its author.')),
    m.connects.includes('*') && h('div', { class: 'banner' }, h('div', null, h('strong', null, 'This script may send requests to any website.'))),
    m.antifeatures.length > 0 && h('div', { class: 'banner bad' }, h('div', null, h('strong', null, 'The author declares: '), m.antifeatures.join('; '))),
    p.warnings.map((w) => h('div', { class: 'banner' }, h('div', null, w)))
  ];
}

function shell(title, ...body) {
  fill(app, h('div', { class: 'review' },
    h('div', { class: 'head' }, h('img', { src: 'icons/icon-48.png', alt: '' }), h('h1', null, title)), ...body));
}

function done(text) {
  shell(text, h('div', { class: 'actions' },
    h('button', { class: 'primary', onClick: () => { location.href = api.runtime.getURL('dashboard.html'); } }, 'Open dashboard'),
    h('button', { onClick: () => window.close() }, 'Close')));
}

function sourceOrDiff(p, newSource) {
  if (p.existing && !p.existing.trashed) return [h('h3', null, `Changes from installed version ${p.existing.version}`), diffView(p.existing.source, newSource)];
  return [h('h3', null, 'Source'), h('pre', { class: 'code', tabindex: 0 }, newSource)];
}

async function reviewUrl(url) {
  shell('Loading script…', h('p', { class: 'mono muted' }, url));
  const p = await call('scripts.preview', { url });
  const again = p.existing && !p.existing.trashed;
  const btn = h('button', { class: 'primary', onClick: async () => {
    btn.disabled = true;
    try {
      await call('scripts.install', { source: p.source, url });
      done(again ? 'Script updated' : 'Script installed');
    } catch (e) {
      btn.disabled = false;
      alert(e.message);
    }
  } }, again ? 'Replace installed script' : 'Install');
  shell(again ? 'Replace this userscript?' : 'Install this userscript?', ...facts(p),
    h('div', { class: 'actions' }, btn, h('button', { onClick: () => history.length > 1 ? history.back() : window.close() }, 'Cancel')),
    ...sourceOrDiff(p, p.source));
}

async function reviewUpdate(id) {
  const s = await call('scripts.get', { id });
  if (!s.pendingSource) return done('No update is waiting for this script');
  const p = await call('scripts.preview', { source: s.pendingSource });
  const answer = async (accept) => {
    await call('scripts.applyUpdate', { id, accept });
    done(accept ? 'Script updated' : 'Update skipped');
  };
  shell(`Update "${s.name}" to ${p.meta.version}?`, ...facts(p),
    h('div', { class: 'actions' }, h('button', { class: 'primary', onClick: () => answer(true) }, 'Update'),
      h('button', { onClick: () => answer(false) }, 'Skip this update')),
    h('h3', null, `Changes from ${s.version}`), diffView(s.source, s.pendingSource));
}

async function reviewPending(id) {
  const p = (await call('pending.list')).find((x) => x.id === id);
  if (!p) return done('This request was already answered or has expired');
  const body = [h('div', { class: 'banner info' }, h('div', null, h('strong', null, p.client), ' asks TamperDonkey to: ', h('strong', null, p.summary), '.'))];
  if (p.cmd === 'scripts.install') {
    const prev = await call('scripts.preview', { source: p.args.source, url: p.args.url });
    if (p.args.id) {
      const cur = await call('scripts.get', { id: p.args.id });
      prev.existing = { version: cur.version, source: cur.source, trashed: false };
    }
    body.push(...facts(prev), ...sourceOrDiff(prev, prev.source));
  } else {
    body.push(h('h3', null, 'Request'), h('pre', { class: 'code' }, JSON.stringify(p.args, null, 2)));
  }
  const answer = async (accept) => {
    try {
      await call('pending.resolve', { id, accept });
      done(accept ? 'Request accepted' : 'Request refused');
    } catch (e) {
      alert(e.message);
    }
  };
  const actions = h('div', { class: 'actions' },
    h('button', { class: 'primary', id: 'accept', onClick: () => answer(true) }, 'Allow'),
    h('button', { id: 'refuse', onClick: () => answer(false) }, 'Refuse'));
  shell('An outside tool wants to make a change', body[0], actions, ...body.slice(1));
}

(async () => {
  applyTheme((await call('settings.get')).theme);
  if (q.get('url')) await reviewUrl(q.get('url'));
  else if (q.get('update')) await reviewUpdate(q.get('update'));
  else if (q.get('pending')) await reviewPending(q.get('pending'));
  else done('Nothing to review');
})().catch((e) => shell('Could not load the script', h('div', { class: 'banner bad' }, h('div', null, e.message)),
  h('div', { class: 'actions' }, h('button', { onClick: () => window.close() }, 'Close'))));
