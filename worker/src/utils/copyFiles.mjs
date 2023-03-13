import childProcess from 'child_process';

const { exec } = childProcess;

/**
 * Copy files from fromPath to toPath.
 *
 * @param {String} fromPath - Path to copy from
 * @param {String} toPath - Path to copy to
 */
export default async function copyFiles(fromPath, toPath) {
  const parsedFromPath = fromPath.endsWith('/') ? fromPath : `${fromPath}/`;
  const parsedToPath = toPath.endsWith('/') ? toPath : `${toPath}/`;

  const command = `mkdir -p ${toPath} && cp ${parsedFromPath}* ${parsedToPath}`;

  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) return reject(error);
      if (stderr) return reject(stderr);
      return resolve(stdout);
    });
  });
}
