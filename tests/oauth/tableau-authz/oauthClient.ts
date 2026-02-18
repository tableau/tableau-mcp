import { Client } from '@modelcontextprotocol/sdk/client';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InMemoryOAuthClientProvider } from '@modelcontextprotocol/sdk/examples/client/simpleOAuthClientProvider.js';
import { OAuthClientMetadata } from '@modelcontextprotocol/sdk/shared/auth.js';
import {
  CallToolRequest,
  CallToolResult,
  CallToolResultSchema,
  ListToolsRequest,
  ListToolsResult,
  ListToolsResultSchema,
} from '@modelcontextprotocol/sdk/types.js';

import invariant from '../../../src/utils/invariant';
import { Deferred } from '../deferred';

class OAuthClient {
  private readonly client: Client;
  private readonly serverUrl: string;
  private readonly clientMetadataUrl: string;
  private readonly oauthCallbackUrl: string;

  private oauthProvider: InMemoryOAuthClientProvider;
  private authUrlPromise: Promise<string>;

  constructor({
    serverUrl,
    clientMetadataUrl,
    oauthCallbackUrl,
  }: {
    serverUrl: string;
    clientMetadataUrl: string;
    oauthCallbackUrl: string;
  }) {
    this.client = new Client(
      {
        name: 'basic-oauth-client',
        version: '1.0.0',
      },
      { capabilities: {} },
    );

    this.serverUrl = serverUrl;
    this.clientMetadataUrl = clientMetadataUrl;
    this.oauthCallbackUrl = oauthCallbackUrl;

    // Minimal client metadata to satisfy the DCR specification (which we won't be using).
    const clientMetadata: OAuthClientMetadata = {
      redirect_uris: [this.oauthCallbackUrl],
    };

    const getAuthorizationUrl = new Deferred<string>();
    this.oauthProvider = new InMemoryOAuthClientProvider(
      this.oauthCallbackUrl,
      clientMetadata,
      (redirectUrl: URL) => {
        getAuthorizationUrl.resolve(redirectUrl.toString());
      },
      this.clientMetadataUrl,
    );

    this.authUrlPromise = getAuthorizationUrl.promise;
  }

  async attemptConnection(
    getAuthZCodeFn?: ({
      authorizationUrl,
      callbackUrl,
    }: {
      authorizationUrl: string;
      callbackUrl: string;
    }) => Promise<string>,
  ): Promise<void> {
    console.log('[OAuthClient] Creating transport with OAuth provider');
    const baseUrl = new URL(this.serverUrl);
    const transport = new StreamableHTTPClientTransport(baseUrl, {
      authProvider: this.oauthProvider,
      // Temporarily override fetch until the authorization server
      // adds the client_id_metadata_document_supported flag
      fetch: async (url: string | URL, init?: RequestInit) => {
        if (!url.toString().includes('/.well-known/oauth-authorization-server')) {
          return fetch(url, init);
        }

        const response = await fetch(url, init);
        if (!response.ok) {
          return response;
        }

        const json = await response.json();
        json.client_id_metadata_document_supported = true;
        return new Response(JSON.stringify(json), { status: 200 });
      },
    });
    console.log('[OAuthClient] Transport created');

    try {
      console.log('[OAuthClient] Attempting connection');
      await this.client.connect(transport);
      console.log('[OAuthClient] Connected successfully');
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        console.log('[OAuthClient] OAuth required - waiting for authorization');

        invariant(getAuthZCodeFn, 'getAuthZCodeFn is required for authorization');
        const authCode = await getAuthZCodeFn({
          authorizationUrl: await this.authUrlPromise,
          callbackUrl: this.oauthCallbackUrl,
        });
        invariant(authCode, 'Authorization code is empty');

        console.log('[OAuthClient] Authorization code received:', authCode.slice(0, 10) + '...');
        console.log('[OAuthClient] Exchanging authorization code for access token');
        await transport.finishAuth(authCode);

        console.log('[OAuthClient] Reconnecting with authenticated transport');
        await this.attemptConnection();
      } else {
        console.error('[OAuthClient] Connection failed with non-auth error:', error);
        throw error;
      }
    }
  }

  async listTools(): Promise<ListToolsResult> {
    console.log('[OAuthClient] Listing tools');
    const request: ListToolsRequest = {
      method: 'tools/list',
      params: {},
    };

    return await this.client.request(request, ListToolsResultSchema);
  }

  async callTool(toolName: string, toolArgs: Record<string, unknown>): Promise<CallToolResult> {
    console.log('[OAuthClient] Calling tool:', toolName);
    console.log('[OAuthClient] Tool arguments:', toolArgs);
    const request: CallToolRequest = {
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: toolArgs,
      },
    };

    return await this.client.request(request, CallToolResultSchema);
  }

  close(): void {
    this.client.close();
  }
}

export function getOauthClient(): OAuthClient {
  // We masquerade the client as client.dev because we need to provide a client metadata document URL that
  // the authorization server can actually resolve.
  // AuthZ codes will be issued to the masqueraded callback URL, but that's ok,
  // we can intercept them with Playwright.
  return new OAuthClient({
    serverUrl: 'http://127.0.0.1:3927/tableau-mcp',
    clientMetadataUrl: 'https://client.dev/oauth/metadata.json',
    oauthCallbackUrl: 'https://client.dev/oauth/callback',
  });
}
