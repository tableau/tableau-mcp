---
name: test-tool
description: Test a specific MCP tool end-to-end with MCP Inspector
---

# Test Tool Workflow

This skill helps you test an MCP tool thoroughly.

## Steps

1. **Ask which tool to test**
   - Get tool name from user
   - Verify tool exists in `src/tools/web/` or `src/tools/desktop/`

2. **Run unit tests**
   - `npm test -- {toolName}` - Run tool-specific unit tests
   - Check for failures and fix if needed

3. **Build the project**
   - `npm run build` - Build latest changes

4. **Start MCP Inspector**
   - `npm run inspect` - Launches inspector in browser
   - Inspector URL: http://localhost:5173

5. **Test the tool interactively**
   - In Inspector, find the tool in the tools list
   - Fill in required parameters
   - Execute the tool
   - Verify the response

6. **Check logs**
   - Review console output for errors/warnings
   - Check for proper logging and masking
   - Verify no sensitive data leakage

7. **Test error cases**
   - Try invalid parameters
   - Try unauthorized access (if applicable)
   - Verify error messages are helpful

8. **Performance check**
   - Note response times
   - Check for unnecessary API calls
   - Verify proper caching if applicable

## Common Issues

- **Tool not appearing**: Check it's registered in `tools.ts`
- **Auth errors**: Verify .env has valid PAT credentials
- **Timeout**: Check `SERVER` env var is correct
- **Validation errors**: Check Zod schema matches parameters
