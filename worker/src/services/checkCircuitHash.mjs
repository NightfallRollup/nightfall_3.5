import fs from 'fs';
import path from 'path';

export default async function checkCircuitHash({ filepath, hash }) {
  const outputPath = `./output`;
  const filePath = `${outputPath}/circuithash.txt`;
  const circuitNameWext = path.basename(filepath, '.circom'); // filename without '.circom'

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '[]');
  }

  const resultBuffer = fs.readFileSync(filePath);
  const resultData = JSON.parse(resultBuffer.toString().trim());

  let differentHash;
  let previousHash;
  let exist = false;

  for (const element of resultData) {
    if (element.circuitName === circuitNameWext && element.circuitHash === hash) {
      differentHash = false;
      exist = true;
    } else if (element.circuitName === circuitNameWext && element.circuitHash !== hash) {
      differentHash = true;
      exist = true;
      previousHash = element.circuitHash;
      element.circuitHash = hash;
    }
  }

  if (!exist) {
    resultData.push({ circuitHash: hash, circuitName: circuitNameWext });
    differentHash = true;
  }

  if (differentHash) {
    fs.writeFileSync(filePath, JSON.stringify(resultData));
  }

  return { differentHash, previousHash };
}
