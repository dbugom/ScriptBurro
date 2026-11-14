import { EditorView, basicSetup } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { Compartment, EditorState } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { api, call } from '../shared/browser.js';
import { h, clear, fill, timeAgo, applyTheme, toast } from '../shared/dom.js';
import { NEW_SCRIPT_TEMPLATE } from '../shared/defaults.js';
import { zipFiles, unzipFiles } from '../shared/zip.js';
import { accessBanner } from './common.js';
import { runAi } from './ai.js';

const app = document.getElementById('app');
let settings = null;
let status = null;
let dirty = false;

const ROUTES = [['scripts', 'Scripts'], ['trash', 'Trash'], ['settings', 'Settings'], ['integrations', 'Integrations'], ['log', 'Activity']];

function isDark() {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
}

async function guard(fn) {
  try {
    return await fn();
  } catch (e) {
    toast(e.message, 'error');
    return undefined;
  }
}

function saveFile(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  h('a', { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function pickFile(accept) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, onChange: () => resolve(input.files[0] || null) });
    input.click();
  });
}

function frame(active, ...body) {
  const pendingCount = status?.pending || 0;
  fill(app,
    h('div', { class: 'top' }, h('div', { class: 'top-in' },
      h('div', { class: 'brand' }, h('img', { src: 'icons/icon-48.png', alt: '' }), 'TamperDonkey'),
      h('nav', { 'aria-label': 'Sections' }, ROUTES.map(([id, label]) => h('a', {
        href: `#${id}`, class: active === id ? 'active' : '', 'aria-current': active === id ? 'page' : null
      }, label, id === 'integrations' && pendingCount > 0 && h('span', { class: 'pill warn count' }, pendingCount)))))),
    h('main', null, !status.userScripts && accessBanner(route), ...body));
}

// ---------------------------------------------------------------- scripts

let filter = '';
let tagFilter = '';
const selected = new Set();

function sites(s) {
  const all = [...s.matches, ...s.includes];
  if (!all.length) return h('span', { class: 'pill warn' }, 'no pages');
  return h('span', { class: 'mono small', title: all.join('\n') }, all[0], all.length > 1 ? ` +${all.length - 1}` : '');
}

function toggle(s, after) {
  return h('label', { class: 'switch' }, h('input', {
    type: 'checkbox', checked: s.enabled, 'aria-label': `Enable ${s.name}`,
    onChange: (e) => guard(async () => { await call('scripts.patch', { id: s.id, enabled: e.target.checked }); after(); })
  }), h('span'));
}

