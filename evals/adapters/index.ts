/** Adapter registry: resolve an AgentAdapter by harness id. */

import { claudeCodeAdapter } from './claude-code.js';
import { codexAdapter } from './codex.js';
import { cursorAdapter } from './cursor.js';
import { AGENT_HARNESSES, AgentAdapter, AgentHarness, isAgentHarness } from './types.js';

const REGISTRY: Record<AgentHarness, AgentAdapter> = {
  'claude-code': claudeCodeAdapter,
  cursor: cursorAdapter,
  codex: codexAdapter,
};

export function getAdapter(harness: AgentHarness): AgentAdapter {
  return REGISTRY[harness];
}

/**
 * Resolve the harness from an explicit value or `process.env`, defaulting to
 * claude-code. Throws on an unrecognized value.
 */
export function resolveHarness(value: string | undefined, envVar: string): AgentHarness {
  const raw = value ?? process.env[envVar];
  if (raw == null || raw.trim() === '') return 'claude-code';
  const normalized = raw.trim();
  if (!isAgentHarness(normalized)) {
    throw new Error(
      `Invalid ${envVar}="${normalized}". Expected one of: ${AGENT_HARNESSES.join(', ')}.`,
    );
  }
  return normalized;
}

export * from './types.js';
export { claudeCodeAdapter, codexAdapter, cursorAdapter };
