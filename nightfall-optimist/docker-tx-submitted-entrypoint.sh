#!/usr/bin/env bash

if [ -z "${USE_EXTERNAL_NODE}" ];
then
  # wait until there's a blockchain client up
  while ! nc -z ${BLOCKCHAIN_WS_HOST} ${BLOCKCHAIN_PORT}; do sleep 3; done
fi

# Launch Transaction Submitted Workers
if [ "${OPTIMIST_TX_WORKER_COUNT}" ]; then
  exec "$@"
fi
