/**
 * Headless one-shot helper: send a single prompt to a coding-agent CLI (no MCP
 * tools) and return the final assistant text. Used by the grader's semantic judge.
 */

import { execFileSync } from 'child_process';

import { AgentAdapter, HeadlessContext } from './types.js';

export type HeadlessRunResult = {
  text: string;
  exitCode: number;
  stdout: string;
  stderr: string;
};

export function runHeadless(adapter: AgentAdapter, ctx: HeadlessContext): HeadlessRunResult {
  const invocation = adapter.buildHeadlessInvocation(ctx);
  let stdout = '';
  let stderr = '';
  let exitCode = 0;
  try {
    stdout = execFileSync(invocation.command, invocation.args, {
      env: { ...process.env, ...invocation.env },
      cwd: invocation.cwd,
      timeout: invocation.timeoutMs,
      maxBuffer: 25 * 1024 * 1024,
    }).toString();
  } catch (error: unknown) {
    const e = error as { status?: number; stdout?: Buffer; stderr?: Buffer; message?: string };
    exitCode = e.status ?? 1;
    stdout = e.stdout?.toString() ?? '';
    stderr = [e.message, e.stderr?.toString()].filter(Boolean).join('\n');
  }
  return { text: adapter.extractFinalText(stdout), exitCode, stdout, stderr };
}

/**
 * Extract the first balanced JSON object from a text blob. Coding-agent CLIs often
 * wrap the judge's JSON in prose/markdown fences, so we scan for `{ ... }`.
 */
export function extractJsonObject<T>(text: string): T | null {
  // Prefer fenced ```json blocks.
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates: Array<string> = [];
  if (fenceMatch?.[1]) candidates.push(fenceMatch[1].trim());
  candidates.push(text.trim());

  for (const candidate of candidates) {
    const start = candidate.indexOf('{');
    if (start === -1) continue;
    let depth = 0;
    for (let i = start; i < candidate.length; i++) {
      const ch = candidate[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          const slice = candidate.slice(start, i + 1);
          try {
            return JSON.parse(slice) as T;
          } catch {
            break;
          }
        }
      }
    }
  }
  return null;
}
