/* eslint-disable import/prefer-default-export */

import axios from 'axios';
import logger from '@polygon-nightfall/common-files/utils/logger.mjs';
import constants from '@polygon-nightfall/common-files/constants/index.mjs';
import gen from 'general-number';
import getProposers from '@polygon-nightfall/common-files/utils/proposer.mjs';
import NotFoundError from '@polygon-nightfall/common-files/utils/not-found-error.mjs';
import ValidationError from '@polygon-nightfall/common-files/utils/validation-error.mjs';
import { waitForContract } from '@polygon-nightfall/common-files/utils/contract.mjs';

const { generalise } = gen;

const { SHIELD_CONTRACT_NAME } = constants;

const STATUS_MINED = 'mined';
const STATUS_MEMPOOL = 'mempool';

let feeL2TokenAddress = null;

export async function findTransactionInMempools(l2TransactionHash) {
  logger.debug('Get all registered proposer URLs from State contract..');
  const proposerURLs = (await getProposers()).map(p => p.url);

  logger.debug('Query each proposer mempool..');
  const promises = proposerURLs.map(pURL =>
    axios.get(`${pURL}/proposer/mempool/${l2TransactionHash}`),
  );

  /*
    The user may have sent the transaction multiple times to different proposers,
    but this situation should be resolved when including the tx in L2 block
  */
  try {
    const { data } = await Promise.any(promises);
    return data; // ie transaction object
  } catch (err) {
    logger.trace(err);
    throw new NotFoundError(`Could not find L2 transaction hash ${l2TransactionHash}`);
  }
}

export function setL2TransactionStatus(transaction) {
  const { blockNumberL2 } = transaction;
  logger.debug(`Set status for L2 transaction with L2 block number ${blockNumberL2}..`);

  let status;
  if (blockNumberL2 >= 0) {
    status = STATUS_MINED;
  } else if (blockNumberL2 === -1) {
    status = STATUS_MEMPOOL;
  } else {
    throw new ValidationError(`Incorrect L2 block number ${blockNumberL2}`);
  }

  return status;
}

export async function feeL2TokenAddressGet() {
  if (feeL2TokenAddress === null) {
    const shieldContractInstance = await waitForContract(SHIELD_CONTRACT_NAME);
    feeL2TokenAddress = generalise(
      (await shieldContractInstance.methods.getFeeL2TokenAddress().call()).toLowerCase(),
    );
  }
  return feeL2TokenAddress;
}
