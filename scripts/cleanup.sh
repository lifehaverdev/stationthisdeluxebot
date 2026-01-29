#!/bin/bash
# cleanup.sh - Run from repo root
# Review before running!

set -e

echo "=== Phase 1: DELETE temp and stale root files ==="
rm -rf temp/*
rm -f DEPLOY_WORKER_PLAN.md
rm -f EXPORT_RESILIENCE_PLAN.md
rm -f cookies.txt 2>/dev/null || true

echo "=== Phase 2: Create archive structure ==="
mkdir -p docs/_archived/investigations-nov-2025
mkdir -p docs/_archived/vibecode-migration-2025
mkdir -p docs/_archived/sandbox-audits-2025
mkdir -p docs/_archived/executed-plans
mkdir -p docs/_archived/completed-features
mkdir -p docs/_archived/legacy-deluxebot

echo "=== Phase 2: Move stale docs ==="
# Move /docs/*.md to archive (except plans/)
find docs -maxdepth 1 -name "*.md" -exec mv {} docs/_archived/investigations-nov-2025/ \;

# Move roadmap historical
mv roadmap/_historical/* docs/_archived/vibecode-migration-2025/ 2>/dev/null || true
rmdir roadmap/_historical 2>/dev/null || true

# Move sandbox audits
mv SANDBOX_NODE_SYSTEM_AUDIT.md docs/_archived/sandbox-audits-2025/ 2>/dev/null || true
mv SANDBOX_IMPROVEMENTS_IMPLEMENTED.md docs/_archived/sandbox-audits-2025/ 2>/dev/null || true

# Move legacy archive
mv archive/deluxebot/* docs/_archived/legacy-deluxebot/ 2>/dev/null || true
rmdir archive/deluxebot 2>/dev/null || true

echo "=== Phase 2: Create archive README ==="
cat > docs/_archived/README.md << 'EOF'
# Archived Documentation

Historical documentation preserved for reference. **Not in public repo (gitignored).**

## Structure

- `investigations-nov-2025/` - Investigation reports from Discord/Telegram parity work
- `vibecode-migration-2025/` - Documents from the vibecode → stationthis migration
- `sandbox-audits-2025/` - Sandbox node system audits and improvements
- `collection-analysis/` - One-time collection analysis reports
- `executed-plans/` - Plans that have been fully implemented
- `completed-features/` - Roadmap features that shipped
- `legacy-deluxebot/` - Pre-refactor codebase (deprecated)

## Policy

When a plan in `/docs/plans/` is fully executed:
1. Move it here to `executed-plans/`
2. Keep the date prefix for chronology

When a roadmap feature is complete:
1. Move the feature directory to `completed-features/`
EOF

echo "=== Phase 3: Create temp README ==="
cat > temp/README.md << 'EOF'
# Temp Directory

**Gitignored. For temporary files only.**

- Do not store anything permanent here
- Clean up after yourself
- Large files here will not be committed
EOF

echo "=== Phase 4: Remove from git tracking (already gitignored) ==="
# These are now gitignored, remove from git cache if tracked
git rm -r --cached roadmap/ 2>/dev/null || true
git rm -r --cached docs/plans/ 2>/dev/null || true
git rm -r --cached docs/_archived/ 2>/dev/null || true
git rm -r --cached archive/ 2>/dev/null || true
git rm --cached ROADMAP_EXPLORATION.md 2>/dev/null || true

echo "=== Cleanup complete ==="
echo ""
echo "Internal docs are now gitignored:"
echo "  - roadmap/"
echo "  - docs/plans/"
echo "  - docs/_archived/"
echo "  - archive/"
echo "  - ROADMAP_EXPLORATION.md"
echo ""
echo "Next steps:"
echo "1. Review the changes"
echo "2. git add .gitignore"
echo "3. git commit -m 'chore: cleanup codebase, gitignore internal planning docs'"
