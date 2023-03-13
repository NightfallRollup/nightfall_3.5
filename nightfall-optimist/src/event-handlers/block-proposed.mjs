/* eslint-disable import/no-cycle */
import WebSocket from 'ws';
import config from 'config';
import logger from '@polygon-nightfall/common-files/utils/logger.mjs';
import Timber from '@polygon-nightfall/common-files/classes/timber.mjs';
import { getTimeByBlock } from '@polygon-nightfall/common-files/utils/block-utils.mjs';
import { queues } from '@polygon-nightfall/common-files/utils/event-queue.mjs';
import constants from '@polygon-nightfall/common-files/constants/index.mjs';
import * as pm from '@polygon-nightfall/common-files/utils/stats.mjs';
import { checkBlock } from '../services/check-block.mjs';
import {
  saveBlock,
  getTreeByBlockNumberL2,
  saveTree,
  deleteDuplicateCommitmentsAndNullifiersFromMemPool,
  saveTransaction,
  getNumberOfL2Blocks,
} from '../services/database.mjs';
import { getProposeBlockCalldata } from '../services/process-calldata.mjs';
import { syncState } from '../services/state-sync.mjs';
import Proposer from '../classes/proposer.mjs';

const { TIMBER_HEIGHT, HASH_TYPE } = config;
const { ZERO } = constants;

let ws;
// Stores latest L1 block correctly synchronized to speed possible resyncs
let lastInOrderL1Block = 'earliest';
// Counter to monitor resync attempts in case something is wrong we can force a
//   full resync
let consecutiveResyncAttempts = 0;

export function setBlockProposedWebSocketConnection(_ws) {
  ws = _ws;
}

/**
This handler runs whenever a BlockProposed event is emitted by the blockchain
*/
async function blockProposedEventHandler(data) {
  pm.start('blockProposedEventHandler');
  pm.stop('blockAssembly - blockProposed');
  const { blockNumber: currentBlockCount, transactionHash: transactionHashL1 } = data;
  const { block, transactions } = await getProposeBlockCalldata(data);
  const nextBlockNumberL2 = await getNumberOfL2Blocks();

  // Check block preconditions and raise exception
  if (!transactionHashL1) {
    throw new Error('Layer 2 blocks must have a valid Layer 1 transactionHash');
  }
  if (!currentBlockCount) {
    throw new Error('Layer 2 blocks must have a valid Layer 1 block number');
  }

  // If a service is subscribed to this websocket and listening for events.
  if (ws && ws.readyState === WebSocket.OPEN) {
    await ws.send(
      JSON.stringify({
        type: 'blockProposed',
        data: {
          blockNumber: currentBlockCount,
          transactionHash: transactionHashL1,
          block,
          transactions,
        },
      }),
    );
  }

  logger.debug({
    msg: 'Received BlockProposed event',
    receivedBlockNumberL2: block.blockNumberL2,
    expectedBlockNumberL2: nextBlockNumberL2,
    transactions,
  });

  // Check resync attempts
  if (consecutiveResyncAttempts > 10) {
    lastInOrderL1Block = 'earliest';
    consecutiveResyncAttempts = 0;
  }

  // If an out of order L2 block is detected,
  // WARNING: if we ever reach this scenario, this optimist may have built a block based
  //  in an incorrect state and will be challengeable
  if (block.blockNumberL2 > nextBlockNumberL2) {
    consecutiveResyncAttempts++;
    logger.debug('Resyncing...');
    const proposer = new Proposer();
    await syncState(proposer, lastInOrderL1Block);
  }

  lastInOrderL1Block = currentBlockCount;

  // We get the L1 block time in order to save it in the database to have this information available
  let timeBlockL2 = await getTimeByBlock(transactionHashL1);
  timeBlockL2 = new Date(timeBlockL2 * 1000);

  // Block preconditions are already checked, so we can saveBlock and transactions simultaneously
  pm.start('blockProposedEventHandler - save');
  await Promise.all([
    // save the block to facilitate later lookup of block data
    // we will save before checking because the database at any time should reflect the state the blockchain holds
    // when a challenge is raised because the is correct block data, then the corresponding block deleted event will
    // update this collection
    saveBlock({ blockNumber: currentBlockCount, transactionHashL1, timeBlockL2, ...block }),

    // It's possible that some of these transactions are new to us. That's because they were
    // submitted by someone directly to another proposer and so there was never a TransactionSubmitted
    // event associated with them. Either that, or we lost our database and had to resync from the chain.
    // In which case this handler is being called be the resync code. either way, we need to add the transaction.
    // let's use transactionSubmittedEventHandler to do this because it will perform all the duties associated
    // with saving a transaction.
    ...transactions.map(tx =>
      saveTransaction({ ...tx, blockNumberL2: block.blockNumberL2, mempool: false }),
    ),
  ]);
  pm.stop('blockProposedEventHandler - save');

  pm.start('blockProposedEventHandler - deleteDup');
  const blockCommitments = transactions
    .map(t => t.commitments.filter(c => c !== ZERO))
    .flat(Infinity);
  const blockNullifiers = transactions
    .map(t => t.nullifiers.filter(c => c !== ZERO))
    .flat(Infinity);

  const [, latestTree] = await Promise.all([
    deleteDuplicateCommitmentsAndNullifiersFromMemPool(
      blockCommitments,
      blockNullifiers,
      block.transactionHashes,
    ),
    getTreeByBlockNumberL2(block.blockNumberL2 - 1),
  ]);
  pm.stop('blockProposedEventHandler - deleteDup');

  pm.start('blockProposedEventHandler - stateLess Timber');
  const updatedTimber = Timber.statelessUpdate(
    latestTree,
    blockCommitments,
    HASH_TYPE,
    TIMBER_HEIGHT,
  );

  const res = await saveTree(block.blockNumber, block.blockNumberL2, updatedTimber);
  logger.info(`Saving tree with block number ${block.blockNumberL2}, ${res}`);
  pm.stop('blockProposedEventHandler - stateLess Timber');

  // signal to the block-making routines that a block is received: they
  // won't make a new block until their previous one is stored on-chain.
  // we'll check the block and issue a challenge if appropriate
  // we should not check the block if the stop queue is not empty because
  // it signals that there is a bad block which will get challenged eventually
  // meanwhile any new L2 blocks received if turned out to be bad blocks will
  // raise a commit to challenge and reveal challenge which is bound to fail because
  // a rollback from previous wrong block would have removed this anyway.
  // Instead, what happens now is that any good/bad blocks on top of the first bad block
  // will get saved and eventually all these blocks will be removed as part of the rollback
  // of the first bad block
  try {
    pm.start('blockProposedEventHandler - checkBlock');
    if (queues[2].length === 0) await checkBlock(block, transactions);
    pm.stop('blockProposedEventHandler - checkBlock');
    logger.info('Block Checker - Block was valid');
  } catch (err) {
    logger.error('Error detected in block', err);
  }
  pm.stop('blockProposedEventHandler');
}

export default blockProposedEventHandler;
