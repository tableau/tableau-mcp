---
sidebar_position: 2
---

# Check for User Changes

Checks whether the user changed the active workbook after a previously recorded event sequence.

## Required arguments

### `session`

The Tableau Desktop session ID returned by [List Instances](list-instances.md).

## Optional arguments

### `sinceSequence`

The sequence number from an earlier call. Omit it on the first call to establish a checkpoint. The
result always includes `currentSequence`; when later changes are present it also includes their
event sequence, timestamp, and type.
