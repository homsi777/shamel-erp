#!/bin/bash
# UTF-8
set -e
BASE_URL="${BASE_URL:-http://localhost:3333}"

echo "Running E2E via Node harness against: $BASE_URL"
node scripts/test-e2e.cjs
