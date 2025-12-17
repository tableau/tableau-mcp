import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'crypto';

import { ClientInfo } from '../../server';
import { Store } from './store';

export type Session = {
  sessionId: string;
  clientInfo: ClientInfo;
  transport: StreamableHTTPServerTransport | undefined;
};

export const createSession = ({
  clientInfo,
  store,
  expirationTimeMs,
  sessionIdGenerator = () => randomUUID(),
}: {
  clientInfo: ClientInfo;
  store: Store<Session>;
  expirationTimeMs: number;
  sessionIdGenerator?: () => string;
}): StreamableHTTPServerTransport => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator,
    onsessioninitialized: (sessionId) => {
      store.set(sessionId, { sessionId, clientInfo, transport }, expirationTimeMs);
    },
  });

  transport.onclose = () => {
    if (transport.sessionId) {
      store.delete(transport.sessionId);
    }
  };

  return transport;
};
