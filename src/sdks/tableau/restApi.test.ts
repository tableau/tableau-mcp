import { beforeEach, describe, expect, it, vi } from 'vitest';

// Use importActual to bypass the global RestApi mock from testSetup.ts
// and access the real class's static getter/setter behavior.

describe('RestApi static version', () => {
  let RealRestApi: any;

  beforeEach(async () => {
    const actual = await vi.importActual<{ RestApi: unknown }>('./restApi.js');
    RealRestApi = actual.RestApi;
    // Reset to the uninitialized state before each test
    RealRestApi._version = undefined;
  });

  it('throws when version has not been initialized', () => {
    expect(() => RealRestApi.version).toThrow('REST API version not initialized');
  });

  it('returns the version after it has been set via the setter', () => {
    RealRestApi.version = '3.27';
    expect(RealRestApi.version).toBe('3.27');
  });
});
