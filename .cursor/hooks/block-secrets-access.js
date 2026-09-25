#!/usr/bin/env node
'use strict';

/**
 * block-secrets-access.js — refuse agent reads of credential files.
 *
 * Wired as a Claude Code PreToolUse hook (see .claude/settings.json) and as a
 * Cursor beforeReadFile hook. Exit 2 is the deny convention; exit 0 allows.
 *
 * This exists because an agent that reads a .env into its context has put your
 * credentials into a transcript, a provider's logs, and every subsequent
 * request in that session. Blocking the read is far cheaper than rotating.
 */

const BLOCKED_PATTERNS = [
  /\.env$/i,
  /\.env\..+/i,
  /\.pem$/i,
  /\.p8$/i,
  /\.pfx$/i,
  /\.key$/i,
  /\.crt$/i,
  /id_rsa/i,
  /secrets?\.json$/i,
  /credentials?\.json$/i,
  /service[_-]?account.*\.json$/i,
  /\.password$/i,
  /private[_-]key/i,
  /\.npmrc$/i,
];

// Example/template files are safe by definition and get read constantly.
const ALLOWED_PATTERNS = [/\.example$/i, /\.sample$/i, /\.template$/i, /\.env\.example/i];

function shouldBlock(target) {
  if (!target) return false;
  if (ALLOWED_PATTERNS.some((p) => p.test(target))) return false;
  return BLOCKED_PATTERNS.some((p) => p.test(target));
}

function main() {
  const toolName = process.argv[2] || 'unknown';
  const target = process.argv[3] || '';

  if (shouldBlock(target)) {
    process.stderr.write(
      `BLOCKED: ${toolName} access to ${target} (credential file).\n` +
        'Read the value from the environment at runtime instead of opening the file.\n'
    );
    process.exit(2);
  }

  process.exit(0);
}

main();
