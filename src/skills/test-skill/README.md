# test-skill

A minimal test skill used to verify the **skills-over-mcp** integration end to end.

When invoked, the skill:

1. Prints `this is a test skill.`
2. Calls the `list-workbooks` tool to list all of the user's Tableau workbooks.
3. Prints `test skill complete`.

## Structure

```
test-skill/
├── SKILL.md                     # Skill frontmatter (name, description) + instructions
├── README.md                    # This file
└── skill-expertise/
    └── list-workbooks.md        # Supporting reference for the list-workbooks step
```

## Usage

This skill exists purely as a wiring/smoke test for the skills capability. It has no
side effects beyond a read-only `list-workbooks` call.
