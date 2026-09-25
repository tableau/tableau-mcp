'use strict';

/**
 * Pure helpers for Drive MCP mutate gating (ask, not deny).
 * No I/O — unit-testable from scripts/test-drive-mutate-gate.js.
 *
 * create_file stays allow (new unshared Sheet/Doc staging).
 * update_file / trash_file / copy_file / share_file → ask (named-this-turn).
 * Must match Drive server/namespace so generic tool names do not brick other MCP.
 */

const ASK_LEAVES = new Set(['update_file', 'trash_file', 'copy_file', 'share_file']);

const ASK_REASONS = {
  share_file:
    'Drive share_file emails people immediately (a send). Confirm Andy named this file and person this turn.',
  trash_file:
    'Drive trash_file is destructive. Confirm Andy named this exact file this turn.',
  update_file:
    'Drive update_file mutates an existing file (rename/move). Confirm Andy named this file this turn. Accuracy vs wiki is not permission (sales ICP refs off-limits).',
  copy_file:
    'Drive copy_file can land in a shared folder. Confirm Andy named this file this turn.',
};

/**
 * @param {string} toolName
 * @returns {string}
 */
function toolLeaf(toolName) {
  const name = String(toolName || '');
  const parts = name.split('__');
  return (parts[parts.length - 1] || name).trim();
}

/**
 * @param {string} [serverName]
 * @param {string} [toolName]
 * @returns {boolean}
 */
function isDriveSurface(serverName, toolName) {
  const blob = `${serverName || ''}\n${toolName || ''}`;
  return /google[-_]?drive/i.test(blob);
}

/**
 * @param {string} toolName
 * @returns {boolean}
 */
function isDriveAskTool(toolName) {
  return ASK_LEAVES.has(toolLeaf(toolName));
}

/**
 * @param {string} toolName
 * @param {unknown} [_toolInput]
 * @param {string} [serverName]
 * @returns {{ decision: 'allow'|'ask', reason: string }}
 */
function evaluateDriveMutate(toolName, _toolInput, serverName) {
  if (!isDriveSurface(serverName, toolName)) {
    return { decision: 'allow', reason: 'not_drive' };
  }
  const leaf = toolLeaf(toolName);
  if (ASK_LEAVES.has(leaf)) {
    return {
      decision: 'ask',
      reason: ASK_REASONS[leaf] || `Drive ${leaf} requires Andy's approval this turn.`,
    };
  }
  return { decision: 'allow', reason: 'drive_read_or_create' };
}

module.exports = {
  ASK_LEAVES,
  ASK_REASONS,
  toolLeaf,
  isDriveSurface,
  isDriveAskTool,
  evaluateDriveMutate,
};
