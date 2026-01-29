#!/bin/bash
# cleanup-root.sh - Clean up root directory cruft
# Run from repo root

set -e
cd "$(dirname "$0")/.."

echo "=== Phase 1: DELETE cruft ==="
rm -f backup-before-migration.json
rm -f GxM_Vu0aoAAOJmp.jpeg
rm -f deploy.legacy.sh
rm -rf stationthisdeluxebot/  # empty nested dir

echo "=== Phase 2: MOVE shell scripts to /scripts/ ==="
mv cleanup_disk_space.sh scripts/ 2>/dev/null || true
mv cleanup.sh scripts/ 2>/dev/null || true
mv debugdeploy.sh scripts/ 2>/dev/null || true
mv logs.sh scripts/ 2>/dev/null || true
mv run-dev-training.sh scripts/ 2>/dev/null || true
mv run-dev.sh scripts/ 2>/dev/null || true
mv run-dry.sh scripts/ 2>/dev/null || true
mv run-with-env.sh scripts/ 2>/dev/null || true

echo "=== Phase 3: MOVE plan to docs/plans/ ==="
mv COLLECTION_REVIEW_OPTIMIZATION_PLAN.md docs/plans/ 2>/dev/null || true

echo "=== Phase 4: ARCHIVE agent_prompts ==="
mkdir -p docs/_archived/agent-prompts-2025
mv agent_prompts/* docs/_archived/agent-prompts-2025/ 2>/dev/null || true
rmdir agent_prompts 2>/dev/null || true

echo "=== Phase 5: Untrack from git ==="
git rm -r --cached stationthisdeluxebot/ 2>/dev/null || true
git rm --cached backup-before-migration.json 2>/dev/null || true
git rm --cached GxM_Vu0aoAAOJmp.jpeg 2>/dev/null || true
git rm --cached deploy.legacy.sh 2>/dev/null || true
git rm --cached cleanup_disk_space.sh 2>/dev/null || true
git rm --cached debugdeploy.sh 2>/dev/null || true
git rm --cached logs.sh 2>/dev/null || true
git rm --cached run-dev-training.sh 2>/dev/null || true
git rm --cached run-dev.sh 2>/dev/null || true
git rm --cached run-dry.sh 2>/dev/null || true
git rm --cached run-with-env.sh 2>/dev/null || true
git rm -r --cached agent_prompts/ 2>/dev/null || true

echo ""
echo "=== Root cleanup complete ==="
echo ""
echo "Root now contains only:"
echo "  - app.js, worker.js (entry points)"
echo "  - deploy.sh (main deploy script)"
echo "  - Dockerfile, docker-compose.yml, Caddyfile (operational)"
echo "  - package.json, package-lock.json (dependencies)"
echo "  - README.md, CONTRIBUTING.md (public docs)"
echo "  - .env, .env-example, .gitignore, .dockerignore (config)"
echo "  - site.webmanifest (web manifest)"
echo ""
echo "Shell scripts moved to /scripts/"
echo "Agent prompts archived to /docs/_archived/agent-prompts-2025/"
echo ""
echo "Next: git add -A && git commit -m 'chore: clean root directory, move scripts'"
