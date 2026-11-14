import Anthropic from '@anthropic-ai/sdk';
import { extractCode } from './ai-extract.js';

/**
 * Optional AI helper for the editor. It is off until the user enables it and stores
 * their own API key. Requests go straight from this page to the Claude API; the result
 * is only shown to the user, who decides whether to put it in the editor.
 */
const SYSTEM = `You help write userscripts for TamperDonkey, a userscript manager for Chrome and Firefox (Manifest V3).

Rules of this manager that differ from older managers:
- A script must start with a // ==UserScript== metadata block with @name, @version and at least one @match.
- A script only receives the GM functions it lists with @grant. With "@grant none" (or no @grant) it runs in the page's own JavaScript world and has no GM functions.
- With any other @grant the script runs in an isolated world: it shares the DOM with the page but not the page's JavaScript variables, and unsafeWindow is that isolated window.
- GM_xmlhttpRequest and GM_download only reach hosts listed with @connect, and only over https.
- Available: GM_addStyle, GM_addElement, GM_getValue, GM_setValue, GM_deleteValue, GM_listValues, GM_addValueChangeListener, GM_registerMenuCommand, GM_openInTab, GM_xmlhttpRequest, GM_download, GM_notification, GM_setClipboard, GM_getResourceText, GM_getResourceURL, GM_getTab, GM_saveTab, GM_cookie, GM_info, and the promise forms under GM.*.
- Prefer narrow @match patterns and the fewest grants that do the job.`;

const TASKS = {
  generate: (input) => `Write a complete userscript for this request. Answer with one \`\`\`javascript code block that contains the whole script, then at most three short sentences on what it does and which permissions it uses.\n\nRequest:\n${input.prompt}${input.source.trim() ? `\n\nCurrent editor content, for context:\n\`\`\`javascript\n${input.source}\n\`\`\`` : ''}`,
  explain: (input) => `Explain what this userscript does in plain language: where it runs, what it changes on the page, what data it stores or sends and to which hosts, and anything a careful user should check before installing it.\n\n\`\`\`javascript\n${input.source}\n\`\`\``,
  fix: (input) => `This userscript has a problem. Find the cause and answer with one \`\`\`javascript code block that contains the whole corrected script, then a short explanation of the change.\n\nProblem description or error message:\n${input.prompt || '(none given: review the script for bugs)'}\n\n\`\`\`javascript\n${input.source}\n\`\`\``
};

/**
 * @param {{apiKey: string, model: string, baseUrl: string}} cfg
 * @param {'generate'|'explain'|'fix'} task
 * @param {{prompt: string, source: string}} input
 * @param {(delta: string) => void} onText called with each piece of the answer
 * @param {AbortSignal} signal
 * @returns {Promise<{text: string, code: string|null}>}
 */
export async function runAi(cfg, task, input, onText, signal) {
  if (!cfg.apiKey) throw new Error('Add your API key under Integrations first.');
  const client = new Anthropic({
    apiKey: cfg.apiKey,
    baseURL: cfg.baseUrl || undefined,
    // The key belongs to the person using this page and never leaves their browser profile.
    dangerouslyAllowBrowser: true
  });
  try {
    const stream = client.beta.messages.stream({
      model: cfg.model || 'claude-opus-5-5',
      max_tokens: 64000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      messages: [{ role: 'user', content: TASKS[task](input) }]
    }, { signal });
    stream.on('text', onText);
    const message = await stream.finalMessage();
    if (message.stop_reason === 'refusal') throw new Error('The model declined this request.');
    const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    if (message.stop_reason === 'max_tokens') return { text: `${text}\n\n[The answer was cut off because it reached the length limit.]`, code: null };
    return { text, code: extractCode(text) };
  } catch (e) {
    if (e instanceof Anthropic.APIUserAbortError) throw new Error('Stopped.');
    if (e instanceof Anthropic.AuthenticationError) throw new Error('The API key was rejected. Check it under Integrations.');
    if (e instanceof Anthropic.PermissionDeniedError) throw new Error('This API key may not use the selected model.');
    if (e instanceof Anthropic.NotFoundError) throw new Error(`The model "${cfg.model}" was not found. Check the model name under Integrations.`);
    if (e instanceof Anthropic.RateLimitError) throw new Error('Rate limited by the API. Try again in a moment.');
    if (e instanceof Anthropic.APIConnectionError) throw new Error('Could not reach the API. Check your connection and the base URL.');
    if (e instanceof Anthropic.APIError) throw new Error(`API error ${e.status}: ${e.message}`);
    throw e;
  }
}
