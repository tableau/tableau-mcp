'use strict';

const { validateConfluenceBody } = require('./confluence-body-preflight.js');

/**
 * Pure helpers for Confluence MCP write gating.
 * Allowlist is MARTECH (planning/docs) plus MTT (Marketing Tiger Teams).
 * No I/O — unit-testable from scripts/test-confluence-space-gate.js.
 */

const MARTECH_SPACE_ID = '3355672712';
const MARTECH_SPACE_KEY = 'MARTECH';
const MTT_SPACE_ID = '4694048939';
const MTT_SPACE_KEY = 'MTT';

const ALLOWED_WRITE_SPACES = Object.freeze([
  { id: MARTECH_SPACE_ID, key: MARTECH_SPACE_KEY },
  { id: MTT_SPACE_ID, key: MTT_SPACE_KEY },
]);

const ALLOWED_SPACE_LABEL = 'MARTECH (3355672712) or MTT (4694048939)';

const ALLOWED_CLOUD_HOSTS = new Set([
  'servicetitan.atlassian.net',
  // UUID cloudIds also appear; host form is preferred when present.
]);

const WRITE_TOOLS = new Set([
  'createConfluencePage',
  'updateConfluencePage',
  'createConfluenceFooterComment',
  'createConfluenceInlineComment',
]);

/**
 * @param {string} toolName
 * @returns {boolean}
 */
function isConfluenceWriteTool(toolName) {
  const name = String(toolName || '');
  if (!name) return false;
  if (WRITE_TOOLS.has(name)) return true;
  // Claude / namespaced forms: mcp__plugin-atlassian-atlassian__createConfluencePage
  return WRITE_TOOLS.has(name.split('__').pop() || '');
}

/**
 * @param {unknown} toolInput
 * @returns {Record<string, unknown>}
 */
function normalizeToolInput(toolInput) {
  if (toolInput == null) return {};
  if (typeof toolInput === 'string') {
    try {
      const parsed = JSON.parse(toolInput);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? /** @type {Record<string, unknown>} */ (parsed)
        : {};
    } catch {
      return {};
    }
  }
  if (typeof toolInput === 'object' && !Array.isArray(toolInput)) {
    return /** @type {Record<string, unknown>} */ (toolInput);
  }
  return {};
}

/**
 * @param {unknown} raw
 * @returns {string}
 */
function normalizeSpaceToken(raw) {
  return String(raw == null ? '' : raw)
    .trim()
    .replace(/^~/, '');
}

/**
 * @param {unknown} spaceIdOrKey
 * @param {{ id: string, key: string }} space
 * @returns {boolean}
 */
function tokenMatchesSpace(spaceIdOrKey, space) {
  const token = normalizeSpaceToken(spaceIdOrKey);
  if (!token) return false;
  if (token === space.id) return true;
  if (token.toUpperCase() === space.key) return true;
  return false;
}

/**
 * MARTECH only. Kept for callers that need the planning-space check.
 * @param {unknown} spaceIdOrKey
 * @returns {boolean}
 */
function isMartechSpace(spaceIdOrKey) {
  return tokenMatchesSpace(spaceIdOrKey, {
    id: MARTECH_SPACE_ID,
    key: MARTECH_SPACE_KEY,
  });
}

/**
 * @param {unknown} spaceIdOrKey
 * @returns {boolean}
 */
function isMttSpace(spaceIdOrKey) {
  return tokenMatchesSpace(spaceIdOrKey, {
    id: MTT_SPACE_ID,
    key: MTT_SPACE_KEY,
  });
}

/**
 * True when spaceId/key is on the MCP write allowlist (MARTECH or MTT).
 * @param {unknown} spaceIdOrKey
 * @returns {boolean}
 */
function isAllowedWriteSpace(spaceIdOrKey) {
  return ALLOWED_WRITE_SPACES.some((space) =>
    tokenMatchesSpace(spaceIdOrKey, space)
  );
}

/**
 * @param {unknown} cloudId
 * @returns {{ ok: boolean, reason?: string }}
 */
