#!/bin/sh
set -eu
cd "$(dirname "$0")"
if [ -x "runtime/node" ]; then NODE_BIN="$(pwd)/runtime/node"; else NODE_BIN="$(command -v node || true)"; fi
if [ -z "$NODE_BIN" ]; then echo '没有找到 Node.js。请使用带运行环境的分享包。'; read -r; exit 1; fi
OPEN_BROWSER=1 "$NODE_BIN" server.js
