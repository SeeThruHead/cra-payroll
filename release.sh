#!/bin/bash
set -e

BUMP="${1:-patch}"

if [[ "$BUMP" != "patch" && "$BUMP" != "minor" && "$BUMP" != "major" ]]; then
  echo "Usage: ./release.sh [patch|minor|major]"
  exit 1
fi

# Ensure clean working tree
if [[ -n "$(git status --porcelain)" ]]; then
  echo "❌ Git working directory not clean. Commit or stash changes first."
  exit 1
fi

# Restore README on exit (success or failure)
cleanup() { [ -f README.md.bak ] && mv README.md.bak README.md; }
trap cleanup EXIT

# Bump version (updates package.json, commits, and tags)
npm version "$BUMP"

# Push commit and tag
git push && git push --tags

# Build and publish to npm (swap README for npm)
bun run build:npm
cp README.md README.md.bak
cp npm-README.md README.md
npm publish --access public

echo "✅ Released $(node -p "require('./package.json').version")"
