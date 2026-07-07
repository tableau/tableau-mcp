import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import type { MockedFunction } from 'vitest';

import * as logger from '../../../logging/logger.js';
import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { auditRecordSchema } from '../_lib/auditRecord.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getDeleteExtractRefreshTaskTool } from './deleteExtractRefreshTask.js';

// Auto-mock the logger so the durable audit record emitted by the mutation guard is captured as a
// spy call (AC-6) rather than written to stderr.
vi.mock('../../../logging/logger.js');

const mocks = vi.hoisted(() => ({
  mockDeleteExtractRefreshTask: vi.fn(),
  mockQueryUserOnSite: vi.fn(),
  mockAssertAdmin: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      tasksMethods: {
        deleteExtractRefreshTask: mocks.mockDeleteExtractRefreshTask,
      },
      usersMethods: {
        queryUserOnSite: mocks.mockQueryUserOnSite,
      },
      siteId: 'test-site-id',
      userId: 'test-user-id',
    }),
  ),
}));

vi.mock('../adminGate.js', () => ({
  assertAdmin: mocks.mockAssertAdmin,
}));

vi.mock('../../../config.js', () => ({
  getConfig: vi.fn(() => ({
    adminToolsEnabled: true,
    productTelemetryEnabled: false,
    productTelemetryEndpoint: 'https://test.com',
    server: 'https://test.tableau.com',
  })),
}));

const validTaskId = 'a1b2c3d4-e5f6-4789-9abc-ef1234567890';

// All mutation-audit records emitted so far, each parsed through the authoritative schema so the
// assertion fails if the guard ever drops a required field.
function getAuditRecords(): ReturnType<typeof auditRecordSchema.parse>[] {
  const log = logger.log as MockedFunction<typeof logger.log>;
  return log.mock.calls
    .map((c) => c[0])
    .filter((e) => e.logger === 'audit')
    .map((e) => auditRecordSchema.parse(e.data));
}

// Convenience for the single-audit-record assertions (preview and denied phases emit exactly one).
function getAuditRecord(): ReturnType<typeof auditRecordSchema.parse> {
  const records = getAuditRecords();
  expect(records).toHaveLength(1);
  return records[0];
}

// Run a preview and pull the server-minted single-use confirmation token from the response text so
// the confirm phase can supply the genuine nonce. The token is a UUID echoed as
// `confirmationToken: "<uuid>"`.
async function previewAndGetToken(taskId: string): Promise<string> {
  const preview = await getToolResult({ taskId });
  invariant(preview.isError === false, 'preview should succeed');
  invariant(preview.content[0].type === 'text');
  // The tool response text is JSON-escaped by the WebTool result serializer, so the quotes around
  // the nonce arrive as \" — match the bare UUID that follows the confirmationToken label.
  const match = preview.content[0].text.match(
    /confirmationToken:\s*\\?"?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/,
  );
  invariant(match, `preview should surface a confirmationToken, got: ${preview.content[0].text}`);
  return match[1];
}

describe('deleteExtractRefreshTaskTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockAssertAdmin.mockResolvedValue(new Ok(true));
    mocks.mockQueryUserOnSite.mockResolvedValue({ siteRole: 'SiteAdministratorCreator' });
    mocks.mockDeleteExtractRefreshTask.mockResolvedValue(undefined);
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getDeleteExtractRefreshTaskTool(new WebMcpServer());
    expect(tool.name).toBe('delete-extract-refresh-task');
    expect(tool.description).toContain('Deletes an extract refresh task from the Tableau site');
    expect(tool.paramsSchema).toHaveProperty('taskId');
    expect(tool.paramsSchema).toHaveProperty('confirm');
    expect(tool.paramsSchema).toHaveProperty('confirmationToken');
  });

  it('should have correct annotations for destructive operation', () => {
    const tool = getDeleteExtractRefreshTaskTool(new WebMcpServer());
    expect(tool.annotations).toEqual({
      title: 'Delete Extract Refresh Task',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  it('should call assertAdmin before deleting', async () => {
    await getToolResult({ taskId: validTaskId });
    expect(mocks.mockAssertAdmin).toHaveBeenCalled();
  });

  it('should fail when user is not admin and not call delete', async () => {
    mocks.mockAssertAdmin.mockResolvedValue(
      new Err('This tool requires site administrator permissions. Your site role is: Viewer'),
    );
    const result = await getToolResult({ taskId: validTaskId, confirm: true });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('requires site administrator permissions');
    expect(mocks.mockDeleteExtractRefreshTask).not.toHaveBeenCalled();
  });

  // AC-6(c): a denied attempt still emits an authoritative audit record with required fields.
  it('should emit a DENIED audit record when the user is not an admin', async () => {
    mocks.mockAssertAdmin.mockResolvedValue(new Err('not admin'));
    await getToolResult({ taskId: validTaskId, confirm: true });
    const record = getAuditRecord();
    expect(record.result).toBe('denied');
    expect(record.denyReason).toBe('not-admin');
    expect(record.tool).toBe('delete-extract-refresh-task');
    expect(record.target.id).toBe(validTaskId);
    expect(record.target.kind).toBe('extract-refresh-task');
  });

  // --- Preview phase: mints a single-use token, no deletion ---

  it('should preview without deleting and surface a single-use confirmation token', async () => {
    const result = await getToolResult({ taskId: validTaskId });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Preview');
    expect(result.content[0].text).toContain('confirmationToken:');
    expect(mocks.mockDeleteExtractRefreshTask).not.toHaveBeenCalled();
    // AC-6(c): preview emits an allowed audit with the registry-nonce evidence descriptor.
    const record = getAuditRecord();
    expect(record.result).toBe('allowed');
    expect(record.phase).toBe('preview');
    expect(record.action).toBe('delete');
    expect(record.confirmationEvidence.kind).toBe('registry-nonce');
  });

  it('SECURITY: the preview audit record never embeds the raw confirmation token', async () => {
    const token = await previewAndGetToken(validTaskId);
    // The token is surfaced in the model-facing text, but the durable audit record must only carry
    // a non-sensitive descriptor — never the raw nonce.
    const record = getAuditRecord();
    expect(JSON.stringify(record)).not.toContain(token);
  });

  // --- AC-6(a): forged / precomputed confirm rejected ---

  it('AC-6(a): rejects a confirm with no token (no prior preview) and does not delete', async () => {
    const result = await getToolResult({ taskId: validTaskId, confirm: true });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Mutation blocked');
    expect(mocks.mockDeleteExtractRefreshTask).not.toHaveBeenCalled();
    const record = getAuditRecord();
    expect(record.result).toBe('denied');
    expect(record.denyReason).toBe('preview-not-run');
  });

  it('AC-6(a): rejects a confirm with a forged/precomputed token and does not delete', async () => {
    const result = await getToolResult({
      taskId: validTaskId,
      confirm: true,
      confirmationToken: 'forged-precomputed-uuid-value',
    });
    expect(result.isError).toBe(true);
    expect(mocks.mockDeleteExtractRefreshTask).not.toHaveBeenCalled();
    expect(getAuditRecord().result).toBe('denied');
  });

  // --- AC-6(b): preview → confirm happy path ---

  it('AC-6(b): preview then confirm with the minted token deletes and audits both phases', async () => {
    const token = await previewAndGetToken(validTaskId);
    const previewRecord = getAuditRecord();
    expect(previewRecord.result).toBe('allowed');
    expect(previewRecord.phase).toBe('preview');

    // Isolate the confirm-phase audit.
    vi.mocked(logger.log).mockClear();

    const confirm = await getToolResult({
      taskId: validTaskId,
      confirm: true,
      confirmationToken: token,
    });
    expect(confirm.isError).toBe(false);
    invariant(confirm.content[0].type === 'text');
    expect(confirm.content[0].text).toContain('successfully deleted');
    expect(mocks.mockDeleteExtractRefreshTask).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      taskId: validTaskId,
    });
    // A confirmed delete emits two records: the allowed authorization decision, then the terminal
    // 'completed' outcome once the REST delete succeeds (Fix #2 — audit reflects outcome, not intent).
    const confirmRecords = getAuditRecords();
    expect(confirmRecords.map((r) => r.result)).toEqual(['allowed', 'completed']);
    expect(confirmRecords.every((r) => r.phase === 'confirm')).toBe(true);
  });

  it('single-use: a token consumed by one confirm cannot be replayed for a second delete', async () => {
    const token = await previewAndGetToken(validTaskId);

    const first = await getToolResult({
      taskId: validTaskId,
      confirm: true,
      confirmationToken: token,
    });
    expect(first.isError).toBe(false);
    expect(mocks.mockDeleteExtractRefreshTask).toHaveBeenCalledTimes(1);

    // Replay the same token — the nonce was consumed, so the second confirm is rejected.
    const second = await getToolResult({
      taskId: validTaskId,
      confirm: true,
      confirmationToken: token,
    });
    expect(second.isError).toBe(true);
    expect(mocks.mockDeleteExtractRefreshTask).toHaveBeenCalledTimes(1);
  });

  it('should handle API errors gracefully on a confirmed delete', async () => {
    const token = await previewAndGetToken(validTaskId);
    const errorMessage = 'Task not found';
    mocks.mockDeleteExtractRefreshTask.mockRejectedValue(new Error(errorMessage));
    const result = await getToolResult({
      taskId: validTaskId,
      confirm: true,
      confirmationToken: token,
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(errorMessage);
    // Fix #2: an authorized-but-failed delete records the terminal 'failed' outcome (with detail) so
    // the audit trail never claims a deletion that did not happen. previewAndGetToken emitted the
    // preview 'allowed'; the confirm phase adds 'allowed' then 'failed'.
    const confirmRecords = getAuditRecords().filter((r) => r.phase === 'confirm');
    expect(confirmRecords.map((r) => r.result)).toEqual(['allowed', 'failed']);
    const failed = confirmRecords.find((r) => r.result === 'failed');
    invariant(failed, 'expected a failed audit record');
    expect(failed.failureDetail).toContain(errorMessage);
  });

  it('should reject a non-UUID taskId at the schema boundary', () => {
    const tool = getDeleteExtractRefreshTaskTool(new WebMcpServer());
    const taskIdSchema = (
      tool.paramsSchema as { taskId: { safeParse: (v: unknown) => { success: boolean } } }
    ).taskId;
    expect(taskIdSchema.safeParse('task-123').success).toBe(false);
    expect(taskIdSchema.safeParse(validTaskId).success).toBe(true);
  });
});

async function getToolResult(args: {
  taskId: string;
  confirm?: boolean;
  confirmationToken?: string;
}): Promise<CallToolResult> {
  const tool = getDeleteExtractRefreshTaskTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    {
      taskId: args.taskId,
      confirm: args.confirm,
      confirmationToken: args.confirmationToken,
    },
    getMockRequestHandlerExtra(),
  );
}
