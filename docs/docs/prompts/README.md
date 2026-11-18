---
sidebar_position: 0
---

# Prompts

Guided admin [prompts](https://modelcontextprotocol.io/specification/2025-06-18/server/prompts) that orchestrate multiple tools. Gated behind the [`ADMIN_TOOLS_ENABLED`](../configuration/mcp-config/env-vars.md#admin_tools_enabled) environment variable.

In this section:

- [Stale Content Cleanup — Inform](stale-content-cleanup-inform.md): Read-only report of stale workbooks and published data sources.
- [Stale Content Cleanup — Apply](stale-content-cleanup-apply.md): After approval, tag and delete stale content to the recycle bin.
- [Job Optimization — Inform](job-optimization-inform.md): Read-only analysis of Admin Insights job performance.
- [Extract Refresh Optimization — Apply](extract-optimization-apply.md): After approval, keep, downgrade, or delete extract refresh tasks.
- [User License Reclamation — Inform](user-license-reclamation-inform.md): Read-only list of inactive licensed users who could be unlicensed.
- [User License Reclamation — Apply](user-license-reclamation-apply.md): After approval, downgrade inactive users to Unlicensed.
