/**
Module that runs up as a combined proposer and challenger
*/
import { Command } from 'commander/esm.mjs';
import axios from 'axios';
import Web3 from 'web3';
import clear from 'clear';
import WebSocket from 'ws';
import {
  submitTransaction,
  getContractAddress,
  optimistBaseUrl,
  web3WsUrl,
  healthcheck,
  optimistWsUrl,
} from './common.mjs';

const defaultKey = '0x4775af73d6dc84a0ae76f8726bda4b9ecf187c377229cb39e1afa7a18236a69e';
const program = new Command();
axios.defaults.baseURL = optimistBaseUrl;
program.option('-k, --key', 'Ethereum signing key', defaultKey);
const ethereumSigningKey = program.opts().key || defaultKey;

async function registerProposer(web3, proposersContractAddress, proposersAddress) {
  const res = await axios.post('/proposer/register', { address: proposersAddress });
  const { txDataToSign } = res.data;
  // we have to pay 10 ETH to be registered
  const PROPOSER_BOND = 10000000000000000000;
  // now we need to sign the transaction and send it to the blockchain
  return submitTransaction(
    web3,
    txDataToSign,
    ethereumSigningKey,
    proposersContractAddress,
    PROPOSER_BOND,
  );
}

/**
Does the preliminary setup and starts listening on the websocket
*/
async function startProposer() {
  clear();
  console.log('Starting Proposer...');
  const BLOCK_STAKE = 1000000000000000000; // 1 ether
  await healthcheck(optimistBaseUrl);
  console.log('Healthcheck passed');
  const web3 = new Web3(web3WsUrl);
  const ethereumAddress = web3.eth.accounts.privateKeyToAccount(ethereumSigningKey).address;
  await registerProposer(web3, await getContractAddress('Proposers'), ethereumAddress);
  console.log('Proposer registration complete');
  const stateContractAddress = await getContractAddress('State');
  const connection = new WebSocket(optimistWsUrl);
  connection.onopen = () => {
    connection.send('blocks');
  };
  connection.onmessage = async message => {
    const msg = JSON.parse(message.data);
    const { type, txDataToSign } = msg;
    if (type === 'block') {
      await submitTransaction(
        web3,
        txDataToSign,
        ethereumSigningKey,
        stateContractAddress,
        BLOCK_STAKE,
      );
    }
  };
  // TODO subscribe to layer 1 blocks and call change proposer
  console.log('Listening for incoming events');
}

startProposer();