// Builds dist/chrome and dist/firefox from one source tree.
import { build, transform } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const dev = process.argv.includes('--dev');

const runtime = (await transform(await fs.readFile(path.join(root, 'src/inject/runtime.inject.js'), 'utf8'), {
  minify: !dev,
  target: 'es2020'
})).code;

const PERMISSIONS = [
  'storage', 'unlimitedStorage', 'tabs', 'alarms', 'notifications', 'contextMenus',
  'webNavigation', 'clipboardWrite'
];
// Requested only when a script that uses GM_cookie or GM_download is installed.
const OPTIONAL = ['cookies', 'downloads'];

function manifest(target) {
  const m = {
    manifest_version: 3,
    name: 'ScriptBurro',
    version: pkg.version,
    description: 'Open-source userscript manager with an MCP bridge for AI tools.',
    icons: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' },
    action: { default_title: 'ScriptBurro', default_popup: 'popup.html', default_icon: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png' } },
    options_ui: { page: 'dashboard.html', open_in_tab: true },
    host_permissions: ['<all_urls>']
  };
  if (target === 'chrome') {
    m.minimum_chrome_version = '135';
    m.permissions = [...PERMISSIONS, 'userScripts'];
    m.optional_permissions = OPTIONAL;
    m.background = { service_worker: 'background.js' };
  } else {
    // Firefox only offers userScripts as an optional permission the user grants at runtime.
    m.permissions = PERMISSIONS;
    m.optional_permissions = ['userScripts', ...OPTIONAL];
    m.background = { scripts: ['background.js'] };
    m.browser_specific_settings = {
      gecko: {
        id: 'scriptburro@dbugom.github.io',
        strict_min_version: '142.0',
        data_collection_permissions: { required: ['none'] }
      }
    };
  }
  return m;
}

async function copyDir(from, to) {
  await fs.mkdir(to, { recursive: true });
  for (const e of await fs.readdir(from, { withFileTypes: true })) {
    if (e.isDirectory()) await copyDir(path.join(from, e.name), path.join(to, e.name));
    else await fs.copyFile(path.join(from, e.name), path.join(to, e.name));
  }
}

for (const target of ['chrome', 'firefox']) {
  const out = path.join(root, 'dist', target);
  await fs.rm(out, { recursive: true, force: true });
  await copyDir(path.join(root, 'static'), out);
  await build({
    entryPoints: {
      background: path.join(root, 'src/background/index.js'),
      dashboard: path.join(root, 'src/ui/dashboard.js'),
      popup: path.join(root, 'src/ui/popup.js'),
      review: path.join(root, 'src/ui/review.js')
    },
    outdir: out,
    bundle: true,
    format: 'iife',
    target: ['chrome120', 'firefox136'],
    minify: !dev,
    sourcemap: dev ? 'inline' : false,
    legalComments: 'none',
    define: {
      __TD_RUNTIME__: JSON.stringify(runtime),
      __TD_VERSION__: JSON.stringify(pkg.version),
      __TD_TARGET__: JSON.stringify(target)
    },
    logLevel: 'warning'
  });
  await fs.writeFile(path.join(out, 'manifest.json'), JSON.stringify(manifest(target), null, 2));
  await fs.copyFile(path.join(root, '../../LICENSE'), path.join(out, 'LICENSE'));
}
console.log(`Built ScriptBurro ${pkg.version} -> dist/chrome, dist/firefox`);
