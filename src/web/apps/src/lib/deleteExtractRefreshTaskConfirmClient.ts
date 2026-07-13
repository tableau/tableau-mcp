/**
 * @file MCP-Apps HITL confirm panel for delete-extract-refresh-task (W-23202047, mirroring
 * delete-workbook).
 *
 * The delete-extract-refresh-task preview returns an AppToolResult whose `data.kind` is
 * 'delete-extract-refresh-task-confirm'. This module renders that into a confirm panel inside the
 * iframe: the task id, a live countdown to the approval expiry, and Confirm/Cancel buttons. (A task
 * has no name/project/owner.)
 *
 * Clicking Confirm invokes the model-invisible `confirm-delete-extract-refresh-task` tool via
 * `app.callServerTool` — that human gesture IS the approval the server's AppApprovalEvidence
 * verifies. The countdown is advisory only: the server independently rejects an expired approval, so
 * disabling the button past expiry is a UX nicety, not the security boundary.
 *
 * The panel is built entirely with DOM APIs (createElement + textContent) — never innerHTML — so no
 * server-derived string is ever interpreted as markup.
 */
import type { App } from '@modelcontextprotocol/ext-apps';
import { z } from 'zod';

const confirmPanelSchema = z.object({
  kind: z.literal('delete-extract-refresh-task-confirm'),
  taskId: z.string(),
  expiresAtMs: z.number(),
});

export type DeleteExtractRefreshTaskConfirmPanel = z.infer<typeof confirmPanelSchema>;

const callToolResultSchema = z.object({
  content: z.array(z.object({ type: z.literal('text'), text: z.string() })).nonempty(),
  isError: z.boolean().optional(),
});

/** Pulls the `data` object out of a tool result's first text content, or null if it doesn't parse. */
function extractData(result: unknown): unknown {
  const parsed = callToolResultSchema.safeParse(result);
  if (!parsed.success) {
    return null;
  }
  try {
    const payload = JSON.parse(parsed.data.content[0].text);
    // AppToolResult wraps the panel in { data, url }; tolerate a bare panel too.
    return payload && typeof payload === 'object' && 'data' in payload ? payload.data : payload;
  } catch {
    return null;
  }
}

/** True when the tool result is a delete-extract-refresh-task confirm panel (vs a viz-embed {url}). */
export function isDeleteExtractRefreshTaskConfirmResult(result: unknown): boolean {
  return confirmPanelSchema.safeParse(extractData(result)).success;
}

/** Parses a confirm-panel tool result into its typed fields. Throws if the shape is wrong. */
export function parseDeleteExtractRefreshTaskConfirmResult(
  result: unknown,
): DeleteExtractRefreshTaskConfirmPanel {
  return confirmPanelSchema.parse(extractData(result));
}

const CONTAINER_ID = 'deleteExtractRefreshTaskConfirm';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

/**
 * Renders the confirm panel into #root (or document.body) and wires Confirm/Cancel + the countdown.
 * Confirm calls confirm-delete-extract-refresh-task(taskId) — the single human gesture that
 * authorizes the destructive delete server-side.
 */
export function renderDeleteExtractRefreshTaskConfirm(app: App, result: unknown): void {
  const panel = parseDeleteExtractRefreshTaskConfirmResult(result);

  const host = document.getElementById('root') ?? document.body;
  // Idempotent: replace any prior panel so a re-render doesn't stack duplicates.
  document.getElementById(CONTAINER_ID)?.remove();

  const container = el('div', 'dww-panel');
  container.id = CONTAINER_ID;

  container.appendChild(el('h2', 'dww-title', 'Confirm extract refresh task deletion'));
  container.appendChild(
    el(
      'p',
      'dww-warning',
      'This permanently and irreversibly deletes the extract refresh task. It is NOT recoverable ' +
        'from a recycle bin. The underlying data source or workbook is unaffected but will no longer ' +
        'be refreshed on this schedule.',
    ),
  );

  const taskRow = el('div', 'dww-row');
  taskRow.appendChild(el('span', 'dww-label', 'Task'));
  // textContent (never innerHTML) so the server-derived task id can't inject markup.
  taskRow.appendChild(el('span', 'dww-value', panel.taskId));
  container.appendChild(taskRow);

  const countdownEl = el('p', 'dww-countdown');
  container.appendChild(countdownEl);

  const actions = el('div', 'dww-actions');
  const cancelBtn = el('button', 'dww-cancel', 'Cancel');
  cancelBtn.type = 'button';
  const confirmBtn = el('button', 'dww-confirm', 'Delete task');
  confirmBtn.type = 'button';
  actions.appendChild(cancelBtn);
  actions.appendChild(confirmBtn);
  container.appendChild(actions);

  host.appendChild(container);

  let expired = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  const stopTimer = (): void => {
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };

  const tick = (): void => {
    const remainingMs = panel.expiresAtMs - Date.now();
    if (remainingMs <= 0) {
      expired = true;
      confirmBtn.disabled = true;
      countdownEl.textContent = 'Approval window expired — preview again to delete.';
      stopTimer();
      return;
    }
    const seconds = Math.ceil(remainingMs / 1000);
    countdownEl.textContent = `Confirm within ${seconds}s.`;
  };

  tick();
  timer = setInterval(tick, 1000);

  cancelBtn.addEventListener('click', () => {
    stopTimer();
    container.remove();
  });

  confirmBtn.addEventListener('click', () => {
    // The countdown is advisory; the server re-checks expiry. Still, don't even attempt past expiry.
    if (expired) {
      return;
    }
    stopTimer();
    confirmBtn.disabled = true;
    void app
      .callServerTool({
        name: 'delete-content',
        arguments: {
          resourceType: 'extract-refresh-task',
          resourceId: panel.taskId,
          confirm: true,
        },
      })
      .then((res) => {
        const text = callToolResultSchema.safeParse(res).success
          ? (res as { content: Array<{ text: string }> }).content[0].text
          : 'Done.';
        countdownEl.textContent = text;
      })
      .catch((error) => {
        countdownEl.textContent = `Deletion failed: ${String(error)}`;
        confirmBtn.disabled = false;
      });
  });
}
