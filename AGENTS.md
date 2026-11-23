# Rules for this repository

## Documentation

- The code has the details. Put them in the docstrings and in the comments.
- Do not copy a detail into two places. If a README repeats the code, the two will not agree later.
- Before a commit, look for the old name in all the `*.md`, `*.py` and `*.yaml` files. Use `grep`.
  Do this when you rename, move or delete a file, a folder, an option or a constant.
- If you find that a document is wrong, fix it in the same commit, or tell the user.

## Writing style
- Write in Simplified Technical English (ASD-STE100). Use it for READMEs, docstrings, comments and commits.
  A minimum of 80% of the text must follow it.

## Commits

- Use Conventional Commits: `type(scope): subject`. The types are `feat`, `fix`, `refactor`, `docs`,
  `chore`, `test` and `perf`.
- Write the subject in the imperative, in lower case, with no full stop. 
- The body tells what changed and why. It does not repeat the diff.
- Make one commit for each logical change. Do not mix a refactor and a new feature.
- A refactor must not change the output. Show the check that proves it.