---
sidebar_position: 4
---

# Debugging

## Diagnosing missing web tools

Reconnect the MCP client to rerun registration, then search the server logs for
`"logger":"tool-registration"`. These events use the `info` level, so the configured
`LOG_LEVEL` must be `info` or `debug` and a logging sink must be enabled.

- **Scaffold data app gates evaluated** records the `data-apps` flag, Tableau product version
  and build, minimum version, `versionAllowed`, and the combined `disabled` result. For example,
  product version `0.0.0` with build `main.26.1005.0759` fails the `2026.3.1` minimum; the special
  `main` exemption applies to the product-version value, not the build string.
- **Tool registration gates evaluated** lists `eligibleTools` and `omittedTools`. Each omitted
  tool includes its first failing gate: `disabled`, `not-in-include-tools`, `excluded`,
  `site-role-unavailable`, `insufficient-site-role`, or `registration-condition-not-met`.
  Role failures include the required role, and condition failures name the failing condition.
  The summary also records whether role and condition enforcement are enabled. Eligible tools
  have passed these gates; app-only tools may still be hidden by client compatibility checks.

## Local debugging

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
