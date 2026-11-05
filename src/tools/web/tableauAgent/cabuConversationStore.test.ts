import { getCabuConversationStore } from './cabuConversationStore.js';

describe('getCabuConversationStore', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the same store instance across calls (lazy singleton)', () => {
    expect(getCabuConversationStore()).toBe(getCabuConversationStore());
  });

  it('round-trips state set for a conversationId', () => {
    const store = getCabuConversationStore();
    store.set('conversation-1', { cookies: ['cabuCtx=abc'], utteranceArgs: 'encoded-args' });

    expect(store.get('conversation-1')).toEqual({
      cookies: ['cabuCtx=abc'],
      utteranceArgs: 'encoded-args',
    });
  });

  it('returns undefined for an unknown conversationId', () => {
    const store = getCabuConversationStore();

    expect(store.get('no-such-conversation')).toBeUndefined();
  });

  it('expires entries after the conversation TTL', () => {
    vi.useFakeTimers();
    const store = getCabuConversationStore();
    store.set('conversation-ttl', { cookies: [], utteranceArgs: 'args' });

    vi.advanceTimersByTime(store.defaultExpirationTimeMs + 1);

    expect(store.get('conversation-ttl')).toBeUndefined();
  });
});
