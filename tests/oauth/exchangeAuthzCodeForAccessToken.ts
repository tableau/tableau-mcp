import express from 'express';
import request from 'supertest';

import { generateCodeChallenge } from '../../src/server/oauth/generateCodeChallenge.js';

export async function exchangeAuthzCodeForAccessToken(app: express.Application): Promise<{
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
  scope: string;
}> {
  const codeChallenge = 'test-code-challenge';
  const authzResponse = await request(app)
    .get('/oauth2/authorize')
    .query({
      client_id: 'test-client-id',
      redirect_uri: 'http://localhost:3000',
      response_type: 'code',
      code_challenge: generateCodeChallenge(codeChallenge),
      code_challenge_method: 'S256',
      state: 'test-state',
    });

  const authzLocation = new URL(authzResponse.headers['location']);
  const [authKey, tableauState] = authzLocation.searchParams.get('state')?.split(':') ?? [];

  const response = await request(app)
    .get('/Callback')
    .query({
      code: 'test-code',
      state: `${authKey}:${tableauState}`,
    });

  expect(response.status).toBe(302);
  const location = new URL(response.headers['location']);
  const code = location.searchParams.get('code');

  const tokenResponse = await request(app).post('/oauth2/token').send({
    grant_type: 'authorization_code',
    code,
    code_verifier: codeChallenge,
    redirect_uri: 'http://localhost:3000',
  });

  expect(tokenResponse.status).toBe(200);
  expect(tokenResponse.headers['content-type']).toBe('application/json; charset=utf-8');
  expect(tokenResponse.body).toEqual({
    access_token: expect.any(String),
    refresh_token: expect.any(String),
    token_type: 'Bearer',
    expires_in: 3600,
    scope: expect.stringMatching(/tableau:mcp:/),
  });

  return tokenResponse.body;
}
