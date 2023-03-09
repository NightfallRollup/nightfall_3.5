/**
 * Module to handle new Transactions being posted
 */
import config from 'config';
import axios from 'axios';
import logger from '@polygon-nightfall/common-files/utils/logger.mjs';
import constants from '@polygon-nightfall/common-files/constants/index.mjs';
import { waitForContract } from '@polygon-nightfall/common-files/utils/contract.mjs';
import {
  deleteDuplicateCommitmentsAndNullifiersFromMemPool,
  saveTransaction,
} from '../services/database.mjs';
import { checkTransaction } from '../services/transaction-checker.mjs';
import TransactionError from '../classes/transaction-error.mjs';
import { getTransactionSubmittedCalldata } from '../services/process-calldata.mjs';

const { STATE_CONTRACT_NAME } = constants;

const { optimistTxWorkerUrl } = config.OPTIMIST_TX_WORKER_PARAMS;

// Flag to enable/disable worker processing
//  When disabled, workers are stopped. Workers are
//   stopped during initial syncing
let _workerEnable = true;

export function workerEnableSet(flag) {
  _workerEnable = flag;
}
export function workerEnableGet() {
  return _workerEnable;
}

/**
 * Transaction Event Handler processing.
 *
 * @param {Object} eventParams Transaction data
 */
export async function submitTransaction(eventParams) {
  const { offchain = false, ...data } = eventParams;
  let transaction;
  if (offchain) {
    transaction = data;
    transaction.blockNumber = 'offchain';
    transaction.transactionHashL1 = 'offchain';
  } else {
    transaction = await getTransactionSubmittedCalldata(data);
    transaction.blockNumber = data.blockNumber;
    transaction.transactionHashL1 = data.transactionHash;
  }

  logger.info({
    msg: 'Transaction Handler - New transaction received.',
    transaction,
    _workerEnable,
  });

  try {
    const stateInstance = await waitForContract(STATE_CONTRACT_NAME);

    const circuitInfo = await stateInstance.methods.getCircuitInfo(transaction.circuitHash).call();
    if (circuitInfo.isEscrowRequired) {
      const isCommitmentEscrowed = await stateInstance.methods
        .getCommitmentEscrowed(transaction.commitments[0])
        .call();
      if (!isCommitmentEscrowed) {
        throw new TransactionError(
          `The commitment ${transaction.commitments[0]} has not been escrowed`,
        );
      }
      logger.info({ msg: `Commmitment ${transaction.commitments[0]} is escrowed` });
    }
    logger.info({ msg: 'Checking transaction validity...' });

    const nonZeroCommitmentsAndNullifiers = await checkTransaction({
      transaction,
      checkDuplicatesInL2: true,
      checkDuplicatesInMempool: true,
    });
    const nonZeroCommitments = nonZeroCommitmentsAndNullifiers[0];
    const nonZeroNullifiers = nonZeroCommitmentsAndNullifiers[1];
    Promise.all([
      deleteDuplicateCommitmentsAndNullifiersFromMemPool(nonZeroCommitments, nonZeroNullifiers, [
        transaction.transactionHash,
      ]),
      saveTransaction({ ...transaction }),
    ]);
  } catch (err) {
    if (err instanceof TransactionError) {
      logger.warn(
        `The transaction check failed with error: ${err.message}. The transaction has been ignored`,
      );
    } else {
      logger.error(err);
    }
  }
}

/**
 * This handler runs whenever a new transaction is submitted to the blockchain
 * Transaction Event Handler processing. It can be processed by main thread
 * or by worker thread
 * @param {Object} eventParams Transaction data
 */
export async function transactionSubmittedEventHandler(eventParams) {
  // If TX WORKERS enabled or not responsive, route transaction requests to main thread
  if (_workerEnable) {
    axios
      .post(`${optimistTxWorkerUrl}/workers/transaction-submitted`, {
        eventParams,
      })
      .catch(function (error) {
        logger.error(`Error submit tx worker ${error}, ${optimistTxWorkerUrl}`);
        submitTransaction(eventParams);
      });
  } else {
    // Main thread (no workers)
    await submitTransaction(eventParams);
  }
}
