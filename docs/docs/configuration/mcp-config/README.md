# Configuring Tableau MCP

The Tableau MCP server makes use of environment variables to configure its behavior.

Environment variables can be provided in many different ways, including:

- System and user level environment variables.
- Environment variables specified in a `.env` file.
- AI tools via their MCP configuration.
- [A variety of ways](https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/)
  when running in Docker.

Use [key-value storage configuration](storage.md) to select in-memory storage or bring your own
backend implementation.

Beyond environment variables, some configuration can be overridden at a more granular level:

- **[Site Settings](site-settings.md)** — Override select configuration variables on a per-site basis via the REST API. Site settings are applied on top of environment variables for all users authenticated to the site.
- **[Request Overrides](request-overrides.md)** — Override select configuration variables on a per-request basis via an HTTP header. Request overrides are applied on top of site settings and environment variables, and are only available when using the HTTP transport.

In this section:

- [Environment Variables](env-vars.md): All Tableau MCP environment variables and what they control.
- [Authentication](authentication/README.md): Ways to authenticate Tableau MCP to Tableau Server or Tableau Cloud.
- [Enabling OAuth (Tableau Server)](oauth.md): Enable OAuth on Tableau Server. Cloud users should use the Cloud OAuth page under Authentication.
- [HTTP Server](http-server.md): Run Tableau MCP as a Streamable HTTP server for remote, multi-client deployments.
- [Tool Scoping](tool-scoping.md): Limit tools to a set of data sources, workbooks, views, projects, or tags.
- [Site Settings](site-settings.md): Per-site configuration overrides applied via the REST API, on top of environment variables.
- [Request Overrides](request-overrides.md): Per-request configuration via an HTTP header (HTTP transport only).
- [MCP Configuration for Site Administrators](site-administrators.md): Governance and security guidance for site and server admins.
- [Configure a Local Tableau MCP Service](configure-local-service.md): Where to put configuration when running MCP locally for yourself.
