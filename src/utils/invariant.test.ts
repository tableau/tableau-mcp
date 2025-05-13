import invariant from './invariant.js';

describe('invariant', () => {
  it("doesn't throw when the condition is truthy", () => {
    expect(() => invariant(true)).not.toThrow();
    expect(() => invariant({})).not.toThrow();
    expect(() => invariant([])).not.toThrow();
    expect(() => invariant('asdf')).not.toThrow();
    expect(() => invariant(1)).not.toThrow();
  });

  it('throws when the condition is falsy', () => {
    expect(() => invariant(false)).toThrow();
    expect(() => invariant(null)).toThrow();
    expect(() => invariant(undefined)).toThrow();
    expect(() => invariant('')).toThrow();
    expect(() => invariant(0)).toThrow();
  });

  it('shows a generic error if no message is passed', () => {
    expect(() => invariant(false)).toThrow(/^Invariant Violation$/);
  });

  it('shows a message if one is supplied', () => {
    expect(() => invariant(null, 'expected element to exist')).toThrow('expected element to exist');
  });
});
