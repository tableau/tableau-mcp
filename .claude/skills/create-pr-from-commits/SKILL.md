---
name: create-pr-from-commits
description: Use when user asks to create a pull request - automates PR creation by analyzing commits, filling PR template, and submitting with gh pr create
---

# Create PR from Commits

## Overview

Automate pull request creation by extracting information from git commits and filling the repository's PR template. This eliminates manual repetition while ensuring PRs contain complete, accurate information.

## When to Use

Use when:
- User asks to "create a PR"
- User says "make a pull request"
- User requests "submit this for review"
- You've created 2+ PRs in the session (proactively offer this workflow)

Don't use when:
- User wants to manually draft the PR description
- PR requires special context not in commits
- Repository has no PR template

## Core Workflow

```dot
digraph pr_workflow {
    "User requests PR" [shape=doublecircle];
    "Gather git context" [shape=box];
    "Find PR template" [shape=box];
    "Analyze commits" [shape=box];
    "Fill template" [shape=box];
    "Create PR with gh pr create" [shape=box];
    "Return PR URL" [shape=doublecircle];

    "User requests PR" -> "Gather git context";
    "Gather git context" -> "Find PR template";
    "Find PR template" -> "Analyze commits";
    "Analyze commits" -> "Fill template";
    "Fill template" -> "Create PR with gh pr create";
    "Create PR with gh pr create" -> "Return PR URL";
}
```

## Implementation

### Step 1: Gather Git Context (parallel)

Run these commands in parallel with Bash tool:

```bash
# Get all commits since main
git log main..HEAD --format="%h %s%n%b"

# Get full diff
git diff main...HEAD

# Get changed files
git diff main...HEAD --stat

# Check branch tracking
git branch -vv
```

### Step 2: Find PR Template

Common locations (check in order):
1. `.github/pull_request_template.md`
2. `.github/PULL_REQUEST_TEMPLATE.md`
3. `docs/pull_request_template.md`
4. `.gitlab/merge_request_templates/default.md` (GitLab)

Read the template to identify required sections.

### Step 3: Analyze Commits

Extract information for each template section:

**Description/Summary:**
- Combine commit subjects into bullet points
- Group related commits (e.g., "fix lint issues" with main feature)
- Lead with most important change

**Motivation/Context:**
- Look for "why" in commit messages
- Extract issue numbers (e.g., W-12345, #123, GUS-456)
- Infer purpose from code changes if not explicit

**Type of Change:**
- Scan for keywords: "fix" (bug fix), "add" (feature), "breaking" (breaking change), "docs" (documentation)
- Check multiple commits - may have multiple types

**Testing:**
- Look for test file changes in diff (`*.test.ts`, `*.spec.js`)
- Check commit messages mentioning "test"
- Note if all tests pass (check last commit message)

**Breaking Changes:**
- Scan for: renamed env vars, removed APIs, changed defaults
- Check commit bodies for "BREAKING" or "breaking change"

### Step 4: Fill Template

Create PR body using HEREDOC format:

```bash
gh pr create --title "PR Title from commits" --body "$(cat <<'EOF'
## Description
- Bullet point 1 from commit
- Bullet point 2 from commit

## Motivation and Context
[Extracted from commit bodies or inferred from changes]

## Type of Change
- [x] Bug fix
- [ ] New feature
...

## How Has This Been Tested?
[List test files changed or mention manual testing]

## Related Issues
Closes #123, W-45678

## Checklist
- [x] Tests added
- [x] Tests pass
- [ ] Documentation updated
EOF
)"
```

**Template mapping patterns:**

| Template Section | Information Source |
|------------------|-------------------|
| Description/Summary | Commit subjects (bullets) |
| Motivation | Commit bodies + issue refs |
| Type of Change | Keywords in commits + diff analysis |
| Testing | Test file changes + commit messages |
| Breaking Changes | BREAKING in commits + env var changes |
| Checklist items | Verify against actual changes |

### Step 5: Create PR

```bash
# Push if needed
[[ $(git branch -vv | grep 'gone\]') ]] && git push -u origin HEAD

# Create PR
gh pr create --title "..." --body "..."
```

## Edge Cases

### No PR Template Found

If no template exists, create minimal but complete PR:

```bash
gh pr create --title "..." --body "$(cat <<'EOF'
## Summary
- [commit-based bullets]

## Changes
- [files changed summary]

## Testing
[test coverage or manual testing note]
EOF
)"
```

### Multiple Base Branch Options

Check project conventions:
- Most repos: `main`
- Some use: `master`, `develop`, `trunk`

Use `gh pr create --base <branch>` to specify.

### PR Already Exists

If `gh pr create` fails with "pull request already exists":
- Return the existing PR URL
- Offer to update the PR description with `gh pr edit <number>`

## Common Mistakes

### ❌ Asking User for Information Already in Commits

Don't ask: "What should I put in the description?"

The commits contain this information. Extract it.

### ❌ Generic or Vague Descriptions

Don't write: "Various bug fixes and improvements"

Extract specifics: "Fix memory leak in auth flow, improve error logging for failed requests"

### ❌ Skipping Template Sections

Don't leave sections empty with "TODO".

If information is missing, infer from code changes or use reasonable defaults:
- No tests? Say "Manual testing performed"
- No breaking changes? Check the box as "No"

### ❌ Creating PR Before Checking Push Status

Always verify branch is pushed before creating PR:

```bash
git branch -vv  # Check tracking
```

### ❌ Not Handling HEREDOC Properly

Use single quotes in `<<'EOF'` to prevent variable expansion in PR body.

## Quick Reference

**Full command sequence:**

```bash
# 1. Gather context (parallel)
git log main..HEAD --format="%h %s%n%b" &
git diff main...HEAD --stat &
wait

# 2. Find and read template
cat .github/pull_request_template.md

# 3. Create PR with filled template
gh pr create --title "..." --body "$(cat <<'EOF'
[filled template here]
EOF
)"
```

## Real-World Impact

**Before this skill:**
- 2-3 minutes per PR (manual git commands, template reading, copy-paste)
- Inconsistent PR descriptions
- Easy to skip template sections
- Repeated work for multiple PRs

**After this skill:**
- ~30 seconds per PR (automated extraction)
- Consistent, complete PR descriptions
- All template sections filled
- Scalable to many PRs
