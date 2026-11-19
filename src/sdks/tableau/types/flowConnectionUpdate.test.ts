import { flowConnectionSchema } from './flow.js';
import { flowConnectionUpdateSchema } from './flowConnectionUpdate.js';

describe('non-secret flow connection update schema', () => {
  it.each([
    { serverAddress: 'warehouse.example' },
    { serverAddress: '127.0.0.1', serverPort: 5432 },
    { serverAddress: '::1' },
    { userName: '' },
  ])('accepts a supplied non-secret change %j', (updates) => {
    expect(flowConnectionUpdateSchema.safeParse(updates).success).toBe(true);
  });
  it.each([
    {},
    { serverAddress: '' },
    { serverAddress: 'https://host/path' },
    { serverAddress: 'user@host' },
    { serverPort: 0 },
    { serverPort: 65536 },
    { serverPort: 1.5 },
    { serverAddress: 'valid', password: 'not-a-real-secret' },
    { userName: 'line\nbreak' },
  ])('rejects invalid or secret-bearing input %j', (updates) => {
    expect(flowConnectionUpdateSchema.safeParse(updates).success).toBe(false);
  });
  it('strips secrets and undocumented connection metadata from responses', () => {
    expect(
      flowConnectionSchema.parse({
        id: 'connection',
        serverPort: 5432,
        embedPassword: 'false',
        password: 'private-sentinel',
        internal: 'hidden',
      }),
    ).toEqual({ id: 'connection', serverPort: '5432', embedPassword: false });
  });
});
