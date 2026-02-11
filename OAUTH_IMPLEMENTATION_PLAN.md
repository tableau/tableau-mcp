# Tableau MCP OAuth Integration Implementation Plan

## Executive Summary

This document outlines the phased approach to integrate Tableau OAuth with the MCP server, implementing MCP authorization best practices, scope management, and token exchange mechanisms. The work is divided into three phases, with Phase 1 focusing on immediate improvements we can make independently while coordinating with the auth team on Phase 2 and 3 requirements.

---

## Current State Analysis

### Existing OAuth Implementation
- ✅ Basic OAuth 2.1 flow with PKCE implemented
- ✅ Authorization server metadata endpoint (`.well-known/oauth-authorization-server`)
- ✅ Protected resource metadata endpoint (`.well-known/oauth-protected-resource`)
- ✅ Client ID Metadata Documents support
- ✅ Dynamic client registration support
- ✅ Token endpoint with authorization_code, refresh_token, and client_credentials grants
- ✅ JWE-encrypted access tokens

### Gaps Identified
- ❌ **No scope support**: `scopes_supported: []` in authorization server metadata
- ❌ **No scope parameter** in `WWW-Authenticate` header (per MCP spec recommendation)
- ❌ **No scope validation** in authorization or token endpoints
- ❌ **No scope-to-Tableau mapping** mechanism
- ❌ **Token exchange** needs to be adapted for Tableau REST API compatibility
- ❌ **Scope challenge handling** not implemented (for insufficient scope errors)
- ❌ **Step-up authorization flow** not implemented (for requesting additional scopes)
- ⚠️ **Testing gaps**: Long-lived token testing (30-day refresh tokens), scope edge cases

---

## Phase 1: Best Practices & Auth Uplift (Independent Work)

**Timeline**: 2-3 weeks  
**Dependencies**: None (can start immediately)

### 1.1 Review MCP Authorization Specification Changes
- [ ] Review latest MCP spec (2025-11-25) vs current implementation (2025-06-18)
- [ ] Document any breaking changes or new requirements
- [ ] Update code references to latest spec version
- [ ] Review Security Best Practices guide: https://modelcontextprotocol.io/docs/tutorials/security/authorization

### 1.2 Implement Scope Infrastructure
**Files to modify:**
- `src/server/oauth/.well-known/oauth-authorization-server.ts`
- `src/server/oauth/.well-known/oauth-protected-resource.ts`
- `src/server/oauth/authMiddleware.ts`
- `src/server/oauth/authorize.ts`
- `src/server/oauth/schemas.ts`
- `src/server/oauth/token.ts`

**Tasks:**
- [ ] Add scope configuration to config (environment variable or config file)
- [ ] Define scope data structures and types
- [ ] Implement `scopes_supported` in authorization server metadata
- [ ] Add scope parameter parsing in authorize endpoint
- [ ] Add scope validation logic
- [ ] Store requested scopes in pending authorization and authorization codes
- [ ] Include scopes in issued access tokens (JWE payload)
- [ ] Add scope extraction in auth middleware

### 1.3 Implement WWW-Authenticate Scope Guidance
**Per MCP Spec Section: Protected Resource Metadata Discovery Requirements**

- [ ] Add `scope` parameter to `WWW-Authenticate` header in `authMiddleware.ts`
- [ ] Determine appropriate scopes for each MCP endpoint/tool
- [ ] Implement scope selection strategy (per MCP spec)
- [ ] Handle scope challenges in 401 responses

### 1.4 Scope Research & Documentation
- [ ] Research Tableau OAuth scope format and structure
- [ ] Document scope naming conventions
- [ ] Create scope inventory: what scopes does Tableau OAuth support?
- [ ] Document scope lifecycle: adding/removing scopes without breaking existing clients
- [ ] Design scope versioning strategy (if needed)

### 1.5 Code Quality Improvements
- [ ] Review and improve error handling in OAuth flows
- [ ] Add comprehensive logging for OAuth operations
- [ ] Improve token validation error messages
- [ ] Add input validation for scope parameters
- [ ] Review security best practices implementation:
  - [ ] Token audience validation (already implemented via `AUDIENCE`)
  - [ ] PKCE enforcement (already implemented)
  - [ ] Redirect URI validation (already implemented)
  - [ ] SSRF protection (already implemented in client metadata fetching)

### 1.6 Testing Infrastructure Updates
- [ ] Update OAuth test suite to handle scopes
- [ ] Add tests for scope validation
- [ ] Add tests for WWW-Authenticate scope parameter
- [ ] Document testing approach for long-lived tokens (30-day refresh tokens)
- [ ] Create test utilities for simulating token expiration scenarios

---

## Phase 2: Scope Mapping (Coordination with Auth Team)

**Timeline**: 3-4 weeks  
**Dependencies**: Auth team decisions on scope mapping

### 2.1 Scope Mapping Design & Implementation
**Coordination needed with George:**
- [ ] Finalize scope mapping strategy (MCP scopes → Tableau scopes)
- [ ] Define scope mapping configuration format
- [ ] Implement scope mapping logic
- [ ] Handle scope translation in authorization flow
- [ ] Handle scope translation in token exchange

**Implementation tasks:**
- [ ] Create scope mapping module/utility
- [ ] Add scope mapping configuration to config
- [ ] Integrate scope mapping into authorize endpoint (when forwarding to Tableau OAuth)
- [ ] Integrate scope mapping into token exchange

### 2.2 Token Exchange
Token exchange is **out of scope** for the initial release. Revisit only if the authorization
strategy changes or Tableau OAuth requirements evolve.

### 2.3 Authorization Flow Updates
- [ ] Update authorize endpoint to include mapped scopes in Tableau OAuth redirect
- [ ] Handle scope parameter from client requests
- [ ] Validate requested scopes against supported scopes
- [ ] Store scope information throughout the flow

