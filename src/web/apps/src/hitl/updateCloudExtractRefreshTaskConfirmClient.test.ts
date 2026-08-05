/**
 * @vitest-environment jsdom
 */
import type { App } from '@modelcontextprotocol/ext-apps';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isUpdateCloudExtractRefreshTaskConfirmResult,
  parseUpdateCloudExtractRefreshTaskConfirmResult,
  renderUpdateCloudExtractRefreshTaskConfirm,
} from './updateCloudExtractRefreshTaskConfirmClient.js';

const taskId = 'a1b2c3d4-e5f6-4789-9abc-ef1234567890';

const schedule = {
  frequency: 'Weekly',
  frequencyDetails: { start: '06:00:00', intervals: { interval: [{ weekDay: 'Sunday' }] } },
};

function confirmResult(overrides: Record<string, unknown> = {}): unknown {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          data: {
            kind: 'update-cloud-extract-refresh-task-confirm',
            taskId,
            schedule,
            frequency: 'Weekly',
            start: '06:00:00',
            expiresAtMs: 60_000,
            ...overrides,
          },
          url: '',
        }),
      },
    ],
  };
}

describe('isUpdateCloudExtractRefreshTaskConfirmResult / parse', () => {
  it('recognizes its own confirm-panel kind', () => {
    expect(isUpdateCloudExtractRefreshTaskConfirmResult(confirmResult())).toBe(true);
  });

  it('rejects a viz-embed result (a plain {url} payload)', () => {
    const vizResult = {
      content: [{ type: 'text', text: JSON.stringify({ url: 'https://x.tableau.com/v' }) }],
    };
    expect(isUpdateCloudExtractRefreshTaskConfirmResult(vizResult)).toBe(false);
  });

  it("rejects a sibling tool's confirm panel (delete-extract-refresh-task kind)", () => {
    const deletePanel = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            data: { kind: 'delete-extract-refresh-task-confirm', taskId, expiresAtMs: 1 },
          }),
        },
      ],
    };
    expect(isUpdateCloudExtractRefreshTaskConfirmResult(deletePanel)).toBe(false);
  });

  it('parses the panel fields including the structured schedule', () => {
    const panel = parseUpdateCloudExtractRefreshTaskConfirmResult(confirmResult());
    expect(panel.taskId).toBe(taskId);
    expect(panel.frequency).toBe('Weekly');
    expect(panel.schedule.frequency).toBe('Weekly');
    expect(panel.expiresAtMs).toBe(60_000);
  });
});

describe('renderUpdateCloudExtractRefreshTaskConfirm', () => {
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
    document.getElementById('updateCloudExtractRefreshTaskConfirm')?.remove();
  });

  it('renders the task id and the new schedule window', () => {
    renderUpdateCloudExtractRefreshTaskConfirm(
      app as unknown as App,
      confirmResult({ end: undefined }) as never,
    );
    const panel = document.getElementById('updateCloudExtractRefreshTaskConfirm');
    expect(panel).toBeTruthy();
    expect(panel?.textContent).toContain(taskId);
    expect(panel?.textContent).toContain('Weekly');
    expect(panel?.textContent).toContain('06:00:00');
  });

  it('does not interpret a markup-bearing taskId as live DOM', () => {
    renderUpdateCloudExtractRefreshTaskConfirm(
      app as unknown as App,
      confirmResult({ taskId: '<img src=x onerror=alert(1)>' }) as never,
    );
    const panel = document.getElementById('updateCloudExtractRefreshTaskConfirm');
    expect(panel?.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(panel?.querySelector('img')).toBeNull();
  });

  it('Apply calls confirm-update-cloud-extract-refresh-task with the taskId AND structured schedule', async () => {
    renderUpdateCloudExtractRefreshTaskConfirm(app as unknown as App, confirmResult() as never);
    (document.querySelector('.dww-confirm') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(app.callServerTool).toHaveBeenCalledWith({
      name: 'confirm-update-cloud-extract-refresh-task',
      arguments: { taskId, schedule },
    });
  });

  it('Cancel does NOT call the server', () => {
    renderUpdateCloudExtractRefreshTaskConfirm(app as unknown as App, confirmResult() as never);
    (document.querySelector('.dww-cancel') as HTMLButtonElement).click();
    expect(app.callServerTool).not.toHaveBeenCalled();
  });

  it('disables Apply once the TTL window elapses and a late click does not reach the server', () => {
    renderUpdateCloudExtractRefreshTaskConfirm(
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
