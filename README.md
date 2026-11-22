# ScriptBurro

An open-source userscript manager for Chrome and Firefox (Manifest V3), with an MCP bridge so AI tools can manage your scripts.

ScriptBurro starts from the last open-source release of Tampermonkey (version 2.9, GPLv3, by Jan Biniok). That code targets browser APIs that no longer exist, so the extension here is a rewrite: the metadata parser and URL matching are ported, everything else is new. It is not affiliated with Tampermonkey.

## What it does

- Installs, edits, enables, disables and updates userscripts.
- Runs them through the browser's `userScripts` API.
- Enforces `@grant` and `@connect`: a script gets only the GM functions it asks for, and can only send requests to the hosts it lists.
- Shows a review page before every install and update, with the permissions in plain words and a diff against the installed version.
- Keeps each script's stored values separate, with an editor for them.
- Dashboard with search, tags, bulk actions, trash with restore, zip export and import, dark theme.
- MCP server (`scriptburro-mcp`) and a message API for other extensions.
- Optional AI helper in the editor (generate, explain, fix), using your own Claude API key.

## Build

Needs Node.js 20 or newer.

```bash
npm install
```

```bash
npm run build
```

The builds land in `packages/extension/dist/chrome` and `packages/extension/dist/firefox`.

### Load it in Chrome (135 or newer), Edge, Brave

1. Open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked** and pick `packages/extension/dist/chrome`.
2. Open the extension's **Details** page and turn on **Allow User Scripts**. Until you do, the dashboard shows a banner and no script runs.

### Load it in Firefox (142 or newer)

1. Open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on** and pick `packages/extension/dist/firefox/manifest.json`.
2. Open the ScriptBurro dashboard and use the two buttons in the banner to allow user scripts and access to web pages.

The Firefox build passes Mozilla's add-on linter. It has not been run in Firefox yet; see [Status](#status).

## Userscript support

Metadata: `@name @namespace @version @description @author @match @include @exclude @exclude-match @require @resource @grant @connect @run-at @noframes @updateURL @downloadURL @homepageURL @supportURL @icon @antifeature @inject-into`.

`@run-at`: `document-start`, `document-body`, `document-end`, `document-idle`, `context-menu`.

Functions, each also available in promise form under `GM.*`:

`GM_addStyle`, `GM_addElement`, `GM_getValue`, `GM_setValue`, `GM_deleteValue`, `GM_listValues`, `GM_getValues`, `GM_setValues`, `GM_deleteValues`, `GM_addValueChangeListener`, `GM_removeValueChangeListener`, `GM_registerMenuCommand`, `GM_unregisterMenuCommand`, `GM_openInTab`, `GM_xmlhttpRequest`, `GM_download`, `GM_notification`, `GM_setClipboard`, `GM_getResourceText`, `GM_getResourceURL`, `GM_getTab`, `GM_saveTab`, `GM_getTabs`, `GM_cookie`, `GM_log`, `GM_info`, and `window.onurlchange`.

### Toolbar badge

`GM.setBadge(text)` or `GM.setBadge({ text, title, color })` shows a short status (up to 4 characters) on the ScriptBurro toolbar icon for the tab the script runs in; `title` appears in the icon's tooltip and in the popup. `GM_setBadge` is the same function. It needs no `@grant`, works in page-world scripts too, and is cleared when the tab navigates. Only the top frame can set it. Other managers do not have this function, so guard the call: `if (typeof GM !== 'undefined' && GM.setBadge) GM.setBadge('3');`

### Differences from other managers

