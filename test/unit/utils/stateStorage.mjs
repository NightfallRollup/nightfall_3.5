/* eslint-disable no-empty-function */
import hardhat from 'hardhat';
import { BigNumber } from 'ethers';
import { setStorageAt, time } from '@nomicfoundation/hardhat-network-helpers';

const { ethers } = hardhat;

const blockHashesSlot = 162;
const stakeAccountsSlot = 165;
const feeBookIndex = 166;
const claimedBlockStakesSlot = 167;

export async function setBlockPaymentClaimed(stateAddress, blockHash) {
  const index = ethers.utils.solidityKeccak256(
    ['uint256', 'uint256'],
    [blockHash, claimedBlockStakesSlot],
  );
  await setStorageAt(stateAddress, index, ethers.utils.hexlify(ethers.utils.zeroPad(1, 32)));
}

export async function setFeeBookInfo(stateAddress, block, feePaymentsEth, feePaymentsMatic) {
  const proposerBlockHash = ethers.utils.keccak256(
    ethers.utils.solidityPack(['address', 'uint256'], [block.proposer, block.blockNumberL2]),
  );

  const index = ethers.utils.solidityKeccak256(
    ['uint256', 'uint256'],
    [proposerBlockHash, feeBookIndex],
  );

  await setStorageAt(stateAddress, index, feePaymentsEth);
  await setStorageAt(
    stateAddress,
    ethers.utils.hexlify(BigNumber.from(index).add(1)),
    feePaymentsMatic,
  );
}

export async function setStakeAccount(stateAddress, proposer, amount, challengeLocked, timeStake) {
  const index = ethers.utils.solidityKeccak256(
    ['uint256', 'uint256'],
    [proposer, stakeAccountsSlot],
  );
  await setStorageAt(stateAddress, index, ethers.utils.hexlify(ethers.utils.zeroPad(amount, 32)));
  await setStorageAt(
    stateAddress,
    ethers.utils.hexlify(BigNumber.from(index).add(1)),
    ethers.utils.hexlify(ethers.utils.zeroPad(challengeLocked, 32)),
  );
  await setStorageAt(
    stateAddress,
    ethers.utils.hexlify(BigNumber.from(index).add(2)),
    ethers.utils.hexZeroPad(ethers.utils.hexlify(timeStake), 32),
  );
}

export async function setBlockData(
  StateInstance,
  stateAddress,
  blockHash,
  blockStake,
  proposerAddress,
) {
  const indexTime = ethers.utils.solidityKeccak256(
    ['uint256'],
    [ethers.utils.hexlify(blockHashesSlot)],
  );

  const blocksL2 = await StateInstance.getNumberOfL2Blocks();
  await setStorageAt(
    stateAddress,
    ethers.utils.hexlify(blockHashesSlot),
    ethers.utils.hexZeroPad(ethers.utils.hexlify(blocksL2.add(1), 32)),
  );
  await setStorageAt(stateAddress, indexTime, blockHash);
  await setStorageAt(
    stateAddress,
    ethers.utils.hexlify(BigNumber.from(indexTime).add(1)),
    ethers.utils.hexZeroPad(ethers.utils.hexlify(await time.latest()), 32),
  );
  await setStorageAt(
    stateAddress,
    ethers.utils.hexlify(BigNumber.from(indexTime).add(2)),
    ethers.utils.hexlify(
      ethers.utils.concat([
        ethers.utils.hexZeroPad(ethers.utils.hexlify(blockStake), 12),
        proposerAddress,
      ]),
    ),
  );
}