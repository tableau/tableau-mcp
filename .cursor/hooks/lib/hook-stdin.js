'use strict';

/**
 * Decode + parse hook stdin. Claude Code on Windows often sends UTF-16 LE;
 * treating that as UTF-8 breaks JSON.parse and used to deny ALL MCP (including wiki).
 */

/**
 * @param {Buffer|string} input
 * @returns {string}
 */
function decodeHookStdin(input) {
  if (input == null) return '';
  if (typeof input === 'string') {
    // Strip UTF-8 BOM if present as character
    return input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  }
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (buf.length === 0) return '';

  // UTF-16 LE BOM
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.toString('utf16le').replace(/^\uFEFF/, '');
  }
  // UTF-16 BE BOM
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf);
    swapped.swap16();
    return swapped.toString('utf16le').replace(/^\uFEFF/, '');
  }
  // UTF-8 BOM
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.slice(3).toString('utf8');
  }
  // UTF-16 LE without BOM (NUL in odd positions for ASCII-heavy JSON)
  if (
    buf.length >= 8 &&
    buf[1] === 0 &&
    buf[3] === 0 &&
    buf[5] === 0 &&
    buf[0] !== 0
  ) {
    return buf.toString('utf16le');
  }
  return buf.toString('utf8');
}

/**
 * @param {Buffer|string} input
 * @returns {{ ok: true, value: object } | { ok: false, error: string, rawPreview: string }}
 */
function parseHookStdinJson(input) {
  const text = decodeHookStdin(input).trim();
  if (!text) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return {
      ok: false,
      error: err.message,
      rawPreview: text.slice(0, 80).replace(/[^\x20-\x7E]/g, '?'),
    };
  }
}

const STDIN_TIMEOUT_MS = 500;

/**
 * Read hook stdin once. Cursor closes the pipe in ~10 ms; the timeout is only
 * a fallback when EOF never arrives. Clear and unref the timer so it cannot
 * keep the process alive after the payload is in — that 500 ms of dead time
 * was about half of every dispatcher spawn (2026-09-09).
 *
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<Buffer>}
 */
function readStdinBuffer(opts) {
  const timeoutMs = opts && Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : STDIN_TIMEOUT_MS;
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve(Buffer.alloc(0));
      return;
    }
    const chunks = [];
    let settled = false;
    let timer;
    const onData = (c) => {
      chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.stdin.removeListener('data', onData);
      process.stdin.removeListener('end', finish);
      process.stdin.removeListener('error', finish);
      resolve(Buffer.concat(chunks));
    };
    process.stdin.on('data', onData);
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
    timer = setTimeout(finish, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
  });
}

module.exports = {
  decodeHookStdin,
  parseHookStdinJson,
  readStdinBuffer,
  STDIN_TIMEOUT_MS,
};
