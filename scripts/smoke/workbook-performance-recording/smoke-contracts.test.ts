import { describe, expect, it } from 'vitest';

import {
  aggregateFailures,
  analyzeAgentFrames,
  extractFilePath,
  PERFORMANCE_PROMPT,
  redactSecrets,
  validateLogEvidence,
  validateUiCdpReport,
  withTimeout,
} from './smoke-contracts.mjs';

describe('workbook performance recording smoke contracts', () => {
  it('accepts an ordered successful agent recorder sequence', () => {
    const evidence = analyzeAgentFrames([
      { type: 'history', messages: [] },
      {
        type: 'tool_use',
        toolName: 'mcp__tableau-desktop__start-performance-recording',
        toolId: 'a',
      },
      { type: 'tool_result', toolUseId: 'a', isError: false, content: '{"message":"started"}' },
      {
        type: 'tool_use',
        toolName: 'mcp__tableau-desktop__stop-performance-recording',
        toolId: 'b',
      },
      {
        type: 'tool_result',
        toolUseId: 'b',
        isError: false,
        content: '{"filePath":"C:\\\\recordings\\\\performance.twbx"}',
      },
      { type: 'result', success: true },
    ]);

    expect(evidence).toMatchObject({
      success: true,
      startUseIndex: 1,
      startResultIndex: 2,
      stopUseIndex: 3,
      stopResultIndex: 4,
      terminalIndex: 5,
      filePath: 'C:\\recordings\\performance.twbx',
    });
  });

  it('rejects reversed, errored, and incomplete agent evidence', () => {
    const evidence = analyzeAgentFrames([
      { type: 'tool_use', toolName: 'stop-performance-recording', toolId: 'b' },
      { type: 'tool_result', toolUseId: 'b', isError: true, content: 'failed' },
      { type: 'agent_error' },
      { type: 'result', success: false },
    ]);

    expect(evidence.success).toBe(false);
    expect(evidence.errors.join('\n')).toContain('missing start-performance-recording');
    expect(evidence.errors.join('\n')).toContain('agent emitted agent_error');
  });

  it('extracts filePath from structured and textual results', () => {
    expect(extractFilePath({ nested: { filePath: 'D:\\perf\\one.twbx' } })).toBe(
      'D:\\perf\\one.twbx',
    );
    expect(extractFilePath('created "D:\\perf\\two.twbx"')).toBe('D:\\perf\\two.twbx');
  });

  it('correlates MCP timestamps and both Desktop routes', () => {
    const now = Date.now();
    const evidence = validateLogEvidence({
      mcpLog: `${JSON.stringify({ timestamp: new Date(now).toISOString(), tool: 'start-performance-recording' })}\nstop-performance-recording`,
      desktopLog:
        'POST /v0/workbook:startPerformanceRecording\nPOST /v0/workbook:stopPerformanceRecording',
      startedAtMs: now - 100,
      finishedAtMs: now + 100,
    });
    expect(evidence.success).toBe(true);
  });

  it('redacts nested and inline secrets while preserving paths', () => {
    const redacted = redactSecrets({
      authorization: 'Bearer abc.def',
      nested: 'token=cleartext C:\\recordings\\safe.twbx',
      json: '{"token":"cleartext-json","proxy-authorization":"Bearer proxy.secret"}',
      filePath: 'C:\\recordings\\safe.twbx',
    });
    expect(JSON.stringify(redacted)).not.toContain('cleartext');
    expect(JSON.stringify(redacted)).not.toContain('proxy.secret');
    expect(JSON.stringify(redacted)).not.toContain('abc.def');
    expect(JSON.stringify(redacted)).toContain('safe.twbx');
  });

  it('validates a live-dev CDP report and rejects console errors', () => {
    const report = {
      url: 'http://localhost:8081/#live-dev',
      results: [
        { shot: 'C:\\shots\\before.png' },
        { eval: 'fill', value: { phase: 'composer-filled', ok: true, text: PERFORMANCE_PROMPT } },
        { shot: 'C:\\shots\\submitted.png' },
        { eval: 'send', value: { phase: 'prompt-submitted', ok: true } },
        { eval: 'stop', value: { phase: 'stop-selector-seen', ok: true } },
        { eval: 'done', value: { phase: 'turn-completed', ok: true } },
        { shot: 'C:\\shots\\completed.png' },
        {
          eval: 'transcript',
          value: {
            phase: 'transcript',
            text: `${PERFORMANCE_PROMPT}\nfilePath: "C:\\recordings\\ui.twbx"`,
          },
        },
      ],
      consoleErrors: [],
    };
    expect(validateUiCdpReport(report)).toMatchObject({ success: true });
    expect(validateUiCdpReport({ ...report, consoleErrors: ['boom'] }).success).toBe(false);
  });

  it('bounds pending operations and aggregates scenario failures', async () => {
    await expect(withTimeout(new Promise(() => undefined), 5, 'operation')).rejects.toThrow(
      'operation timed out',
    );
    expect(
      aggregateFailures([
        { name: 'direct', success: true },
        { name: 'agent-ui', success: false, errors: ['missing stop'] },
      ]),
    ).toEqual(['agent-ui: missing stop']);
  });
});
