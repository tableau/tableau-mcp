/**
 * @vitest-environment jsdom
 */
import type { App } from '@modelcontextprotocol/ext-apps';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isDeleteDatasourceConfirmResult,
  parseDeleteDatasourceConfirmResult,
  renderDeleteDatasourceConfirm,
} from './deleteDatasourceConfirmClient.js';

function confirmResult(overrides: Record<string, unknown> = {}): unknown {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          data: {
            kind: 'delete-datasource-confirm',
            datasourceId: 'ds-1',
            name: 'Sales Extract',
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

describe('isDeleteDatasourceConfirmResult / parseDeleteDatasourceConfirmResult', () => {
  it('recognizes its own confirm-panel kind', () => {
    expect(isDeleteDatasourceConfirmResult(confirmResult())).toBe(true);
  });

  it('rejects a viz-embed result (a plain {url} payload)', () => {
    const vizResult = {
      content: [{ type: 'text', text: JSON.stringify({ url: 'https://x.tableau.com/v' }) }],
    };
    expect(isDeleteDatasourceConfirmResult(vizResult)).toBe(false);
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
    expect(isDeleteDatasourceConfirmResult(workbookPanel)).toBe(false);
  });

  it('parses the panel fields', () => {
    const panel = parseDeleteDatasourceConfirmResult(confirmResult());
    expect(panel.datasourceId).toBe('ds-1');
    expect(panel.name).toBe('Sales Extract');
    expect(panel.expiresAtMs).toBe(60_000);
  });
});

describe('renderDeleteDatasourceConfirm', () => {
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
    document.getElementById('deleteDatasourceConfirm')?.remove();
  });

  it('renders the data source details a human needs to decide', () => {
    renderDeleteDatasourceConfirm(app as unknown as App, confirmResult() as never);
    const panel = document.getElementById('deleteDatasourceConfirm');
    expect(panel).toBeTruthy();
    expect(panel?.textContent).toContain('Sales Extract');
    expect(panel?.textContent).toContain('Finance');
    expect(panel?.textContent).toContain('owner@example.com');
  });

  it('renders server-derived strings via textContent, not innerHTML (no markup injection)', () => {
    renderDeleteDatasourceConfirm(
      app as unknown as App,
      confirmResult({ name: '<img src=x onerror=alert(1)>' }) as never,
    );
    const panel = document.getElementById('deleteDatasourceConfirm');
    // The malicious string is present as text but NOT as a live <img> element.
    expect(panel?.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(panel?.querySelector('img')).toBeNull();
  });

  it('Confirm calls confirm-delete-datasource with the datasourceId (the human gesture)', async () => {
    renderDeleteDatasourceConfirm(app as unknown as App, confirmResult() as never);
    (document.getElementById('confirmDeleteBtn') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(app.callServerTool).toHaveBeenCalledWith({
      name: 'confirm-delete-datasource',
      arguments: { datasourceId: 'ds-1' },
    });
  });

  it('Cancel does NOT call the server', () => {
    renderDeleteDatasourceConfirm(app as unknown as App, confirmResult() as never);
    (document.getElementById('cancelDeleteBtn') as HTMLButtonElement).click();
    expect(app.callServerTool).not.toHaveBeenCalled();
  });

  it('disables Confirm once the TTL window elapses and a late click does not reach the server', () => {
    renderDeleteDatasourceConfirm(
      app as unknown as App,
      confirmResult({ expiresAtMs: 5_000 }) as never,
    );
    const confirmBtn = document.getElementById('confirmDeleteBtn') as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(false);
    vi.advanceTimersByTime(6_000);
    expect(confirmBtn.disabled).toBe(true);
    confirmBtn.click();
    expect(app.callServerTool).not.toHaveBeenCalled();
  });
});
