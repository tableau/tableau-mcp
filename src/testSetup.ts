vi.stubEnv('SERVER', 'https://my-tableau-server.com');
vi.stubEnv('SITE_NAME', 'tc25');
vi.stubEnv('PAT_NAME', 'sponge');
vi.stubEnv('PAT_VALUE', 'bob');
vi.stubEnv('TABLEAU_MCP_TEST', 'true');

vi.mock('./server.js', async (importOriginal) => ({
  ...(await importOriginal()),
  Server: vi.fn().mockImplementation(() => ({
    name: 'test-server',
    server: {
      notification: vi.fn(),
    },
  })),
}));
