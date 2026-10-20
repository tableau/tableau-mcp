import { isAdminToolsEnabled } from './adminTools.js';

const mocks = vi.hoisted(() => ({
  mockIsFeatureEnabled: vi.fn(),
}));

vi.mock('./init.js', () => ({
  getFeatureGate: () => ({ isFeatureEnabled: mocks.mockIsFeatureEnabled }),
}));

describe('isAdminToolsEnabled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    [true, true, true],
    [true, false, true],
    [false, true, true],
    [false, false, false],
  ])('ADMIN_TOOLS_ENABLED=%s, admin-tools flag=%s → %s', async (env, flag, expected) => {
    mocks.mockIsFeatureEnabled.mockResolvedValue(flag);

    await expect(isAdminToolsEnabled({ adminToolsEnabled: env })).resolves.toBe(expected);
  });

  it('does not consult the feature gate when ADMIN_TOOLS_ENABLED is on', async () => {
    await isAdminToolsEnabled({ adminToolsEnabled: true });

    expect(mocks.mockIsFeatureEnabled).not.toHaveBeenCalled();
  });
});
