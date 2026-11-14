import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const WRITE_NOTE = ' The user may be asked to confirm this in the browser, so the call can take a while; it fails if they refuse or if changes from outside tools are turned off in TamperDonkey.';

/**
 * Builds the MCP server. Every tool is a thin wrapper around one extension command;
 * the extension decides what is allowed.
 * @param {{call: (cmd: string, args?: object, client?: string) => Promise<any>}} bridge
 */
export function createServer(bridge, { version = '0.1.0' } = {}) {
  const server = new McpServer({ name: 'tamperdonkey', version });
  const clientName = () => server.server.getClientVersion()?.name || 'client';

  const tool = (name, { title, description, input = {}, readOnly = false, destructive = false }, cmd, map = (a) => a) => {
    server.registerTool(name, {
      title,
      description,
      inputSchema: input,
      annotations: { readOnlyHint: readOnly, destructiveHint: destructive, openWorldHint: false }
    }, async (args) => {
      try {
        const result = await bridge.call(cmd, map(args), clientName());
        return { content: [{ type: 'text', text: JSON.stringify(result ?? null, null, 2) }] };
      } catch (e) {
        return { isError: true, content: [{ type: 'text', text: e.message }] };
      }
    });
  };

  const id = z.string().describe('Script id as returned by list_scripts');

  tool('status', {
    title: 'TamperDonkey status',
    description: 'Shows whether the browser extension is connected, its version, and whether the browser currently lets it run user scripts.',
    readOnly: true
  }, 'status');

  tool('list_scripts', {
    title: 'List userscripts',
    description: 'Lists installed userscripts with id, name, version, enabled state, the pages they run on and their grants. Does not include source code; use get_script for that.',
    input: { trashed: z.boolean().optional().describe('List the scripts in the trash instead of the installed ones') },
    readOnly: true
  }, 'scripts.list');

  tool('get_script', {
    title: 'Get a userscript',
    description: 'Returns one userscript including its full source code.',
    input: { id },
    readOnly: true
  }, 'scripts.get');

  tool('install_script', {
    title: 'Install a userscript',
    description: `Installs a userscript from source code or from an https URL. The source must start with a // ==UserScript== header that has @name and at least one @match. A script only gets the GM functions it lists with @grant, and GM_xmlhttpRequest only reaches hosts listed with @connect. If a script with the same @namespace and @name exists, it is replaced.${WRITE_NOTE}`,
    input: {
      source: z.string().optional().describe('Complete userscript source. Give this or url.'),
      url: z.string().url().optional().describe('Address of a .user.js file to download and install'),
      enabled: z.boolean().optional().describe('Whether the script is enabled after install (default true)')
    }
  }, 'scripts.install');

  tool('update_script', {
    title: 'Replace a userscript\'s source',
    description: `Replaces the source code of an installed userscript. Stored values and settings are kept.${WRITE_NOTE}`,
    input: { id, source: z.string().describe('Complete new source, including the header') }
  }, 'scripts.install');

  tool('set_enabled', {
    title: 'Enable or disable a userscript',
    description: `Turns a userscript on or off. Open pages must be reloaded for the change to show.${WRITE_NOTE}`,
    input: { id, enabled: z.boolean() }
  }, 'scripts.patch');

  tool('delete_script', {
    title: 'Move a userscript to the trash',
    description: `Moves a userscript to the trash. It stops running and the user can restore it from the dashboard.${WRITE_NOTE}`,
    input: { id },
    destructive: true
  }, 'scripts.trash');

  tool('list_tabs', {
    title: 'List browser tabs',
    description: 'Lists open web page tabs with id, title and address. Use the id with run_script_on_tab.',
    readOnly: true
  }, 'tabs.list');

  tool('run_script_on_tab', {
    title: 'Run a userscript on a tab now',
    description: `Runs an installed, enabled userscript once on the given tab, whatever its @match rules say.${WRITE_NOTE}`,
    input: { id, tab_id: z.number().int().describe('Tab id from list_tabs') }
  }, 'scripts.run', (a) => ({ id: a.id, tabId: a.tab_id }));

  tool('get_values', {
    title: 'Read a userscript\'s stored values',
    description: 'Returns everything a userscript saved with GM_setValue, as a JSON object.',
    input: { id },
    readOnly: true
  }, 'values.get');

  tool('set_value', {
    title: 'Set a stored value of a userscript',
    description: `Sets one value in a userscript's storage, as GM_setValue would. Open pages running the script are notified.${WRITE_NOTE}`,
    input: { id, key: z.string(), value: z.any().describe('Any JSON value') }
  }, 'values.set');

  return server;
}
