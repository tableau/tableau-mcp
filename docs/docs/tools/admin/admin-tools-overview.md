---
sidebar_position: 1
---

# Admin Tools Overview

The Tableau MCP server provides a comprehensive set of administrative tools for managing users, groups, content, permissions, and site operations. These tools are designed for Tableau administrators who need programmatic access to administrative functions.

## Tool Categories

### User & Group Administration

- **[admin-users](./admin-users.md)** - Manage Tableau users including creation, updates, deletion, and OAuth credential management
- **[admin-groups](./admin-groups.md)** - Manage groups, group sets, and group memberships

### Content Management

- **[content-projects](./content-projects.md)** - Create, update, delete, and query projects
- **[content-workbooks](./content-workbooks.md)** - Advanced workbook operations including querying, updating, deleting, and downloading
- **[content-views](./content-views.md)** - Query views and export data in multiple formats (CSV, image, PDF, Excel)

### Permissions & Access Control

- **[content-permissions](./content-permissions.md)** - Manage granular and default permissions for content

### Operations & Monitoring

- **[site-jobs](./site-jobs.md)** - Query and manage background jobs on the site
- **[tableau-operations](./tableau-operations.md)** - Advanced operational tools including job conflict detection, effective permissions analysis, and workbook archiving

## Required Scopes

Admin tools require specific OAuth scopes depending on the operations performed. Common scopes include:

- `tableau:mcp:admin:users` - User administration
- `tableau:mcp:admin:groups` - Group administration
- `tableau:mcp:admin:permissions` - Permission management
- `tableau:mcp:admin:jobs` - Job monitoring
- `tableau:mcp:admin:operations` - Advanced operations

Refer to individual tool documentation for specific scope requirements.

## Tool Filtering

You can control access to admin tools using the `INCLUDE_TOOLS` or `EXCLUDE_TOOLS` environment variables with tool group names:

```bash
# Enable only admin and content tools
INCLUDE_TOOLS=admin,content

# Disable operations tools
EXCLUDE_TOOLS=operations
```

See [Tool Scoping](../../configuration/mcp-config/tool-scoping.md) for more information.
