# Enterprise Deployment

Tableau MCP can be self-hosted on infrastructure you control. The server is a lightweight Node.js
web application that serves many users' MCP clients at once over the Streamable HTTP transport — you
deploy and operate it, exposing it at a URL you own, much like any other internal web app. With
OAuth enabled, each user signs in through Tableau before connecting and acts as themselves, so you
can open the server to your whole user base while keeping access governed by your existing security
and identity policies. The server is highly configurable and built around a plugin model, letting
you adapt operations such as telemetry and monitoring to fit your environment.

## Tableau Server

[Tableau MCP deployment guide for Tableau Server customers](./tableau-server.md).

## Tableau Cloud

[Tableau MCP deployment guide for Tableau Cloud customers](./tableau-cloud.md).
