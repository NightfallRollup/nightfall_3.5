/* eslint-disable no-empty-function */
import { expect } from 'chai';
import hardhat from 'hardhat';
import { time } from '@nomicfoundation/hardhat-network-helpers';
import {
  calculateBlockHash,
  calculateTransactionHash,
  createBlockAndTransactions,
} from '../utils/utils.mjs';
import {
  setAdvancedWithdrawal,
  setEscrowed,
  setTransactionWithdrawn,
  setWhitelist,
} from '../utils/shieldStorage.mjs';
import {
  setBlockData,
  setBlockPaymentClaimed,
  setFeeBookInfo,
  setStakeAccount,
} from '../utils/stateStorage.mjs';

const { ethers, upgrades } = hardhat;

describe('Testing Shield Contract', function () {
  let ShieldInstance;
  let shieldAddress;

  let StateInstance;
  let stateAddress;

  let Erc20MockInstance;
  let erc20MockAddress;

  let Erc721MockInstance;
  let erc721MockAddress;

  let Erc1155MockInstance;
  let erc1155MockAddress;

  let owner;

  let challengesAddress;
  let proposerAddress;

  let withdrawTransaction;
  let withdrawTransactionHash;

  let depositTransaction;
  let depositTransactionHash;

  let block;
  let blockHash;
  let blockStake;

  before(async () => {
    owner = await ethers.getSigners();
  });

  beforeEach(async () => {
    const ERC20MockDeployer = await ethers.getContractFactory('ERC20Mock');
    Erc20MockInstance = await ERC20MockDeployer.deploy(100000000);
    const erc20MockInstance = await Erc20MockInstance.deployed();
    erc20MockAddress = erc20MockInstance.address;

    const ERC721MockDeployer = await ethers.getContractFactory('ERC721Mock');
    Erc721MockInstance = await ERC721MockDeployer.deploy();
    const erc721MockInstance = await Erc721MockInstance.deployed();
    erc721MockAddress = erc721MockInstance.address;

    const ERC1155MockDeployer = await ethers.getContractFactory('ERC1155Mock');
    Erc1155MockInstance = await ERC1155MockDeployer.deploy();
    const erc1155MockInstance = await Erc1155MockInstance.deployed();
    erc1155MockAddress = erc1155MockInstance.address;

    const ShieldDeployer = await ethers.getContractFactory('Shield');
    ShieldInstance = await upgrades.deployProxy(ShieldDeployer);
    shieldAddress = (await ShieldInstance.deployed()).address;

    const PoseidonDeployer = await ethers.getContractFactory('Poseidon');
    const PoseidonInstance = await PoseidonDeployer.deploy();

    const MerkleTreeStatelessDeployer = await ethers.getContractFactory('MerkleTree_Stateless', {
      libraries: {
        Poseidon: (await PoseidonInstance.deployed()).address,
      },
    });
    const MerkleTreeStatelessInstance = await MerkleTreeStatelessDeployer.deploy();

    const ChallengesUtilDeployer = await ethers.getContractFactory('ChallengesUtil', {
      libraries: {
        MerkleTree_Stateless: (await MerkleTreeStatelessInstance.deployed()).address,
      },
    });
    const ChallengesUtilInstance = await ChallengesUtilDeployer.deploy();

    const VerifierDeployer = await ethers.getContractFactory('Verifier');
    const VerifierInstance = await VerifierDeployer.deploy();

    const ChallengesDeployed = await ethers.getContractFactory('Challenges', {
      libraries: {
        ChallengesUtil: (await ChallengesUtilInstance.deployed()).address,
        Verifier: (await VerifierInstance.deployed()).address,
      },
    });
    const ChallengesInstance = await upgrades.deployProxy(ChallengesDeployed, {
      unsafeAllow: ['external-library-linking'],
    });
    challengesAddress = (await ChallengesInstance.deployed()).address;

    const ProposerDeployer = await ethers.getContractFactory('Proposers');
    const ProposerInstance = await upgrades.deployProxy(ProposerDeployer, {
      unsafeAllow: ['external-library-linking'],
    });
    proposerAddress = (await ProposerInstance.deployed()).address;

    const UtilsDeployer = await ethers.getContractFactory('Utils');
    const UtilsInstance = await UtilsDeployer.deploy();

    const StateDeployer = await ethers.getContractFactory('State', {
      libraries: {
        Utils: (await UtilsInstance.deployed()).address,
      },
    });
    StateInstance = await upgrades.deployProxy(
      StateDeployer,
      [proposerAddress, challengesAddress, shieldAddress],
      {
        unsafeAllow: ['external-library-linking'],
        initializer: 'initializeState',
      },
    );
    stateAddress = (await StateInstance.deployed()).address;

    ShieldInstance.setStateContract(stateAddress);

    const transactions = createBlockAndTransactions(erc20MockAddress, owner[0].address);
    depositTransaction = transactions.depositTransaction;
    depositTransactionHash = calculateTransactionHash(depositTransaction);

    withdrawTransaction = transactions.withdrawTransaction;
    withdrawTransactionHash = calculateTransactionHash(withdrawTransaction);

    block = transactions.block;
    blockHash = calculateBlockHash(block);
    blockStake = await StateInstance.getBlockStake();

    ShieldInstance.setMaticAddress(erc20MockAddress);
  });

  afterEach(async () => {
    // clear down the test network after each test
    await hardhat.network.provider.send('hardhat_reset');
  });

  describe('getTransactionEscrowed', async () => {
    it('returns true if a transaction is escrowed', async function () {
      await setEscrowed(shieldAddress, withdrawTransactionHash);
      const isEscrowed = await ShieldInstance.getTransactionEscrowed(withdrawTransactionHash);
      expect(isEscrowed).to.equal(true);
    });

    it('returns false if a transaction is not escrowed', async function () {
      const isEscrowed = await ShieldInstance.getTransactionEscrowed(withdrawTransactionHash);
      expect(isEscrowed).to.equal(false);
    });
  });

  describe('submitTransaction', async function () {
    it('succeeds and sets is Escrowed to true for a deposit transaction of an ERC20 token', async function () {
      await ShieldInstance.setRestriction(erc20MockAddress, '10000', '10000');
      await Erc20MockInstance.approve(shieldAddress, '10');

      const tx = await ShieldInstance.submitTransaction(depositTransaction);

      expect(await ShieldInstance.isEscrowed(depositTransactionHash)).to.equal(true);
      expect(await Erc20MockInstance.balanceOf(await owner[0].address)).to.equal(99999990);
      expect(await Erc20MockInstance.balanceOf(shieldAddress)).to.equal(10);
      await expect(tx).to.emit(ShieldInstance, 'TransactionSubmitted').withArgs();
    });

    it('succeeds and sets is Escrowed to true for a deposit transaction of an ERC721 token', async function () {
      await Erc721MockInstance.awardItem(owner[0].address, `https://erc721mock/item-id.json`);

      await Erc721MockInstance.approve(
        shieldAddress,
        '28948022309329048855892746252171976963317496166410141009864396001978282409986',
      );
      const depositTransactionERC721 = {
        value: '0',
        fee: '0',
        transactionType: '0',
        tokenType: '1',
        historicRootBlockNumberL2: [
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        tokenId: '0x4000000000000000000000000000000000000000000000000000000000000002',
        ercAddress: ethers.utils.hexZeroPad(erc721MockAddress, 32),
        recipientAddress: '0x0000000000000000000000000000000000000000000000000000000000000000',
        commitments: [
          '0x078ba912b4169b22fb2d9b6fba6229ccd4ae9c2610c72312d0c6d18d85fd22cf',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        nullifiers: [
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        compressedSecrets: [
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        proof: [
          '0x2e608465669d24b9f8f0cf93b76d68e10e2ab6d5e24a6097217334960088b63',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
      };
      const tx = await ShieldInstance.submitTransaction(depositTransactionERC721);
      expect(
        await ShieldInstance.isEscrowed(calculateTransactionHash(depositTransactionERC721)),
      ).to.equal(true);
      expect(
        await Erc721MockInstance.ownerOf(
          '28948022309329048855892746252171976963317496166410141009864396001978282409986',
        ),
      ).to.equal(shieldAddress);
      await expect(tx).to.emit(ShieldInstance, 'TransactionSubmitted').withArgs();
    });

    it('succeeds and sets is Escrowed to true for a deposit transaction of an ERC1155 token', async function () {
      await Erc1155MockInstance.setApprovalForAll(shieldAddress, true);
      const depositTransactionERC1155 = {
        value: '5',
        fee: '0',
        transactionType: '0',
        tokenType: '2',
        historicRootBlockNumberL2: [
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        tokenId: '0x0000000000000000000000000000000000000000000000000000000000000000',
        ercAddress: ethers.utils.hexZeroPad(erc1155MockAddress, 32),
        recipientAddress: '0x0000000000000000000000000000000000000000000000000000000000000000',
        commitments: [
          '0x078ba912b4169b22fb2d9b6fba6229ccd4ae9c2610c72312d0c6d18d85fd22cf',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        nullifiers: [
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        compressedSecrets: [
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        proof: [
          '0x2e608465669d24b9f8f0cf93b76d68e10e2ab6d5e24a6097217334960088b63',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
      };
      const tx = await ShieldInstance.submitTransaction(depositTransactionERC1155);
      expect(
        await ShieldInstance.isEscrowed(calculateTransactionHash(depositTransactionERC1155)),
      ).to.equal(true);
      expect(await Erc1155MockInstance.balanceOf(await owner[0].address, 0)).to.equal(1099995);
      expect(await Erc1155MockInstance.balanceOf(shieldAddress, 0)).to.equal(5);
      await expect(tx).to.emit(ShieldInstance, 'TransactionSubmitted').withArgs();
    });

    it('succeeds for a non deposit transaction', async function () {
      const tx = await ShieldInstance.submitTransaction(withdrawTransaction);
      expect(await ShieldInstance.getTransactionEscrowed(withdrawTransactionHash)).to.equal(false);
      await expect(tx).to.emit(ShieldInstance, 'TransactionSubmitted').withArgs();
    });

    it('fails if user is not whitelisted and whitelisting is active', async function () {
      await setWhitelist(shieldAddress);
      await expect(ShieldInstance.submitTransaction(withdrawTransaction)).to.be.revertedWith(
        'You are not authorised to transact using Nightfall',
      );
    });

    it('fails to submit deposit transaction if ercAddress is invalid', async function () {
      const depositTransactionInvalid = {
        value: '10',
        fee: '0',
        transactionType: '0',
        tokenType: '0',
        historicRootBlockNumberL2: [
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        tokenId: '0x0000000000000000000000000000000000000000000000000000000000000000',
        ercAddress: ethers.utils.hexZeroPad(
          ethers.utils.hexlify(1461501637330902918203684832716283019655932542976n),
          32,
        ),
        recipientAddress: '0x0000000000000000000000000000000000000000000000000000000000000000',
        commitments: [
          '0x078ba912b4169b22fb2d9b6fba6229ccd4ae9c2610c72312d0c6d18d85fd22cf',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        nullifiers: [
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        compressedSecrets: [
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        proof: [
          '0x2e608465669d24b9f8f0cf93b76d68e10e2ab6d5e24a6097217334960088b63',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
      };

      await expect(ShieldInstance.submitTransaction(depositTransactionInvalid)).to.be.revertedWith(
        'Shield: The given address is more than 160 bits',
      );
    });

    it('fails to submit deposit transaction if tokenType is ERC20 and tokenId not zero', async function () {
      const depositTransactionInvalid = {
        value: '10',
        fee: '0',
        transactionType: '0',
        tokenType: '0',
        historicRootBlockNumberL2: [
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        tokenId: '0x0000000000000000000000000000000000000000000000000000000000000001',
        ercAddress: ethers.utils.hexZeroPad(erc20MockAddress, 32),
        recipientAddress: '0x0000000000000000000000000000000000000000000000000000000000000000',
        commitments: [
          '0x078ba912b4169b22fb2d9b6fba6229ccd4ae9c2610c72312d0c6d18d85fd22cf',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        nullifiers: [
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        compressedSecrets: [
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        proof: [
          '0x2e608465669d24b9f8f0cf93b76d68e10e2ab6d5e24a6097217334960088b63',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
      };

      await expect(ShieldInstance.submitTransaction(depositTransactionInvalid)).to.be.revertedWith(
        'Shield: ERC20 deposit should have tokenId equal to ZERO',
      );
    });

    it('fails to submit deposit transaction if tokenType is ERC20 and deposit restriction has not been set', async function () {
      await expect(ShieldInstance.submitTransaction(depositTransaction)).to.be.revertedWith(
        'Shield: Cannot have restrictions of zero value',
      );
    });

    it('fails to submit deposit transaction if tokenType is ERC20 and trying to deposit more than allowed', async function () {
      await ShieldInstance.setRestriction(erc20MockAddress, '10000', '10000');
      const depositTransactionInvalid = {
        value: '100000',
        fee: '0',
        transactionType: '0',
        tokenType: '0',
        historicRootBlockNumberL2: [
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        tokenId: '0x0000000000000000000000000000000000000000000000000000000000000000',
        ercAddress: ethers.utils.hexZeroPad(erc20MockAddress, 32),
        recipientAddress: '0x0000000000000000000000000000000000000000000000000000000000000000',
        commitments: [
          '0x078ba912b4169b22fb2d9b6fba6229ccd4ae9c2610c72312d0c6d18d85fd22cf',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        nullifiers: [
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        compressedSecrets: [
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        proof: [
          '0x2e608465669d24b9f8f0cf93b76d68e10e2ab6d5e24a6097217334960088b63',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
      };

      await expect(ShieldInstance.submitTransaction(depositTransactionInvalid)).to.be.revertedWith(
        'Shield: Value is above current restrictions for deposits',
      );
    });

    it('fails to submit deposit transaction if tokenType is ERC721 and value is invalid', async function () {
      const depositTransactionInvalid = {
        value: '1',
        fee: '0',
        transactionType: '0',
        tokenType: '1',
        historicRootBlockNumberL2: [
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        tokenId: '0x0000000000000000000000000000000000000000000000000000000000000000',
        ercAddress: ethers.utils.hexZeroPad(erc20MockAddress, 32),
        recipientAddress: '0x0000000000000000000000000000000000000000000000000000000000000000',
        commitments: [
          '0x078ba912b4169b22fb2d9b6fba6229ccd4ae9c2610c72312d0c6d18d85fd22cf',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        nullifiers: [
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        compressedSecrets: [
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        proof: [
          '0x2e608465669d24b9f8f0cf93b76d68e10e2ab6d5e24a6097217334960088b63',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
      };

      await expect(ShieldInstance.submitTransaction(depositTransactionInvalid)).to.be.revertedWith(
        'Shield: Invalid inputs for ERC721 deposit',
      );
    });

    it('fails if tokenType is unknown', async function () {
      const depositTransactionInvalid = {
        value: '1',
        fee: '0',
        transactionType: '0',
        tokenType: '5',
        historicRootBlockNumberL2: [
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        tokenId: '0x0000000000000000000000000000000000000000000000000000000000000000',
        ercAddress: ethers.utils.hexZeroPad(erc20MockAddress, 32),
        recipientAddress: '0x0000000000000000000000000000000000000000000000000000000000000000',
        commitments: [
          '0x078ba912b4169b22fb2d9b6fba6229ccd4ae9c2610c72312d0c6d18d85fd22cf',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        nullifiers: [
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        compressedSecrets: [
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        proof: [
          '0x2e608465669d24b9f8f0cf93b76d68e10e2ab6d5e24a6097217334960088b63',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
      };

      await expect(ShieldInstance.submitTransaction(depositTransactionInvalid)).to.be.reverted;
    });
  });

  describe('requestBlockPayment', async function () {
    it('succeeds when requesting a block payment', async function () {
      await Erc20MockInstance.transfer(shieldAddress, 100);
      await setBlockData(StateInstance, stateAddress, blockHash, blockStake, owner[0].address);

      await time.increase(86400 * 7 + 1);
      await setFeeBookInfo(stateAddress, block, 0, 20);

      const amount = 5;
      const challengeLocked = 2;
      await setStakeAccount(
        stateAddress,
        owner[0].address,
        amount,
        challengeLocked,
        await time.latest(),
      );

      await ShieldInstance.requestBlockPayment(block);

      expect(await StateInstance.claimedBlockStakes(blockHash)).to.equal(true);
      const proposerBlockHash = ethers.utils.keccak256(
        ethers.utils.solidityPack(['address', 'uint256'], [block.proposer, block.blockNumberL2]),
      );

      expect(await StateInstance.feeBook(proposerBlockHash, 0)).to.equal(0);
      expect(await StateInstance.feeBook(proposerBlockHash, 1)).to.equal(0);

      expect(await StateInstance.pendingWithdrawals(owner[0].address, 0)).to.equal(0);
      expect(await StateInstance.pendingWithdrawals(owner[0].address, 1)).to.equal(20);

      expect(await Erc20MockInstance.balanceOf(shieldAddress)).to.equal(80);
      expect(await Erc20MockInstance.balanceOf(stateAddress)).to.equal(20);

      const stake = await StateInstance.stakeAccounts(owner[0].address);
      expect(stake.challengeLocked).to.equal(Number(challengeLocked) - Number(blockStake));
      expect(stake.amount).to.equal(Number(amount) + Number(blockStake));
    });

    it("fails if block doesn't exist", async function () {
      await setBlockData(StateInstance, stateAddress, blockHash, blockStake, owner[0].address);

      const blockFake = {
        leafCount: 1,
        proposer: owner[1].address,
        root: '0x2dffeee2af2f5be8b946c00d2a0f96dc59ac65d1decce3bae9c2c70d5efca4a0',
        blockNumberL2: 0,
        previousBlockHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
        frontierHash: '0x6fdcfc8a2d541d6b99b6d6349b67783edf599fedfd1931b96f4385bcb3f2f188',
        transactionHashesRoot: ethers.utils.solidityKeccak256(
          ['uint256', 'uint256'],
          [
            calculateTransactionHash(withdrawTransaction),
            calculateTransactionHash(depositTransaction),
          ],
        ),
      };

      await expect(ShieldInstance.requestBlockPayment(blockFake)).to.be.revertedWith(
        'Shield: This block does not exist',
      );
    });

    it('fails if block is still challengeable', async function () {
      await setBlockData(StateInstance, stateAddress, blockHash, blockStake, owner[0].address);

      await expect(ShieldInstance.requestBlockPayment(block)).to.be.revertedWith(
        'Shield: Too soon to get paid for this block',
      );
    });

    it('fails if someone other than proposer is trying to request a payment', async function () {
      await setBlockData(StateInstance, stateAddress, blockHash, blockStake, owner[0].address);

      await time.increase(86400 * 7 + 1);

      await expect(ShieldInstance.connect(owner[1]).requestBlockPayment(block)).to.be.revertedWith(
        'Shield: Not the proposer of this block',
      );
    });

    it('fails if block payment has been already claimed', async function () {
      await setBlockData(StateInstance, stateAddress, blockHash, blockStake, owner[0].address);

      await time.increase(86400 * 7 + 1);

      await setBlockPaymentClaimed(stateAddress, blockHash);

      await expect(ShieldInstance.requestBlockPayment(block)).to.be.revertedWith(
        'Shield: Block stake for this block already claimed',
      );
    });
  });

  describe('isBlockPaymentPending', async function () {
    it('succeeds if block payment is pending', async function () {
      await setBlockData(StateInstance, stateAddress, blockHash, blockStake, owner[0].address);

      await time.increase(86400 * 7 + 1);

      expect(await ShieldInstance.isBlockPaymentPending(0)).to.equal(true);
    });

    it('fails if block number is not stored', async function () {
      await expect(ShieldInstance.isBlockPaymentPending(0)).to.be.revertedWith(
        'State: Invalid block number L2',
      );
    });

    it('fails if block is still challengeable', async function () {
      await setBlockData(StateInstance, stateAddress, blockHash, blockStake, owner[0].address);

      await expect(ShieldInstance.isBlockPaymentPending(0)).to.be.revertedWith(
        'Shield: Too soon to get paid for this block',
      );
    });

    it('fails if block payment has been claimed', async function () {
      await setBlockData(StateInstance, stateAddress, blockHash, blockStake, owner[0].address);

      await setBlockPaymentClaimed(stateAddress, blockHash);

      await time.increase(86400 * 7 + 1);

      await expect(ShieldInstance.isBlockPaymentPending(0)).to.be.revertedWith(
        'Shield: Block stake for this block already claimed',
      );
    });
  });

  describe('isValidWithdrawal', async function () {
    it('returns true if withdrawal is valid', async function () {
      await setBlockData(StateInstance, stateAddress, blockHash, blockStake, owner[0].address);

      await time.increase(86400 * 7 + 1);

      const siblingPath = [block.transactionHashesRoot, depositTransactionHash];
      const index = 0;
      expect(
        await ShieldInstance.isValidWithdrawal(block, withdrawTransaction, index, siblingPath),
      ).to.equal(true);
    });

    it('fails if block or transaction is not real (sibling path wrong)', async function () {
      await setBlockData(StateInstance, stateAddress, blockHash, blockStake, owner[0].address);

      await time.increase(86400 * 7 + 1);

      const siblingPath = [block.transactionHashesRoot, depositTransactionHash];
      const wrongIndex = 1;
      await expect(
        ShieldInstance.isValidWithdrawal(block, withdrawTransaction, wrongIndex, siblingPath),
      ).to.be.reverted;
    });

    it('fails if transaction is still challengeable', async function () {
      await setBlockData(StateInstance, stateAddress, blockHash, blockStake, owner[0].address);

      const siblingPath = [block.transactionHashesRoot, depositTransactionHash];
      const index = 0;
      await expect(
        ShieldInstance.isValidWithdrawal(block, withdrawTransaction, index, siblingPath),
      ).to.be.revertedWith('Shield: Too soon to withdraw funds from this block');
    });

    it('fails if transaction payment has been claimed', async function () {
      await setBlockData(StateInstance, stateAddress, blockHash, blockStake, owner[0].address);

      await time.increase(86400 * 7 + 1);

      const siblingPath = [block.transactionHashesRoot, depositTransactionHash];
      const index = 0;

      await setTransactionWithdrawn(shieldAddress, withdrawTransactionHash);

      await expect(
        ShieldInstance.isValidWithdrawal(block, withdrawTransaction, index, siblingPath),
      ).to.be.revertedWith('Shield: This transaction has already paid out');
    });

    it('fails if transaction is not a withdraw', async function () {
      await setBlockData(StateInstance, stateAddress, blockHash, blockStake, owner[0].address);

      await time.increase(86400 * 7 + 1);

      const siblingPath = [block.transactionHashesRoot, withdrawTransactionHash];
      const index = 1;

      await expect(
        ShieldInstance.isValidWithdrawal(block, depositTransaction, index, siblingPath),
      ).to.be.revertedWith('Shield: Transaction is not a valid withdraw');
    });
  });

  describe('finaliseWithdrawal', async function () {
    it('succeeds to finalise withdrawal for an ERC20 token if valid and has not been advanced', async function () {
      await ShieldInstance.setRestriction(erc20MockAddress, '10000', '10000');
      await Erc20MockInstance.transfer(shieldAddress, 10);
      await setBlockData(StateInstance, stateAddress, blockHash, blockStake, owner[0].address);

      await time.increase(86400 * 7 + 1);

      const siblingPath = [block.transactionHashesRoot, depositTransactionHash];
      const index = 0;

      await ShieldInstance.finaliseWithdrawal(block, withdrawTransaction, index, siblingPath);

      expect(await Erc20MockInstance.balanceOf(await owner[0].address)).to.equal(100000000);
      expect(await Erc20MockInstance.balanceOf(shieldAddress)).to.equal(0);
      const advancedWithdrawal = await ShieldInstance.advancedWithdrawals(withdrawTransactionHash);
      expect(advancedWithdrawal.currentOwner).to.equal(
        '0x0000000000000000000000000000000000000000',
      );
      expect(advancedWithdrawal.advanceFee).to.equal(0n);
      expect(await StateInstance.pendingWithdrawals(owner[0].address, 0)).to.equal(0);
      expect(await StateInstance.pendingWithdrawals(owner[0].address, 1)).to.equal(0);
    });

    it('succeeds to finalise withdrawal for an ERC20 token if valid and has been advanced and fee pending', async function () {
      await ShieldInstance.setRestriction(erc20MockAddress, '10000', '10000');
      await Erc20MockInstance.transfer(shieldAddress, 110);
      await setBlockData(StateInstance, stateAddress, blockHash, blockStake, owner[0].address);

      const siblingPath = [block.transactionHashesRoot, depositTransactionHash];
      const index = 0;

      await ShieldInstance.setAdvanceWithdrawalFee(block, withdrawTransaction, index, siblingPath, {
        value: 15,
      });

      await time.increase(86400 * 7 + 1);

      await ShieldInstance.finaliseWithdrawal(block, withdrawTransaction, index, siblingPath);

      expect(await Erc20MockInstance.balanceOf(await owner[0].address)).to.equal(99999900);
      expect(await Erc20MockInstance.balanceOf(shieldAddress)).to.equal(100);
      expect(await Erc20MockInstance.balanceOf(stateAddress)).to.equal(0);
      expect(await ethers.provider.getBalance(shieldAddress)).to.equal(0);
      expect(await ethers.provider.getBalance(stateAddress)).to.equal(15);
      const advancedWithdrawal = await ShieldInstance.advancedWithdrawals(withdrawTransactionHash);
      expect(advancedWithdrawal.currentOwner).to.equal(
        '0x0000000000000000000000000000000000000000',
      );
      expect(advancedWithdrawal.advanceFee).to.equal(0n);
      expect(await StateInstance.pendingWithdrawals(owner[0].address, 0)).to.equal(15);
      expect(await StateInstance.pendingWithdrawals(owner[0].address, 1)).to.equal(0);
    });

    it('succeeds to finalise withdrawal for an ERC721 token', async function () {
      await Erc721MockInstance.awardItem(shieldAddress, `https://erc721mock/item-id.json`);
      const withdrawERC721 = {
        value: '0',
        fee: '0',
        transactionType: '2',
        tokenType: '1',
        historicRootBlockNumberL2: [
          '0x0000000000000000000000000000000000000000000000000000000000000009',
          '0x0000000000000000000000000000000000000000000000000000000000000002',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        tokenId: '0x4000000000000000000000000000000000000000000000000000000000000002',
        ercAddress: ethers.utils.hexZeroPad(erc721MockAddress, 32),
        recipientAddress: ethers.utils.hexZeroPad(owner[0].address, 32),
        commitments: [
          '0x078ba912b4169b22fb2d9b6fba6229ccd4ae9c2610c72312d0c6d18d85fd22cf',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        nullifiers: [
          '0x078ba912b4169b22fb2d9b6fba6249ccd4ae9c2610c72312d0c6d18d85fd22cf',
          '0x078ba912b4169b22fb2d9b6fba6239ccd4ae9c2610c72312d0c6d18d85fd22cf',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        compressedSecrets: [
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        proof: [
          '0x2e608465669d24b9f8f0cf93b76d68e10e2ab6d5e24a6097217334960088b63',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
      };

      const transactionHashesRoot = ethers.utils.solidityKeccak256(
        ['uint256', 'uint256'],
        [calculateTransactionHash(withdrawERC721), ethers.utils.hexZeroPad(0, 32)],
      );

      const blockERC721 = {
        leafCount: 1,
        proposer: owner[0].address,
        root: '0x2dffeee2af2f5be8b946c00d2a0f96dc59ac65d1decce3bae9c2c70d5efca4a0',
        blockNumberL2: 0,
        previousBlockHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
        frontierHash: '0x6fdcfc8a2d541d6b99b6d6349b67783edf599fedfd1931b96f4385bcb3f2f188',
        transactionHashesRoot,
      };

      await setBlockData(
        StateInstance,
        stateAddress,
        calculateBlockHash(blockERC721),
        blockStake,
        owner[0].address,
      );

      await time.increase(86400 * 7 + 1);

      const siblingPath = [blockERC721.transactionHashesRoot, ethers.utils.hexZeroPad(0, 32)];
      const index = 0;

      await ShieldInstance.finaliseWithdrawal(blockERC721, withdrawERC721, index, siblingPath);

      expect(
        await Erc721MockInstance.ownerOf(
          '28948022309329048855892746252171976963317496166410141009864396001978282409986',
        ),
      ).to.equal(owner[0].address);
      const advancedWithdrawal = await ShieldInstance.advancedWithdrawals(withdrawTransactionHash);
      expect(advancedWithdrawal.currentOwner).to.equal(
        '0x0000000000000000000000000000000000000000',
      );
      expect(advancedWithdrawal.advanceFee).to.equal(0n);
      expect(await StateInstance.pendingWithdrawals(owner[0].address, 0)).to.equal(0);
      expect(await StateInstance.pendingWithdrawals(owner[0].address, 1)).to.equal(0);
    });

    it('succeeds to finalise withdrawal for an ERC1155 token', async function () {
      await Erc1155MockInstance.safeTransferFrom(owner[0].address, shieldAddress, 1, 25, []);
      const withdrawERC1155 = {
        value: '25',
        fee: '0',
        transactionType: '2',
        tokenType: '2',
        historicRootBlockNumberL2: [
          '0x0000000000000000000000000000000000000000000000000000000000000009',
          '0x0000000000000000000000000000000000000000000000000000000000000002',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        tokenId: '0x0000000000000000000000000000000000000000000000000000000000000001',
        ercAddress: ethers.utils.hexZeroPad(erc1155MockAddress, 32),
        recipientAddress: ethers.utils.hexZeroPad(owner[0].address, 32),
        commitments: [
          '0x078ba912b4169b22fb2d9b6fba6229ccd4ae9c2610c72312d0c6d18d85fd22cf',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        nullifiers: [
          '0x078ba912b4169b22fb2d9b6fba6249ccd4ae9c2610c72312d0c6d18d85fd22cf',
          '0x078ba912b4169b22fb2d9b6fba6239ccd4ae9c2610c72312d0c6d18d85fd22cf',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        compressedSecrets: [
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        proof: [
          '0x2e608465669d24b9f8f0cf93b76d68e10e2ab6d5e24a6097217334960088b63',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
      };

      const transactionHashesRoot = ethers.utils.solidityKeccak256(
        ['uint256', 'uint256'],
        [calculateTransactionHash(withdrawERC1155), ethers.utils.hexZeroPad(0, 32)],
      );

      const blockERC1155 = {
        leafCount: 1,
        proposer: owner[0].address,
        root: '0x2dffeee2af2f5be8b946c00d2a0f96dc59ac65d1decce3bae9c2c70d5efca4a0',
        blockNumberL2: 0,
        previousBlockHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
        frontierHash: '0x6fdcfc8a2d541d6b99b6d6349b67783edf599fedfd1931b96f4385bcb3f2f188',
        transactionHashesRoot,
      };

      await setBlockData(
        StateInstance,
        stateAddress,
        calculateBlockHash(blockERC1155),
        blockStake,
        owner[0].address,
      );

      await time.increase(86400 * 7 + 1);

      const siblingPath = [blockERC1155.transactionHashesRoot, ethers.utils.hexZeroPad(0, 32)];
      const index = 0;

      await ShieldInstance.finaliseWithdrawal(blockERC1155, withdrawERC1155, index, siblingPath);

      expect(await Erc1155MockInstance.balanceOf(await owner[0].address, 1)).to.equal(1200000);
      expect(await Erc1155MockInstance.balanceOf(shieldAddress, 1)).to.equal(0);
      const advancedWithdrawal = await ShieldInstance.advancedWithdrawals(withdrawTransactionHash);
      expect(advancedWithdrawal.currentOwner).to.equal(
        '0x0000000000000000000000000000000000000000',
      );
      expect(advancedWithdrawal.advanceFee).to.equal(0n);
      expect(await StateInstance.pendingWithdrawals(owner[0].address, 0)).to.equal(0);
      expect(await StateInstance.pendingWithdrawals(owner[0].address, 1)).to.equal(0);
    });

    it('fails if block or transaction is not real', async function () {
      await setBlockData(StateInstance, stateAddress, blockHash, blockStake, owner[0].address);
      const siblingPath = [block.transactionHashesRoot, withdrawTransactionHash];
      const wrongIndex = 0;

      await expect(
        ShieldInstance.finaliseWithdrawal(block, depositTransaction, wrongIndex, siblingPath),
      ).to.be.reverted;
    });

    it('fails if block is still challengeable', async function () {
      await setBlockData(StateInstance, stateAddress, blockHash, blockStake, owner[0].address);

      const siblingPath = [block.transactionHashesRoot, depositTransactionHash];
      const index = 0;
      await expect(
        ShieldInstance.finaliseWithdrawal(block, withdrawTransaction, index, siblingPath),
      ).to.be.revertedWith('Shield: Too soon to withdraw funds from this block');
    });

    it('fails if block payment has been claimed', async function () {
      await setBlockData(StateInstance, stateAddress, blockHash, blockStake, owner[0].address);

      await time.increase(86400 * 7 + 1);

      const siblingPath = [block.transactionHashesRoot, depositTransactionHash];
      const index = 0;

      await setTransactionWithdrawn(shieldAddress, withdrawTransactionHash);

      await expect(
        ShieldInstance.finaliseWithdrawal(block, withdrawTransaction, index, siblingPath),
      ).to.be.revertedWith('Shield: This transaction has already paid out');
    });

    it('fails if transaction is not a withdraw', async function () {
      await setBlockData(StateInstance, stateAddress, blockHash, blockStake, owner[0].address);
      const siblingPath = [block.transactionHashesRoot, withdrawTransactionHash];
      const index = 1;

      await time.increase(86400 * 7 + 1);

      await expect(
        ShieldInstance.finaliseWithdrawal(block, depositTransaction, index, siblingPath),
      ).to.be.revertedWith('Shield: Transaction is not a valid withdraw');
    });

    it('fails if user is not whitelisted and whitelisting is active', async function () {
      await setWhitelist(shieldAddress);
      await setBlockData(StateInstance, stateAddress, blockHash, blockStake, owner[0].address);

      await time.increase(86400 * 7 + 1);

      const siblingPath = [block.transactionHashesRoot, depositTransactionHash];
      const index = 0;

      await expect(
        ShieldInstance.finaliseWithdrawal(block, withdrawTransaction, index, siblingPath),
      ).to.be.revertedWith('Shield: You are not authorised to withdraw funds');
    });

    it('fails to finalise withdrawal if tokenType is ERC20 and tokenId not zero', async function () {
      const withdrawalTransactionInvalid = {
        value: '10',
        fee: '0',
        transactionType: '2',
        tokenType: '0',
        historicRootBlockNumberL2: [
          '0x0000000000000000000000000000000000000000000000000000000000000009',
          '0x0000000000000000000000000000000000000000000000000000000000000002',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        tokenId: '0x0000000000000000000000000000000000000000000000000000000000000001',
        ercAddress: ethers.utils.hexZeroPad(erc20MockAddress, 32),
        recipientAddress: '0x0000000000000000000000000000000000000000000000000000000000000000',
        commitments: [
          '0x078ba912b4169b22fb2d9b6fba6229ccd4ae9c2610c72312d0c6d18d85fd22cf',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        nullifiers: [
          '0x078ba912b4169b22fb2d9b6fba6249ccd4ae9c2610c72312d0c6d18d85fd22cf',
          '0x078ba912b4169b22fb2d9b6fba6239ccd4ae9c2610c72312d0c6d18d85fd22cf',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        compressedSecrets: [
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        proof: [
          '0x2e608465669d24b9f8f0cf93b76d68e10e2ab6d5e24a6097217334960088b63',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
      };

      const transactionHashesRoot = ethers.utils.solidityKeccak256(
        ['uint256', 'uint256'],
        [calculateTransactionHash(withdrawalTransactionInvalid), ethers.utils.hexZeroPad(0, 32)],
      );

      const blockWithdrawalInvalid = {
        leafCount: 1,
        proposer: owner[0].address,
        root: '0x2dffeee2af2f5be8b946c00d2a0f96dc59ac65d1decce3bae9c2c70d5efca4a0',
        blockNumberL2: 0,
        previousBlockHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
        frontierHash: '0x6fdcfc8a2d541d6b99b6d6349b67783edf599fedfd1931b96f4385bcb3f2f188',
        transactionHashesRoot,
      };

      await setBlockData(
        StateInstance,
        stateAddress,
        calculateBlockHash(blockWithdrawalInvalid),
        blockStake,
        owner[0].address,
      );

      await time.increase(86400 * 7 + 1);

      const index = 0;
      const siblingPath = [transactionHashesRoot, ethers.utils.hexZeroPad(0, 32)];
      await expect(
        ShieldInstance.finaliseWithdrawal(
          blockWithdrawalInvalid,
          withdrawalTransactionInvalid,
          index,
          siblingPath,
        ),
      ).to.be.revertedWith('Shield: ERC20 withdrawal should have tokenId equal to ZERO');
    });

    it('fails to finalise withdrawal if tokenType is ERC20 and trying to withdraw more than allowed', async function () {
      await ShieldInstance.setRestriction(erc20MockAddress, '10000', '10000');
      const withdrawalTransactionInvalid = {
        value: '100000000',
        fee: '0',
        transactionType: '2',
        tokenType: '0',
        historicRootBlockNumberL2: [
          '0x0000000000000000000000000000000000000000000000000000000000000009',
          '0x0000000000000000000000000000000000000000000000000000000000000002',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        tokenId: '0x0000000000000000000000000000000000000000000000000000000000000000',
        ercAddress: ethers.utils.hexZeroPad(erc20MockAddress, 32),
        recipientAddress: '0x0000000000000000000000000000000000000000000000000000000000000000',
        commitments: [
          '0x078ba912b4169b22fb2d9b6fba6229ccd4ae9c2610c72312d0c6d18d85fd22cf',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        nullifiers: [
          '0x078ba912b4169b22fb2d9b6fba6249ccd4ae9c2610c72312d0c6d18d85fd22cf',
          '0x078ba912b4169b22fb2d9b6fba6239ccd4ae9c2610c72312d0c6d18d85fd22cf',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        compressedSecrets: [
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        proof: [
          '0x2e608465669d24b9f8f0cf93b76d68e10e2ab6d5e24a6097217334960088b63',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
      };

      const transactionHashesRoot = ethers.utils.solidityKeccak256(
        ['uint256', 'uint256'],
        [calculateTransactionHash(withdrawalTransactionInvalid), ethers.utils.hexZeroPad(0, 32)],
      );

      const blockWithdrawalInvalid = {
        leafCount: 1,
        proposer: owner[0].address,
        root: '0x2dffeee2af2f5be8b946c00d2a0f96dc59ac65d1decce3bae9c2c70d5efca4a0',
        blockNumberL2: 0,
        previousBlockHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
        frontierHash: '0x6fdcfc8a2d541d6b99b6d6349b67783edf599fedfd1931b96f4385bcb3f2f188',
        transactionHashesRoot,
      };

      await setBlockData(
        StateInstance,
        stateAddress,
        calculateBlockHash(blockWithdrawalInvalid),
        blockStake,
        owner[0].address,
      );

      await time.increase(86400 * 7 + 1);

      const index = 0;
      const siblingPath = [transactionHashesRoot, ethers.utils.hexZeroPad(0, 32)];
      await expect(
        ShieldInstance.finaliseWithdrawal(
          blockWithdrawalInvalid,
          withdrawalTransactionInvalid,
          index,
          siblingPath,
        ),
      ).to.be.revertedWith('Shield: Value is above current restrictions for withdrawals');
    });

    it('fails to finalise withdrawal if tokenType is ERC721 and value is invalid', async function () {
      const withdrawalTransactionInvalid = {
        value: '5',
        fee: '0',
        transactionType: '2',
        tokenType: '1',
        historicRootBlockNumberL2: [
          '0x0000000000000000000000000000000000000000000000000000000000000009',
          '0x0000000000000000000000000000000000000000000000000000000000000002',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        tokenId: '0x0000000000000000000000000000000000000000000000000000000000000001',
        ercAddress: ethers.utils.hexZeroPad(erc20MockAddress, 32),
        recipientAddress: '0x0000000000000000000000000000000000000000000000000000000000000000',
        commitments: [
          '0x078ba912b4169b22fb2d9b6fba6229ccd4ae9c2610c72312d0c6d18d85fd22cf',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        nullifiers: [
          '0x078ba912b4169b22fb2d9b6fba6249ccd4ae9c2610c72312d0c6d18d85fd22cf',
          '0x078ba912b4169b22fb2d9b6fba6239ccd4ae9c2610c72312d0c6d18d85fd22cf',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        compressedSecrets: [
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        proof: [
          '0x2e608465669d24b9f8f0cf93b76d68e10e2ab6d5e24a6097217334960088b63',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
      };

      const transactionHashesRoot = ethers.utils.solidityKeccak256(
        ['uint256', 'uint256'],
        [calculateTransactionHash(withdrawalTransactionInvalid), ethers.utils.hexZeroPad(0, 32)],
      );

      const blockWithdrawalInvalid = {
        leafCount: 1,
        proposer: owner[0].address,
        root: '0x2dffeee2af2f5be8b946c00d2a0f96dc59ac65d1decce3bae9c2c70d5efca4a0',
        blockNumberL2: 0,
        previousBlockHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
        frontierHash: '0x6fdcfc8a2d541d6b99b6d6349b67783edf599fedfd1931b96f4385bcb3f2f188',
        transactionHashesRoot,
      };

      await setBlockData(
        StateInstance,
        stateAddress,
        calculateBlockHash(blockWithdrawalInvalid),
        blockStake,
        owner[0].address,
      );
      await time.increase(86400 * 7 + 1);

      const index = 0;
      const siblingPath = [transactionHashesRoot, ethers.utils.hexZeroPad(0, 32)];
      await expect(
        ShieldInstance.finaliseWithdrawal(
          blockWithdrawalInvalid,
          withdrawalTransactionInvalid,
          index,
          siblingPath,
        ),
      ).to.be.revertedWith('Shield: Invalid inputs for ERC721 withdrawal');
    });

    it('fails to finalise withdrawal if tokenType is unknown', async function () {
      const withdrawalTransactionInvalid = {
        value: '5',
        fee: '0',
        transactionType: '2',
        tokenType: '5',
        historicRootBlockNumberL2: [
          '0x0000000000000000000000000000000000000000000000000000000000000009',
          '0x0000000000000000000000000000000000000000000000000000000000000002',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        tokenId: '0x0000000000000000000000000000000000000000000000000000000000000001',
        ercAddress: ethers.utils.hexZeroPad(erc20MockAddress, 32),
        recipientAddress: '0x0000000000000000000000000000000000000000000000000000000000000000',
        commitments: [
          '0x078ba912b4169b22fb2d9b6fba6229ccd4ae9c2610c72312d0c6d18d85fd22cf',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        nullifiers: [
          '0x078ba912b4169b22fb2d9b6fba6249ccd4ae9c2610c72312d0c6d18d85fd22cf',
          '0x078ba912b4169b22fb2d9b6fba6239ccd4ae9c2610c72312d0c6d18d85fd22cf',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        compressedSecrets: [
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        proof: [
          '0x2e608465669d24b9f8f0cf93b76d68e10e2ab6d5e24a6097217334960088b63',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
      };

      const transactionHashesRoot = ethers.utils.solidityKeccak256(
        ['uint256', 'uint256'],
        [calculateTransactionHash(withdrawalTransactionInvalid), ethers.utils.hexZeroPad(0, 32)],
      );

      const blockWithdrawalInvalid = {
        leafCount: 1,
        proposer: owner[0].address,
        root: '0x2dffeee2af2f5be8b946c00d2a0f96dc59ac65d1decce3bae9c2c70d5efca4a0',
        blockNumberL2: 0,
        previousBlockHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
        frontierHash: '0x6fdcfc8a2d541d6b99b6d6349b67783edf599fedfd1931b96f4385bcb3f2f188',
        transactionHashesRoot,
      };

      await setBlockData(
        StateInstance,
        stateAddress,
        calculateBlockHash(blockWithdrawalInvalid),
        blockStake,
        owner[0].address,
      );

      await time.increase(86400 * 7 + 1);

      const index = 0;
      const siblingPath = [transactionHashesRoot, ethers.utils.hexZeroPad(0, 32)];
      await expect(
        ShieldInstance.finaliseWithdrawal(
          blockWithdrawalInvalid,
          withdrawalTransactionInvalid,
          index,
          siblingPath,
        ),
      ).to.be.reverted;
    });
  });

  describe('advanceWithdrawal', async function () {
    it('succeeds to advance a withdrawal', async function () {
      await Erc20MockInstance.transfer(await owner[1].address, 100);
      await Erc20MockInstance.connect(owner[1]).approve(shieldAddress, 10);

      await setBlockData(StateInstance, stateAddress, blockHash, blockStake, owner[0].address);

      const siblingPath = [block.transactionHashesRoot, depositTransactionHash];
      const index = 0;

      await ShieldInstance.setAdvanceWithdrawalFee(block, withdrawTransaction, index, siblingPath, {
        value: 15,
      });

      await ShieldInstance.connect(owner[1]).advanceWithdrawal(
        block,
        withdrawTransaction,
        index,
        siblingPath,
      );

      const advancedWithdrawal = await ShieldInstance.advancedWithdrawals(withdrawTransactionHash);

      expect(await Erc20MockInstance.balanceOf(await owner[0].address)).to.equal(99999910);
      expect(await Erc20MockInstance.balanceOf(await owner[1].address)).to.equal(90);
      expect(await ethers.provider.getBalance(shieldAddress)).to.equal(0);
      expect(await ethers.provider.getBalance(stateAddress)).to.equal(15);
      expect(advancedWithdrawal.currentOwner).to.equal(await owner[1].address);
      expect(advancedWithdrawal.advanceFee).to.equal(0n);
      expect(await StateInstance.pendingWithdrawals(owner[1].address, 0)).to.equal(15);
      expect(await StateInstance.pendingWithdrawals(owner[1].address, 1)).to.equal(0);
    });

    it('fails if block or transaction is not real', async function () {
      await setBlockData(StateInstance, stateAddress, blockHash, blockStake, owner[0].address);
      const siblingPath = [block.transactionHashesRoot, withdrawTransactionHash];
      const wrongIndex = 0;

      await expect(
        ShieldInstance.advanceWithdrawal(block, depositTransaction, wrongIndex, siblingPath),
      ).to.be.reverted;
    });

    it('fails if no fee is set', async function () {
      await setBlockData(StateInstance, stateAddress, blockHash, blockStake, owner[0].address);

      const siblingPath = [block.transactionHashesRoot, depositTransactionHash];
      const index = 0;

      await expect(
        ShieldInstance.advanceWithdrawal(block, withdrawTransaction, index, siblingPath),
      ).to.be.revertedWith('Shield: No advanced fee has been set for this withdrawal');
    });

    it('fails if block is finalized', async function () {
      await setBlockData(StateInstance, stateAddress, blockHash, blockStake, owner[0].address);

      const siblingPath = [block.transactionHashesRoot, depositTransactionHash];
      const index = 0;

      await setAdvancedWithdrawal(shieldAddress, withdrawTransactionHash, owner[1].address, 1);

      await time.increase(86400 * 7 + 1);

      await expect(
        ShieldInstance.advanceWithdrawal(block, withdrawTransaction, index, siblingPath),
      ).to.be.revertedWith('Shield: The block has already been finalized');
    });

    it('fails if block payment has been claimed', async function () {
      await setBlockData(StateInstance, stateAddress, blockHash, blockStake, owner[0].address);

      const siblingPath = [block.transactionHashesRoot, depositTransactionHash];
      const index = 0;

      await setAdvancedWithdrawal(shieldAddress, withdrawTransactionHash, owner[1].address, 1);

      await setTransactionWithdrawn(shieldAddress, withdrawTransactionHash);

      await expect(
        ShieldInstance.advanceWithdrawal(block, withdrawTransaction, index, siblingPath),
      ).to.be.revertedWith('Shield: This transaction has already paid out');
    });
  });

  describe('setAdvanceWithdrawalFee', async function () {
    it('succeeds to set fee for advance withdrawal', async function () {
      await setBlockData(StateInstance, stateAddress, blockHash, blockStake, owner[0].address);

      const siblingPath = [block.transactionHashesRoot, depositTransactionHash];
      const index = 0;

      const tx = await ShieldInstance.setAdvanceWithdrawalFee(
        block,
        withdrawTransaction,
        index,
        siblingPath,
        {
          value: 15,
        },
      );

      const advancedWithdrawal = await ShieldInstance.advancedWithdrawals(withdrawTransactionHash);

      expect(advancedWithdrawal.currentOwner).to.equal(
        '0x0000000000000000000000000000000000000000',
      );
      expect(advancedWithdrawal.advanceFee).to.equal(15n);
      await expect(tx)
        .to.emit(ShieldInstance, 'InstantWithdrawalRequested')
        .withArgs(withdrawTransactionHash, await owner[0].address, advancedWithdrawal.advanceFee);
    });

    it('fails if transaction is not a withdrawal', async function () {
      await setBlockData(StateInstance, stateAddress, blockHash, blockStake, owner[0].address);
      const siblingPath = [block.transactionHashesRoot, withdrawTransactionHash];
      const index = 1;

      await expect(
        ShieldInstance.setAdvanceWithdrawalFee(block, depositTransaction, index, siblingPath, {
          value: ethers.utils.parseEther('1'),
        }),
      ).to.be.revertedWith('Shield: Can only advance withdrawals');
    });

    it('fails if advance fee is zero', async function () {
      await setBlockData(StateInstance, stateAddress, blockHash, blockStake, owner[0].address);
      const siblingPath = [block.transactionHashesRoot, depositTransactionHash];
      const index = 0;

      await expect(
        ShieldInstance.setAdvanceWithdrawalFee(block, withdrawTransaction, index, siblingPath),
      ).to.be.revertedWith('Shield: Advance fee cannot be zero');
    });

    it('fails if block or transaction is not real', async function () {
      await setBlockData(StateInstance, stateAddress, blockHash, blockStake, owner[0].address);
      const siblingPath = [block.transactionHashesRoot, withdrawTransactionHash];
      const wrongIndex = 0;

      await expect(
        ShieldInstance.setAdvanceWithdrawalFee(block, depositTransaction, wrongIndex, siblingPath),
      ).to.be.reverted;
    });

    it('fails if trying to advance withdraw for a non ERC 20 token', async function () {
      const withdrawTransactionERC721 = {
        value: '10',
        fee: '0',
        transactionType: '2',
        tokenType: '1',
        historicRootBlockNumberL2: [
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        tokenId: '0x0000000000000000000000000000000000000000000000000000000000000000',
        ercAddress: ethers.utils.hexZeroPad(erc20MockAddress, 32),
        recipientAddress: '0x0000000000000000000000000000000000000000000000000000000000000000',
        commitments: [
          '0x078ba912b4169b22fb2d9b6fba6229ccd4ae9c2610c72312d0c6d18d85fd22cf',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        nullifiers: [
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        compressedSecrets: [
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
        proof: [
          '0x2e608465669d24b9f8f0cf93b76d68e10e2ab6d5e24a6097217334960088b63',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
      };

      const transactionHashesRoot = ethers.utils.solidityKeccak256(
        ['uint256', 'uint256'],
        [calculateTransactionHash(withdrawTransactionERC721), ethers.utils.hexZeroPad(0, 32)],
      );

      const blockERC721 = {
        leafCount: 1,
        proposer: owner[0].address,
        root: '0x2dffeee2af2f5be8b946c00d2a0f96dc59ac65d1decce3bae9c2c70d5efca4a0',
        blockNumberL2: 0,
        previousBlockHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
        frontierHash: '0x6fdcfc8a2d541d6b99b6d6349b67783edf599fedfd1931b96f4385bcb3f2f188',
        transactionHashesRoot,
      };

      await setBlockData(
        StateInstance,
        stateAddress,
        calculateBlockHash(blockERC721),
        blockStake,
        owner[0].address,
      );

      const index = 0;
      const siblingPath = [blockERC721.transactionHashesRoot, ethers.utils.hexZeroPad(0, 32)];
      await expect(
        ShieldInstance.setAdvanceWithdrawalFee(
          blockERC721,
          withdrawTransactionERC721,
          index,
          siblingPath,
          {
            value: ethers.utils.parseEther('1'),
          },
        ),
      ).to.be.revertedWith('Shield: Can only advance withdrawals for fungible tokens');
    });

    it('fails if block is finalized', async function () {
      await setBlockData(StateInstance, stateAddress, blockHash, blockStake, owner[0].address);

      const siblingPath = [block.transactionHashesRoot, depositTransactionHash];
      const index = 0;

      await time.increase(86400 * 7);

      await expect(
        ShieldInstance.setAdvanceWithdrawalFee(block, withdrawTransaction, index, siblingPath, {
          value: ethers.utils.parseEther('1'),
        }),
      ).to.be.revertedWith('Shield: The block has already been finalized');
    });

    it('fails if block payment has been claimed', async function () {
      await setBlockData(StateInstance, stateAddress, blockHash, blockStake, owner[0].address);

      const siblingPath = [block.transactionHashesRoot, depositTransactionHash];
      const index = 0;

      await setTransactionWithdrawn(shieldAddress, withdrawTransactionHash);

      await expect(
        ShieldInstance.setAdvanceWithdrawalFee(block, withdrawTransaction, index, siblingPath, {
          value: ethers.utils.parseEther('1'),
        }),
      ).to.be.revertedWith('Shield: This transaction has already paid out');
    });

    it('fails if trying to set a fee for a withdrawal that is not yours', async function () {
      await setBlockData(StateInstance, stateAddress, blockHash, blockStake, owner[0].address);

      await setAdvancedWithdrawal(shieldAddress, withdrawTransactionHash, owner[1].address, 1);

      const siblingPath = [block.transactionHashesRoot, depositTransactionHash];
      const index = 0;

      await expect(
        ShieldInstance.setAdvanceWithdrawalFee(block, withdrawTransaction, index, siblingPath, {
          value: ethers.utils.parseEther('1'),
        }),
      ).to.be.revertedWith('Shield: You are not the current owner of this withdrawal');
    });
  });
});
