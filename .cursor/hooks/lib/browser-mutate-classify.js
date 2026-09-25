'use strict';

/**
 * Soft-gate for browser mutate / evaluate tools (Chrome DevTools + IDE Browser).
 * Navigate stays in browser-host-classify.js. Deny session-exfil patterns; else ask.
 */

const SESSION_EXFIL_RE =
  /document\.cookie|cookieStore|localStorage|sessionStorage|indexedDB|storageState|\bxox[cpsa]-|getCookie|Cookies\.get|Authorization\s*[:=]|Secure Preferences|Login Data/i;

/** Exact tool names (bare or common MCP prefixes stripped later). */
const MUTATE_EXACT = new Set([
  'evaluate_script',
  'click',
  'fill',
  'fill_form',
  'type_text',
  'press_key',
  'drag',
  'upload_file',
  'handle_dialog',
  'hover',
  'emulate',
  'select_option',
  'browser_click',
  'browser_type',
  'browser_fill',
  'browser_press_key',
  'browser_drag',
  'browser_select_option',
  'browser_hover',
  'browser_mouse_click_xy',
]);

const MUTATE_NAME_RE =
  /(evaluate_script|fill_form|type_text|press_key|upload_file|handle_dialog|mouse_click|select_option|^click$|browser_click|browser_type|browser_fill)/i;

/**
 * @param {string} toolName
 */
function normalizeToolLeaf(toolName) {
  const name = String(toolName || '');
  const parts = name.split('__');
  return (parts[parts.length - 1] || name).toLowerCase();
}

/**
 * @param {string} toolName
 */
function isBrowserMutateCall(toolName) {
  const leaf = normalizeToolLeaf(toolName);
  if (MUTATE_EXACT.has(leaf)) return true;
  if (MUTATE_NAME_RE.test(leaf)) return true;
  // Prefixed Chrome DevTools / Claude-in-Chrome mutate tools
  if (/chrome[-_]?devtools|claude[-_]?in[-_]?chrome/i.test(toolName) && MUTATE_NAME_RE.test(toolName)) {
    return true;
  }
  return false;
}

/**
 * @param {unknown} toolInput
 * @returns {string}
 */
function extractScriptBody(toolInput) {
  if (!toolInput) return '';
  if (typeof toolInput === 'string') return toolInput;
  if (typeof toolInput !== 'object') return '';
  const obj = /** @type {Record<string, unknown>} */ (toolInput);
  for (const key of ['expression', 'script', 'code', 'function', 'source', 'js']) {
    if (typeof obj[key] === 'string') return obj[key];
  }
  if (obj.arguments && typeof obj.arguments === 'object') {
    return extractScriptBody(obj.arguments);
  }
  try {
    return JSON.stringify(obj);
  } catch {
    return '';
  }
}

/**
 * @param {string} toolName
 * @param {unknown} toolInput
 * @returns {{ gated: boolean, decision?: 'deny'|'ask', reason?: string, tool?: string }}
 */
function classifyBrowserMutateCall(toolName, toolInput) {
  if (!isBrowserMutateCall(toolName)) {
    return { gated: false };
  }

  const leaf = normalizeToolLeaf(toolName);
  const body = extractScriptBody(toolInput);
  let inputBlob = body;
  try {
    inputBlob = `${body}\n${typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput || {})}`;
  } catch {
    /* keep body */
  }

  // Mechanical halt: password fields / form submit — never wait on model judgment.
  if (
    /\btype\s*[:=]\s*["']?password\b/i.test(inputBlob)
    || /input\[type\s*=\s*["']?password["']?\]/i.test(inputBlob)
    || /"type"\s*:\s*"password"/i.test(inputBlob)
  ) {
    return {
      gated: true,
      decision: 'deny',
      tool: toolName,
      reason:
        'Browser mutate denied: password field target. Operator takeover — never type credentials into the model/agent.',
    };
  }
  if (
    /button\[type\s*=\s*["']?submit["']?\]/i.test(inputBlob)
    || /\btype\s*[:=]\s*["']?submit\b/i.test(inputBlob)
    || /"type"\s*:\s*"submit"/i.test(inputBlob)
    || /\bform\s*\.\s*submit\s*\(/i.test(inputBlob)
    || /\.submit\s*\(\s*\)/.test(inputBlob)
  ) {
    return {
      gated: true,
      decision: 'deny',
      tool: toolName,
      reason:
        'Browser mutate denied: form submit / button[type=submit]. Prefer snapshot; company forms still need test/test/@servicetitan.com + Andy approval.',
    };
  }

  if (leaf === 'evaluate_script' || /evaluate_script/i.test(toolName)) {
    if (SESSION_EXFIL_RE.test(body)) {
      return {
        gated: true,
        decision: 'deny',
        tool: toolName,
        reason:
          'Browser evaluate_script denied: session/cookie/storage exfil pattern in script. Do not scrape cookies or storage.',
      };
    }
    return {
      gated: true,
      decision: 'ask',
      tool: toolName,
      reason:
        'Chrome/IDE evaluate_script requires approval (prefer take_snapshot / read). Confirm no session exfil.',
    };
  }

  return {
    gated: true,
    decision: 'ask',
    tool: toolName,
    reason: `Browser mutate tool "${leaf}" requires approval (prefer snapshot/read over click/fill/type).`,
  };
}

module.exports = {
  SESSION_EXFIL_RE,
  isBrowserMutateCall,
  classifyBrowserMutateCall,
  extractScriptBody,
  normalizeToolLeaf,
};
