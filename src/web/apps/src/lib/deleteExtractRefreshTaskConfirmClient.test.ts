/**
 * @vitest-environment jsdom
 */
import type { App } from '@modelcontextprotocol/ext-apps';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isDeleteExtractRefreshTaskConfirmResult,
  parseDeleteExtractRefreshTaskConfirmResult,
  renderDeleteExtractRefreshTaskConfirm,
} from './deleteExtractRefreshTaskConfirmClient.js';

const taskId = 'a1b2c3d4-e5f6-4789-9abc-ef1234567890';

function confirmResult(overrides: Record<string, unknown> = {}): unknown {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          data: {
            kind: 'delete-extract-refresh-task-confirm',
            taskId,
            expiresAtMs: 60_000,
            ...overrides,
          },
          url: '',
        }),
      },
    ],
  };
}

describe('isDeleteExtractRefreshTaskConfirmResult / parse', () => {
  it('recognizes its own confirm-panel kind', () => {
    expect(isDeleteExtractRefreshTaskConfirmResult(confirmResult())).toBe(true);
  });

  it('rejects a viz-embed result (a plain {url} payload)', () => {
    const vizResult = {
      content: [{ type: 'text', text: JSON.stringify({ url: 'https://x.tableau.com/v' }) }],
    };
    expect(isDeleteExtractRefreshTaskConfirmResult(vizResult)).toBe(false);
  });

  it("rejects another tool's confirm panel (workbook kind)", () => {
    const workbookPanel = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            data: { kind: 'delete-workbook-confirm', workbookId: 'wb-1', expiresAtMs: 1 },
          }),
        },
      ],
    };
    expect(isDeleteExtractRefreshTaskConfirmResult(workbookPanel)).toBe(false);
  });

  it('parses the panel fields', () => {
    const panel = parseDeleteExtractRefreshTaskConfirmResult(confirmResult());
    expect(panel.taskId).toBe(taskId);
    expect(panel.expiresAtMs).toBe(60_000);
  });
});

describe('renderDeleteExtractRefreshTaskConfirm', () => {
  let app: { callServerTool: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    const root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);
    app = {
      callServerTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }),
    };
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    document.getElementById('root')?.remove();
    document.getElementById('deleteExtractRefreshTaskConfirm')?.remove();
  });

  it('renders the task id (built with createElement + textContent, never innerHTML)', () => {
    renderDeleteExtractRefreshTaskConfirm(app as unknown as App, confirmResult() as never);
    const panel = document.getElementById('deleteExtractRefreshTaskConfirm');
    expect(panel).toBeTruthy();
    expect(panel?.textContent).toContain(taskId);
  });

  it('does not interpret a markup-bearing taskId as live DOM', () => {
    renderDeleteExtractRefreshTaskConfirm(
      app as unknown as App,
      confirmResult({ taskId: '<img src=x onerror=alert(1)>' }) as never,
    );
    const panel = document.getElementById('deleteExtractRefreshTaskConfirm');
    expect(panel?.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(panel?.querySelector('img')).toBeNull();
  });

  it('Confirm calls confirm-delete-extract-refresh-task with the taskId', async () => {
    renderDeleteExtractRefreshTaskConfirm(app as unknown as App, confirmResult() as never);
    const confirmBtn = document.querySelector('.dww-confirm') as HTMLButtonElement;
    confirmBtn.click();
    await Promise.resolve();
    expect(app.callServerTool).toHaveBeenCalledWith({
      name: 'confirm-delete-extract-refresh-task',
      arguments: { taskId },
    });
  });

  it('Cancel does NOT call the server', () => {
    renderDeleteExtractRefreshTaskConfirm(app as unknown as App, confirmResult() as never);
    (document.querySelector('.dww-cancel') as HTMLButtonElement).click();
    expect(app.callServerTool).not.toHaveBeenCalled();
  });

  it('disables Confirm once the TTL window elapses and a late click does not reach the server', () => {
    renderDeleteExtractRefreshTaskConfirm(
      app as unknown as App,
      confirmResult({ expiresAtMs: 5_000 }) as never,
    );
    const confirmBtn = document.querySelector('.dww-confirm') as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(false);
    vi.advanceTimersByTime(6_000);
    expect(confirmBtn.disabled).toBe(true);
    confirmBtn.click();
    expect(app.callServerTool).not.toHaveBeenCalled();
  });
});
