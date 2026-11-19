import { inspect } from 'node:util';

import { KeyValueStoreProviderValidationError } from '../errors/mcpToolError.js';
import { loadProviderModule } from '../utils/loadProviderModule.js';
import type { KeyValueStore } from './keyValueStore.js';
import { loadCustomProvider, validateProvider } from './provider.js';

vi.mock('../utils/loadProviderModule.js', () => ({ loadProviderModule: vi.fn() }));

function createProvider(): KeyValueStore<unknown> {
  return {
    get: vi.fn(async () => undefined),
    set: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    consume: vi.fn(async () => undefined),
  };
}

describe('validateProvider', () => {
  it('accepts the four required methods without optional lifecycle hooks', () => {
    expect(() => validateProvider(createProvider())).not.toThrow();
  });

  it.each([
    { name: 'null', value: null },
    { name: 'undefined', value: undefined },
    { name: 'a number', value: 42 },
    { name: 'a string', value: 'provider' },
    { name: 'an array', value: [] },
  ])('rejects $name as a provider', ({ value }) => {
    expect(() => validateProvider(value)).toThrow(KeyValueStoreProviderValidationError);
  });

  it.each(['get', 'set', 'delete', 'consume'] as const)(
    'rejects a provider missing %s()',
    (method) => {
      const provider: Partial<KeyValueStore<unknown>> = createProvider();
      delete provider[method];
      expect(() => validateProvider(provider)).toThrow(
        `Custom provider missing required method: ${method}`,
      );
    },
  );

  it.each(['get', 'set', 'delete', 'consume'] as const)(
    'rejects a provider whose %s property is not a function',
    (method) => {
      const provider = { ...createProvider(), [method]: 42 };
      expect(() => validateProvider(provider)).toThrow(
        `Custom provider missing required method: ${method}`,
      );
    },
  );
});

describe('loadCustomProvider', () => {
  const config = { module: '@example/kv-provider', table: 'mcp-state' };

  beforeEach(() => {
    vi.mocked(loadProviderModule).mockReset();
  });

  it.each(['default', 'KeyValueStore'])(
    'constructs the %s export with the full provider configuration',
    (exportName) => {
      const provider = createProvider();
      const Provider = vi.fn(function () {
        return provider;
      });
      vi.mocked(loadProviderModule).mockReturnValueOnce({ [exportName]: Provider });

      expect(loadCustomProvider(config)).toBe(provider);
      expect(Provider).toHaveBeenCalledExactlyOnceWith(config);
    },
  );

  it('rejects a module without a provider export', () => {
    vi.mocked(loadProviderModule).mockReturnValueOnce({});
    expect(() => loadCustomProvider(config)).toThrow(
      'Module must export a default class or named export "KeyValueStore"',
    );
  });

  it('reports a generic load error when the export cannot be constructed', () => {
    vi.mocked(loadProviderModule).mockReturnValueOnce({ default: 42 });
    expect(() => loadCustomProvider(config)).toThrow(
      'Failed to load custom key-value store provider. Check its module export and configuration.',
    );
  });

  it('preserves the typed validation error when the constructed provider lacks consume()', () => {
    const provider: Partial<KeyValueStore<unknown>> = createProvider();
    delete provider.consume;
    vi.mocked(loadProviderModule).mockReturnValueOnce({
      default: vi.fn(function () {
        return provider;
      }),
    });

    expect(() => loadCustomProvider(config)).toThrow(
      expect.objectContaining({
        type: 'key-value-store-provider-validation',
        statusCode: 500,
        message: 'Custom provider missing required method: consume',
      }),
    );
  });

  it('hides private details when module loading fails', () => {
    const marker = 'PRIVATE_MODULE_ERROR';
    vi.mocked(loadProviderModule).mockImplementationOnce(() => {
      throw new Error(marker, { cause: new Error(marker) });
    });

    let failure: unknown;
    try {
      loadCustomProvider(config);
    } catch (error) {
      failure = error;
    }
    expect(failure).toHaveProperty(
      'message',
      'Failed to load custom key-value store provider. Check its module export and configuration.',
    );
    expect(inspect(failure)).not.toContain(marker);
    expect(failure).not.toHaveProperty('cause');
  });

  it('hides private details when the provider constructor throws', () => {
    const marker = 'PRIVATE_CONSTRUCTOR_ERROR';
    vi.mocked(loadProviderModule).mockReturnValueOnce({
      default: class {
        constructor() {
          throw new Error(marker, { cause: new Error(marker) });
        }
      },
    });

    let failure: unknown;
    try {
      loadCustomProvider(config);
    } catch (error) {
      failure = error;
    }
    expect(failure).toHaveProperty(
      'message',
      'Failed to load custom key-value store provider. Check its module export and configuration.',
    );
    expect(inspect(failure)).not.toContain(marker);
    expect(failure).not.toHaveProperty('cause');
  });
});
