---
name: deploy-check
description: Pre-deployment checklist - run all tests and build all variants
---

# Deploy Check Workflow

This skill runs a comprehensive check before deployment.

## Steps

1. **Clean build**
   - Remove existing build artifacts
   - `rm -rf build/`

2. **Run linter**
   - `npm run lint` - Check for linting errors
   - Fix any issues before proceeding

3. **Run all test suites**
   - `npm test` - Unit tests
   - `npm run test:e2e` - End-to-end tests
   - `npm run test:eval` - Evaluation tests
   - `npm run test:oauth:embedded` - OAuth embedded tests
   - Check for any failures

4. **Build all variants**
   - `npm run build` - Default variant
   - `npm run build:desktop` - Desktop variant
   - `npm run build:combined` - Combined variant
   - Verify all builds succeed

5. **Build Docker image**
   - `npm run build:docker`
   - Check for build errors

6. **Verify package.json**
   - Check version number is correct
   - Verify dependencies are up to date
   - Check for security vulnerabilities: `npm audit`

7. **Test Docker container locally**
   - Start container: `npm run start:http:docker`
   - Verify health endpoint responds
   - Stop container

8. **Review changes**
   - `git diff main` - Review all changes
   - Check CLAUDE.md is up to date
   - Verify README reflects new features

9. **Security check**
   - Verify no secrets in code/commits
   - Check .env is in .gitignore
   - Review OAuth configuration

10. **Create deployment summary**
    - List what changed
    - Note any breaking changes
    - Document migration steps if needed

## Success Criteria

- ✅ All tests pass
- ✅ All variants build successfully
- ✅ Linter passes
- ✅ Docker image builds and runs
- ✅ No security issues
- ✅ Documentation is current
