# Do Not Guess execute_tableau_command Names (Retired → Enforced in Code)

> **Retired knowledge entry.** The load-bearing behavior once documented here is now enforced at the tool boundary in `src/server/command-registry.ts` (verb-allowlist + crash-prone-command guard). This file is kept as a short pointer so retrieval and the `_index.md` map still resolve. The residual, prompt-level behavior that code cannot enforce is tracked as a proposed core update — see `docs/proposed-core-updates/never-guess-command-names.md`.

## When to Use

You rarely need this entry directly. Read the enforcement site (`src/server/command-registry.ts`) when reviewing why an `execute_tableau_command` call was rejected. For the agent-behavior guidance (treat `search_commands` as authoritative; never guess a command name), see the proposed core update linked above.

## Best Practices

- Treat `search_commands` as authoritative: if a command name is not returned, it is not available via MCP. Do not infer `tabui:` / `tabdoc:` names from Tableau menu labels.
- Let the command registry reject unknown or crash-prone verbs; do not work around a rejection by trying name variants.

## Common Mistakes

- Inferring command names from Tableau menu paths and calling them directly — this historically crashed the Desktop session and destroyed unsaved work (some menu items invoke native OS save dialogs that block the main UI thread when called headlessly).
- Retrying multiple plausible name variants after a rejection instead of stopping and offering the user a supported alternative.

## Implementation

The guard lives in `src/server/command-registry.ts` (verb-allowlist + crash-prone-command guard); no knowledge-side action is required. The prompt-level "never guess a command name / offer a supported alternative" behavior is not enforceable in code and is captured in `docs/proposed-core-updates/never-guess-command-names.md`.

## Source and Confidence

- Source/evidence type: field-tested (live authoring session, ben, 2026-06-08 — `tabui:export-image` / `tabdoc:export-image` crashed Desktop after `search_commands` returned no results). Retired to enforcement site + proposed core update on 2026-07-04.
- Confidence: field-tested
- Last reviewed: 2026-07-04
