# Chrome Web Store listing kit

Copy these into the Developer Dashboard. Sizes and field names were checked against the Chrome Web Store documentation on 14 November 2026.

Upload file: `packages/extension/dist/scriptburro-chrome-<version>.zip` (made by `npm run package`).

## Store listing tab

**Name** (from the manifest): ScriptBurro

**Summary** (from the manifest description, 132 characters max):

> Open-source userscript manager with an MCP bridge for AI tools.

**Category:** Developer Tools

**Language:** English

**Description:**

```
ScriptBurro installs and runs userscripts: small programs that change how the websites you choose look and behave.

IMPORTANT: after installing, open chrome://extensions, click Details on ScriptBurro and turn on "Allow User Scripts". Chrome requires this switch before any userscript manager can run scripts. The dashboard reminds you until it is on.

What you get
• A review page before every install and every update. It shows where the script runs, what it is allowed to do, and the exact changes since the version you have.
• Real permissions. A script only gets the functions it asks for with @grant, and can only contact the hosts it lists with @connect.
• Separate storage for each script, with an editor to see and change the saved values.
• A dashboard with search, tags, bulk actions, a code editor, trash with restore, and zip backup and restore.
• Light and dark theme.

For developers and AI tools
• MCP bridge: with the free companion program, AI tools that speak the Model Context Protocol can list, install and run your scripts. It is off by default, works only on your own computer, and can ask you to confirm every change.
• Optional AI helper in the editor that drafts, explains and fixes scripts with your own Claude API key.

Privacy
No account, no analytics, no ads. Your scripts and their data stay in your browser. See the privacy policy for the few cases where the extension contacts the network.

Compatibility
Supports the common userscript header keys and the GM_* functions, including the GM.* promise forms. Scripts that use @grant run isolated from the page; scripts that need the page's own JavaScript variables should use "@grant none".

Open source under the GNU GPL v3: https://github.com/dbugom/TamperDonkey
```

**Images** (in this folder):

| File | Use | Size |
|---|---|---|
| `screenshot-1-dashboard.png` | Screenshot | 1280x800 |
| `screenshot-2-review.png` | Screenshot | 1280x800 |
| `screenshot-3-editor.png` | Screenshot | 1280x800 |
| `screenshot-4-storage.png` | Screenshot | 1280x800 |
| `screenshot-5-integrations.png` | Screenshot | 1280x800 |
| `promo-small-440x280.png` | Small promotional image | 440x280 |

The store icon (128x128) is taken from the zip.

## Privacy tab

**Single purpose:**

> ScriptBurro manages and runs userscripts that the user installs, on the web pages those scripts name.

**Permission justifications:**

| Permission | Justification |
|---|---|
| `userScripts` | Core function: registers and runs the userscripts the user installed, through the User Scripts API. |
| Host permission `<all_urls>` | Users choose which sites their scripts run on, and a script may name any site in @match. The extension also downloads script files and their @require files from the addresses the user provides, and performs GM_xmlhttpRequest for scripts to the hosts they list in @connect. |
| `storage` | Stores the installed scripts, their saved values and the extension settings on the device. |
| `unlimitedStorage` | Userscripts and their bundled libraries can exceed the default storage quota. |
| `tabs` | Reads the address of the active tab to show which installed scripts apply to it in the popup, opens tabs for scripts that call GM_openInTab, and lists tabs for the "run on tab" feature. |
| `webNavigation` | Detects when the user opens a link ending in .user.js so the install review page can be shown, and clears per-page script menu commands when a page navigates. |
| `alarms` | Schedules the periodic check for script updates and housekeeping of the trash. |
| `notifications` | Shows a desktop notification when an installed script calls GM_notification. |
| `contextMenus` | Adds a context-menu entry for scripts declared with "@run-at context-menu". |
| `clipboardWrite` | Lets an installed script copy text with GM_setClipboard. |
| `cookies` (optional) | Requested only when the user installs a script that uses GM_cookie. Limited to cookies of the page the script runs on; HttpOnly cookies are not exposed. |
| `downloads` (optional) | Requested only when the user installs a script that uses GM_download. |

**Remote code:** choose **Yes, I am using remote code**.

> Justification: ScriptBurro is a userscript manager. The userscripts a user installs are executed only through the chrome.userScripts API, which the Chrome Web Store policy names as a permitted way to run such code. The extension's own logic is fully contained in the package; it loads no remote scripts for itself.

**Data usage:** my reading is that none of the listed data types is collected, because the extension sends nothing to the developer or to any service the developer runs. Read each checkbox yourself before certifying; you are the one making the declaration. Two behaviours to keep in mind while you do:

- the optional AI helper sends the text the user types and the script in the editor to the Claude API, with the user's own key, when the user presses a button;
- installed userscripts are third-party code and can send data to the hosts they declare.

Tick the three certification boxes only if they are true for you (no selling of data, no use unrelated to the single purpose, no use for creditworthiness or lending).

**Privacy policy URL:** `https://github.com/dbugom/TamperDonkey/blob/main/PRIVACY.md`

This link only works for reviewers if the repository is public. If it is private, publish `PRIVACY.md` somewhere public (for example GitHub Pages) and use that address.

## Distribution tab

- Free, all regions.
- Visibility: **Unlisted** or **Private** for the first submission, then switch to Public once it is approved and you have tried the store build yourself.

## Test instructions tab

```
No account is needed.
1. After installing, open chrome://extensions > ScriptBurro > Details and turn on "Allow User Scripts".
2. Open the ScriptBurro dashboard (extension icon > Dashboard) and click "New script". Change the @match line to https://example.com/* and add the line: document.title = 'ScriptBurro works';  Click Save.
3. Open https://example.com/ . The tab title changes to "ScriptBurro works".
The MCP bridge and the AI helper are optional, off by default, and need software or an API key from the user; they are not required to test the extension.
```

## Before you press Submit

- Decide on the name. "ScriptBurro" is close to the name of an existing store extension; a different name avoids a possible impersonation or trademark complaint.
- Try `GM_notification`, `GM_download` and `GM_setClipboard` by hand; they have no automated test.
