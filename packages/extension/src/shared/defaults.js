export const DEFAULT_SETTINGS = {
  theme: 'auto',
  updateIntervalHours: 24,
  updateMode: 'ask', // 'ask' keeps a found update for review; 'auto' installs it
  allowHttp: false,
  trashDays: 30,
  blacklist: [],
  bridge: { enabled: false, url: 'ws://127.0.0.1:8765', token: '' },
  external: { allowWrites: false, confirm: true, extensions: [] },
  ai: { enabled: false, apiKey: '', model: 'claude-opus-5-5', baseUrl: '' }
};

export const NEW_SCRIPT_TEMPLATE = `// ==UserScript==
// @name         New script
// @namespace    https://github.com/dbugom/ScriptBurro
// @version      0.1
// @description  What does this script do?
// @match        https://example.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // Your code here...
})();
`;
