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
}: {
  clientInfo: ClientInfo;
  store: Store<Session>;
}): StreamableHTTPServerTransport => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sessionId) => {
      store.set(sessionId, { sessionId, clientInfo, transport });
    },
  });

  transport.onclose = () => {
    if (transport.sessionId) {
      store.delete(transport.sessionId);
    }
  };

  return transport;
};
