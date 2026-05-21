# Configuring Tableau MCP

The Tableau MCP server makes use of environment variables to configure its behavior.

Environment variables can be provided in many different ways, including:

- System and user level environment variables.
- Environment variables specified in a `.env` file.
- AI tools via their MCP configuration.
- [A variety of ways](https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/)
  when running in Docker.

Beyond environment variables, some configuration can be overridden at a more granular level:

- **[Site Settings](site-settings.md)** — Override select configuration variables on a per-site basis via the REST API. Site settings are applied on top of environment variables for all users authenticated to the site.
- **[Request Overrides](request-overrides.md)** — Override select configuration variables on a per-request basis via an HTTP header. Request overrides are applied on top of site settings and environment variables, and are only available when using the HTTP transport.
