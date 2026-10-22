#!/bin/sh
# zampp installer — https://github.com/MHK-26/zampp
#
#   curl -fsSL https://raw.githubusercontent.com/MHK-26/zampp/main/install.sh | sh
#
# Installs the app code to ~/.zampp/app, the `zampp` command on your PATH and (macOS) the
# native control panel to /Applications. Re-run to update. `sh install.sh --uninstall` removes it.
set -eu

REPO="${ZAMPP_REPO:-https://github.com/MHK-26/zampp.git}"
BRANCH="${ZAMPP_BRANCH:-main}"
HOME_DIR="${ZAMPP_HOME:-$HOME/.zampp}"
APP_DIR="$HOME_DIR/app"
MIN_NODE=24

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
ok() { printf '  \033[32m✔\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✖\033[0m %s\n' "$1" >&2; exit 1; }

pick_bin_dir() {
  for d in /opt/homebrew/bin /usr/local/bin "$HOME/.local/bin"; do
    if [ -d "$d" ] && [ -w "$d" ]; then echo "$d"; return; fi
  done
  mkdir -p "$HOME/.local/bin"
  echo "$HOME/.local/bin"
}

uninstall() {
  bold "Uninstalling zampp"
  if [ -x "$APP_DIR/bin/zampp.ts" ] && command -v node >/dev/null 2>&1; then
    node "$APP_DIR/bin/zampp.ts" stop >/dev/null 2>&1 || true
  fi
  pkill -f "zampp.ts serve" 2>/dev/null || true
  for d in /opt/homebrew/bin /usr/local/bin "$HOME/.local/bin"; do
    [ -f "$d/zampp" ] && grep -q "zampp/app/bin/zampp.ts" "$d/zampp" 2>/dev/null && rm -f "$d/zampp" && ok "removed $d/zampp"
  done
  [ -d /Applications/zampp.app ] && rm -rf /Applications/zampp.app && ok "removed /Applications/zampp.app"
  [ -d "$HOME/Applications/zampp.app" ] && rm -rf "$HOME/Applications/zampp.app" && ok "removed ~/Applications/zampp.app"
  rm -rf "$APP_DIR" && ok "removed $APP_DIR"
  if [ "${1:-}" = "--purge" ]; then
    rm -rf "$HOME_DIR" && ok "removed $HOME_DIR (databases, sites config, logs)"
  else
    warn "kept $HOME_DIR (your databases, site configs and logs). Add --purge to delete it."
  fi
  exit 0
}

case "${1:-}" in
  --uninstall) uninstall "${2:-}" ;;
  --help|-h) sed -n '2,8p' "$0"; exit 0 ;;
esac

bold "Installing zampp"
OS="$(uname -s)"
case "$OS" in
  Darwin) ok "macOS $(sw_vers -productVersion 2>/dev/null || echo '') ($(uname -m))" ;;
  Linux) warn "Linux is not tested yet; the web panel and CLI should work, the desktop app is macOS-only" ;;
  *) fail "Unsupported OS: $OS" ;;
esac

command -v git >/dev/null 2>&1 || fail "git is required. On macOS run: xcode-select --install"

# Node.js
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt "$MIN_NODE" ]; then
  if command -v brew >/dev/null 2>&1; then
    warn "Node.js $MIN_NODE+ not found, installing with Homebrew…"
    brew install node >/dev/null
  else
    fail "Node.js $MIN_NODE or newer is required. Install it from https://nodejs.org or with Homebrew (brew install node), then re-run."
  fi
fi
NODE="$(command -v node)"
ok "Node.js $(node -v) at $NODE"
command -v brew >/dev/null 2>&1 && ok "Homebrew found (used for MySQL/MariaDB)" || warn "Homebrew not found: MySQL/MariaDB cannot be installed automatically (https://brew.sh)"

# Code
mkdir -p "$HOME_DIR"
if [ -d "$APP_DIR/.git" ]; then
  printf '  … updating %s\n' "$APP_DIR"
  git -C "$APP_DIR" fetch -q origin "$BRANCH"
  git -C "$APP_DIR" checkout -q "$BRANCH"
  git -C "$APP_DIR" reset -q --hard "origin/$BRANCH"
else
  printf '  … cloning into %s\n' "$APP_DIR"
  rm -rf "$APP_DIR"
  git clone -q --depth 1 --branch "$BRANCH" "$REPO" "$APP_DIR"
fi
ok "zampp $(node -p "require('$APP_DIR/package.json').version") source ready"

# Dependencies and web panel
printf '  … installing dependencies\n'
(cd "$APP_DIR" && npm install --omit=dev --no-fund --no-audit --loglevel=error)
(cd "$APP_DIR/ui" && npm install --no-fund --no-audit --loglevel=error && npm run build --silent >/dev/null)
ok "web control panel built"

# CLI wrapper
BIN_DIR="$(pick_bin_dir)"
cat > "$BIN_DIR/zampp" <<WRAP
#!/bin/sh
# zampp CLI wrapper (installed by install.sh) → $APP_DIR
exec "$NODE" "$APP_DIR/bin/zampp.ts" "\$@"
WRAP
chmod +x "$BIN_DIR/zampp"
ok "command installed: $BIN_DIR/zampp"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) warn "$BIN_DIR is not on your PATH. Add this to your shell profile:  export PATH=\"$BIN_DIR:\$PATH\"" ;;
esac

# Desktop app (macOS)
if [ "$OS" = "Darwin" ]; then
  if xcrun --find swiftc >/dev/null 2>&1; then
    printf '  … building the desktop control panel\n'
    if sh "$APP_DIR/desktop/macos/build.sh" >/dev/null 2>&1; then
      DEST=/Applications
      [ -w /Applications ] || { mkdir -p "$HOME/Applications"; DEST="$HOME/Applications"; }
      rm -rf "$DEST/zampp.app"
      cp -R "$APP_DIR/desktop/macos/build/zampp.app" "$DEST/zampp.app"
      ok "desktop app installed: $DEST/zampp.app"
    else
      warn "desktop app build failed; use the web panel (zampp ui)"
    fi
  else
    warn "Xcode command line tools not found (xcode-select --install); skipping the desktop app. The web panel works: zampp ui"
  fi
fi

echo
bold "Done. Next:"
echo "  zampp start     # installs PHP, phpMyAdmin, Mailpit, MariaDB as needed and starts everything"
echo "  zampp gui       # native control panel (macOS)   ·   zampp ui  # web panel"
echo "  zampp doctor    # if anything looks wrong"
