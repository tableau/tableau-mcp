/**
 * @file MCP-Apps HITL confirm panel for update-cloud-extract-refresh-task (W-23202047, mirroring
 * delete-workbook).
 *
 * The update-cloud-extract-refresh-task preview returns an AppToolResult whose `data.kind` is
 * 'update-cloud-extract-refresh-task-confirm'. This module renders that into a confirm panel inside
 * the iframe describing the SCHEDULE CHANGE (frequency + time window), a live countdown to the
 * approval expiry, and Cancel / "Apply schedule change" buttons. This is a schedule change, NOT a
 * deletion.
 *
 * Clicking Apply invokes the model-invisible `confirm-update-cloud-extract-refresh-task` tool via
 * `app.callServerTool`, passing the task id and the full structured `schedule` (passed through as
 * data, never rendered as markup) — that human gesture IS the approval the server's
 * AppApprovalEvidence verifies. The countdown is advisory only: the server independently rejects an
 * expired approval, so disabling the button past expiry is a UX nicety, not the security boundary.
 *
 * The panel is built entirely with DOM APIs (createElement + textContent) — never innerHTML — so no
 * server-derived string is ever interpreted as markup.
 */
import type { App } from '@modelcontextprotocol/ext-apps';
import { z } from 'zod';

// The structured schedule is passed straight back to the confirm tool; it is never rendered as
// markup, so a permissive passthrough schema is sufficient here (the server re-validates it against
// the strict updateCloudExtractRefreshScheduleSchema).
const scheduleSchema = z
  .object({
    frequency: z.string(),
    frequencyDetails: z
      .object({
        start: z.string(),
        end: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

const confirmPanelSchema = z.object({
  kind: z.literal('update-cloud-extract-refresh-task-confirm'),
  taskId: z.string(),
  schedule: scheduleSchema,
  frequency: z.string(),
  start: z.string(),
  end: z.string().optional(),
  expiresAtMs: z.number(),
});

export type UpdateCloudExtractRefreshTaskConfirmPanel = z.infer<typeof confirmPanelSchema>;

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

/** True when the tool result is an update-cloud-extract-refresh-task confirm panel. */
export function isUpdateCloudExtractRefreshTaskConfirmResult(result: unknown): boolean {
  return confirmPanelSchema.safeParse(extractData(result)).success;
}

/** Parses a confirm-panel tool result into its typed fields. Throws if the shape is wrong. */
export function parseUpdateCloudExtractRefreshTaskConfirmResult(
  result: unknown,
): UpdateCloudExtractRefreshTaskConfirmPanel {
  return confirmPanelSchema.parse(extractData(result));
}

const CONTAINER_ID = 'updateCloudExtractRefreshTaskConfirm';

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
 * Renders the confirm panel into #root (or document.body) and wires Cancel/Apply + the countdown.
 * Apply calls confirm-update-cloud-extract-refresh-task(taskId, schedule) — the single human gesture
 * that authorizes the schedule change server-side.
 */
export function renderUpdateCloudExtractRefreshTaskConfirm(app: App, result: unknown): void {
  const panel = parseUpdateCloudExtractRefreshTaskConfirmResult(result);

  const host = document.getElementById('root') ?? document.body;
  // Idempotent: replace any prior panel so a re-render doesn't stack duplicates.
  document.getElementById(CONTAINER_ID)?.remove();

  const window = panel.end ? `${panel.start}–${panel.end}` : `start ${panel.start}`;

  const container = el('div', 'dww-panel');
  container.id = CONTAINER_ID;

  container.appendChild(el('h2', 'dww-title', 'Confirm extract refresh schedule change'));
  container.appendChild(
    el(
      'p',
      'dww-warning',
      'This changes the refresh schedule for this extract refresh task, overwriting the existing ' +
        'schedule. To revert, apply the prior schedule values again.',
    ),
  );

  const taskRow = el('div', 'dww-row');
  taskRow.appendChild(el('span', 'dww-label', 'Task'));
  // textContent (never innerHTML) for every server-derived string.
  taskRow.appendChild(el('span', 'dww-value', panel.taskId));
  container.appendChild(taskRow);

  const scheduleRow = el('div', 'dww-row');
  scheduleRow.appendChild(el('span', 'dww-label', 'New schedule'));
  scheduleRow.appendChild(el('span', 'dww-value', `${panel.frequency} (${window})`));
  container.appendChild(scheduleRow);

  const countdownEl = el('p', 'dww-countdown');
  container.appendChild(countdownEl);

  const actions = el('div', 'dww-actions');
  const cancelBtn = el('button', 'dww-cancel', 'Cancel');
  cancelBtn.type = 'button';
  const confirmBtn = el('button', 'dww-confirm', 'Apply schedule change');
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
      countdownEl.textContent = 'Approval window expired — preview again to apply.';
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
        name: 'confirm-update-cloud-extract-refresh-task',
        arguments: { taskId: panel.taskId, schedule: panel.schedule },
      })
      .then((res) => {
        const text = callToolResultSchema.safeParse(res).success
          ? (res as { content: Array<{ text: string }> }).content[0].text
          : 'Done.';
        countdownEl.textContent = text;
      })
      .catch((error) => {
        countdownEl.textContent = `Update failed: ${String(error)}`;
        confirmBtn.disabled = false;
      });
  });
}
