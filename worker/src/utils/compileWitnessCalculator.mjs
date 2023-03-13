import childProcess from 'child_process';

const { exec } = childProcess;

/**
 * Compiles code found at `codePath` and outputs at the output path.
 *
 * @example
 * // Will compile contents, generating ./ft-mint.code` and ./ft-mint as outputs
 * compileWitnessCalculator('./code/ft-mint/ft-mint.code', './');
 *
 * @param {String} codePath - Path of code file to compile
 * @param {String} [outputPath=./] - Directory to output, defaults to current directory
 * @param {String} circuitName - circuit name
 * @param {String} circuitKeyPath - Path of zkey file compiled
 */
export default async function compileWitnessCalculator(
  codePath,
  outputPath = './',
  circuitName,
  circuitKeyPath,
) {
  const parsedOutputPath = outputPath.endsWith('/') ? outputPath : `${outputPath}/`;
  const command = `cd ${codePath} && make && cd /app && mkdir -p ${parsedOutputPath} && cp ${codePath}/${circuitName} ${parsedOutputPath} && cp ${circuitKeyPath} ${parsedOutputPath} && cp ${codePath}/${circuitName}.dat ${parsedOutputPath}`;

  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) return reject(error);
      if (stderr) return reject(stderr);
      return resolve(stdout);
    });
  });
}
