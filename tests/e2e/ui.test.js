import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, serve, PAGE, mark } from './helpers.mjs';

let b;
let web;
let version = '1.0';
const aiRequests = [];

const GENERATED = '// ==UserScript==\n// @name AI made this\n// @version 0.1\n// @match https://example.org/*\n// @grant none\n// ==/UserScript==\ndocument.title = "hi";\n';

function sse(res, events) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' });
  for (const e of events) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
  res.end();
}

before(async () => {
  web = await serve({
    '/': PAGE,
    '/up.user.js': (req, res) => {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end(`// ==UserScript==\n// @name Updatable\n// @namespace e2e\n// @version ${version}\n// @match http://127.0.0.1/*\n// @grant none\n// ==/UserScript==\ndocument.documentElement.dataset.up = '${version}';\n`);
    },
    // Stand-in for the Claude Messages API (streaming).
    '/v1/messages': (req, res) => {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST' });
        return res.end();
      }
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        aiRequests.push({ headers: req.headers, body: JSON.parse(body) });
        const text = `Sure.\n\`\`\`javascript\n${GENERATED}\`\`\`\nIt sets the page title.`;
        sse(res, [
          { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } },
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(0, 20) } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(20) } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 40 } },
          { type: 'message_stop' }
        ]);
      });
    }
  });
  b = await launch();
  await b.call('settings.set', { patch: { allowHttp: true } });
});

after(async () => {
  await b?.context.close();
  await web?.close();
});

test('write a new script in the editor, save it, find it, trash and restore it', async () => {
  const p = b.dashboard;
  await p.goto(b.url('dashboard.html#new'));
  await p.reload();
  await p.locator('.cm-content').waitFor();
  await p.getByRole('button', { name: 'Save' }).click();
  await p.waitForURL(/#edit\//);
  await p.getByRole('tab', { name: 'Storage' }).waitFor();
  assert.equal((await b.call('scripts.list'))[0].name, 'New script');

  await p.goto(b.url('dashboard.html#scripts'));
  await p.getByRole('link', { name: 'New script', exact: true }).first().waitFor();
  await p.getByRole('searchbox', { name: 'Search scripts' }).fill('no such thing');
  await p.getByText('No script matches the search.').waitFor();
  await p.getByRole('searchbox', { name: 'Search scripts' }).fill('example.com');
  await p.locator('tbody .sname').waitFor();

  await p.getByRole('button', { name: 'Move New script to trash' }).click();
  await p.getByText('No scripts installed yet.').waitFor();
  await p.getByRole('link', { name: 'Trash' }).click();
  await p.getByRole('button', { name: 'Restore' }).click();
  await p.getByText('The trash is empty.').waitFor();
  assert.equal((await b.call('scripts.list')).length, 1);
});

test('the storage tab edits a script\'s saved values', async () => {
  const [s] = await b.call('scripts.list');
  const p = b.dashboard;
  await p.goto(b.url(`dashboard.html#edit/${s.id}`));
  await p.reload();
  await p.getByRole('tab', { name: 'Storage' }).click();
  await p.getByRole('textbox', { name: 'Key', exact: true }).fill('colour');
  await p.getByRole('textbox', { name: 'Value of new key' }).fill('"green"');
  await p.getByRole('button', { name: 'Save' }).last().click();
  await p.getByRole('textbox', { name: 'Value of colour' }).waitFor();
  assert.deepEqual(await b.call('values.get', { id: s.id }), { colour: 'green' });
});

test('an update is held for review and installed only after the user accepts the diff', async () => {
  const s = await b.call('scripts.install', { url: `${web.origin}/up.user.js` });
  assert.equal(s.version, '1.0');
  version = '2.0';
  const found = await b.call('scripts.checkUpdates', { id: s.id });
  assert.deepEqual(found.map((f) => [f.version, f.installed]), [['2.0', false]]);
  // Not installed yet: the page still gets version 1.0.
  const page = await b.context.newPage();
  await page.goto(`${web.origin}/`);
  assert.equal(await mark(page, 'up'), '1.0');

  const p = b.dashboard;
  await p.goto(b.url(`review.html?update=${s.id}`));
  await p.getByRole('heading', { name: 'Update "Updatable" to 2.0?' }).waitFor();
  assert.equal(await p.locator('.diff .add').count(), 2);
  assert.equal(await p.locator('.diff .del').count(), 2);
  await p.getByRole('button', { name: 'Update', exact: true }).click();
  await p.getByRole('heading', { name: 'Script updated' }).waitFor();
  await page.reload();
  assert.equal(await mark(page, 'up'), '2.0');
  await page.close();
});

test('backup export and import round trip, including stored values', async () => {
  const data = await b.call('backup.export');
  assert.equal(data.scripts.length, 2);
  for (const s of await b.call('scripts.list')) {
    await b.call('scripts.trash', { id: s.id });
    await b.call('scripts.purge', { id: s.id });
  }
  assert.equal((await b.call('scripts.list')).length, 0);
  const r = await b.call('backup.import', { scripts: data.scripts });
  assert.deepEqual(r.failed, []);
  const back = await b.call('scripts.list');
  assert.deepEqual(back.map((s) => s.name).sort(), ['New script', 'Updatable']);
  const restored = back.find((s) => s.name === 'New script');
  assert.deepEqual(await b.call('values.get', { id: restored.id }), { colour: 'green' });
});

test('the AI helper streams an answer and only fills the editor when asked', async () => {
  await b.call('settings.set', { patch: { ai: { enabled: true, apiKey: 'sk-ant-api03-test', baseUrl: web.origin } } });
  const p = b.dashboard;
  await p.goto(b.url('dashboard.html#new'));
  await p.reload();
  await p.getByRole('textbox', { name: 'Request for the AI helper' }).fill('Set the page title to hi on example.org');
  await p.getByRole('button', { name: 'Generate script' }).click();
  await p.getByText('It sets the page title.').waitFor();
  // The draft is offered, not applied.
  assert.ok(!(await p.locator('.cm-content').innerText()).includes('AI made this'));
  await p.getByRole('button', { name: 'Put this script in the editor' }).click();
  assert.ok((await p.locator('.cm-content').innerText()).includes('AI made this'));
  assert.equal((await b.call('scripts.list')).some((s) => s.name === 'AI made this'), false);

  const sent = aiRequests.at(-1);
  assert.ok([sent.headers['x-api-key'], sent.headers.authorization].some((v) => v?.includes('sk-ant-api03-test')), 'the key is sent as a credential header');
  assert.equal(sent.body.model, 'claude-opus-5-5');
  assert.equal(sent.body.stream, true);
  assert.deepEqual(sent.body.thinking, { type: 'adaptive' });
  assert.equal(sent.body.fallbacks, 'default');
  assert.match(sent.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.match(sent.body.messages[0].content, /Set the page title to hi/);
});
