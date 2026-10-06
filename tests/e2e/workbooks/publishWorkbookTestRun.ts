import { randomUUID } from 'crypto';
import { z } from 'zod';

import { getExceptionMessage } from '../../../src/utils/getExceptionMessage.js';

/** Owns only workbooks created by one execution of the publishing smoke tests. */
export class PublishWorkbookTestRun {
  private readonly prefix: string;
  private readonly names = new Set<string>();
  private readonly workbookIds = new Set<string>();

  constructor(
    name: string,
    private readonly projectId: string,
  ) {
    const run = process.env.GITHUB_RUN_ID ?? 'local';
    const attempt = process.env.GITHUB_RUN_ATTEMPT ?? '1';
    this.prefix = `${name} ${run}-${attempt}-node${process.versions.node.split('.')[0]}-${randomUUID()}`;
  }

  get hasPublishedWorkbooks(): boolean {
    return this.workbookIds.size > 0;
  }

  name(label: string): string {
    const name = `${this.prefix} ${label}`;
    this.names.add(name);
    return name;
  }

  track(workbook: { id: string; name: string; project?: { id: string } }): void {
    // Never clean up a pre-existing workbook or one in another project, even on a bad response.
    if (!this.names.has(workbook.name) || workbook.project?.id !== this.projectId) {
      throw new Error('Published workbook did not match this test run and target project.');
    }
    this.workbookIds.add(workbook.id);
  }

  async cleanup(deleteWorkbook: (id: string) => Promise<void>): Promise<void> {
    const failures: string[] = [];
    // Try every owned ID even when one delete fails, and retain failed IDs for diagnostics.
    for (const id of this.workbookIds) {
      try {
        await deleteWorkbook(id);
        this.workbookIds.delete(id);
      } catch (error) {
        failures.push(`${id}: ${getExceptionMessage(error)}`);
      }
    }
    if (failures.length > 0) {
      throw new Error(`Failed to clean up published test workbooks: ${failures.join('; ')}`);
    }
  }
}

const failureNotificationSchema = z.object({
  notifier: z.literal('rest-api'),
  message: z.object({
    type: z.literal('response'),
    requestId: z.union([z.string(), z.number()]),
    status: z.number().min(400),
    data: z.object({
      error: z.object({
        code: z.string().optional(),
        summary: z.string().optional(),
        detail: z.string().optional(),
      }),
    }),
  }),
});

/** Extract only error fields from the server's already-masked REST notification. */
export function getRestFailureDiagnostic(data: unknown): string | undefined {
  try {
    const parsed = failureNotificationSchema.safeParse(
      typeof data === 'string' ? JSON.parse(data) : data,
    );
    if (!parsed.success) return;
    const { requestId, status, data: body } = parsed.data.message;
    return JSON.stringify({ requestId, status, ...body.error });
  } catch {
    // Malformed diagnostic notifications must not change the result of a test.
    return;
  }
}