async function viewScripts() {
  const scripts = await call('scripts.list');
  const tags = [...new Set(scripts.flatMap((s) => s.tags))].sort();
  const body = h('tbody');
  const count = h('span', { class: 'muted small' });
  const bulk = h('div', { class: 'row', hidden: true });

  const draw = () => {
    const q = filter.trim().toLowerCase();
    const shown = scripts.filter((s) => (!tagFilter || s.tags.includes(tagFilter)) &&
      (!q || [s.name, s.description, s.namespace, s.author, ...s.matches, ...s.includes, ...s.tags].join('\n').toLowerCase().includes(q)));
    clear(body);
    for (const s of shown) {
      body.append(h('tr', { class: s.enabled ? '' : 'off' },
        h('td', null, h('input', {
          type: 'checkbox', checked: selected.has(s.id), 'aria-label': `Select ${s.name}`,
          onChange: (e) => { if (e.target.checked) selected.add(s.id); else selected.delete(s.id); drawBulk(); }
        })),
        h('td', null, toggle(s, route)),
        h('td', null,
          h('a', { class: 'sname', href: `#edit/${s.id}` }, s.name),
          s.tags.length > 0 && h('span', { class: 'tags' }, s.tags.map((t) => h('span', { class: 'pill' }, t))),
          s.pendingUpdate && h('span', { class: 'tags' }, h('a', { class: 'pill warn', href: `review.html?update=${s.id}` }, `Update ${s.pendingUpdate.version} available: review`)),
          h('div', { class: 'sdesc', title: s.description }, s.description || ' ')),
        h('td', { class: 'num' }, s.version),
        h('td', { class: 'hide-narrow' }, sites(s)),
        h('td', { class: 'hide-narrow' },
          h('span', { class: `pill ${s.world === 'sandbox' ? 'ok' : ''}`, title: s.world === 'sandbox' ? 'Runs isolated from the page, with the GM functions it was granted' : 'Runs inside the page with no extra permissions' }, s.world === 'sandbox' ? 'isolated' : 'in page'),
          s.connects.length > 0 && h('span', { class: 'pill', title: `Connects to: ${s.connects.join(', ')}` }, 'network'),
          s.antifeatures.length > 0 && h('span', { class: 'pill bad', title: s.antifeatures.join('; ') }, 'antifeature')),
        h('td', { class: 'num hide-narrow', title: new Date(s.updatedAt).toLocaleString() }, timeAgo(s.updatedAt)),
        h('td', { class: 'actions' },
          h('button', { class: 'danger', title: 'Move to trash', 'aria-label': `Move ${s.name} to trash`, onClick: () => guard(async () => {
            await call('scripts.trash', { id: s.id });
            toast(`"${s.name}" moved to trash`);
            route();
          }) }, 'Trash'))));
    }
    if (!shown.length) {
      body.append(h('tr', null, h('td', { colSpan: 8, class: 'empty' }, scripts.length
        ? 'No script matches the search.'
        : ['No scripts installed yet. ', h('a', { href: '#new' }, 'Write a new script'), ' or open a link that ends in .user.js to install one.'])));
    }
    count.textContent = `${shown.length} of ${scripts.length}`;
    drawBulk();
  };

  const drawBulk = () => {
    for (const id of [...selected]) if (!scripts.some((s) => s.id === id)) selected.delete(id);
    bulk.hidden = selected.size === 0;
    const each = (fn, done) => guard(async () => {
      for (const id of selected) await fn(id);
      selected.clear();
      toast(done);
      route();
    });
    fill(bulk, h('span', { class: 'muted' }, `${selected.size} selected`),
      h('button', { onClick: () => each((id) => call('scripts.patch', { id, enabled: true }), 'Enabled') }, 'Enable'),
      h('button', { onClick: () => each((id) => call('scripts.patch', { id, enabled: false }), 'Disabled') }, 'Disable'),
      h('button', { class: 'danger', onClick: () => each((id) => call('scripts.trash', { id }), 'Moved to trash') }, 'Move to trash'));
  };

  const importFile = () => guard(async () => {
    const file = await pickFile('.json,.zip,.js');
    if (!file) return;
    let items;
    if (/\.zip$/i.test(file.name)) {
      const files = await unzipFiles(new Uint8Array(await file.arrayBuffer()));
      const manifest = files.find((f) => f.name === 'tamperdonkey.json');
      const extra = manifest ? JSON.parse(manifest.text).scripts : [];
      items = files.filter((f) => /\.user\.js$/i.test(f.name)).map((f) => ({ source: f.text, ...(extra.find((x) => x.file === f.name) || {}) }));
    } else if (/\.json$/i.test(file.name)) {
      items = JSON.parse(await file.text()).scripts;
    } else {
      items = [{ source: await file.text() }];
    }
    if (!Array.isArray(items) || !items.length) throw new Error('No scripts found in that file.');
    const r = await call('backup.import', { scripts: items });
    toast(`Imported ${r.imported.length} script(s)${r.failed.length ? `, ${r.failed.length} failed: ${r.failed[0].error}` : ''}`, r.failed.length ? 'error' : 'info');
    route();
  });

  const exportZip = () => guard(async () => {
    const data = await call('backup.export');
    const used = new Set();
    const files = [];
    const meta = [];
    for (const s of data.scripts) {
      let base = s.name.replace(/[^\w.-]+/g, '_').slice(0, 80) || 'script';
      let name = `${base}.user.js`;
      for (let i = 2; used.has(name); i++) name = `${base}_${i}.user.js`;
      used.add(name);
      files.push({ name, text: s.source });
      meta.push({ file: name, enabled: s.enabled, origin: s.origin, tags: s.tags, overrides: s.overrides, values: s.values });
    }
    files.push({ name: 'tamperdonkey.json', text: JSON.stringify({ format: data.format, version: data.version, created: data.created, scripts: meta }, null, 2) });
    saveFile(`tamperdonkey-backup-${data.created.slice(0, 10)}.zip`, zipFiles(files), 'application/zip');
  });

  const installUrl = () => {
    const input = h('input', { type: 'url', id: 'install-url', placeholder: 'https://example.com/script.user.js', 'aria-label': 'Script address' });
    const go = () => { if (input.value.trim()) location.href = `review.html?url=${encodeURIComponent(input.value.trim())}`; };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    const box = h('div', { class: 'card pad' }, h('div', { class: 'row' }, h('div', { class: 'grow', style: 'flex:1 1 260px;display:flex' }, input), h('button', { class: 'primary', onClick: go }, 'Review and install')));
    input.style.width = '100%';
    toolbar.after(box);
    input.focus();
  };

  const toolbar = h('div', { class: 'toolbar' },
    h('div', { class: 'grow' }, h('input', {
      type: 'search', id: 'search', placeholder: 'Search by name, site or tag', value: filter, 'aria-label': 'Search scripts',
      onInput: (e) => { filter = e.target.value; draw(); }
    })),
    tags.length > 0 && h('select', { 'aria-label': 'Filter by tag', onChange: (e) => { tagFilter = e.target.value; draw(); } },
      h('option', { value: '' }, 'All tags'), tags.map((t) => h('option', { value: t, selected: t === tagFilter }, t))),
    count,
    h('a', { class: 'btn primary', href: '#new', style: 'background:var(--accent);color:var(--accent-fg);border-color:var(--accent);font-weight:600' }, 'New script'),
    h('button', { onClick: installUrl }, 'Install from URL'),
    h('button', { onClick: importFile }, 'Import'),
    h('button', { onClick: exportZip, disabled: scripts.length === 0 }, 'Export zip'),
    h('button', { onClick: (e) => guard(async () => {
      e.target.disabled = true;
      const found = await call('scripts.checkUpdates');
      toast(found.length ? `${found.length} update(s) found` : 'All scripts are up to date');
      route();
    }) }, 'Check for updates'));

  frame('scripts', toolbar, bulk,
    h('div', { class: 'card tablewrap' }, h('table', null,
      h('thead', null, h('tr', null,
        h('th', null, h('input', { type: 'checkbox', 'aria-label': 'Select all', onChange: (e) => {
          selected.clear();
          if (e.target.checked) scripts.forEach((s) => selected.add(s.id));
          draw();
        } })),
        h('th', null, 'On'), h('th', null, 'Script'), h('th', null, 'Version'), h('th', { class: 'hide-narrow' }, 'Runs on'),
        h('th', { class: 'hide-narrow' }, 'Access'), h('th', { class: 'hide-narrow' }, 'Updated'), h('th', null, ''))), body)));
  draw();
}

