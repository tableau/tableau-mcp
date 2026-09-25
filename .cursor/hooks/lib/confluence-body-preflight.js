'use strict';

/**
 * Pure Confluence body validation shared by the MARTECH MCP gate and CLI.
 * No I/O. Errors are safe to hard-deny; warnings require review.
 */

const VALID_OPERATIONS = new Set(['create', 'update']);
const VALID_FORMATS = new Set(['html', 'markdown']);
const VALID_STATUSES = new Set(['draft', 'current']);

const PRIVATE_PATTERNS = [
  ['wiki-link', /\[\[[^\]]+\]\]/i, 'private wiki-link syntax'],
  ['wiki-name', /\b(?:the\s+)?wiki\b/i, 'private wiki name'],
  ['llm-wiki', /\bllm-wiki\b/i, 'private llm-wiki name'],
  ['second-brain', /\bsecond brain\b/i, 'private second-brain language'],
  ['cos-wiki', /\bCoS(?:\s+wiki)?\b/, 'private CoS language'],
  ['private-path', /(?:^|[\s"'`(])(?:wiki|raw|\.state|\.tmp)[\\/][\w.-]/im, 'private repository path'],
  ['watchtower', /\bWatchtower\b/i, 'private operator surface'],
  ['operator-queue', /\b(?:Open ideas|personal queue|Today (?:row|plate|board|tab))\b/i, 'private operator queue language'],
  ['local-pending', /\b(?:local document pending|ready locally|google drive upload is pending|draft until published)\b/i, 'local/pending artifact status'],
  ['downloads-path', /[A-Za-z]:\\Users\\[^\\\s]+\\Downloads\\/i, 'local Downloads path'],
];

// Marketer-facing Confluence bodies (MTT homes and MARTECH). IDs may live in
// hrefs; they must not appear as visible prose or operator asides.
const MARKETER_PROSE_PATTERNS = [
  ['slack-channel-id', /\bC0[A-Z0-9]{8,}\b/, 'a Slack channel ID (C0…)'],
  ['channel-id-pending', /Channel ID pending/i, 'Channel ID pending placeholder'],
  ['airtable-record-id', /\brec[A-Za-z0-9]{14}\b/, 'an Airtable record ID'],
  ['team-id-field', /team\\_id|\bteam_id\b/, 'a team_id / team\\_id field name'],
  ['drive-file-id-label', /\bfileId\b|\bfile_id\b|File ID/i, 'a Google Drive fileId label'],
  ['drive-file-id-prose', /\b1[A-Za-z0-9_-]{32,43}\b/, 'a Google Drive fileId in visible text'],
  [
    'operator-aside',
    /Automations should key off|Private with Andy as the only member|Naming pattern\s+mktg-pod/i,
    'an operator/agent aside',
  ],
];

function finding(severity, code, message) {
  return { severity, code, message };
}

function hasMetadataLabel(body, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const markdown = new RegExp(`\\*\\*${escaped}:\\*\\*\\s*\\S`, 'i');
  const html = new RegExp(`<strong>\\s*${escaped}:\\s*</strong>\\s*[^<\\s]`, 'i');
  return markdown.test(body) || html.test(body);
}

function headingLevels(body) {
  const levels = [];
  for (const match of String(body).matchAll(/^(#{1,6})\s+\S/gm)) {
    levels.push(match[1].length);
  }
  for (const match of String(body).matchAll(/<h([1-6])(?:\s[^>]*)?>/gi)) {
    levels.push(Number(match[1]));
  }
  return levels;
}

function hasHeadingSkip(levels) {
  for (let i = 1; i < levels.length; i += 1) {
    if (levels[i] - levels[i - 1] > 1) return true;
  }
  return false;
}

function bodyWordCount(body) {
  return String(body)
    .replace(/<[^>]+>/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function hasNativeTableOfContents(body) {
  for (const match of String(body).matchAll(/<div\b[^>]*>/gi)) {
    const tag = match[0];
    const isToc = /\bdata-extension-key\s*=\s*["']toc["']/i.test(tag);
    const isCoreMacro =
      /\bdata-extension-type\s*=\s*["']com\.atlassian\.confluence\.macro\.core["']/i.test(tag);
    if (isToc && isCoreMacro) return true;
  }
  return false;
}

function tableOfContentsFindings(body, existingBody) {
  const hasToc = hasNativeTableOfContents(body);
  const existingHasToc = hasNativeTableOfContents(existingBody);
  if (existingHasToc && !hasToc) {
    return [
      finding(
        'error',
        'toc-removed',
        'Updated body removes the existing native table of contents macro.'
      ),
    ];
  }
  if (!hasToc && headingLevels(body).length >= 4 && bodyWordCount(body) >= 1000) {
    return [
      finding(
        'warn',
        'toc-recommended',
        'Long, sectioned page has no native table of contents; add one for a create or substantial rewrite, or waive this warning for a surgical update.'
      ),
    ];
  }
  return [];
}

function bodyLooksLikePath(body) {
  const trimmed = String(body || '').trim();
  if (/\bFILE\s*:/i.test(trimmed)) return true;
  if (trimmed.includes('\n') || trimmed.length > 260) return false;
  return /^(?:[A-Za-z]:\\|\/|\.{1,2}[\\/])[^<>]+$/.test(trimmed);
}

function stripHttpUrls(body) {
  return String(body).replace(/https?:\/\/[^\s"'<>]+/gi, '');
}

function visibleProse(body) {
  return String(body)
    .replace(/\b(?:href|src)\s*=\s*["'][^"']*["']/gi, '')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '');
}

function marketerProseFindings(body) {
  const prose = visibleProse(body);
  return MARKETER_PROSE_PATTERNS.filter(([, pattern]) => pattern.test(prose)).map(
    ([code, , label]) => finding('error', code, `Body contains ${label}.`)
  );
}

function inventedUrlFindings(body) {
  const findings = [];
  if (/https?:\/\/(?:www\.)?(?:example\.(?:com|org|net)|localhost)\b/i.test(body)) {
    findings.push(finding('error', 'invented-url', 'Body contains an invented or placeholder URL.'));
  }
  if (/\bhref\s*=\s*["'](?:#|javascript:void\(0\))?["']/i.test(body)) {
    findings.push(finding('error', 'invented-url', 'Body contains an empty or placeholder href.'));
  }
  return findings;
}

function reportingLinkFindings(body, pageType) {
  if (String(pageType || '').toLowerCase() !== 'tt-reporting') return [];
  const hasConfirmed =
    /https?:\/\/(?:[^/\s"'<>]*tableau|docs\.google\.com\/spreadsheets)/i.test(body);
  const hasUnconfirmed = /link not confirmed yet/i.test(visibleProse(body));
  if (hasConfirmed || hasUnconfirmed) return [];
  return [
    finding(
      'error',
      'reporting-link-unconfirmed',
      'Reporting & Analytics must use a confirmed Tableau/Sheet URL or the sentence “link not confirmed yet”.'
    ),
  ];
}

function privateLeakFindings(body) {
  const findings = [];
  const prose = stripHttpUrls(body);
  for (const [code, pattern, label] of PRIVATE_PATTERNS) {
    const haystack = code === 'wiki-name' ? prose : body;
    if (pattern.test(haystack)) {
      findings.push(finding('error', code, `Body contains ${label}.`));
    }
  }
  findings.push(...marketerProseFindings(body));
  findings.push(...inventedUrlFindings(body));
  if (/https?:\/\/[^/\s]*slack\.com\/archives\/D[A-Z0-9]+/i.test(body)) {
    findings.push(finding('error', 'slack-dm-link', 'Body contains a Slack DM permalink.'));
  }
  if (/\bslack:\/\//i.test(body)) {
    findings.push(finding('error', 'slack-deep-link', 'Body contains a slack:// link. For people, use https://app.slack.com/team/{USER_ID}. For channels, name the channel in prose.'));
  }
  if (/https?:\/\/[^/\s]*slack\.com\/archives\/[CG][A-Z0-9]+/i.test(body)) {
    findings.push(finding('error', 'slack-conversation-unverified', 'Slack C/G archive URLs cannot be mechanically distinguished from MPDMs; use the channel name without a permalink.'));
  }
  if (/https?:\/\/(?:docs|drive)\.google\.com\//i.test(body)) {
    findings.push(finding('warn', 'drive-link-review', 'Verify each Drive URL is the exact shared team file named this turn.'));
  }
  return findings;
}

function metadataFindings(body, operation) {
  const labels = ['Tags', 'Type', 'Owner', 'Last reviewed', 'Review cadence'];
  return labels
    .filter((label) => !hasMetadataLabel(body, label))
    .map((label) =>
      finding(
        'warn',
        `metadata-${label.toLowerCase().replace(/\s+/g, '-')}`,
        `${operation} body is missing ${label} metadata.`
      )
    );
}

function accessibilityFindings(body) {
  const findings = [];
  if (hasHeadingSkip(headingLevels(body))) {
    findings.push(finding('warn', 'heading-skip', 'Heading hierarchy skips a level.'));
  }
  for (const match of body.matchAll(/<table(?:\s[^>]*)?>([\s\S]*?)<\/table>/gi)) {
    if (!/<th(?:\s[^>]*)?>/i.test(match[1])) {
      findings.push(finding('warn', 'table-no-header', 'HTML table has no <th> header cells.'));
      break;
    }
  }
  for (const match of body.matchAll(/<img\b[^>]*>/gi)) {
    if (!/\balt\s*=\s*["'][^"']*["']/i.test(match[0])) {
      findings.push(finding('warn', 'image-no-alt', 'Image is missing an alt attribute.'));
      break;
    }
  }
  if (/!\[\s*\]\([^)]+\)/.test(body)) {
    findings.push(finding('warn', 'image-empty-alt', 'Markdown image has empty alt text; confirm it is decorative.'));
  }
  if (/\b(?:click here|read more here)\b/i.test(body)) {
    findings.push(finding('warn', 'link-text', 'Use destination-specific link text instead of “click here”.'));
  }
  const wordCount = bodyWordCount(body);
  if (wordCount > 2500) {
    findings.push(finding('warn', 'page-too-long', `Page has about ${wordCount} words; consider splitting independent topics.`));
  }
  return findings;
}

function retentionFindings(body, existingBody) {
  if (!existingBody) return [];
  const findings = [];
  if (body.length < existingBody.length * 0.6) {
    findings.push(finding('warn', 'body-collapse', 'Updated body is under 60% of the existing body length; verify the rewrite is intentional.'));
  }
  const headings = [...String(existingBody).matchAll(/^(?:#{1,6}\s+)(.+)$/gm)]
    .map((match) => match[1].trim())
    .filter((text) => text.length >= 8)
    .slice(0, 5);
  if (headings.length && !headings.some((text) => body.includes(text))) {
    findings.push(finding('warn', 'historical-anchor-missing', 'Updated body retains none of the sampled existing headings.'));
  }
  return findings;
}

function pageTypeFindings(body, pageType) {
  if (!pageType) return [];
  const escaped = String(pageType).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const markdown = new RegExp(`\\*\\*Type:\\*\\*\\s*${escaped}\\b`, 'i');
  const html = new RegExp(`<strong>\\s*Type:\\s*</strong>\\s*${escaped}\\b`, 'i');
  return markdown.test(body) || html.test(body)
    ? []
    : [finding('warn', 'page-type-mismatch', `Body Type metadata does not match ${pageType}.`)];
}

function validateConfluenceBody(options = {}) {
  const operation = String(options.operation || '').toLowerCase();
  const format = String(options.format || '').toLowerCase();
  const status = String(options.status || '').toLowerCase();
  const body = typeof options.body === 'string' ? options.body : '';
  const existingBody = typeof options.existingBody === 'string' ? options.existingBody : '';
  const findings = [];

  if (!VALID_OPERATIONS.has(operation)) {
    findings.push(finding('error', 'operation', 'Operation must be create or update.'));
  }
  if (!VALID_FORMATS.has(format)) {
    findings.push(finding('error', 'content-format', 'contentFormat must be explicit: html or markdown.'));
  }
  if (!VALID_STATUSES.has(status)) {
    findings.push(finding('error', 'status', 'Status must be explicit: draft or current.'));
  }
  if (operation === 'update' && format && format !== 'html') {
    findings.push(finding('error', 'update-format', 'Existing-page updates must use HTML.'));
  }
  if (!body.trim()) {
    findings.push(finding('error', 'empty-body', 'Body must be a nonempty inline string.'));
  } else {
    if (bodyLooksLikePath(body)) {
      findings.push(finding('error', 'file-as-body', 'Body looks like FILE: or a filesystem path.'));
    }
    findings.push(...privateLeakFindings(body));
    findings.push(...reportingLinkFindings(body, options.pageType));
    findings.push(...metadataFindings(body, operation || 'write'));
    findings.push(...pageTypeFindings(body, options.pageType));
    findings.push(...accessibilityFindings(body));
    findings.push(...tableOfContentsFindings(body, existingBody));
    if (operation === 'update') findings.push(...retentionFindings(body, existingBody));
  }
  if (status === 'current') {
    findings.push(finding('warn', 'publish-stop-gate', 'Current-status writes require hook confirmation because the gate cannot distinguish an already-live update from first publish.'));
  }

  const errors = findings.filter((item) => item.severity === 'error');
  const warnings = findings.filter((item) => item.severity === 'warn');
  return { ok: errors.length === 0, errors, warnings, findings };
}

module.exports = {
  VALID_OPERATIONS,
  VALID_FORMATS,
  VALID_STATUSES,
  bodyLooksLikePath,
  bodyWordCount,
  hasMetadataLabel,
  hasNativeTableOfContents,
  headingLevels,
  tableOfContentsFindings,
  validateConfluenceBody,
};
