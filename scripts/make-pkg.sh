#!/bin/sh
# Builds an unsigned macOS installer package: dist/zampp-<version>.pkg
# Installs the app code to /usr/local/zampp, the CLI to /usr/local/bin/zampp and
# zampp.app to /Applications. Node.js 24+ must already be installed (checked by preinstall).
set -eu
cd "$(dirname "$0")/.."
VERSION="$(node -p "require('./package.json').version")"
export NODE_EXTRA_CA_CERTS="${NODE_EXTRA_CA_CERTS:-}"
STAGE="$(mktemp -d)"
ROOT="$STAGE/root"
SCRIPTS="$STAGE/scripts"
mkdir -p "$ROOT/usr/local/zampp" "$ROOT/usr/local/bin" "$ROOT/Applications" "$SCRIPTS" dist

echo "… building web panel"
(cd ui && npm install --no-fund --no-audit --loglevel=error >/dev/null && npm run build --silent >/dev/null)
echo "… building desktop app"
sh desktop/macos/build.sh >/dev/null
cp -R desktop/macos/build/zampp.app "$ROOT/Applications/zampp.app"

echo "… staging payload"
for item in bin src templates package.json package-lock.json README.md LICENSE; do cp -R "$item" "$ROOT/usr/local/zampp/"; done
mkdir -p "$ROOT/usr/local/zampp/ui" && cp -R ui/dist "$ROOT/usr/local/zampp/ui/dist"
(cd "$ROOT/usr/local/zampp" && npm install --omit=dev --no-fund --no-audit --loglevel=error >/dev/null)
cat > "$ROOT/usr/local/bin/zampp" <<'WRAP'
#!/bin/sh
NODE="$(command -v node || true)"
for c in /opt/homebrew/bin/node /usr/local/bin/node; do [ -z "$NODE" ] && [ -x "$c" ] && NODE="$c"; done
[ -n "$NODE" ] || { echo "zampp: Node.js 24+ is required (https://nodejs.org)"; exit 1; }
exec "$NODE" /usr/local/zampp/bin/zampp.ts "$@"
WRAP
chmod 755 "$ROOT/usr/local/bin/zampp"

cat > "$SCRIPTS/preinstall" <<'PRE'
#!/bin/sh
NODE="$(command -v node || true)"
for c in /opt/homebrew/bin/node /usr/local/bin/node; do [ -z "$NODE" ] && [ -x "$c" ] && NODE="$c"; done
if [ -z "$NODE" ] || [ "$("$NODE" -p 'process.versions.node.split(".")[0]')" -lt 24 ]; then
  osascript -e 'display alert "zampp needs Node.js 24 or newer" message "Install it from https://nodejs.org (or: brew install node), then run the installer again." as critical' >/dev/null 2>&1 || true
  exit 1
fi
exit 0
PRE
cat > "$SCRIPTS/postinstall" <<'POST'
#!/bin/sh
chmod -R a+rX /usr/local/zampp /Applications/zampp.app
xattr -dr com.apple.quarantine /Applications/zampp.app 2>/dev/null || true
exit 0
POST
chmod 755 "$SCRIPTS/preinstall" "$SCRIPTS/postinstall"

OUT="dist/zampp-$VERSION.pkg"
# pkgbuild prints harmless "write: Permission denied" lines when it cannot reach its cache; only show output on failure.
if ! pkgbuild --root "$ROOT" --scripts "$SCRIPTS" --identifier dev.zampp.pkg --version "$VERSION" --install-location / "$OUT" >"$STAGE/pkgbuild.log" 2>&1; then
  cat "$STAGE/pkgbuild.log"; exit 1
fi
rm -rf "$STAGE"
echo "built $OUT ($(du -h "$OUT" | cut -f1))"
