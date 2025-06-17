import { Zodios } from '@zodios/core';
import { createHmac } from 'crypto';

import {
  exploreInTableauApis,
  ExploreInTableauRequest,
  ExploreInTableauResponse,
} from '../apis/exploreInTableauAPI.js';
import Methods from './methods.js';

export interface ExploreInTableauResult {
  redirectUrl: string | null;
  response: ExploreInTableauResponse;
  headers: Record<string, string>;
  status: number;
}

export default class ExploreInTableauMethods extends Methods<typeof exploreInTableauApis> {
  private _lastResponseHeaders: Record<string, string> = {};
  private _lastResponseStatus: number = 0;

  constructor() {
    // Use the external Salesforce API base URL
    super(new Zodios('https://api.salesforce.com', exploreInTableauApis));

    // Add response interceptor to capture headers
    this._apiClient.axios.interceptors.response.use(
      (response) => {
        // Store the headers and status from the last response
        this._lastResponseHeaders = response.headers as Record<string, string>;
        this._lastResponseStatus = response.status;
        return response;
      },
      (error) => {
        // Also capture headers from error responses
        if (error.response) {
          this._lastResponseHeaders = error.response.headers as Record<string, string>;
          this._lastResponseStatus = error.response.status;
        }
        return Promise.reject(error);
      },
    );
  }

  /**
   * Submit TDS content to explore in Tableau and returns redirect URL from response headers.
   * @param tdsContent - Raw TDS content as string (will be base64 encoded automatically)
   * @returns Promise containing the redirect URL extracted from headers
   */
  exploreInTableau = async (tdsContent: string): Promise<string> => {
    // Base64 encode the TDS content
    const encodedTdsContent = Buffer.from(tdsContent, 'utf8').toString('base64');

    // Prepare the request data with environment variables
    const requestData: ExploreInTableauRequest = {
      tdsContent: encodedTdsContent,
    };

    await this._apiClient.exploreInTableau(requestData, {
      headers: {
        'x-salesforce-region': this.getRegion(),
        'Content-Type': 'application/json',
        Authorization: `C2C:${this.generateJWT()}`,
      },
    });

    // Extract redirect URL from the location header
    return this.getLastResponseHeader('location')?.toString() || 'Failed to upload.';
  };

  /**
   * Get a specific header from the last response
   * @param headerName - Name of the header to retrieve
   * @returns Header value or undefined if not found
   */
  getLastResponseHeader(headerName: string): string | undefined {
    return this._lastResponseHeaders[headerName.toLowerCase()];
  }

  /**
   * Get the status code from the last response
   * @returns HTTP status code
   */
  getLastResponseStatus(): number {
    return this._lastResponseStatus;
  }

  // Helper function to generate JWT token using Node.js crypto
  generateJWT(): string {
    const apiKey = process.env.IA_API_KEY;
    if (!apiKey) {
      throw new Error('IA_API_KEY environment variable is required');
    }

    // JWT Header
    const header = {
      alg: 'HS256',
      typ: 'JWT',
    };

    // JWT Payload
    const payload = {
      iss: 'tableau-mcp', // Issuer - adjust as needed
      iat: Math.floor(Date.now() / 1000), // Issued at
    };

    // Base64 encode header and payload
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');

    // Create signature
    const signatureInput = `${encodedHeader}.${encodedPayload}`;
    const signature = createHmac('sha256', apiKey).update(signatureInput).digest('base64url');

    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  // Helper function to get region from environment
  getRegion(): string {
    const region = process.env.SALESFORCE_REGION || 'us-east-1';
    return region;
  }
}