// ---------------------------------------------------------------- editor

async function viewEditor(id, seedOrigin) {
  const existing = id ? await call('scripts.get', { id }) : null;
  let source = existing ? existing.source : NEW_SCRIPT_TEMPLATE;
  if (!existing && seedOrigin) source = source.replace('https://example.com/*', `${seedOrigin}/*`);
  let tab = 'code';
  let view = null;
  const themeSlot = new Compartment();
  const panel = h('div');
  const title = h('h1', null, existing ? existing.name : 'New script');
  const state = h('span', { class: 'muted small' });

  const setDirty = (v) => {
    dirty = v;
    state.textContent = v ? 'Unsaved changes' : existing ? `Saved, version ${existing.version}` : 'Not saved yet';
  };

  const save = () => guard(async () => {
    const r = await call('scripts.install', { source: view ? view.state.doc.toString() : source, id: existing?.id });
    setDirty(false);
    toast(r.warnings.length ? `Saved. ${r.warnings[0]}` : 'Saved', r.warnings.length ? 'error' : 'info');
    if (!existing) location.hash = `#edit/${r.id}`;
    else {
      Object.assign(existing, r);
      title.textContent = r.name;
      setDirty(false);
    }
  });

  const drawCode = () => {
    const host = h('div', { class: 'editor' });
    fill(panel, host, settings.ai.enabled && aiPanel(() => view.state.doc.toString(), (code) => {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: code } });
    }));
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: source,
        extensions: [
          basicSetup, javascript(), themeSlot.of(isDark() ? oneDark : []),
          keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => { save(); return true; } }]),
          EditorView.updateListener.of((u) => { if (u.docChanged) { source = u.state.doc.toString(); setDirty(true); } })
        ]
      })
    });
  };

  const lines = (label, help, value, onSave) => {
    const ta = h('textarea', { rows: 3, value: value.join('\n'), spellcheck: false, 'aria-label': label });
    ta.addEventListener('change', () => onSave(ta.value.split('\n').map((x) => x.trim()).filter(Boolean)));
    return h('div', { class: 'field' }, h('span', { class: 'lbl' }, label), ta, h('span', { class: 'help' }, help));
  };

  const drawSettings = () => {
    const s = existing;
    const patch = (p) => guard(async () => { Object.assign(s, await call('scripts.patch', { id: s.id, ...p })); toast('Saved'); });
    const ov = s.overrides || { includes: [], matches: [], excludes: [] };
    fill(panel, h('div', { class: 'grid2' },
      h('div', { class: 'card pad' },
        h('h3', null, 'Behaviour'),
        h('label', null, h('input', { type: 'checkbox', checked: s.enabled, onChange: (e) => patch({ enabled: e.target.checked }) }), 'Enabled'),
        h('label', null, h('input', { type: 'checkbox', checked: s.autoUpdate, onChange: (e) => patch({ autoUpdate: e.target.checked }) }), 'Check this script for updates'),
        h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Tags'),
          h('input', { type: 'text', value: s.tags.join(', '), 'aria-label': 'Tags', onChange: (e) => patch({ tags: e.target.value.split(',') }) }),
          h('span', { class: 'help' }, 'Comma separated. Used to filter the script list.')),
        h('div', { class: 'row' },
          h('button', { onClick: () => guard(async () => { await call('scripts.refetch', { id: s.id }); toast('Downloaded @require and @resource files again'); }) }, 'Download @require files again'),
          h('button', { onClick: () => guard(async () => {
            const r = await call('scripts.checkUpdates', { id: s.id });
            toast(r.length ? `Version ${r[0].version} found` : 'No newer version found');
            if (r.length && !r[0].installed) location.href = `review.html?update=${s.id}`;
          }) }, 'Check for update now'))),
      h('div', { class: 'card pad' },
        h('h3', null, 'Your own page rules'),
        lines('Also run on', 'One @include pattern per line, added to the script\'s own rules.', ov.includes, (v) => patch({ overrides: { ...ov, includes: (ov.includes = v) } })),
        lines('Never run on', 'One @exclude pattern per line.', ov.excludes, (v) => patch({ overrides: { ...ov, excludes: (ov.excludes = v) } })),
        lines('Extra hosts this script may contact', 'One host per line, added to the script\'s @connect list.', s.connectApproved || [], (v) => patch({ connectApproved: v }))),
      h('div', { class: 'card pad' },
        h('h3', null, 'From the script header'),
        h('dl', { class: 'facts' },
          h('dt', null, 'Runs on'), h('dd', { class: 'mono' }, [...s.matches, ...s.includes].join('\n') || 'no pages'),
          h('dt', null, 'Excluded'), h('dd', { class: 'mono' }, s.excludes.join('\n') || 'none'),
          h('dt', null, 'Run at'), h('dd', null, s.runAt),
          h('dt', null, 'Grants'), h('dd', { class: 'mono' }, s.grants.join(', ') || 'none'),
          h('dt', null, 'Connects to'), h('dd', { class: 'mono' }, s.connects.join(', ') || 'nothing'),
          h('dt', null, 'World'), h('dd', null, s.world === 'sandbox' ? 'Isolated from the page' : 'Inside the page'),
          h('dt', null, 'Installed from'), h('dd', { class: 'mono' }, s.origin || 'written here'),
          h('dt', null, 'Last update check'), h('dd', null, timeAgo(s.lastCheck), s.lastCheckError ? ` (failed: ${s.lastCheckError})` : '')))));
  };

  const drawStorage = async () => {
    const values = await call('values.get', { id: existing.id });
    const rows = h('tbody');
    const row = (key, value, isNew) => {
      const k = h('input', { type: 'text', value: key, disabled: !isNew, 'aria-label': 'Key', class: 'mono' });
      const v = h('textarea', { rows: 1, value: JSON.stringify(value), 'aria-label': `Value of ${key || 'new key'}`, spellcheck: false });
      return h('tr', null, h('td', null, k), h('td', { style: 'width:60%' }, v), h('td', { class: 'actions' },
        h('button', { onClick: () => guard(async () => {
          if (!k.value) throw new Error('Enter a key.');
          let parsed;
          try { parsed = JSON.parse(v.value); } catch { throw new Error('The value must be valid JSON, for example "text", 12, true or {"a":1}.'); }
          await call('values.set', { id: existing.id, key: k.value, value: parsed });
          toast('Value saved');
          drawStorage();
        }) }, 'Save'),
        !isNew && h('button', { class: 'danger', onClick: () => guard(async () => { await call('values.delete', { id: existing.id, key }); drawStorage(); }) }, 'Delete')));
    };
    for (const [k, v] of Object.entries(values)) rows.append(row(k, v, false));
    rows.append(row('', '', true));
    fill(panel,
      h('p', { class: 'muted' }, 'Data this script saved with GM_setValue. Values are JSON. Pages that are open get the change at once.'),
      h('div', { class: 'card tablewrap' }, h('table', null, h('thead', null, h('tr', null, h('th', null, 'Key'), h('th', null, 'Value (JSON)'), h('th', null, ''))), rows)));
  };

  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const drawTabs = () => {
    fill(tabs, [['code', 'Code'], existing && ['settings', 'Settings'], existing && ['storage', 'Storage']].filter(Boolean).map(([t, label]) =>
      h('button', { role: 'tab', 'aria-selected': String(tab === t), class: tab === t ? 'active' : '', onClick: () => { tab = t; drawTabs(); } }, label)));
    view = null;
    if (tab === 'code') drawCode();
    else if (tab === 'settings') drawSettings();
    else drawStorage();
  };

  frame('scripts',
    h('div', { class: 'toolbar' }, h('a', { href: '#scripts', class: 'btn' }, 'Back'), title, state, h('div', { class: 'grow' }),
      existing && h('label', { class: 'switch', title: 'Enabled' }, h('input', {
        type: 'checkbox', checked: existing.enabled, 'aria-label': 'Enabled',
        onChange: (e) => guard(async () => { await call('scripts.patch', { id: existing.id, enabled: e.target.checked }); existing.enabled = e.target.checked; })
      }), h('span')),
      h('button', { class: 'primary', id: 'save', onClick: save }, 'Save')),
    tabs, panel);
  drawTabs();
  setDirty(!existing);
  dirty = false;
}

