/* eslint-disable */

const DB_CLIENT_NAME = 'nightfall_commitments';
const DB_OPTIMIST_NAME = 'optimist_data';

const TRANSACTIONS_COLLECTION = 'transactions ';
const SUBMITTED_BLOCKS_COLLECTION = 'blocks';
const COMMITMENTS_COLLECTION = 'commitments';

use(DB_CLIENT_NAME);
db[TRANSACTIONS_COLLECTION].createIndex({ transactionHash: 1 });
db[SUBMITTED_BLOCKS_COLLECTION].createIndex({ blockNumberL2: -1 });
db[SUBMITTED_BLOCKS_COLLECTION].createIndex({ blockHash: -1 });
db[SUBMITTED_BLOCKS_COLLECTION].createIndex({ blockNumber: -1 });
db[COMMITMENTS_COLLECTION].createIndex({ isNullifiedOnChain: 1 });
db[COMMITMENTS_COLLECTION].createIndex({ isOnChain: 1 });
db[COMMITMENTS_COLLECTION].createIndex({ nullifier: 1 });

use(DB_OPTIMIST_NAME);
db[TRANSACTIONS_COLLECTION].createIndex({ transactionHash: 1 });
db[TRANSACTIONS_COLLECTION].createIndex({ transactionHashL1: 1 });
db[TRANSACTIONS_COLLECTION].createIndex({ commitments: 1 });
db[TRANSACTIONS_COLLECTION].createIndex({ nullifiers: 1 });
db[SUBMITTED_BLOCKS_COLLECTION].createIndex({ blockNumberL2: -1 });
db[SUBMITTED_BLOCKS_COLLECTION].createIndex({ blockHash: -1 });
db[SUBMITTED_BLOCKS_COLLECTION].createIndex({ blockNumber: -1 });
db[SUBMITTED_BLOCKS_COLLECTION].createIndex({ transactionHashes: -1 });
db[SUBMITTED_BLOCKS_COLLECTION].createIndex({ proposer: -1 });
db[SUBMITTED_BLOCKS_COLLECTION].createIndex({ mempool: -1 });
