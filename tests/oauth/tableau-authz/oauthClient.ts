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

export class OAuthClient {
  private readonly client: Client;
  private readonly serverUrl: string;
  private readonly clientMetadataUrl: string;
  private readonly oauthCallbackUrl: string;

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
  }

  async attemptConnection(
    authProvider: InMemoryOAuthClientProvider,
    triggerOAuthCallbackFn?: () => Promise<string>,
  ): Promise<void> {
    console.log('[OAuthClient] Creating transport with OAuth provider...');
    const baseUrl = new URL(this.serverUrl);
    const transport = new StreamableHTTPClientTransport(baseUrl, {
      authProvider,
    });
    console.log('[OAuthClient] Transport created');

    try {
      console.log('[OAuthClient] Attempting connection (this will trigger OAuth redirect)...');
      await this.client.connect(transport);

      console.log('[OAuthClient] Connected successfully');
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        console.log('[OAuthClient] OAuth required - waiting for authorization...');

        invariant(triggerOAuthCallbackFn, 'triggerOAuthCallbackFn is required');
        const authCode = await triggerOAuthCallbackFn();
        console.log('[OAuthClient] Authorization code received:', authCode.slice(0, 10) + '...');

        await transport.finishAuth(authCode);

        console.log('[OAuthClient] Reconnecting with authenticated transport...');
        await this.attemptConnection(authProvider);
      } else {
        console.error('[OAuthClient] Connection failed with non-auth error:', error);
        throw error;
      }
    }
  }

  getOAuthProvider(): {
    getAuthorizationUrl: Deferred<string>;
    oauthProvider: InMemoryOAuthClientProvider;
  } {
    console.log(`[OAuthClient] Attempting to connect to ${this.serverUrl}...`);

    // Minimal client metadata to satisfy the DCR specification (which we won't be using).
    const clientMetadata: OAuthClientMetadata = {
      redirect_uris: [this.oauthCallbackUrl],
    };

    console.log('[OAuthClient] Creating OAuth provider...');
    const getAuthorizationUrl = new Deferred<string>();
    const oauthProvider = new InMemoryOAuthClientProvider(
      this.oauthCallbackUrl,
      clientMetadata,
      (redirectUrl: URL) => {
        getAuthorizationUrl.resolve(redirectUrl.toString());
      },
      this.clientMetadataUrl,
    );
    console.log('[OAuthClient] OAuth provider created');

    console.log('[OAuthClient] Creating MCP client...');

    console.log('[OAuthClient] Client created');
    console.log('[OAuthClient] Starting OAuth flow...');

    return { getAuthorizationUrl, oauthProvider };
  }

  async listTools(): Promise<ListToolsResult> {
    const request: ListToolsRequest = {
      method: 'tools/list',
      params: {},
    };

    return await this.client.request(request, ListToolsResultSchema);
  }

  async callTool(toolName: string, toolArgs: Record<string, unknown>): Promise<CallToolResult> {
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
    this.client?.close();
  }
}
