#!/usr/bin/env bash

# Launch Block Proposed Workers
if [ "${TX_WORKER_COUNT}" ]; then
  mkdir -p /tmp
  node /app/src/workers/transaction-submitted-app.mjs > /tmp/worker.txt &
fi
# Launch Block Proposed Workers
mkdir -p /tmp
node /app/src/workers/block-proposed-app.mjs > /tmp/block-proposed-worker.txt &

exec "$@"
