---
name: debug-oauth
description: Debug OAuth authentication issues
---

# Debug OAuth Workflow

This skill helps troubleshoot OAuth authentication problems.

## Steps

1. **Identify the issue**
   - Ask user to describe the OAuth error
   - Determine if it's embedded or Tableau OAuth
   - Get error messages from logs

2. **Check configuration**
   - Read `.env` file
   - Verify OAuth env vars are set:
     - `OAUTH_ENABLED=true`
     - `OAUTH_EMBEDDED_AUTHZ_SERVER=true|false`
     - `OAUTH_ISSUER` (for Tableau OAuth)
     - `OAUTH_RESOURCE_URI`
     - `OAUTH_REDIRECT_URI`
   - Check `DANGEROUSLY_DISABLE_OAUTH` is NOT true in production

3. **Check OAuth provider setup**
   - For embedded: Check `src/server/oauth/embeddedProvider.ts`
   - For Tableau: Check `src/server/oauth/tableauProvider.ts`
   - Verify routes are registered in `src/server/express.ts`

4. **Test authorization flow**
   - Start server: `npm run start:http`
   - Open browser to `http://localhost:3927/tableau-mcp/authorize`
   - Check for redirects and errors
   - Review server logs

5. **Check token handling**
   - Verify JWT signing/verification
   - Check token expiration times:
     - `OAUTH_AUTHZ_CODE_TIMEOUT_MS`
     - `OAUTH_ACCESS_TOKEN_TIMEOUT_MS`
     - `OAUTH_REFRESH_TOKEN_TIMEOUT_MS`
   - Test token refresh flow

6. **Review middleware**
   - Check `authMiddleware` in OAuth provider
   - Verify `getTableauAuthInfo` extracts auth correctly
   - Check headers: `Authorization: Bearer {token}`

7. **Check scopes**
   - If `OAUTH_ENFORCE_SCOPES=true`, verify requested scopes
   - Check tool requires correct scopes
   - Review `OAUTH_ADVERTISE_API_SCOPES` setting

8. **Test with OAuth tests**
   - `npm run test:oauth:embedded`
   - `npm run test:oauth:tableau`
   - Review test failures for clues

9. **Check JWE encryption**
   - Verify `OAUTH_JWE_PRIVATE_KEY` or `OAUTH_JWE_PRIVATE_KEY_PATH`
   - Check passphrase if key is encrypted
   - Test key loading in `src/server/oauth/jwe.ts`

10. **Debug with logs**
    - Enable debug logging: `DEFAULT_NOTIFICATION_LEVEL=debug`
    - Check file logs if enabled: `ENABLE_FILE_LOGGER=true`
    - Disable log masking temporarily: `DISABLE_LOG_MASKING=true`
    - Review OAuth-related log entries

## Common Issues

- **"Invalid token"**: Check token expiration and signing key
- **"Unauthorized"**: Verify scopes and auth middleware
- **"Redirect URI mismatch"**: Check `OAUTH_REDIRECT_URI` matches client
- **"CORS error"**: Check `CORS_ORIGIN_CONFIG` includes client origin
- **"Session expired"**: Check session management isn't disabled
- **Passthrough auth conflict**: Ensure `ENABLE_PASSTHROUGH_AUTH` is compatible with OAuth

## Files to Check

- `src/server/oauth/provider.ts` - OAuth provider interface
- `src/server/oauth/embeddedProvider.ts` - Embedded authz server
- `src/server/oauth/tableauProvider.ts` - Tableau OAuth integration
- `src/server/oauth/schemas.ts` - Auth data structures
- `src/server/oauth/getTableauAuthInfo.ts` - Extract auth from request
- `src/config.ts` - OAuth configuration loading
