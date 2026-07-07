import { auditRecordSchema } from './auditRecord.js';

const validRecord = {
  schemaVersion: 2 as const,
  timestamp: new Date().toISOString(),
  actor: {
    username: 'admin@example.com',
    userLuid: 'user-1',
    siteLuid: 'site-1',
    siteName: 'tc25',
  },
  tool: 'delete-datasource',
  action: 'delete' as const,
  phase: 'confirm' as const,
  target: {
    id: 'ds-1',
    name: 'Sales',
    project: 'Finance',
    owner: 'o@e.com',
    kind: 'datasource' as const,
  },
  confirmationEvidence: { kind: 'tag' as const, detail: "pending-deletion tag 'pending-deletion'" },
  result: 'allowed' as const,
};

describe('auditRecordSchema', () => {
  it('accepts a complete, well-formed record', () => {
    expect(auditRecordSchema.safeParse(validRecord).success).toBe(true);
  });

  it('accepts a denied record carrying a denyReason', () => {
    const denied = { ...validRecord, result: 'denied' as const, denyReason: 'preview-not-run' };
    expect(auditRecordSchema.safeParse(denied).success).toBe(true);
  });

  it('accepts a minimal actor/target (only required fields)', () => {
    const minimal = {
      ...validRecord,
      actor: { siteLuid: 'site-1', siteName: 'tc25' },
      target: { id: 'task-1', kind: 'extract-refresh-task' as const },
      confirmationEvidence: { kind: 'none' as const },
    };
    expect(auditRecordSchema.safeParse(minimal).success).toBe(true);
  });

  it('pins schemaVersion to the literal 2', () => {
    expect(auditRecordSchema.safeParse({ ...validRecord, schemaVersion: 1 }).success).toBe(false);
    expect(auditRecordSchema.safeParse({ ...validRecord, schemaVersion: 3 }).success).toBe(false);
  });

  it('accepts the terminal completed/failed outcome results (the v2 widening)', () => {
    expect(auditRecordSchema.safeParse({ ...validRecord, result: 'completed' }).success).toBe(true);
    const failed = {
      ...validRecord,
      result: 'failed' as const,
      failureDetail: 'Tableau 500: Internal Server Error',
    };
    expect(auditRecordSchema.safeParse(failed).success).toBe(true);
  });

  it('rejects an unknown result value', () => {
    expect(auditRecordSchema.safeParse({ ...validRecord, result: 'maybe' }).success).toBe(false);
  });

  it('rejects an unknown action', () => {
    expect(auditRecordSchema.safeParse({ ...validRecord, action: 'archive' }).success).toBe(false);
  });

  it('rejects an unknown phase', () => {
    expect(auditRecordSchema.safeParse({ ...validRecord, phase: 'rollback' }).success).toBe(false);
  });

  it('rejects an unknown evidence kind', () => {
    expect(
      auditRecordSchema.safeParse({
        ...validRecord,
        confirmationEvidence: { kind: 'magic' },
      }).success,
    ).toBe(false);
  });

  it('requires a non-empty timestamp in datetime form', () => {
    expect(auditRecordSchema.safeParse({ ...validRecord, timestamp: 'not-a-date' }).success).toBe(
      false,
    );
  });

  it('requires siteLuid on the actor', () => {
    const { siteLuid: _omit, ...actorWithoutSite } = validRecord.actor;
    expect(auditRecordSchema.safeParse({ ...validRecord, actor: actorWithoutSite }).success).toBe(
      false,
    );
  });
});
