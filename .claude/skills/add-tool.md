---
name: add-tool
description: Scaffold a new MCP tool with proper structure and tests
---

# Add Tool Workflow

This skill helps you create a new MCP tool following tableau-mcp conventions.

## Steps

1. **Ask for tool details**
   - Tool name (kebab-case, e.g., "get-workbook-data")
   - Tool description
   - Tool type: web or desktop
   - Parameters needed (Zod schema)

2. **Create tool directory**
   - Create `src/tools/{web|desktop}/{toolName}/`

3. **Create tool.ts**
   - Extend `WebTool` or `DesktopTool` class
   - Define `name`, `description`, `paramsSchema`
   - Implement `callback` function
   - Use `TableauWebRequestHandlerExtra` context for auth/config

4. **Create tool.test.ts**
   - Unit tests with vitest
   - Mock Tableau REST API calls
   - Test success and error cases
   - Test parameter validation

5. **Register the tool**
   - Add factory to `src/tools/{web|desktop}/tools.ts`
   - Add tool name constant to `src/tools/{web|desktop}/toolName.ts`

6. **Run checks**
   - `npm run lint:fix` - Fix linting issues
   - `npm test -- {toolName}` - Run tool tests
   - `npm run build` - Ensure it builds

7. **Test with MCP Inspector**
   - `npm run inspect` - Test tool interactively

## Template Reference

```typescript
// tool.ts
import { z } from 'zod';
import { WebTool } from '../tool.js';

const paramsSchema = z.object({
  // Define parameters
});

export class MyTool extends WebTool<typeof paramsSchema> {
  name = 'my_tool' as const;
  description = 'Tool description';
  paramsSchema = paramsSchema;

  callback = async (args: z.infer<typeof paramsSchema>, context) => {
    // Implementation
    return {
      content: [{ type: 'text', text: 'Result' }],
    };
  };
}
```
