import { Client } from '@modelcontextprotocol/sdk/client';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InMemoryOAuthClientProvider } from '@modelcontextprotocol/sdk/examples/client/simpleOAuthClientProvider.js';
import { OAuthClientMetadata } from '@modelcontextprotocol/sdk/shared/auth.js';
import {
  CallToolRequest,
  CallToolResultSchema,
  ListToolsRequest,
  ListToolsResult,
  ListToolsResultSchema,
  LoggingMessageNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';
import z from 'zod';

import { ToolName } from '../../../src/tools/toolName.js';
import invariant from '../../../src/utils/invariant.js';
import { Deferred } from '../embedded-authz/deferred.js';
import { expect } from './tests/base.js';

export class OAuthClient {
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
        name: 'tmcp-test-oauth-client',
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

  setNotificationHandler(): void {
    this.client.setNotificationHandler(LoggingMessageNotificationSchema, (notification) => {
      console.debug('[OAuthClient] Notification received:');
      try {
        if (typeof notification.params.data === 'string') {
          const data = JSON.stringify(JSON.parse(notification.params.data), null, 2);
          console.debug(data);
        } else {
          console.debug(notification.params.data);
        }
      } catch {
        console.debug(notification.params.data);
      }
    });
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

  async resetConsent(): Promise<void> {
    const tokens = this.oauthProvider.tokens();
    if (!tokens) {
      return;
    }

    const authorizationUrl = await this.authUrlPromise;
    const resetConsentUrl = new URL(authorizationUrl.split('?')[0]);
    resetConsentUrl.pathname = '/oauth2/resetConsent';

    console.log('[OAuthClient] Resetting consent');
    const response = await fetch(resetConsentUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!response.ok) {
      console.warn(`Failed to reset consent: ${response.statusText} ${await response.text()}`);
    }
  }

  async revokeToken(): Promise<void> {
    const tokens = this.oauthProvider.tokens();
    if (!tokens) {
      return;
    }

    const authorizationUrl = await this.authUrlPromise;
    const resetConsentUrl = new URL(authorizationUrl.split('?')[0]);
    resetConsentUrl.pathname = '/oauth2/revoke';

    console.log('[OAuthClient] Revoking token');
    const response = await fetch(resetConsentUrl, {
      method: 'POST',
      body: JSON.stringify({
        token: tokens.access_token,
      }),
    });

    if (!response.ok) {
      console.warn(`Failed to revoke token: ${response.statusText} ${await response.text()}`);
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

  async callTool<Z extends z.ZodTypeAny = z.ZodNever>(
    toolName: ToolName,
    {
      schema,
      contentType,
      toolArgs,
    }: {
      schema: Z;
      contentType?: 'text' | 'image';
      toolArgs?: Record<string, unknown>;
    },
  ): Promise<z.infer<Z>> {
    console.log('[OAuthClient] Calling tool:', toolName);
    console.log('[OAuthClient] Tool arguments:', toolArgs);
    contentType = contentType ?? 'text';
    toolArgs = toolArgs ?? {};

    const request: CallToolRequest = {
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: toolArgs,
      },
    };

    const result = await this.client.request(request, CallToolResultSchema);
    if (!Array.isArray(result.content)) {
      console.error(result.content);
      throw new Error('result.content must be an array');
    }

    expect(result.content).toHaveLength(1);
    const content = result.content[0];
    expect(content.type).toBe(contentType);

    if (result.isError) {
      const errorContent =
        content.type === 'text'
          ? content.text
          : content.type === 'image'
            ? content.data
            : 'unknown error';
      console.error(errorContent);
      throw new Error(errorContent);
    }

    if (content.type === 'text') {
      const text = content.text;
      invariant(typeof text === 'string');
      const response = schema.parse(JSON.parse(text));
      return response;
    } else if (content.type === 'image') {
      const data = content.data;
      invariant(typeof data === 'string');
      const response = schema.parse(data);
      return response;
    }
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

export function getOAuthClient(): OAuthClient {
  // We masquerade the client as client.dev because we need to provide a client metadata document URL that
  // the authorization server can actually resolve.
  // AuthZ codes will be issued to the masqueraded callback URL, but that's ok,
  // we can intercept them with Playwright.
  const client = new OAuthClient({
    serverUrl: 'http://127.0.0.1:3927/tableau-mcp',
    clientMetadataUrl: 'https://client.dev/oauth/metadata.json',
    oauthCallbackUrl: 'https://client.dev/oauth/callback',
  });

  client.setNotificationHandler();
  return client;
}
