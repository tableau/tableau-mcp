---
sidebar_position: 4
---

# Debugging

The easiest way to debug is to set `TRANSPORT` to `http` and run `npm run start:http` from the
JavaScript Debug Terminal in VS Code / Cursor.

If you want want to use `stdio` transport, it's a bit more complicated by using the
[VS Code Run and Debug Launcher](https://code.visualstudio.com/docs/debugtest/debugging#_start-a-debugging-session)
to run and debug the server.

To set up local debugging with breakpoints:

1. Store your environment variables in the VS Code user settings:

   - Open the Command Palette (F1 or Cmd/Ctrl + Shift + P).
   - Type `Preferences: Open User Settings (JSON)`.
   - This should open your user's `settings.json` file.
   - Copy the environment variables from `.vscode/settings.example.json`, append them to the JSON
     blob in your user's `settings.json` file, and update their values accordingly:

     ```
     "tableau.mcp.SERVER": "https://my-tableau-server.com",
     ...
     ```

2. Set breakpoints in your TypeScript files.
3. Locate and click the `Run and Debug` button in the Activity Bar.
4. Select the configuration labeled "`Launch MCP Server`" in the dropdown.
5. Click the Start Debugging ▶️ button, or press F5.
