import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const EXT_DIR = path.resolve(here, '../../packages/extension/dist/chrome');

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try {
    return require('playwright');
  } catch {
    // Playwright installed globally (as in the development container).
    return require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
  }
}

/** Starts Chromium with the built extension loaded and user scripts allowed. */
export async function launch({ extraExtensions = [] } = {}) {
  const { chromium } = loadPlaywright();
  const all = [EXT_DIR, ...extraExtensions].join(',');
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${all}`, `--load-extension=${all}`]
  });
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  const id = new URL(sw.url()).host;

  // Same switch a user flips on the extension's details page ("Allow User Scripts").
  const admin = await context.newPage();
  await admin.goto('chrome://extensions');
  await admin.evaluate((extensionId) => chrome.developerPrivate.updateExtensionConfiguration({ extensionId, userScriptsAccess: true }), id);
  await admin.close();

  const dashboard = await context.newPage();
  await dashboard.goto(`chrome-extension://${id}/dashboard.html`);
  const call = (cmd, args = {}) => dashboard.evaluate(async ([c, a]) => {
    const r = await chrome.runtime.sendMessage({ cmd: c, args: a });
    if (!r.ok) throw new Error(r.error);
    return r.result;
  }, [cmd, args]);
  await call('registrations.sync');
  return { context, id, dashboard, call, url: (p) => `chrome-extension://${id}/${p}` };
}

/** Local web server for test pages. `routes` maps a path to a body or a handler. */
export async function serve(routes) {
  const hits = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    hits.push({ path: u.pathname, method: req.method, headers: req.headers });
    const r = routes[u.pathname];
    if (r === undefined) {
      res.writeHead(404).end('not found');
    } else if (typeof r === 'function') {
      r(req, res, u);
    } else {
      res.writeHead(200, { 'content-type': u.pathname.endsWith('.js') ? 'text/javascript' : 'text/html' }).end(r);
    }
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const port = server.address().port;
  return { port, hits, origin: `http://127.0.0.1:${port}`, close: () => new Promise((ok) => server.close(ok)) };
}

export const PAGE = '<!doctype html><html><head><title>t</title></head><body><h1>Test page</h1><script>window.pageSecret = "from-page";</script></body></html>';

/** Reads a data-* attribute the test userscripts write on <html>, waiting until it appears. */
export async function mark(page, name, timeout = 4000) {
  try {
    await page.waitForFunction((n) => document.documentElement.dataset[n] !== undefined, name, { timeout });
  } catch {
    return undefined;
  }
  return page.evaluate((n) => document.documentElement.dataset[n], name);
}

export function freePort() {
  return new Promise((resolve) => {
    const s = http.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

export async function until(fn, timeout = 8000) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('Timed out waiting for a condition.');
    await new Promise((r) => setTimeout(r, 100));
  }
}
