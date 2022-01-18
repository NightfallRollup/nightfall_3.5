/**
Module that runs up as a user
*/
import logger from 'common-files/utils/logger.mjs';
import config from 'config';
import Nf3 from '../../../../cli/lib/nf3.mjs';

const {
  zkpMnemonic,
  userEthereumSigningKey,
  optimistWsUrl,
  web3WsUrl,
  clientBaseUrl,
  optimistBaseUrl,
} = config;

/**
Does the preliminary setup and starts listening on the websocket
*/
async function localTest() {
  logger.info('Starting local test...');
  const nf3 = new Nf3(web3WsUrl, userEthereumSigningKey, {
    clientApiUrl: clientBaseUrl,
    optimistApiUrl: optimistBaseUrl,
    optimistWsUrl,
  });
  await nf3.init(zkpMnemonic);
  if (await nf3.healthcheck('client')) logger.info('Healthcheck passed');
  else throw new Error('Healthcheck failed');
  const ercAddress = await nf3.getContractAddress('ERC20Mock'); // TODO use proper mock contracts
  const startBalance = await nf3.getLayer2Balances();
  await nf3.deposit(ercAddress, 'ERC20', 1, '0x00');
  await nf3.deposit(ercAddress, 'ERC20', 1, '0x00');
  let endBalance = await nf3.getLayer2Balances();
  while (Object.keys(startBalance).length >= Object.keys(endBalance).length) {
    logger.warn(
      'The test has not yet passed because the L2 balance has not increased - waiting 30s',
    );
    // eslint-disable-next-line no-await-in-loop
    await new Promise(resolve => setTimeout(resolve, 30000));
    // eslint-disable-next-line no-await-in-loop
    endBalance = await nf3.getLayer2Balances();
  }
  logger.info('Test passed');
  nf3.close();
}

localTest();