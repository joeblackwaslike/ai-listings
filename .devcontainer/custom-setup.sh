#!/usr/bin/env bash
# Project-specific devcontainer setup hook.
# Called by discover-deps.sh on every container attach, after automatic dependency detection.
#
# See docs/discover-deps.md for documentation and examples.
#
# Examples:
#   bun add -g @myorg/internal-cli
#   psql -U postgres -c "CREATE DATABASE myapp;" 2>/dev/null || true
#   export MY_PROJECT_ENV=devcontainer
