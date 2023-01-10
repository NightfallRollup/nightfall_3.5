/* eslint-disable no-await-in-loop */
import { waitForContract } from '@polygon-nightfall/common-files/utils/contract.mjs';
import constants from '@polygon-nightfall/common-files/constants/index.mjs';
import Web3 from '@polygon-nightfall/common-files/utils/web3.mjs';
import logger from '@polygon-nightfall/common-files/utils/logger.mjs';
import { waitForTimeout } from '@polygon-nightfall/common-files/utils/utils.mjs';

const { STATE_CONTRACT_NAME } = constants;

const TIMER_CHANGE_PROPOSER_SECOND = process.env.TIMER_CHANGE_PROPOSER_SECOND || 30;
const MAX_ROTATE_TIMES = process.env.MAX_ROTATE_TIMES || 2;

async function autoChangeCurrentProposer(proposerEthAddress) {
  const web3 = Web3.connection();
  const stateContractInstance = await waitForContract(STATE_CONTRACT_NAME);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    logger.info('Checking Proposer...');
    const proposerStartBlock = await stateContractInstance.methods.proposerStartBlock().call();
    const rotateProposerBlocks = await stateContractInstance.methods
      .getRotateProposerBlocks()
      .call();
    const numproposers = await stateContractInstance.methods.getNumProposers().call();
    const currentBlock = await web3.eth.getBlockNumber();

    logger.info(`proposerEthAddress: ${proposerEthAddress}`);

    if (currentBlock - proposerStartBlock >= rotateProposerBlocks && numproposers > 1) {
      const currentSprint = await stateContractInstance.methods.currentSprint().call();
      const sprintInSpan = await stateContractInstance.methods.getSprintsInSpan().call();

      if (currentSprint === '0') {
        let spanProposersList = [];
        for (let i = 0; i < sprintInSpan; i++) {
          spanProposersList.push(stateContractInstance.methods.spanProposersList(i).call());
        }
        spanProposersList = await Promise.all(spanProposersList);
        logger.info(`list of next proposer: ${spanProposersList}`);
      }
      const spanProposersListAtPosition = await stateContractInstance.methods
        .spanProposersList(currentSprint)
        .call();
      logger.info(`Proposer address: ${spanProposersListAtPosition} and sprint: ${currentSprint}`);
      try {
        if (spanProposersListAtPosition === proposerEthAddress) {
          logger.info(`${proposerEthAddress} is Calling changeCurrentProposer`);
          await stateContractInstance.methods.changeCurrentProposer().send();
        } else if (currentBlock - proposerStartBlock >= rotateProposerBlocks * MAX_ROTATE_TIMES) {
          logger.info(
            `${proposerEthAddress} is not the next proposer and is Calling changeCurrentProposer`,
          );
          await stateContractInstance.methods.changeCurrentProposer().send();
        }
      } catch (err) {
        logger.error(err);
      }
    }
    await waitForTimeout(TIMER_CHANGE_PROPOSER_SECOND * 1000);
  }
}

export default autoChangeCurrentProposer;