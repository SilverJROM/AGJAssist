# Decision - 404 app_path Guess

## Context

R12.5 requires the 404 callback to include an `<app_path guess>` and a suggested slug derived from the walked-up directory or run directory.

## Decision

For the client-side callback text, `cmd_register` walks upward from `run_dir` to the nearest directory containing `.git`. If found, that path is used as the app-path guess and its basename is used as the suggested slug. If no `.git` directory is found before `/`, the original `run_dir` is used.

## Reasoning

The overmind project is intended to represent an app/repo root, while run directories commonly live under a project planning folder. The nearest `.git` root is the best local signal available to the shell client without server metadata.
