#!/bin/sh
# Install the shared-data post-checkout hook.
#
# Runs from `pnpm install` (package.json `prepare`) and is safe to run again.
# In a linked worktree `.git` is a file, so resolve the real hooks directory
# through Git rather than assuming `.git/hooks`.
set -eu

git rev-parse --git-dir >/dev/null 2>&1 || exit 0

root=$(cd "$(dirname "$0")/.." && pwd)
hooks=$(git rev-parse --git-path hooks)
mkdir -p "$hooks"
ln -sf "$root/scripts/post-checkout" "$hooks/post-checkout"
