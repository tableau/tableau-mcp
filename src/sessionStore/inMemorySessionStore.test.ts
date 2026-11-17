import { InMemoryKeyValueStore } from '../storage/inMemoryKeyValueStore.js';
import { InMemorySessionStore } from './inMemorySessionStore.js';

describe('InMemorySessionStore compatibility', () => {
  it('exports the same class as InMemoryKeyValueStore', () => {
    expect(InMemorySessionStore).toBe(InMemoryKeyValueStore);
  });
});
