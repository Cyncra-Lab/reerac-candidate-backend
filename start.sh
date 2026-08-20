#!/bin/sh
set -e

if [ -f dist/main.js ]; then
  exec node dist/main.js
fi

if [ -f dist/src/main.js ]; then
  echo "WARN: using legacy build output at dist/src/main.js"
  exec node dist/src/main.js
fi

echo "ERROR: compiled entry point not found"
ls -la /app || true
ls -la dist || true
exit 1
