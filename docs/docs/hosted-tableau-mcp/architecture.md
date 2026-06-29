---
sidebar_position: 1
---

# Architecture

AI agents (such as Claude, ChatGPT, Slackbot or other AI clients) connect to the hosted
Tableau MCP service through the Tableau routing layer (CloudFront edge location+compute)
which routes the request to corresponding Tableau Cloud pod. Each cloud pod
(e.g. `prod-us-west-c`, `prod-us-east-a`, `eu-west-1a`, ...) runs its own instance of Tableau MCP, which communicates
with the pod-local VizQL Data Service, Metadata API and other REST APIs.

```mermaid
---
config:
  layout: dagre
  theme: default
---
flowchart LR
 subgraph agents["Agents"]
    direction TB
        claude["Claude"]
        chatgpt["ChatGPT"]
        slackbot["Slackbot"]
        otherAgents["..."]
  end
 subgraph routing["Tableau Routing Layer"]
    direction TB
        edgeWest["CloudFront Edge<br/><b>prod-us-west-c</b>"]
        edgeEast["CloudFront Edge<br/><b>prod-us-east-a</b>"]
        edgeEu["CloudFront Edge<br/><b>eu-west-1a</b>"]
        edgeMore["CloudFront Edge<br/><b>...</b>"]
  end
 subgraph cloud["Tableau Cloud Infra"]
    direction LR
        podWest["prod-us-west-c"]
        podEast["&nbsp;<br/>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;prod-us-east-a&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<br/>&nbsp;"]
        podEu["&nbsp;<br/>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;eu-west-1a&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<br/>&nbsp;"]
        podMore["&nbsp;<br/>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;...&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<br/>&nbsp;"]
  end
 subgraph podWest["prod-us-west-c"]
    direction TB
        mcp["Tableau MCP"]
        vizportal["VizQLDataService"]
        vizserver["Metadata API"]
        otherApis["Other REST APIs"]
  end
    claude ~~~ chatgpt ~~~ slackbot ~~~ otherAgents
    podWest ~~~ podEast ~~~ podEu ~~~ podMore
    agents <--> edgeWest & edgeEast & edgeEu & edgeMore
    edgeWest --> podWest
    edgeEast --> podEast
    edgeEu --> podEu
    edgeMore --> podMore
    mcp <--> vizportal
    mcp <--> vizserver
    mcp <--> otherApis
    style agents fill:#FFFFFF,stroke:#9E9E9E
    style routing fill:#FFFFFF,stroke:#9E9E9E
    style cloud fill:#FFFFFF,stroke:#9E9E9E
    style podWest fill:#FFF8E1,stroke:#FFB300
    style podEast fill:#FFF8E1,stroke:#FFB300
    style podEu fill:#FFF8E1,stroke:#FFB300
    style podMore fill:#FFF8E1,stroke:#FFB300
    style edgeWest fill:#BBDEFB
    style edgeEast fill:#BBDEFB
    style edgeEu fill:#BBDEFB
    style edgeMore fill:#BBDEFB
    style mcp fill:#BBDEFB
    style vizportal fill:#B2DFDB
    style vizserver fill:#B2DFDB
    style otherApis fill:#B2DFDB
    style claude fill:#B2DFDB
    style chatgpt fill:#B2DFDB
    style slackbot fill:#B2DFDB
    style otherAgents fill:#B2DFDB
```

> **Note:** Any AI agent (Claude, ChatGPT, Slackbot, ...) can be routed to any CloudFront
> edge location. Each agent's request is directed to the nearest edge location to provide the
> best network latency, so the agent-to-edge pairing shown above is illustrative rather than fixed.

### Request routing sequence

1. An user's AI agent sends unauthenticated request to [mcp.tableau.com](https://mcp.tableau.com).
2. AI agent's unauthenticated request is routed to the nearest Cloudfront edge location to provide best network latency.
3. Unauthenticated request is sent back by Routing Layer returning an `HTTP 401` with a `WWW-Authenticate` header pointing the agent to the OAuth 2.1 flow:

   ```http
   HTTP/2 401
   www-authenticate: Bearer realm="MCP", resource_metadata="https://mcp.tableau.com/.well-known/oauth-protected-resource", scope="tableau:mcp:datasource:read tableau:mcp:workbook:read ..."

   {"error":"unauthorized","error_description":"Authorization required. Use OAuth 2.1 flow. See https://tableau.github.io/tableau-mcp/ for details."}
   ```
4. AI agent starts OAuth flow from the info provided in `www-authenticate` and completes authentication.
5. AI agent starts making authenticated requests to [mcp.tableau.com](https://mcp.tableau.com).
5. Tableau Routing Layer routes the authenticated request to the corresponding tableau cloud pod.