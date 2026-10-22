#!/bin/sh
# zampp CLI wrapper (installed by install.sh) → /tmp/zampp-test-home/app
exec "/opt/homebrew/bin/node" "/tmp/zampp-test-home/app/bin/zampp.ts" "$@"
