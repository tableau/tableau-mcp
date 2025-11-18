import { Provider } from './provider.js';

describe('Provider', () => {
  it('should resolve to undefined if the input is undefined', async () => {
    expect(await Provider.from(undefined)).toBeUndefined();
  });

  it('should resolve to the input if it is a constant', async () => {
    const value = 'test';
    expect(await Provider.from(value)).toBe(value);
  });

  it('should resolve to the value if the input returns a constant', async () => {
    const value = 'test';
    const provider = new Provider(() => value);
    expect(await Provider.from(provider)).toBe(value);
  });

  it('should resolve to the value if the input returns a promise', async () => {
    const value = 'test';
    const provider = new Provider(() => Promise.resolve(value));
    expect(await Provider.from(provider)).toBe(value);
  });
});