function aiPanel(getSource, setSource) {
  const prompt = h('textarea', { rows: 2, id: 'ai-prompt', placeholder: 'Describe the script you want, or paste an error message', 'aria-label': 'Request for the AI helper', style: 'font-family:var(--font);font-size:14px' });
  const out = h('div', { class: 'aiout', hidden: true, 'aria-live': 'polite' });
  const use = h('button', { class: 'primary', hidden: true }, 'Put this script in the editor');
  const stop = h('button', { hidden: true }, 'Stop');
  let ctrl = null;
  const run = (task) => guard(async () => {
    if (task === 'generate' && !prompt.value.trim()) throw new Error('Describe what the script should do.');
    out.hidden = false;
    out.textContent = '';
    use.hidden = true;
    stop.hidden = false;
    ctrl = new AbortController();
    try {
      const r = await runAi(settings.ai, task, { prompt: prompt.value, source: getSource() }, (d) => { out.textContent += d; out.scrollTop = out.scrollHeight; }, ctrl.signal);
      out.textContent = r.text;
      if (r.code) {
        use.hidden = false;
        use.onclick = () => { setSource(r.code); toast('Draft placed in the editor. Review it, then save.'); };
      }
    } finally {
      stop.hidden = true;
    }
  });
  stop.onclick = () => ctrl?.abort();
  return h('div', { class: 'card pad aipanel' },
    h('h3', null, 'AI helper'),
    h('p', { class: 'muted small' }, 'Your request and the script in the editor are sent to the Claude API with your key. Nothing is installed until you save.'),
    prompt,
    h('div', { class: 'row' },
      h('button', { onClick: () => run('generate') }, 'Generate script'),
      h('button', { onClick: () => run('explain') }, 'Explain this script'),
      h('button', { onClick: () => run('fix') }, 'Find and fix a problem'), stop, use),
    out);
}

