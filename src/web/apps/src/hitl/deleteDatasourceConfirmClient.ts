/**
 * @file MCP-Apps HITL confirm panel for datasource deletion.
 *
 * The `delete-content` (resourceType: datasource) preview returns an AppToolResult whose `data.kind`
 * is 'delete-datasource-confirm'. This module renders that into a confirm panel inside the iframe:
 * data source name/project/owner, a live countdown to the approval expiry, and Confirm/Cancel
 * buttons.
 *
 * Clicking Confirm invokes the app-only `confirm-delete-content` tool via `app.callServerTool` —
 * that human gesture IS the approval the server's AppApprovalEvidence verifies. The countdown is
 * advisory only: the server independently rejects an expired approval, so disabling the button past
 * expiry is a UX nicety, not the security boundary.
 */
import type { App } from '@modelcontextprotocol/ext-apps';
import { z } from 'zod';

const confirmPanelSchema = z.object({
  kind: z.literal('delete-datasource-confirm'),
  datasourceId: z.string(),
  name: z.string().optional(),
  project: z.string().optional(),
  owner: z.string().optional(),
  expiresAtMs: z.number(),
});

export type DeleteDatasourceConfirmPanel = z.infer<typeof confirmPanelSchema>;

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

/** True when the tool result is a delete-datasource confirm panel (vs a viz-embed {url} result). */
export function isDeleteDatasourceConfirmResult(result: unknown): boolean {
  return confirmPanelSchema.safeParse(extractData(result)).success;
}

/** Parses a confirm-panel tool result into its typed fields. Throws if the shape is wrong. */
export function parseDeleteDatasourceConfirmResult(result: unknown): DeleteDatasourceConfirmPanel {
  return confirmPanelSchema.parse(extractData(result));
}

const CONTAINER_ID = 'deleteDatasourceConfirm';

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

function appendRow(container: HTMLElement, label: string, value: string | undefined): void {
  if (!value) {
    return;
  }
  const row = el('div', 'dww-row');
  row.appendChild(el('span', 'dww-label', label));
  // textContent (never innerHTML) so name/project/owner strings can't inject markup.
  row.appendChild(el('span', 'dww-value', value));
  container.appendChild(row);
}

/**
 * Renders the confirm panel into #root (or document.body) and wires Confirm/Cancel + the countdown.
 * Confirm calls confirm-delete-datasource(datasourceId) — the single human gesture that authorizes
 * the destructive delete server-side.
 */
export function renderDeleteDatasourceConfirm(app: App, result: unknown): void {
  const panel = parseDeleteDatasourceConfirmResult(result);

  const host = document.getElementById('root') ?? document.body;
  // Idempotent: replace any prior panel so a re-render doesn't stack duplicates.
  document.getElementById(CONTAINER_ID)?.remove();

  const container = el('div', 'dww-panel');
  container.id = CONTAINER_ID;

  container.appendChild(el('h2', 'dww-title', 'Confirm data source deletion'));
  container.appendChild(
    el(
      'p',
      'dww-warning',
      'This permanently deletes the data source. On Tableau Cloud it can be restored from the recycle bin for a limited time; dependent workbooks and flows will lose this data source.',
    ),
  );
  appendRow(container, 'Data source', panel.name);
  appendRow(container, 'Project', panel.project);
  appendRow(container, 'Owner', panel.owner);

  const countdownEl = el('p', 'dww-countdown');
  countdownEl.id = 'ddsCountdown';
  container.appendChild(countdownEl);

  const actions = el('div', 'dww-actions');
  const cancelBtn = el('button', 'dww-cancel', 'Cancel');
  cancelBtn.type = 'button';
  cancelBtn.id = 'cancelDeleteBtn';
  const confirmBtn = el('button', 'dww-confirm', 'Delete data source');
  confirmBtn.type = 'button';
  confirmBtn.id = 'confirmDeleteBtn';
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
        name: 'confirm-delete-content',
        arguments: { resourceType: 'datasource', resourceId: panel.datasourceId },
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
