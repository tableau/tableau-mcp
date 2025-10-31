import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'crypto';

import { ClientInfo } from './server.js';

type Session = {
  transport: StreamableHTTPServerTransport;
  clientInfo: ClientInfo;
};

const sessions: { [sessionId: string]: Session } = {};

export const hasSession = (sessionId: string): boolean => !!sessions[sessionId];

export const createSession = ({
  clientInfo,
}: {
  clientInfo: ClientInfo;
}): StreamableHTTPServerTransport => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sessionId) => {
      sessions[sessionId] = { transport, clientInfo };
    },
  });

  transport.onclose = () => {
    if (transport.sessionId) {
      deleteSession(transport.sessionId);
    }
  };

  return transport;
};

export const getSession = (sessionId: string): Session => {
  return sessions[sessionId];
};

const deleteSession = (sessionId: string): void => {
  delete sessions[sessionId];
};
