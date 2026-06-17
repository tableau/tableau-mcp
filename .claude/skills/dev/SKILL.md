---
name: dev
description: Common development tasks
---

Handle common dev tasks:

## Build Commands:
- `npm run build` - Production build
- `npm run build:dev` - Development build
- `npm run build:desktop` - Desktop variant
- `npm run build:docker` - Docker image

## Quality Checks:
- `npx tsc --noEmit` - Type check only
- `npx eslint .` - Lint check
- `npx eslint --fix .` - Auto-fix lint issues

## Running Server:
- `npm run start:http` - Start HTTP server (port 3927)
- `npm run start:http:apm` - Start with APM tracing

## MCP Inspector:
- `npm run inspect` - Build + inspect (stdio)
- `npm run inspect:http` - HTTP server + inspector

When user says "check the build" or "run quality checks":
1. Run type check
2. Run lint
3. Run tests
4. Report any issues
