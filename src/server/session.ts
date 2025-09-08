import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID, timingSafeEqual } from 'crypto';
import { Request, Response } from 'express';
import { Err, Ok, Result } from 'ts-results-es';

export type Session = {
  transport: StreamableHTTPServerTransport;
  accessToken?: string;
};

const sessions: { [sessionId: string]: Session } = {};

export function getSession(sessionId: string): Session | undefined {
  return sessions[sessionId];
}

export function verifySessionAccessToken(req: Request, res: Response): Result<void, string> {
  const getSessionResult = getSessionFromRequest({
    stateful: true,
    req,
    res,
  });

  if (!getSessionResult) {
    return new Err('No session found');
  }

  const sessionAccessToken = getSessionResult.session?.accessToken;
  const token = req.headers.authorization?.slice(7) ?? '';

  if (
    !sessionAccessToken ||
    !token ||
    !timingSafeEqual(new TextEncoder().encode(sessionAccessToken), new TextEncoder().encode(token))
  ) {
    return new Err('Invalid token');
  }

  return Ok.EMPTY;
}

export function getSessionFromRequest({
  stateful,
  req,
  res,
}: {
  stateful: boolean;
  req: Request;
  res: Response;
}):
  | {
      session: Session | undefined;
      fromCache: boolean;
    }
  | undefined {
  if (!stateful) {
    return {
      session: {
        transport: new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        }),
        accessToken: req.headers.authorization?.slice(7),
      },
      fromCache: false,
    };
  }

  const sessionId = req.headers['mcp-session-id'];
  if (Array.isArray(sessionId)) {
    res.status(400).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Bad Request: Multiple MCP-Session-Id headers are not supported',
      },
      id: null,
    });
    return;
  }

  if (sessionId && sessions[sessionId]) {
    // Reuse existing transport
    return { session: sessions[sessionId], fromCache: true };
  }

  if (!sessionId && isInitializeRequest(req.body)) {
    // New initialization request
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        // Store the transport by session ID
        sessions[sessionId] = {
          transport,
          accessToken: req.headers.authorization?.slice(7),
        };
      },
      // DNS rebinding protection is disabled by default for backwards compatibility. If you are running this server
      // locally, make sure to set:
      // enableDnsRebindingProtection: true,
      // allowedHosts: ['127.0.0.1'],
    });

    // Clean up transport when closed
    transport.onclose = () => {
      if (transport.sessionId) {
        delete sessions[transport.sessionId];
      }
    };

    return {
      session: {
        transport,
        accessToken: req.headers.authorization?.slice(7),
      },
      fromCache: false,
    };
  }

  // Invalid request
  res.status(400).json({
    jsonrpc: '2.0',
    error: {
      code: -32000,
      message: 'Bad Request: No valid session ID provided',
    },
    id: null,
  });
}
