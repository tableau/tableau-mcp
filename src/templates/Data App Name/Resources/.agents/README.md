# Resources/.agents/

This folder holds context docs for AI agents (and people) that build or change this Tableau data
app. It ships inside the packaged `.twbx` under `Resources/`, next to the `.twb` and `Packages/`, so
it travels with the workbook through publish and download. Tableau ignores it; it is not part of the
app's runtime.

Before you modify this app, read every file in this folder. If this README is the only file here,
nobody has written docs for the app yet.

## Rules

- **Never put secrets here.** No tokens, passwords, API keys, credentials, or personal data. Anyone
  who can download the workbook can read this folder.
- Never put these docs under `Packages/<id>/content/`. That folder is the extension's web root and
  is served to the browser.
- When repackaging the `.twbx`, include this folder.
