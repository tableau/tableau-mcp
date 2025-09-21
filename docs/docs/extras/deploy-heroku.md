---
sidebar_position: 2
---

# Deploy to Heroku

For information on how the deployment works, see the
[Creating a 'Deploy to Heroku' Button](https://devcenter.heroku.com/articles/heroku-button)
documentation.

[![Deploy to Heroku](https://www.herokucdn.com/deploy/button.svg)](https://www.heroku.com/deploy?template=https://github.com/tableau/tableau-mcp)

As part of the deployment process, Heroku will prompt for the key configuration values:

- SERVER
- SITE_NAME
- PAT_NAME
- PAT_VALUE

## Configure AI Tools with Heroku

Because the Heroku deployment is already configured with your server, site and authentication
settings, configuring in AI tools only needs to point to the instance:

```json
{
  "mcpServers": {
    "tableau": {
      "transport": "http",
      "url": "https://YOUR-APP-NAME.herokuapp.com/tableau-mcp"
    }
  }
}
```

:::warning

Deploying Tableau MCP to Heroku should be considered experimental at this point. Treat your Heroku
instance URL carefully and don't share it.

:::
