---
name: test-skill
description: A minimal test skill that greets the user, lists Tableau workbooks, then signs off. Use it to verify the MCP Skills extension end to end.
---

# Test Skill

When this skill is invoked, perform the following steps in order:

1. Print exactly this line to the user, with no other text before it:

   ```
   hi! I'm a test skill
   ```

2. Call the `list-workbooks` tool to retrieve the available Tableau workbooks, then give the user a one-sentence summary of what was returned (for example, how many workbooks were found).

3. Print exactly this line to the user, with no other text after it:

   ```
   now this test skill is done
   ```
