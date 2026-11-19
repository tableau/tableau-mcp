// Minimal build-time string-variable substitution for Markdown/MDX content.
//
// Single source of truth for content variables. Author a slug in the form
// `%variable_name%` anywhere in a page — prose, inline/fenced code, link URLs,
// and front matter — and it is replaced with the value below at build time.
// Percent delimiters are used (not `{{ }}`) because braces are interpreted as
// JSX expressions in MDX; `%…%` is inert text that survives parsing.
//
// Substitution runs in three places so no path can leak a raw slug:
// - `markdown.preprocessor` (raw MDX, including backticks)
// - `markdown.parseFrontMatter` (OG/meta excerpt — never sees remark)
// - this remark plugin (text, inlineCode, code, and link URLs)
export const VARIABLES = {
  product_name: 'Tableau Studio',
  ecapi_name: 'External Client API',
  ecapi_tools_name: 'Desktop Tools',
  // Upcoming named release. Author `%coming_release%` in prose that names it
  // (never a hardcoded "2026.3.1" or "September 2026 (2026.3.1)").
  coming_release: 'November 2026 (2026.3.1)',
};

const TOKEN = /%([a-zA-Z0-9_]+)%/g;

/**
 * Replace known `%token%` slugs. Unknown tokens are left unchanged.
 * @param {unknown} value
 * @returns {string}
 */
export function substituteVariables(value) {
  return String(value).replace(TOKEN, (match, key) =>
    Object.prototype.hasOwnProperty.call(VARIABLES, key) ? VARIABLES[key] : match,
  );
}

/**
 * @param {object} node
 * @returns {void}
 */
function walk(node) {
  // Prose text nodes (e.g. `%product_name%`).
  if (node.type === 'text' && typeof node.value === 'string') {
    node.value = substituteVariables(node.value);
  }
  // Inline and fenced code keep the slug as a literal unless we rewrite `value`
  // here — Docusaurus excerpt/meta also strip backticks but keep the inner text.
  if ((node.type === 'inlineCode' || node.type === 'code') && typeof node.value === 'string') {
    node.value = substituteVariables(node.value);
  }
  // Link/image URLs are a separate `url` field, not a text child — cover them so a
  // wording slug works inside a link target. Env-aware sibling-docs URLs use
  // `ext://site/path` (see remark/extLinks.mjs), not a %url% variable.
  if (
    (node.type === 'link' || node.type === 'image' || node.type === 'definition') &&
    typeof node.url === 'string'
  ) {
    node.url = substituteVariables(node.url);
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      walk(child);
    }
  }
}

export default function remarkVariables() {
  return (tree) => {
    walk(tree);
  };
}
