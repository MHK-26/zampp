#!/bin/sh
# Builds desktop/macos/build/zampp.app with the system Swift toolchain (no Xcode project needed).
set -eu
cd "$(dirname "$0")"
APP=build/zampp.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -swift-version 5 -O -framework AppKit -o "$APP/Contents/MacOS/zampp" main.swift
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>zampp</string>
  <key>CFBundleDisplayName</key><string>zampp Control Panel</string>
  <key>CFBundleExecutable</key><string>zampp</string>
  <key>CFBundleIdentifier</key><string>dev.zampp.panel</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
</dict></plist>
PLIST
codesign --force --sign - "$APP" >/dev/null 2>&1 || true
echo "built $PWD/$APP"
