---
sidebar_position: 1
---

# List Instances

Lists running Tableau Desktop instances discovered on the local computer. Call this first and pass
the returned `sessionId` as the `session` argument to every other Desktop authoring tool.

This tool has no arguments. Each returned instance includes `sessionId`, process ID, Agent API port,
start time, and whether the instance advertised an authentication secret.
