# ScriptBurro privacy policy

Last updated: 14 November 2026

ScriptBurro is a browser extension that manages and runs userscripts you install. It has no server of its own, no account, no analytics and no advertising. The developer receives no data from it.

## What is stored, and where

Everything is kept in the extension's storage inside your browser profile, on your device:

- the userscripts you install and their settings;
- data those scripts save with `GM_setValue`;
- your ScriptBurro settings, including the MCP pairing token and, if you enter one, your Claude API key;
- a log of actions taken by outside tools and by the automatic updater.

Removing the extension deletes all of it. The export function writes a backup file only where you choose to save it.

## When the extension contacts the network

The extension makes a network request only in these cases:

| When | Where the request goes | What is sent |
|---|---|---|
| You install a script from a link, or a script lists `@require` or `@resource` files | The address in the link or in the script | A normal download request, without your cookies |
| Update check (can be turned off in Settings) | The update address named by each installed script | A normal download request, without your cookies |
| You turn on the MCP bridge | `127.0.0.1` on your own computer only | Commands and results exchanged with the companion program you started |
| You turn on the AI helper and press one of its buttons | The Claude API (`api.anthropic.com`, or the address you set) | Your request text, the script in the editor, and your API key |

The AI helper and the MCP bridge are off until you turn them on.

## What userscripts can do

A userscript is code written by a third party that you chose to install. It runs on the pages named in its header. Depending on the permissions shown on the review page before you install it, a script can read and change those pages, store data, and send requests to the hosts it lists under `@connect`. ScriptBurro limits each script to what its header declares, but it cannot vouch for what a script's author does with the data. Install scripts only from authors you trust.

## Browser permissions

- Access to all sites: needed so your scripts can run on the pages they name. ScriptBurro itself does not read page content.
- User scripts: runs the scripts you install.
- Tabs and web navigation: finds which scripts apply to the current page and opens the review page when you open a `.user.js` link.
- Storage: keeps scripts and settings on your device.
- Alarms: schedules update checks.
- Notifications, context menus, clipboard write: used only when a script you installed asks for them.
- Cookies and downloads (optional): requested only when you install a script that uses `GM_cookie` or `GM_download`.

## Changes and contact

Changes to this policy are published in this file. Questions and reports: https://github.com/dbugom/TamperDonkey/issues
