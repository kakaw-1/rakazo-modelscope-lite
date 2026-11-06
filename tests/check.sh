#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
bash -n deploy/entrypoint.sh
bash -n deploy/desktopctl
node --check deploy/patch-desktop.mjs
node --check deploy/health.mjs
node tests/check.mjs
