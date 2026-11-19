---
sidebar_position: 3
---

# Find Open Tableau Studio Windows

{/* availability */}
<span className="toolAvailability">Available September 2026 and later.</span>
{/* /availability */}

Discovers the running local %product_name% instances the server can connect to and returns each one's session id, along with its loopback base URL, reported API version (when advertised), and whether an authentication token is present. Use the returned session id in the `session` parameter of the other %product_name% tools to target a specific instance.

## APIs called

This tool does not call the %product_name% %ecapi_name%. It discovers instances by reading local discovery state that each running %product_name% publishes, so there is no per-instance route request and no `%ecapi_name%` call.

- Find running instances — reads the per-instance discovery records that each running %product_name% writes to a local application-data directory, keeps only the records it can parse, and drops any whose operating-system process is no longer alive. This is a local filesystem read plus an in-process liveness check; **no `%ecapi_name%` call is made**, so there is no route to ground here.

Each discovered instance advertises a loopback base URL (for example `http://127.0.0.1:8765`) and a per-session bearer token. That token is the auth used to reach the instance's %ecapi_name% over the loopback interface, and it is how every other %product_name% tool authorizes its calls; this tool only reports whether a token is present (`hasToken`) and never returns the token itself.

## Notes and caveats

- The session id is the running %product_name% instance's operating-system process id, returned as a string. Pass it in the `session` parameter of other tools to control that instance.
- Instances are returned newest-first, based on when each instance started.
- Only the presence of an authentication token is reported, via the boolean `hasToken`; the token value is never included in the result.
- When no running instances are discovered, the tool returns an error (HTTP 404) rather than an empty list, prompting the caller to confirm that %product_name% is running and reachable.
- The `message` field still names the product "Tableau Desktop", as shown in the example below. That is the literal text the tool returns today and is reproduced here verbatim; read it as %product_name%.

## Example results

### Instances found

```json
{
  "message": "Found 2 running Tableau Desktop instances (External Client API).",
  "instances": [
    {
      "sessionId": "77700",
      "pid": 77700,
      "baseUrl": "http://127.0.0.1:8765",
      "apiVersion": "1.0",
      "hasToken": true
    },
    {
      "sessionId": "26928",
      "pid": 26928,
      "baseUrl": "http://127.0.0.1:8766",
      "hasToken": true
    }
  ],
  "instructions": "Use the session ID of the instance you want to use in the session parameter of other tools."
}
```

### No running instances

When nothing is discovered, the tool returns an error result (HTTP 404) reporting that no running %product_name% instances were found and prompting the caller to confirm that %product_name% is running and that its discovery information is available.
