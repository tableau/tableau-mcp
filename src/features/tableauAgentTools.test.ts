import { isTableauAgentToolsEnabled } from './tableauAgentTools.js';

const mocks = vi.hoisted(() => ({
  mockIsFeatureEnabled: vi.fn(),
}));

vi.mock('./init.js', () => ({
  getFeatureGate: () => ({ isFeatureEnabled: mocks.mockIsFeatureEnabled }),
}));

const cases = [undefined, false, true].flatMap((env) =>
  [false, true].map((flag) => ({ env, flag, expected: env ?? flag })),
);

describe('isTableauAgentToolsEnabled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(cases)(
    'TABLEAU_AGENT_TOOLS_ENABLED=$env, tableau-agent-tools flag=$flag → $expected',
    async ({ env, flag, expected }) => {
      mocks.mockIsFeatureEnabled.mockImplementation(
        async (name: string) => name === 'tableau-agent-tools' && flag,
      );

      await expect(isTableauAgentToolsEnabled({ tableauAgentToolsEnabled: env })).resolves.toBe(
        expected,
      );
    },
  );

  it.each([false, true])(
    'does not consult the feature gate when TABLEAU_AGENT_TOOLS_ENABLED=%s',
    async (env) => {
      await isTableauAgentToolsEnabled({ tableauAgentToolsEnabled: env });

      expect(mocks.mockIsFeatureEnabled).not.toHaveBeenCalled();
    },
  );

  it('defers to the tableau-agent-tools flag when TABLEAU_AGENT_TOOLS_ENABLED is unset', async () => {
    mocks.mockIsFeatureEnabled.mockResolvedValue(true);

    await isTableauAgentToolsEnabled({ tableauAgentToolsEnabled: undefined });

    expect(mocks.mockIsFeatureEnabled).toHaveBeenCalledWith('tableau-agent-tools');
  });
});