// ---------------------------------------------------------------- trash, settings, integrations, log

async function viewTrash() {
  const scripts = await call('scripts.list', { trashed: true });
  frame('trash',
    h('p', { class: 'muted' }, `Scripts in the trash do not run. They are deleted for good after ${settings.trashDays} days.`),
    h('div', { class: 'card tablewrap' }, h('table', null,
      h('thead', null, h('tr', null, h('th', null, 'Script'), h('th', null, 'Version'), h('th', null, 'Trashed'), h('th', null, ''))),
      h('tbody', null, scripts.length ? scripts.map((s) => h('tr', null,
        h('td', null, h('span', { class: 'sname' }, s.name)), h('td', { class: 'num' }, s.version), h('td', { class: 'num' }, timeAgo(s.trashedAt)),
        h('td', { class: 'actions' },
          h('button', { onClick: () => guard(async () => { await call('scripts.restore', { id: s.id }); toast('Restored'); route(); }) }, 'Restore'), ' ',
          h('button', { class: 'danger', onClick: () => guard(async () => {
            if (!confirm(`Delete "${s.name}" and its stored data for good?`)) return;
            await call('scripts.purge', { id: s.id });
            route();
          }) }, 'Delete for good')))) : h('tr', null, h('td', { colSpan: 4, class: 'empty' }, 'The trash is empty.'))))));
}