### 2.4 Testing
- [ ] Integration tests with Tableau OAuth
- [ ] Test scope mapping in various scenarios
- [ ] Test with actual Tableau REST API calls

---

## Phase 3: Server Support & Full Cloud Integration

**Timeline**: 2-3 weeks  
**Dependencies**: Phase 2 completion, Server vs Cloud requirements clarification

### 3.1 Server vs Cloud Differentiation
**Decisions needed:**
- [ ] Determine if Server needs scope support (or can skip for beta)
- [ ] Define configuration knobs/environment variables for Server vs Cloud behavior
- [ ] Determine if Server OAuth flow differs from Cloud

**Implementation tasks:**
- [ ] Add environment variable/config option for Server mode
- [ ] Implement conditional scope handling (skip scopes in Server mode if needed)
- [ ] Ensure Server OAuth flow still works without breaking changes
- [ ] Add Server-specific configuration options

### 3.2 Full Cloud Integration
- [ ] Complete integration with Tableau Cloud OAuth
- [ ] Test end-to-end flow with Tableau Cloud
- [ ] Verify token exchange works with Cloud
- [ ] Verify scope mapping works with Cloud
- [ ] Performance testing with Cloud

### 3.3 Edge Cases & Error Handling
**Coordination with Andy:**
- [ ] Review edge cases identified
- [ ] Implement handling for:
  - [ ] Insufficient scope errors (scope challenge)
  - [ ] Step-up authorization (requesting additional scopes)
  - [ ] Token expiration during long-running operations
  - [ ] Network failures during token exchange
  - [ ] Invalid scope requests
  - [ ] Scope revocation scenarios

### 3.4 Testing & Validation
- [ ] End-to-end testing with both Server and Cloud
- [ ] Test scope addition/removal scenarios
- [ ] Test backward compatibility (clients without scope support)
- [ ] Load testing with token refresh
- [ ] Security testing (token validation, scope validation)

---

## Technical Implementation Details

### Scope Data Structure
```typescript
// Proposed scope structure
type McpScope = 
  | 'tableau:content:read'
  | 'tableau:content:write'
  | 'tableau:datasource:query'
  | 'tableau:workbook:read'
  | 'tableau:view:read'
  | 'tableau:view:download'
  // ... additional scopes as needed

interface ScopeMapping {
  mcpScope: McpScope;
  tableauScopes: string[]; // Array of Tableau OAuth scopes
}
```

### WWW-Authenticate Header Enhancement
```typescript
// Current (line 51 in authMiddleware.ts):
`Bearer realm="MCP", resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`

// Enhanced (per MCP spec):
`Bearer realm="MCP", resource_metadata="${baseUrl}/.well-known/oauth-protected-resource", scope="tableau:content:read tableau:datasource:query"`
```

### Configuration Additions
```typescript
// Add to config.ts
oauth: {
  // ... existing config
  scopesSupported: string[]; // MCP scopes we support
  scopeMappings: ScopeMapping[]; // MCP → Tableau scope mappings
  serverMode?: boolean; // If true, may skip scope requirements
}
```

---

## Testing Strategy

### Unit Tests
- Scope validation logic
- Scope mapping logic
- Token exchange logic
- WWW-Authenticate header generation

### Integration Tests
- Full OAuth flow with scopes
- Token exchange with Tableau OAuth
- Scope challenge handling
- Step-up authorization

### E2E Tests
- Complete flow with MCP client
- Token refresh scenarios
- Long-lived token testing (30-day refresh tokens)
- Server vs Cloud behavior

### Test Utilities Needed
- Mock Tableau OAuth server with scope support
- Token expiration simulation
- Scope challenge simulation
- Long-running operation simulation

---

## Open Questions for Auth Team

1. **Scope Format**: What is the exact format of Tableau OAuth scopes? (e.g., `tableau:content:read`, `tableau.content.read`, etc.)

2. **Scope Mapping**: How should we map MCP scopes to Tableau scopes? One-to-one, one-to-many, or many-to-one?

3. **Token Exchange**:
   - Not planned for initial release. Revisit if requirements change.

4. **Scope Lifecycle**: 
   - How do we add new scopes without breaking existing clients?
   - How do we handle scope deprecation?
   - Can scopes be requested dynamically, or must they be pre-registered?

5. **Server vs Cloud**: 
   - Does Server OAuth support the same scope mechanism as Cloud?
   - Should Server skip scope requirements for beta?

6. **Token Lifetime**: 
   - What are the actual token lifetimes (access, refresh)?
   - How should we test 30-day refresh tokens?

---

## Success Criteria

### Phase 1
- ✅ MCP authorization best practices implemented
- ✅ Scope infrastructure in place
- ✅ WWW-Authenticate scope guidance implemented
- ✅ Comprehensive scope research documented
- ✅ Code quality improvements completed

### Phase 2
- ✅ Scope mapping implemented and tested
- ✅ Token exchange working with Tableau OAuth
- ✅ Full authorization flow with scopes working end-to-end

### Phase 3
- ✅ Server and Cloud both supported
- ✅ All edge cases handled
- ✅ Comprehensive test coverage
- ✅ Production-ready implementation

---

## References

- [MCP Authorization Specification (2025-11-25)](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [MCP Security Best Practices](https://modelcontextprotocol.io/docs/tutorials/security/authorization)
- [OAuth 2.1 IETF Draft](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-13)
- [OAuth 2.0 Protected Resource Metadata (RFC9728)](https://www.rfc-editor.org/rfc/rfc9728)
- [OAuth 2.0 Authorization Server Metadata (RFC8414)](https://www.rfc-editor.org/rfc/rfc8414)


