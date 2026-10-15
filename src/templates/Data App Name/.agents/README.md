# .agents/

This folder holds context docs for AI agents (and people) that build or change this Tableau data
app. It ships inside the packaged `.twbx` next to the `.twb` and `Packages/`, so it travels with
the workbook through publish and download. Tableau ignores it; it is not part of the app's runtime.

## Before you modify this app

Read every file in this folder first. Follow `spec.md` and `design.md` unless the user asks for
something different, and check `memories.md` for decisions and gotchas that were already worked
out. If this README is the only file here, nobody has written docs for the app yet.

## Files

Use these fixed names so the next agent always knows where to look:

| File | Purpose |
|---|---|
| `spec.md` | What the app must do: questions it answers, data source and fields, filters, acceptance criteria. |
| `design.md` | How it should look and behave: layout, visual style, interactions. |
| `memories.md` | Dated log of decisions and gotchas learned while building. Add to the end; don't rewrite history. |
| `history/` | Earlier versions of user-supplied files that have been replaced (see below). |

Other files (for example `todo.md`) are fine. Keep them in this folder and list them in the table
above.

All of these files are optional. Write them only when they add value, such as when the user supplies
context files, or when the request is vague or spans several steps. A clear one-shot change doesn't
need any docs.

## Frontmatter

Every doc except this README starts with:

```yaml
---
version: 1          # increment when the file is replaced or substantially rewritten
updated: 2026-01-31 # date of the last change (YYYY-MM-DD)
source: user        # user (supplied by the user) | agent (written by an agent)
---
```

## Replacing user-supplied files

When the user brings a file whose name already exists here, move the current file to
`history/<name>.v<version>.<YYYY-MM-DD>.md` (for example `history/spec.v1.2026-01-31.md`), then
write the new file with `version` incremented. Agent edits don't need history entries, because
Tableau's workbook revision history already versions the whole `.twbx`.

## Rules

- **Never put secrets here.** No tokens, passwords, API keys, credentials, or personal data. Anyone
  who can download the workbook can read this folder.
- Keep docs short and text-only, well under about 100 KB in total. Don't add datasets, screenshots,
  binaries, or pasted transcripts; summarize instead.
- Never put these docs under `Packages/<id>/content/`. That folder is the extension's web root and
  is served to the browser.
- When repackaging the `.twbx`, include this folder, and check that it is in the archive before
  publishing.
