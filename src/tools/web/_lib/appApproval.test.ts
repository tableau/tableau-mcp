import { RestApi } from '../../../sdks/tableau/restApi.js';
import { APP_APPROVAL_META_KEY } from '../../../utils/appApprovalMeta.js';
import { defaultSuccessResult } from '../tool.js';
import {
  appApprovalSuccessResult,
  attachAppApproval,
  createAppApprovalEvidence,
} from './appApproval.js';
import { EvidenceContext } from './evidence.js';
import { exportedForTesting } from './signedTokenEvidence.js';

vi.mock('../../../config.js', () => ({
  getConfig: vi.fn(() => ({ mutationTokenSecret: '', mutationTokenSecretPrevious: '' })),
}));

function ctx(overrides: Partial<EvidenceContext> = {}): EvidenceContext {
  return {
    restApi: {} as RestApi,
    siteId: 'site-1',
    target: { id: 'task-1', kind: 'extract-refresh-task' },
    tool: 'update-cloud-extract-refresh-task',
    userLuid: 'admin-1',
    ...overrides,
  };
}

describe('appApproval', () => {
  beforeEach(() => exportedForTesting.reset());
  afterEach(() => exportedForTesting.reset());

  describe('createAppApprovalEvidence (per-request instances)', () => {
    it('returns a new instance on every call', () => {
      expect(createAppApprovalEvidence('delete-content')).not.toBe(
        createAppApprovalEvidence('delete-content'),
      );
    });

    it('two concurrent confirms use separate instances: one release cannot reopen the other token', async () => {
      const tokenA = await attachAppApproval('delete-content', ctx({ target: { id: 'a' } }), {});
      const tokenB = await attachAppApproval('delete-content', ctx({ target: { id: 'b' } }), {});
      const metaA = appApprovalSuccessResult(tokenA)._meta?.[APP_APPROVAL_META_KEY] as string;
      const metaB = appApprovalSuccessResult(tokenB)._meta?.[APP_APPROVAL_META_KEY] as string;

      const requestA = createAppApprovalEvidence('delete-content');
      const requestB = createAppApprovalEvidence('delete-content');
      const [okA, okB] = await Promise.all([
        requestA.verify(ctx({ target: { id: 'a' }, confirmationToken: metaA })),
        requestB.verify(ctx({ target: { id: 'b' }, confirmationToken: metaB })),
      ]);
      expect([okA, okB]).toEqual([true, true]);

      // Request A's mutation did not apply: it releases ONLY its own token.
      requestA.release();
      expect(
        await createAppApprovalEvidence('delete-content').verify(
          ctx({ target: { id: 'a' }, confirmationToken: metaA }),
        ),
      ).toBe(true);
      // B stays consumed.
      expect(
        await createAppApprovalEvidence('delete-content').verify(
          ctx({ target: { id: 'b' }, confirmationToken: metaB }),
        ),
      ).toBe(false);
    });
  });

  describe('appApprovalSuccessResult', () => {
    it.each([
      ['a string preview', 'Preview — would update'],
      ['a plain object', { ok: true, n: 1 }],
      ['null', null],
    ])('delegates to the default serializer for %s (no token)', (_label, result) => {
      expect(appApprovalSuccessResult(result)).toEqual(defaultSuccessResult(result));
    });

    it('adds the token in _meta (never in content) when the result carries one', async () => {
      const result = await attachAppApproval('delete-content', ctx(), { preview: true });
      const out = appApprovalSuccessResult(result);
      const token = out._meta?.[APP_APPROVAL_META_KEY];
      expect(typeof token).toBe('string');
      expect(out.content).toEqual(defaultSuccessResult(result).content);
      expect(JSON.stringify(out.content)).not.toContain(token as string);
    });
  });
});
