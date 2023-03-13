import childProcess from 'child_process';
import logger from '@polygon-nightfall/common-files/utils/logger.mjs';
import fs from 'fs';
import path from 'path';
import copyFiles from './copyFiles.mjs';

const { exec } = childProcess;
const fsPromises = fs.promises;

/**
 * function to extract all file paths in a directory
 */
async function getCircuits(dir) {
  let files = await fsPromises.readdir(dir);
  files = await Promise.all(
    files.map(async file => {
      const filePath = path.join(dir, file);
      const stats = await fsPromises.stat(filePath);
      if (stats.isFile()) return filePath;
      return undefined;
    }),
  );
  return files
    .reduce((all, folderContents) => all.concat(folderContents), [])
    .map(file => file.replace(dir.replace('./', '').concat('/'), ''))
    .filter(file => file.endsWith('.zkey'));
}

/**
 * Start the prover
 */
export default async function startProver() {
  logger.info('Executing prover...');

  await copyFiles('./output/prover', './prover');

  const circuitZkeys = await getCircuits('./prover');
  const sZkeys = circuitZkeys.join(' ');
  const command = `cd ./prover && ./proverServer 9080 ${sZkeys}&`;
  logger.info(`Command to execute: ${command}`);

  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) return reject(error);
      if (stderr) return reject(stderr);
      logger.info(`Command ${command} executed`);
      return resolve(stdout);
    });
  });
}
