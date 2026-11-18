// Contract-shaped markdown for family full-text files.
//
// Agents already have title + URL + summary in llms.txt. Full text keeps the
// tool contract (overview, arguments, API routes, notes) and drops repetition
// and examples so the corpus stays under 1 MB.
//
// Dependency-free ESM. Node >= 18.

import { substituteVars } from './docsMarkdown.mjs';

const TOOL_CONTRACT_RE = /^## (APIs called|Required arguments|Optional arguments)\s*$/m;
const DROP_H2 = new Set(['related', 'example result', 'example results']);

const BOILERPLATE_RE = [
  /127\.0\.0\.1/,
  /loopback interface/i,
  /External Client API/,
  /\bno OAuth scopes\b/i,
  /not (?:on|from) the Tableau Cloud/i,
  /not the Tableau Cloud or Server REST API/i,
  /communicating with .+ directly rather than calling the Tableau Cloud/i,
];
const BOILERPLATE_MAX_CHARS = 450;

export function isToolContractPage(body) {
  return TOOL_CONTRACT_RE.test(String(body));
}

export function desktopSharedLede() {
  return substituteVars(
    'These tools talk to the local **%product_name% %ecapi_name%** at `http://127.0.0.1:<port>/v<x>`, authorized by a per-session bearer token over loopback. No OAuth scopes. They do not call the Tableau Cloud or Tableau Server REST API.',
  );
}

export function desktopSessionBody() {
  return substituteVars(
    'Identifier of the target %product_name% session. When omitted, the session is resolved automatically (for example, when exactly one %product_name% instance is connected or a session has been pinned).',
  );
}

function tidy(markdown) {
  return String(markdown)
    .replace(/^\s*<hr\s*\/?>\s*$/gim, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function dropH2Sections(markdown) {
  const parts = String(markdown).split(/^(?=## )/m);
  return parts
    .filter((part) => {
      const m = /^## ([^\n]+)/.exec(part);
      if (!m) return true;
      return !DROP_H2.has(m[1].trim().toLowerCase());
    })
    .join('');
}

function dropArgExamples(markdown) {
  return String(markdown).replace(/^#### Example[^\n]*\n[\s\S]*?(?=^#{1,4} |(?![\s\S]))/gm, '');
}

function splitSentences(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  return trimmed.split(/(?<=\.)(?:\s+|$)/).filter(Boolean);
}

function isBoilerplateSentence(sentence) {
  const s = sentence.trim();
  if (s.length > BOILERPLATE_MAX_CHARS) return false;
  return BOILERPLATE_RE.some((re) => re.test(s));
}

function stripDesktopApiLede(markdown) {
  return String(markdown).replace(/^## APIs called\n+([\s\S]*?)(?=^## |\s*$)/gm, (block, body) => {
    const listAt = body.search(/^- /m);
    const preamble = listAt === -1 ? body : body.slice(0, listAt);
    const rest = listAt === -1 ? '' : body.slice(listAt);
    if (!BOILERPLATE_RE.some((re) => re.test(preamble))) {
      return block;
    }
    const kept = splitSentences(preamble.replace(/\s+/g, ' '))
      .filter((s) => !isBoilerplateSentence(s))
      .join(' ')
      .trim();
    const next = kept ? `## APIs called\n\n${kept}\n\n${rest}` : `## APIs called\n\n${rest}`;
    return next;
  });
}

function compressSession(markdown) {
  return String(markdown).replace(
    /^### `session`\n[\s\S]*?(?=^(?:## |### )|(?![\s\S]))/gm,
    '### `session`\n\nOptional. Resolved automatically when omitted. Shared description is at the top of this file.\n\n',
  );
}

/**
 * Shape a normalized page body for family full-text. Non-tool pages are
 * unchanged aside from collapsing blank lines. Tool pages drop Related,
 * example sections, per-argument examples, duplicated Desktop API ledes,
 * and the repeated session paragraph.
 */
export function toContractMarkdown(body) {
  let text = dropH2Sections(String(body));
  if (isToolContractPage(body)) {
    text = dropArgExamples(text);
    text = stripDesktopApiLede(text);
    text = compressSession(text);
  }
  return `${tidy(text)}\n`;
}

export function desktopContractPreamble() {
  return [
    '## Shared Desktop contract',
    '',
    desktopSharedLede(),
    '',
    '### `session`',
    '',
    desktopSessionBody(),
    '',
  ].join('\n');
}