function field(label, control, help) {
  return h('div', { class: 'field' }, h('span', { class: 'lbl' }, label), control, help && h('span', { class: 'help' }, help));
}

const set = (patch, msg = 'Saved') => guard(async () => {
  settings = await call('settings.set', { patch });
  applyTheme(settings.theme);
  toast(msg);
});

async function viewSettings() {
  frame('settings', h('div', { class: 'grid2' },
    h('div', { class: 'card pad' }, h('h3', null, 'Appearance'),
      field('Theme', h('select', { 'aria-label': 'Theme', onChange: (e) => set({ theme: e.target.value }) },
        [['auto', 'Follow the system'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => h('option', { value: v, selected: settings.theme === v }, l))))),
    h('div', { class: 'card pad' }, h('h3', null, 'Updates'),
      field('Check for script updates', h('select', { 'aria-label': 'Update interval', onChange: (e) => set({ updateIntervalHours: Number(e.target.value) }) },
        [[0, 'Never'], [6, 'Every 6 hours'], [24, 'Every day'], [168, 'Every week']].map(([v, l]) => h('option', { value: v, selected: settings.updateIntervalHours === v }, l)))),
      field('When an update is found', h('select', { 'aria-label': 'Update mode', onChange: (e) => set({ updateMode: e.target.value }) },
        [['ask', 'Show me the changes first'], ['auto', 'Install it without asking']].map(([v, l]) => h('option', { value: v, selected: settings.updateMode === v }, l))),
      'Installing without asking lets a script author change what runs on your pages at any time.')),
    h('div', { class: 'card pad' }, h('h3', null, 'Security'),
      h('label', null, h('input', { type: 'checkbox', checked: settings.allowHttp, onChange: (e) => set({ allowHttp: e.target.checked }) }), 'Allow plain http:// for installs, updates and script requests'),
      h('span', { class: 'help muted small' }, 'Off by default: anyone on the network can change what is sent over http.'),
      field('Pages where no script may run', (() => {
        const ta = h('textarea', { rows: 4, value: settings.blacklist.join('\n'), spellcheck: false, 'aria-label': 'Blocked pages', placeholder: 'https://*.mybank.example/*' });
        ta.addEventListener('change', () => set({ blacklist: ta.value.split('\n').map((x) => x.trim()).filter(Boolean) }));
        return ta;
      })(), 'One @exclude pattern per line. Applies to every script.')),
    h('div', { class: 'card pad' }, h('h3', null, 'Trash'),
      field('Keep trashed scripts for', h('select', { 'aria-label': 'Trash retention', onChange: (e) => set({ trashDays: Number(e.target.value) }) },
        [7, 30, 90].map((v) => h('option', { value: v, selected: settings.trashDays === v }, `${v} days`)))),
      h('h3', null, 'About'),
      h('p', { class: 'muted small' }, `TamperDonkey ${status.version}. Free software under the GNU GPL v3. Based on the open-source Tampermonkey 2.9 by Jan Biniok.`))));
}

async function viewIntegrations() {
  const pending = await call('pending.list');
  const b = settings.bridge;
  const ex = settings.external;
  const input = (id, type, value, onChange, extra = {}) => h('input', { id, type, value, onChange: (e) => onChange(e.target.value.trim()), style: 'width:100%', ...extra });
  frame('integrations',
    pending.length > 0 && h('div', { class: 'card pad' }, h('h3', null, 'Waiting for your answer'),
      pending.map((p) => h('div', { class: 'row' }, h('span', { style: 'flex:1' }, h('strong', null, p.client), `: ${p.summary}`),
        h('a', { class: 'btn', href: `review.html?pending=${p.id}` }, 'Review')))),
    h('div', { class: 'grid2' },
      h('div', { class: 'card pad' }, h('h3', null, 'MCP bridge'),
        h('p', { class: 'muted small' }, 'Lets AI tools that speak MCP (Claude Code, Claude Desktop and others) list, install and run your scripts. Start the companion on this computer with ',
          h('code', null, 'npx tamperdonkey-mcp'), ' and paste the pairing token it prints.'),
        h('label', null, h('input', { type: 'checkbox', id: 'bridge-enabled', checked: b.enabled, onChange: (e) => set({ bridge: { enabled: e.target.checked } }).then(() => setTimeout(route, 600)) }), 'Connect to the companion'),
        field('Companion address', input('bridge-url', 'text', b.url, (v) => set({ bridge: { url: v } })), 'Must be on this computer (127.0.0.1).'),
        field('Pairing token', input('bridge-token', 'password', b.token, (v) => set({ bridge: { token: v } }), { autocomplete: 'off' })),
        h('div', { class: 'row' },
          h('span', { class: `pill ${status.bridge.connected ? 'ok' : b.enabled ? 'bad' : ''}`, id: 'bridge-state' }, status.bridge.connected ? 'Connected' : b.enabled ? 'Not connected' : 'Off'),
          status.bridge.error && b.enabled && h('span', { class: 'muted small' }, status.bridge.error),
          h('button', { onClick: () => guard(async () => { await call('bridge.reconnect'); setTimeout(route, 800); }) }, 'Reconnect'))),
      h('div', { class: 'card pad' }, h('h3', null, 'What outside tools may do'),
        h('p', { class: 'muted small' }, 'Applies to the MCP bridge and to the extensions listed below. Reading (list scripts, read source, list tabs, read stored values) is always allowed for them.'),
        h('label', null, h('input', { type: 'checkbox', id: 'ext-writes', checked: ex.allowWrites, onChange: (e) => set({ external: { allowWrites: e.target.checked } }) }), 'Allow changes: install, edit, enable, trash, run, set values'),
        h('label', null, h('input', { type: 'checkbox', id: 'ext-confirm', checked: ex.confirm, onChange: (e) => set({ external: { confirm: e.target.checked } }) }), 'Ask me to confirm every change'),
        h('span', { class: 'help muted small' }, 'Without confirmation, a connected tool can put code on every page you visit.'),
        field('Extensions allowed to send commands', (() => {
          const ta = h('textarea', { rows: 3, id: 'ext-ids', value: ex.extensions.join('\n'), spellcheck: false, 'aria-label': 'Allowed extension ids' });
          ta.addEventListener('change', () => set({ external: { extensions: ta.value.split('\n').map((x) => x.trim()).filter(Boolean) } }));
          return ta;
        })(), ['One extension id per line. They call ', h('code', null, `runtime.sendMessage("${api.runtime.id}", { cmd, args })`), '.'])),
      h('div', { class: 'card pad' }, h('h3', null, 'AI helper in the editor'),
        h('p', { class: 'muted small' }, 'Generate, explain and fix scripts with Claude. Uses your own API key, stored only in this browser profile. Your request and the script in the editor are sent to the API when you press a button.'),
        h('label', null, h('input', { type: 'checkbox', id: 'ai-enabled', checked: settings.ai.enabled, onChange: (e) => set({ ai: { enabled: e.target.checked } }) }), 'Show the AI helper'),
        field('API key', input('ai-key', 'password', settings.ai.apiKey, (v) => set({ ai: { apiKey: v } }), { autocomplete: 'off', placeholder: 'sk-ant-…' })),
        field('Model', input('ai-model', 'text', settings.ai.model, (v) => set({ ai: { model: v || 'claude-opus-5-5' } }))),
        field('API address (optional)', input('ai-base', 'url', settings.ai.baseUrl, (v) => set({ ai: { baseUrl: v } }), { placeholder: 'https://api.anthropic.com' }), 'Only needed when you use a gateway.'))));
}

async function viewLog() {
  const log = await call('log.list');
  frame('log',
    h('p', { class: 'muted' }, 'Everything done by outside tools and by the automatic updater.'),
    h('div', { class: 'card tablewrap' }, h('table', null,
      h('thead', null, h('tr', null, h('th', null, 'When'), h('th', null, 'Who'), h('th', null, 'What'))),
      h('tbody', null, log.length ? log.map((l) => h('tr', null,
        h('td', { class: 'num', title: new Date(l.time).toLocaleString() }, timeAgo(l.time)), h('td', null, l.by),
        h('td', null, `${l.action}${l.script ? ` "${l.script}"` : ''}${l.version ? ` (${l.version})` : ''}`)))
        : h('tr', null, h('td', { colSpan: 3, class: 'empty' }, 'Nothing yet.'))))));
}

// ---------------------------------------------------------------- routing

let current = '';
async function route() {
  const hash = location.hash.slice(1) || 'scripts';
  if (dirty && (current.startsWith('edit') || current.startsWith('new')) && hash !== current && !confirm('Leave without saving your changes?')) {
    history.replaceState(null, '', `#${current}`);
    return;
  }
  dirty = false;
  current = hash;
  settings = await call('settings.get');
  status = await call('status');
  status.pending = (await call('pending.list')).length;
  applyTheme(settings.theme);
  const [name, arg] = hash.split('/');
  if (name === 'edit' && arg) return viewEditor(arg);
  if (name === 'new') return viewEditor(null, arg ? decodeURIComponent(arg) : '');
  if (name === 'trash') return viewTrash();
  if (name === 'settings') return viewSettings();
  if (name === 'integrations') return viewIntegrations();
  if (name === 'log') return viewLog();
  return viewScripts();
}

window.addEventListener('hashchange', () => route().catch((e) => toast(e.message, 'error')));
window.addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });
route().catch((e) => { app.textContent = e.message; });