- **No `@grant`, or `@grant none`**: the script runs in the page's own JavaScript world and gets no GM functions except `GM_info`.
- **Any other `@grant`**: the script runs in an isolated world. It shares the DOM with the page but not the page's JavaScript variables, and `unsafeWindow` is that isolated window. A script that needs page variables must use `@grant none`.
- **`GM_xmlhttpRequest` and `GM_download`** only reach hosts listed in `@connect` (plus hosts you add in the script's settings), and only over https unless you allow http in Settings. A redirect to a host outside `@connect` is followed by the browser, but its response is withheld from the script. `onprogress` is not reported, and headers the browser reserves (`Cookie`, `Origin`, `Referer`, `User-Agent`) cannot be set.
- **`GM_cookie`** is limited to the page the script runs on and does not show HttpOnly cookies.
- **`GM_cookie` and `GM_download`** need the browser's optional `cookies` and `downloads` permissions. ScriptBurro asks for them when you install or save a script that uses these functions; you can also allow them later on the script's Settings tab.
- **`@require` and `@resource`** are downloaded at install time. A `#sha256=…` (or sha384, sha512) suffix is verified.
- **`.tld`** in `@include` uses an approximation, not the full public-suffix list.

## MCP: let AI tools manage scripts

A browser extension cannot open a port, so a small companion runs on your computer. MCP clients talk to the companion; the extension connects to it.

1. Add the companion to your MCP client. For Claude Code, from this repository:

   ```bash
   claude mcp add scriptburro -- node /absolute/path/to/packages/mcp/src/cli.js
   ```

   Any client that takes a command works the same way. For clients that want a URL, run `node packages/mcp/src/cli.js --http` and use `http://127.0.0.1:8766/mcp` with the pairing token as a Bearer token.

2. Get the pairing token:

   ```bash
   node packages/mcp/src/cli.js --token
   ```

3. In the browser, open ScriptBurro > **Integrations**, turn on **Connect to the companion** and paste the token.

Tools: `status`, `list_scripts`, `get_script`, `install_script`, `update_script`, `set_enabled`, `delete_script`, `list_tabs`, `run_script_on_tab`, `get_values`, `set_value`.

Reading works once paired. Changing anything needs **Allow changes** in Integrations, and while **Ask me to confirm every change** is on, each change opens a review page in the browser and waits for you. Everything an outside tool does is listed under **Activity**.

The companion listens on `127.0.0.1` only, refuses connections that come from web pages, and requires the token from every caller.

## Use from another extension

Add the other extension's id under Integrations, then from that extension:

```js
const reply = await chrome.runtime.sendMessage(SCRIPTBURRO_ID, { cmd: 'scripts.list', args: {} });
// reply is { ok: true, result } or { ok: false, error }
```

Commands: `status`, `scripts.list`, `scripts.get`, `tabs.list`, `values.get` (read) and `scripts.install`, `scripts.patch`, `scripts.trash`, `scripts.run`, `values.set` (change). The same permission and confirmation rules as MCP apply.

## Development

```bash
npm run lint
```

```bash
npm test
```

```bash
npm run test:e2e
```

`npm test` runs the unit tests. `npm run test:e2e` builds nothing itself: run `npm run build` first. It drives a real Chromium with the extension loaded and needs Playwright with Chromium available.

Layout:

- `packages/core`: metadata parser, URL matching, grant and connect rules. No browser APIs.
- `packages/extension`: the extension. `src/background` (service worker), `src/inject` (code that runs with each userscript), `src/ui` (dashboard, popup, review page).
- `packages/mcp`: the `scriptburro-mcp` companion.
- `tests/e2e`: browser tests.

## Publishing to the Chrome Web Store

```bash
npm run package
```

This builds both targets and writes `packages/extension/dist/scriptburro-chrome-<version>.zip` (and the Firefox one). Everything else the store asks for is in `store/chrome/`: `listing.md` has the listing text, a justification for each permission, the remote-code answer and the reviewer test steps, next to five 1280x800 screenshots and the 440x280 promo tile. `node store/chrome/make-images.mjs` regenerates the images. The privacy policy is `PRIVACY.md`.

Publishing needs a Chrome Web Store developer account (one-time registration fee, 2-step verification on the Google account). In the Developer Dashboard choose **Add new item**, upload the zip, fill the Store listing, Privacy, Distribution and Test instructions tabs from `listing.md`, then **Submit for review**.

## Status

Version 0.1.0. Verified by automated tests in Chromium: install, matching, isolation, storage, requests, menu commands, updates, trash, backup, the MCP flow and the other-extension API.

Not verified yet:

- Running in Firefox. The build is linted only.
- The AI helper against the real Claude API. It is tested against a stand-in server.
- `GM_notification`, `GM_download` and `GM_setClipboard` have no automated test.

Not built yet: cloud backup, script search on Greasy Fork, translations (the interface is English only), per-script update intervals.

## Licence and credits

GPL-3.0-or-later. See `LICENSE`.

`packages/core/src/parser.js` and `packages/core/src/match.js` are derived from `src/parser.js` and `src/helper.js` of Tampermonkey 2.9, copyright Jan Biniok, GPLv3 (source: https://github.com/Tampermonkey/tampermonkey, commit `cdfc253` in the fork `dbugom/tampermonkey`).