function checkCloudId(cloudId) {
  if (cloudId == null || cloudId === '') {
    return { ok: true }; // some clients omit; space check is the hard line
  }
  const raw = String(cloudId).trim().toLowerCase();
  if (ALLOWED_CLOUD_HOSTS.has(raw)) return { ok: true };
  if (raw.includes('servicetitan.atlassian.net')) return { ok: true };
  // UUID-shaped cloud ids — allow (space gate still applies)
  if (/^[0-9a-f-]{36}$/i.test(raw)) return { ok: true };
  return {
    ok: false,
    reason: `cloudId "${cloudId}" is not servicetitan.atlassian.net / known UUID`,
  };
}

function evaluateBodyPayload(operation, input) {
  const result = validateConfluenceBody({
    operation,
    format: input.contentFormat,
    status: input.status,
    body: input.body,
  });
  if (!result.ok) {
    const codes = result.errors.map((item) => item.code).join(', ');
    return {
      decision: 'deny',
      reason: `Confluence ${operation} body preflight failed (${codes}): ${result.errors[0].message}`,
    };
  }
  if (String(input.status).toLowerCase() === 'current') {
    return {
      decision: 'ask',
      reason: `Confluence ${operation} with status current requires confirmation: the hook cannot distinguish an already-live update from first publish.`,
    };
  }
  return { decision: 'allow', reason: `${operation}_body_preflight_ok` };
}

/**
 * @param {string} toolName
 * @param {unknown} toolInput
 * @returns {{ decision: 'allow'|'deny'|'ask', reason: string }}
 */
function evaluateConfluenceWrite(toolName, toolInput) {
  if (!isConfluenceWriteTool(toolName)) {
    return { decision: 'allow', reason: 'not_confluence_write' };
  }

  const bare = (String(toolName).split('__').pop() || String(toolName)).trim();
  const input = normalizeToolInput(toolInput);
  const cloud = checkCloudId(input.cloudId);
  if (!cloud.ok) {
    return { decision: 'deny', reason: cloud.reason || 'bad_cloud' };
  }

  if (bare === 'createConfluencePage') {
    const space = input.spaceId ?? input.spaceKey ?? input.space;
    if (!isAllowedWriteSpace(space)) {
      return {
        decision: 'deny',
        reason:
          `createConfluencePage blocked: space must be ${ALLOWED_SPACE_LABEL}; ` +
          `got ${JSON.stringify(space ?? null)}`,
      };
    }
    const bodyDecision = evaluateBodyPayload('create', input);
    if (bodyDecision.decision !== 'allow') return bodyDecision;
    return { decision: 'allow', reason: 'create_allowlisted_space_body_ok' };
  }

  if (bare === 'updateConfluencePage') {
    const space = input.spaceId ?? input.spaceKey ?? input.space;
    if (space == null || space === '') {
      return {
        decision: 'deny',
        reason:
          `updateConfluencePage blocked: pass spaceId ${ALLOWED_SPACE_LABEL} — ` +
          'pageId alone is not proof of space',
      };
    }
    if (!isAllowedWriteSpace(space)) {
      return {
        decision: 'deny',
        reason:
          `updateConfluencePage blocked: space must be ${ALLOWED_SPACE_LABEL}; ` +
          `got ${JSON.stringify(space)}`,
      };
    }
    const bodyDecision = evaluateBodyPayload('update', input);
    if (bodyDecision.decision !== 'allow') return bodyDecision;
    return { decision: 'allow', reason: 'update_allowlisted_space_body_ok' };
  }

  // Comments: MCP schema has no spaceId — ask Andy (mechanical floor).
  return {
    decision: 'ask',
    reason:
      'Confluence comment: confirm the target page is in MARTECH or MTT before allowing',
  };
}

module.exports = {
  MARTECH_SPACE_ID,
  MARTECH_SPACE_KEY,
  MTT_SPACE_ID,
  MTT_SPACE_KEY,
  ALLOWED_WRITE_SPACES,
  ALLOWED_SPACE_LABEL,
  WRITE_TOOLS,
  isConfluenceWriteTool,
  normalizeToolInput,
  isMartechSpace,
  isMttSpace,
  isAllowedWriteSpace,
  checkCloudId,
  evaluateBodyPayload,
  evaluateConfluenceWrite,
};
