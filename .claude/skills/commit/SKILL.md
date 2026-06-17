---
name: commit
description: Create a git commit following project conventions
---

Create a commit following these rules:

1. **Before committing:**
   - Run `npx tsc --noEmit` - fix any type errors
   - Run `npx eslint --fix .` - auto-fix lint issues
   - Run `npm test -- --run` - ensure tests pass
   - Show me `git status` and `git diff --cached`

2. **Commit message format:**
   - Use conventional commits: `<type>: <description>`
   - Types: feat, fix, refactor, test, docs, chore
   - Keep under 72 characters
   - Example: `feat: add pulse metric insight tool`

3. **Ask for approval:**
   - Show me the exact commit command
   - Wait for my explicit "yes" before running `git commit`

4. **Never:**
   - Commit without asking first
   - Skip the pre-commit checks
   - Force-push without warning
