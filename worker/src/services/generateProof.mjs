import path from 'path';
import logger from '@polygon-nightfall/common-files/utils/logger.mjs';
import generateProof from '../utils/rapidsnark.mjs';

export default async ({ folderpath, inputs, transactionInputs }) => {
  let proof;
  let publicInputs;

  const circuitName = path.basename(folderpath);

  logger.debug('Compute witness and generate proof...');

  ({ proof, publicInputs } = await generateProof(inputs, circuitName));

  logger.debug({
    msg: 'Responding with proof and inputs',
    proof,
    publicInputs,
  });

  return {
    proof,
    inputs: publicInputs,
    transactionInputs,
    type: folderpath,
  };
};
