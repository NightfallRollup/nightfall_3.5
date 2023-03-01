#!/usr/bin/env bash

if [ -z "${USE_EXTERNAL_NODE}" ];
then
  # wait until there's a blockchain client up
  while ! nc -z ${BLOCKCHAIN_WS_HOST} ${BLOCKCHAIN_PORT}; do sleep 3; done
fi

# Launch Transaction Submitted Workers
if [ "${TX_WORKER_COUNT}" ]; then
  mkdir -p /tmp
  node /app/src/workers/transaction-submitted-app.mjs > /tmp/transaction-submitted-worker.txt &
fi
# Launch Block Proposed Workers
if [ "${BLOCK_PROPOSED_WORKER_COUNT}" ]; then
  mkdir -p /tmp
  node /app/src/workers/block-proposed-app.mjs > /tmp/block-proposed-worker.txt &
fi
# Launch Block Assembly  Workers 
# Block Assembly workers are disabled because there is a problem with the websockets. I will disable for now,
#   but leave the code just in case
#if [ "${BLOCK_ASSEMBLY_WORKER_COUNT}" ]; then
  #mkdir -p /tmp
  #node /app/src/workers/block-assembly-app.mjs > /tmp/block-assembly-worker.txt &
#fi
exec "$@"
