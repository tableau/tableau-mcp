import PulseMethods from './pulseMethods.js';

const mock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../routeSafety/zodios.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../routeSafety/zodios.js')>()),
  createGuardedZodios: () => ({
    use: vi.fn(),
    axios: { get: mock.get, interceptors: { request: { use: vi.fn() } } },
  }),
}));
const id = '11111111-1111-4111-8111-111111111111';
const methods = (): PulseMethods =>
  new PulseMethods('https://example.invalid/api/-', { type: 'Bearer', token: 'synthetic' }, {});

describe('bounded Pulse lineage reads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.get.mockResolvedValue({ data: { definitions: [] } });
  });
  it('uses only guarded GET configuration routes with cancellation, body limits and no redirects', async () => {
    const signal = new AbortController().signal;
    await methods().readPulseLineage(
      { kind: 'definitions', after: 'cursor?x=1', pageSize: 25 },
      signal,
    );
    expect(mock.get).toHaveBeenLastCalledWith(
      '/pulse/definitions',
      expect.objectContaining({
        params: { view: 'DEFINITION_VIEW_BASIC', page_token: 'cursor?x=1', page_size: 25 },
        signal,
        maxContentLength: 2 * 1024 * 1024,
        maxRedirects: 0,
      }),
    );
    await methods().readPulseLineage({ kind: 'definitions', id });
    expect(mock.get.mock.lastCall?.[0]).toBe('/pulse/definitions/' + id);
    await methods().readPulseLineage({
      kind: 'metrics',
      definitionId: id,
      after: 'next',
      pageSize: 50,
    });
    expect(mock.get).toHaveBeenLastCalledWith(
      '/pulse/definitions/' + id + '/metrics',
      expect.objectContaining({ params: { page_token: 'next', page_size: 50 } }),
    );
    await methods().readPulseLineage({ kind: 'metric', id });
    expect(mock.get.mock.lastCall?.[0]).toBe('/pulse/metrics/' + id);
  });
  it('retains nested selectors and numeric filter values omitted by the general Pulse DTO schema', async () => {
    const payload = {
      definition: {
        metadata: { id },
        goals: [{ field: 'Native', categorical_values: [{ number_value: 3 }] }],
        representation_options: { row_level_id_field: { identifier_col: 'A', name_col: 'B' } },
      },
    };
    mock.get.mockResolvedValue({ data: payload });
    expect((await methods().readPulseLineage({ kind: 'definitions', id })).unwrap()).toEqual(
      payload,
    );
  });
  it('refuses unsafe identities, invalid cursors/pages and cancellation before the request', async () => {
    await expect(methods().readPulseLineage({ kind: 'metric', id: '../other' })).rejects.toThrow();
    await expect(
      methods().readPulseLineage({ kind: 'metrics', definitionId: id, after: 'x'.repeat(4097) }),
    ).rejects.toThrow();
    await expect(
      methods().readPulseLineage({ kind: 'definitions', pageSize: 101 }),
    ).rejects.toThrow();
    const controller = new AbortController();
    controller.abort();
    await expect(
      methods().readPulseLineage({ kind: 'definitions' }, controller.signal),
    ).rejects.toThrow();
    expect(mock.get).not.toHaveBeenCalled();
  });
});
