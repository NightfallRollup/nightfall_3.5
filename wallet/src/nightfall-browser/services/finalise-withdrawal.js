/* ignore unused exports */

/**
Module to endable withdrawal of funds from the Shield contract to the user's
address.
*/
import { getContractInstance } from '../../common-files/utils/contract';
import { Transaction } from '../classes/index';
import { getTransactionByTransactionHash, getBlockByTransactionHash } from './database';

const { SHIELD_CONTRACT_NAME } = global.config;

// TODO move classes to their own folder so this is not needed (it's already a
// static function in the Block class)
export function buildSolidityStruct(block) {
  const { proposer, root, leafCount, blockNumberL2, previousBlockHash } = block;
  return {
    proposer,
    root,
    leafCount: Number(leafCount),
    blockNumberL2: Number(blockNumberL2),
    previousBlockHash,
  };
}

export async function finaliseWithdrawal(transactionHash, shieldContractAddress) {
  const block = await getBlockByTransactionHash(transactionHash);
  const transactions = await Promise.all(
    block.transactionHashes.map(t => getTransactionByTransactionHash(t)),
  );
  const index = transactions.findIndex(f => f.transactionHash === transactionHash);

  const shieldContractInstance = await getContractInstance(
    SHIELD_CONTRACT_NAME,
    shieldContractAddress,
  );
  try {
    const rawTransaction = await shieldContractInstance.methods
      .finaliseWithdrawal(
        buildSolidityStruct(block),
        block.blockNumberL2,
        transactions.map(t => Transaction.buildSolidityStruct(t)),
        index,
      )
      .encodeABI();
    // store the commitment on successful computation of the transaction
    return { rawTransaction };
  } catch (err) {
    throw new Error(err); // let the caller handle the error
  }
}