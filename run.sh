#!/usr/bin/env bash
# One-click run for Section Image Correction Editor.
# Installs prerequisites if needed and starts the app.

set -e

# Project root = directory containing this script
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

echo "Section Image Correction Editor"
echo "==============================="

# Check for Node (required for npx serve)
if ! command -v node &>/dev/null; then
  echo "Node.js is required but not installed."
  echo "Install it from https://nodejs.org/ or via your package manager (e.g. brew install node)."
  exit 1
fi

# Install dependencies if package.json has a dependencies section
if [ -f package.json ] && grep -q '"dependencies"' package.json 2>/dev/null; then
  echo "Installing dependencies..."
  npm install
fi

PORT=3333
URL="http://localhost:${PORT}"

echo ""
echo "Starting server at $URL"
echo "Press Ctrl+C to stop."
echo ""

# Open browser after a short delay (works on macOS, Linux, WSL)
(
  sleep 2
  if command -v open &>/dev/null; then
    open "$URL"
  elif command -v xdg-open &>/dev/null; then
    xdg-open "$URL"
  else
    echo "Open $URL in your browser to use the app."
  fi
) &

# Start the app (npx serve downloads serve if needed)
npx --yes serve -l "$PORT" .
