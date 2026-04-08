#!/usr/bin/env bash
# SetupMyAi — global CLI installer
# Usage: curl -fsSL https://raw.githubusercontent.com/SarthakChawla/SetupMyAi/main/scripts/install.sh | bash
set -euo pipefail

PACKAGE="@setupmyai/cli"

echo "==> Installing SetupMyAi CLI..."

# Detect package manager
if command -v pnpm &>/dev/null; then
  PM="pnpm"
elif command -v npm &>/dev/null; then
  PM="npm"
else
  echo "Error: pnpm or npm is required. Install pnpm: https://pnpm.io/installation"
  exit 1
fi

# Install globally
echo "==> Installing ${PACKAGE} globally via ${PM}..."
$PM add -g "${PACKAGE}"

echo ""
echo "Done! Run 'setupmyai --help' to get started."
echo ""
echo "Quick start:"
echo "  cd your-project"
echo "  setupmyai init          # Interactive picker"
echo "  setupmyai list          # See available packages"
