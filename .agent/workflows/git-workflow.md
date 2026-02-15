---
description: Git branching and PR workflow — never push directly to main
---

## Rules

1. **NEVER push directly to `main`**. Always create a feature branch.
2. **NEVER merge locally into `main` and push**. Use PRs instead.

## Steps

1. Create a new branch from `main`:
   ```
   git checkout main && git pull origin main
   git checkout -b <branch-name>
   ```

2. Commit changes to the feature branch:
   ```
   git add <files>
   git commit -m "<message>"
   ```

3. Push the feature branch:
   ```
   git push -u origin <branch-name>
   ```

4. Raise a PR via the GitHub URL:
   ```
   https://github.com/AlbinDavis/InTime/pull/new/<branch-name>
   ```
   Provide the user the link to create/review the PR.
