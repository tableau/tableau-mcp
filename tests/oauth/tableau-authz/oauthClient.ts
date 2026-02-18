#!/usr/bin/env node

import { createInterface } from 'node:readline';
import { URL } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InMemoryOAuthClientProvider } from '@modelcontextprotocol/sdk/examples/client/simpleOAuthClientProvider.js';
import { OAuthClientMetadata } from '@modelcontextprotocol/sdk/shared/auth.js';
import {
  CallToolRequest,
  CallToolResultSchema,
  ListToolsRequest,
  ListToolsResultSchema,
} from '@modelcontextprotocol/sdk/types.js';

import invariant from '../../../src/utils/invariant';
import { Deferred } from '../deferred';

/**
 * Interactive MCP client with OAuth authentication
 * Demonstrates the complete OAuth flow with browser-based authorization
 */
export class OAuthClient {
  private readonly serverUrl: string;
  private readonly clientMetadataUrl?: string;

  private client: Client | null = null;
  private readonly rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  constructor(serverUrl: string, clientMetadataUrl?: string) {
    this.serverUrl = serverUrl;
    this.clientMetadataUrl = clientMetadataUrl;
  }

  async attemptConnection(
    oauthProvider: InMemoryOAuthClientProvider,
    triggerOAuthCallbackFn?: () => Promise<string>,
  ): Promise<void> {
    console.log('[OauthClient] Creating transport with OAuth provider...');
    const baseUrl = new URL(this.serverUrl);
    const transport = new StreamableHTTPClientTransport(baseUrl, {
      authProvider: oauthProvider,
    });
    console.log('[OauthClient] Transport created');

    try {
      console.log('[OauthClient] Attempting connection (this will trigger OAuth redirect)...');
      await this.client!.connect(transport);
      console.log('[OauthClient] Connected successfully');
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        console.log('[OauthClient] OAuth required - waiting for authorization...');
        invariant(triggerOAuthCallbackFn, 'triggerOAuthCallbackFn is required');
        const authCode = await triggerOAuthCallbackFn();
        await transport.finishAuth(authCode);
        console.log('[OauthClient] Authorization code received:', authCode);
        console.log('[OauthClient] Reconnecting with authenticated transport...');
        await this.attemptConnection(oauthProvider);
      } else {
        console.error('[OauthClient] Connection failed with non-auth error:', error);
        throw error;
      }
    }
  }

  /**
   * Establishes connection to the MCP server with OAuth authentication
   */
  getOAuthProvider(): {
    getAuthorizationUrl: Deferred<string>;
    oauthProvider: InMemoryOAuthClientProvider;
  } {
    console.log(`[OauthClient] Attempting to connect to ${this.serverUrl}...`);

    // Minimal client metadata to satisfy the DCR specification (which we won't be using).
    const oauthCallbackUrl = 'https://client.dev/oauth/callback'; // Masquerade as client.dev
    const clientMetadata: OAuthClientMetadata = {
      redirect_uris: [oauthCallbackUrl],
    };

    console.log('[OauthClient] Creating OAuth provider...');
    const getAuthorizationUrl = new Deferred<string>();
    const oauthProvider = new InMemoryOAuthClientProvider(
      oauthCallbackUrl,
      clientMetadata,
      (redirectUrl: URL) => {
        getAuthorizationUrl.resolve(redirectUrl.toString());
      },
      this.clientMetadataUrl,
    );
    console.log('[OauthClient] OAuth provider created');

    console.log('[OauthClient] Creating MCP client...');
    this.client = new Client(
      {
        name: 'tableau-mcp-client',
        version: '1.0.0',
      },
      { capabilities: {} },
    );

    console.log('[OauthClient] Client created');
    console.log('[OauthClient] Starting OAuth flow...');

    return { getAuthorizationUrl, oauthProvider };
  }

  /**
   * Main interactive loop for user commands
   */
  // async interactiveLoop(): Promise<void> {
  //   while (true) {
  //     try {
  //       const command = await this.question('mcp> ');

  //       if (!command.trim()) {
  //         continue;
  //       }

  //       if (command === 'quit') {
  //         console.log('\n👋 Goodbye!');
  //         this.close();
  //         process.exit(0);
  //       } else if (command === 'list') {
  //         await this.listTools();
  //       } else if (command.startsWith('call ')) {
  //         await this.handleCallTool(command);
  //       } else if (command.startsWith('stream ')) {
  //         //await this.handleStreamTool(command);
  //       } else {
  //         console.log(
  //           "❌ Unknown command. Try 'list', 'call <tool_name>', 'stream <tool_name>', or 'quit'",
  //         );
  //       }
  //     } catch (error) {
  //       if (error instanceof Error && error.message === 'SIGINT') {
  //         console.log('\n\n👋 Goodbye!');
  //         break;
  //       }
  //       console.error('❌ Error:', error);
  //     }
  //   }
  // }

  private async listTools(): Promise<void> {
    if (!this.client) {
      console.log('❌ Not connected to server');
      return;
    }

    try {
      const request: ListToolsRequest = {
        method: 'tools/list',
        params: {},
      };

      const result = await this.client.request(request, ListToolsResultSchema);

      if (result.tools && result.tools.length > 0) {
        console.log('\n📋 Available tools:');
        for (const [index, tool] of result.tools.entries()) {
          console.log(`${index + 1}. ${tool.name}`);
          if (tool.description) {
            console.log(`   Description: ${tool.description}`);
          }
          console.log();
        }
      } else {
        console.log('No tools available');
      }
    } catch (error) {
      console.error('❌ Failed to list tools:', error);
    }
  }

  private async handleCallTool(command: string): Promise<void> {
    const parts = command.split(/\s+/);
    const toolName = parts[1];

    if (!toolName) {
      console.log('❌ Please specify a tool name');
      return;
    }

    // Parse arguments (simple JSON-like format)
    let toolArgs: Record<string, unknown> = {};
    if (parts.length > 2) {
      const argsString = parts.slice(2).join(' ');
      try {
        toolArgs = JSON.parse(argsString);
      } catch {
        console.log('❌ Invalid arguments format (expected JSON)');
        return;
      }
    }

    await this.callTool(toolName, toolArgs);
  }

  private async callTool(toolName: string, toolArgs: Record<string, unknown>): Promise<void> {
    if (!this.client) {
      console.log('❌ Not connected to server');
      return;
    }

    try {
      const request: CallToolRequest = {
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: toolArgs,
        },
      };

      const result = await this.client.request(request, CallToolResultSchema);

      console.log(`\n🔧 Tool '${toolName}' result:`);
      if (result.content) {
        for (const content of result.content) {
          if (content.type === 'text') {
            console.log(content.text);
          } else {
            console.log(content);
          }
        }
      } else {
        console.log(result);
      }
    } catch (error) {
      console.error(`❌ Failed to call tool '${toolName}':`, error);
    }
  }

  // private async handleStreamTool(command: string): Promise<void> {
  //   const parts = command.split(/\s+/);
  //   const toolName = parts[1];

  //   if (!toolName) {
  //     console.log('❌ Please specify a tool name');
  //     return;
  //   }

  //   // Parse arguments (simple JSON-like format)
  //   let toolArgs: Record<string, unknown> = {};
  //   if (parts.length > 2) {
  //     const argsString = parts.slice(2).join(' ');
  //     try {
  //       toolArgs = JSON.parse(argsString);
  //     } catch {
  //       console.log('❌ Invalid arguments format (expected JSON)');
  //       return;
  //     }
  //   }

  //   await this.streamTool(toolName, toolArgs);
  // }

  // private async streamTool(toolName: string, toolArgs: Record<string, unknown>): Promise<void> {
  //   if (!this.client) {
  //     console.log('❌ Not connected to server');
  //     return;
  //   }

  //   try {
  //     // Using the experimental tasks API - WARNING: may change without notice
  //     console.log(`\n🔧 Streaming tool '${toolName}'...`);

  //     const stream = this.client.experimental.tasks.callToolStream(
  //       {
  //         name: toolName,
  //         arguments: toolArgs,
  //       },
  //       {
  //         task: {
  //           taskId: `task-${Date.now()}`,
  //           ttl: 60_000,
  //         },
  //       },
  //     );

  //     // Iterate through all messages yielded by the generator
  //     for await (const message of stream) {
  //       switch (message.type) {
  //         case 'taskCreated': {
  //           console.log(`✓ Task created: ${message.task.taskId}`);
  //           break;
  //         }

  //         case 'taskStatus': {
  //           console.log(`⟳ Status: ${message.task.status}`);
  //           if (message.task.statusMessage) {
  //             console.log(`  ${message.task.statusMessage}`);
  //           }
  //           break;
  //         }

  //         case 'result': {
  //           console.log('✓ Completed!');
  //           for (const content of message.result.content) {
  //             if (content.type === 'text') {
  //               console.log(content.text);
  //             } else {
  //               console.log(content);
  //             }
  //           }
  //           break;
  //         }

  //         case 'error': {
  //           console.log('✗ Error:');
  //           console.log(`  ${message.error.message}`);
  //           break;
  //         }
  //       }
  //     }
  //   } catch (error) {
  //     console.error(`❌ Failed to stream tool '${toolName}':`, error);
  //   }
  // }

  close(): void {
    this.rl.close();
    if (this.client) {
      // Note: Client doesn't have a close method in the current implementation
      // This would typically close the transport connection
    }
  }
}

/**
 * Main entry point
 */
// async function main(): Promise<void> {
//   const args = process.argv.slice(2);
//   const serverUrl = args[0] || DEFAULT_SERVER_URL;
//   const clientMetadataUrl = args[1];

//   console.log('🚀 Simple MCP OAuth Client');
//   console.log(`Connecting to: ${serverUrl}`);
//   if (clientMetadataUrl) {
//     console.log(`Client Metadata URL: ${clientMetadataUrl}`);
//   }
//   console.log();

//   const client = new OauthClient(serverUrl, clientMetadataUrl);

//   // Handle graceful shutdown
//   process.on('SIGINT', () => {
//     console.log('\n\n👋 Goodbye!');
//     client.close();
//     process.exit(0);
//   });

//   try {
//     await client.connect();
//   } catch (error) {
//     console.error('Failed to start client:', error);
//     process.exit(1);
//   } finally {
//     client.close();
//   }
// }
