#!/bin/bash
set -e

REPO="SeeThruHead/cra-payroll"
INSTALL_DIR="/usr/local/bin"
BINARY_NAME="cra-payroll"

# Detect platform
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin)
    case "$ARCH" in
      arm64) TARGET="cra-payroll-darwin-arm64" ;;
      x86_64) TARGET="cra-payroll-darwin-x64" ;;
      *) echo "❌ Unsupported architecture: $ARCH"; exit 1 ;;
    esac
    ;;
  Linux)
    case "$ARCH" in
      x86_64) TARGET="cra-payroll-linux-x64" ;;
      *) echo "❌ Unsupported architecture: $ARCH"; exit 1 ;;
    esac
    ;;
  *) echo "❌ Unsupported OS: $OS"; exit 1 ;;
esac

echo "📦 Installing cra-payroll ($TARGET)..."

# Download
DOWNLOAD_URL="https://github.com/$REPO/releases/latest/download/$TARGET"
TMP="$(mktemp)"
curl -fSL -o "$TMP" "$DOWNLOAD_URL" || { echo "❌ Download failed. Check https://github.com/$REPO/releases"; exit 1; }

# Remove macOS quarantine
if [ "$OS" = "Darwin" ]; then
  xattr -d com.apple.quarantine "$TMP" 2>/dev/null || true
fi

# Install
chmod +x "$TMP"
if [ -w "$INSTALL_DIR" ]; then
  mv "$TMP" "$INSTALL_DIR/$BINARY_NAME"
else
  echo "🔐 Need sudo to install to $INSTALL_DIR"
  sudo mv "$TMP" "$INSTALL_DIR/$BINARY_NAME"
fi

echo "✅ Installed to $INSTALL_DIR/$BINARY_NAME"
echo ""
echo "Run it:"
echo "  cra-payroll --salary 100000"
echo "  cra-payroll --salary 263000 --table"
