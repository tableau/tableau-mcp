import { isKnowledgeToolsEnabled, isKnowledgeWriteToolsEnabled } from './knowledgeTools.js';

const mocks = vi.hoisted(() => ({
  mockIsFeatureEnabled: vi.fn(),
}));

vi.mock('./init.js', () => ({
  getFeatureGate: () => ({ isFeatureEnabled: mocks.mockIsFeatureEnabled }),
}));

const cases = [undefined, false, true].flatMap((env) =>
  [false, true].map((flag) => ({ env, flag, expected: env ?? flag })),
);

describe('isKnowledgeToolsEnabled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(cases)(
    'KNOWLEDGE_TOOLS_ENABLED=$env, knowledge-tools flag=$flag → $expected',
    async ({ env, flag, expected }) => {
      mocks.mockIsFeatureEnabled.mockImplementation(
        async (name: string) => name === 'knowledge-tools' && flag,
      );

      await expect(isKnowledgeToolsEnabled({ knowledgeToolsEnabled: env })).resolves.toBe(expected);
    },
  );

  it.each([false, true])(
    'does not consult the feature gate when KNOWLEDGE_TOOLS_ENABLED=%s',
    async (env) => {
      await isKnowledgeToolsEnabled({ knowledgeToolsEnabled: env });

      expect(mocks.mockIsFeatureEnabled).not.toHaveBeenCalled();
    },
  );

  it('defers to the knowledge-tools flag when KNOWLEDGE_TOOLS_ENABLED is unset', async () => {
    mocks.mockIsFeatureEnabled.mockResolvedValue(true);

    await isKnowledgeToolsEnabled({ knowledgeToolsEnabled: undefined });

    expect(mocks.mockIsFeatureEnabled).toHaveBeenCalledWith('knowledge-tools');
  });
});

describe('isKnowledgeWriteToolsEnabled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(cases)(
    'KNOWLEDGE_WRITE_TOOLS_ENABLED=$env, knowledge-write-tools flag=$flag → $expected',
    async ({ env, flag, expected }) => {
      mocks.mockIsFeatureEnabled.mockImplementation(
        async (name: string) => name === 'knowledge-write-tools' && flag,
      );

      await expect(isKnowledgeWriteToolsEnabled({ knowledgeWriteToolsEnabled: env })).resolves.toBe(
        expected,
      );
    },
  );

  it.each([false, true])(
    'does not consult the feature gate when KNOWLEDGE_WRITE_TOOLS_ENABLED=%s',
    async (env) => {
      await isKnowledgeWriteToolsEnabled({ knowledgeWriteToolsEnabled: env });

      expect(mocks.mockIsFeatureEnabled).not.toHaveBeenCalled();
    },
  );

  it('defers to the knowledge-write-tools flag when KNOWLEDGE_WRITE_TOOLS_ENABLED is unset', async () => {
    mocks.mockIsFeatureEnabled.mockResolvedValue(true);

    await isKnowledgeWriteToolsEnabled({ knowledgeWriteToolsEnabled: undefined });

    expect(mocks.mockIsFeatureEnabled).toHaveBeenCalledWith('knowledge-write-tools');
  });
});
