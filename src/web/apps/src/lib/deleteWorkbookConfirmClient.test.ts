/**
 * @vitest-environment jsdom
 */
import type { App } from '@modelcontextprotocol/ext-apps';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isDeleteWorkbookConfirmResult,
  parseDeleteWorkbookConfirmResult,
  renderDeleteWorkbookConfirm,
} from './deleteWorkbookConfirmClient.js';

// Builds a CallToolResult whose text is the AppToolResult the delete-workbook preview returns.
function confirmResult(overrides: Record<string, unknown> = {}): unknown {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          data: {
            kind: 'delete-workbook-confirm',
            workbookId: 'wb-1',
            name: 'Q4 Revenue',
            project: 'Finance',
            owner: 'owner@example.com',
            expiresAtMs: 60_000,
            ...overrides,
          },
          url: '',
        }),
      },
    ],
  };
}

describe('isDeleteWorkbookConfirmResult / parseDeleteWorkbookConfirmResult', () => {
  it('recognizes the confirm-panel result shape', () => {
    expect(isDeleteWorkbookConfirmResult(confirmResult())).toBe(true);
  });

  it('rejects a viz-embed result (a plain {url} payload) so the host falls through to embedding', () => {
    const vizResult = {
      content: [{ type: 'text', text: JSON.stringify({ url: 'https://x.tableau.com/v' }) }],
    };
    expect(isDeleteWorkbookConfirmResult(vizResult)).toBe(false);
  });

  it('parses the panel fields', () => {
    const panel = parseDeleteWorkbookConfirmResult(confirmResult());
    expect(panel.workbookId).toBe('wb-1');
    expect(panel.name).toBe('Q4 Revenue');
    expect(panel.expiresAtMs).toBe(60_000);
  });
});

describe('renderDeleteWorkbookConfirm', () => {
  let app: { callServerTool: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    const root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);
    app = {
      callServerTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }),
    };
    // Freeze time so the countdown math is deterministic.
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    document.getElementById('root')?.remove();
    document.getElementById('deleteWorkbookConfirm')?.remove();
  });

  it('renders the workbook details a human needs to make the decision', () => {
    renderDeleteWorkbookConfirm(app as unknown as App, confirmResult() as never);
    const panel = document.getElementById('deleteWorkbookConfirm');
    expect(panel).toBeTruthy();
    expect(panel?.textContent).toContain('Q4 Revenue');
    expect(panel?.textContent).toContain('Finance');
    expect(panel?.textContent).toContain('owner@example.com');
  });

  it('Confirm button calls confirm-delete-workbook with the workbookId (the human gesture)', async () => {
    renderDeleteWorkbookConfirm(app as unknown as App, confirmResult() as never);
    const confirmBtn = document.getElementById('confirmDeleteBtn') as HTMLButtonElement;
    confirmBtn.click();
    await Promise.resolve();
    expect(app.callServerTool).toHaveBeenCalledWith({
      name: 'delete-content',
      arguments: { resourceType: 'workbook', resourceId: 'wb-1', confirm: true },
    });
  });

  it('Cancel button does NOT call the server (no deletion)', () => {
    renderDeleteWorkbookConfirm(app as unknown as App, confirmResult() as never);
    const cancelBtn = document.getElementById('cancelDeleteBtn') as HTMLButtonElement;
    cancelBtn.click();
    expect(app.callServerTool).not.toHaveBeenCalled();
  });

  it('disables Confirm once the TTL window has elapsed (advisory client countdown)', () => {
    renderDeleteWorkbookConfirm(
      app as unknown as App,
      confirmResult({ expiresAtMs: 5_000 }) as never,
    );
    const confirmBtn = document.getElementById('confirmDeleteBtn') as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(false);
    // Advance past expiry; the countdown tick should disable Confirm.
    vi.advanceTimersByTime(6_000);
    expect(confirmBtn.disabled).toBe(true);
    // A click after expiry must not reach the server.
    confirmBtn.click();
    expect(app.callServerTool).not.toHaveBeenCalled();
  });
});
