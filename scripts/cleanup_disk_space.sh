#!/bin/bash

# Disk Space Cleanup Script for Digital Ocean Droplet
# Run this on your SSH'd droplet to free up disk space

set -e

echo "🔍 Checking disk usage..."
df -h

echo ""
echo "📊 Docker disk usage breakdown..."
docker system df

echo ""
echo "🧹 Cleaning up Docker resources..."

# Remove stopped containers
echo "  - Removing stopped containers..."
docker container prune -f

# Remove unused images (keep last 2)
echo "  - Removing unused images..."
docker image prune -a -f --filter "until=24h"

# Remove unused volumes
echo "  - Removing unused volumes..."
docker volume prune -f

# Remove build cache
echo "  - Removing build cache..."
docker builder prune -a -f --filter "until=24h"

# Remove dangling images
echo "  - Removing dangling images..."
docker image prune -f

echo ""
echo "📊 Docker disk usage after cleanup..."
docker system df

echo ""
echo "🔍 Checking largest directories..."
du -h --max-depth=1 / 2>/dev/null | sort -hr | head -20

echo ""
echo "🔍 Checking /var/log size..."
du -sh /var/log/* 2>/dev/null | sort -hr | head -10

echo ""
echo "🔍 Checking Docker overlay2 size..."
du -sh /var/lib/docker/overlay2/* 2>/dev/null | sort -hr | head -10

echo ""
echo "✅ Cleanup complete! Checking final disk usage..."
df -h

