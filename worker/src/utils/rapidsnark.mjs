import axios from 'axios';

async function callInput(input, circuit) {
  const res = await axios.post(`http://localhost:9080/input/${circuit}`, input);
  if (res.status === 200) {
    return true;
  } else {
    throw new Error(res.status);
  }
}

async function getStatus() {
  const res = await axios.get(`http://localhost:9080/status`);
  if (res.status !== 200) {
    throw new Error(res.status);
  }
  return res.data;
}

/**
 * Takes in a input with all the inputs of the circuit and outputs a proof and public inputs.
 * @param {String} input - Input for the circuit
 * @param {String} circuit - Circuit to use
 */
export default async function generateProof(input, circuit) {
  await callInput(input, circuit);
  let st;
  st = await getStatus();
  while (st.status == 'busy') {
    st = await getStatus();
  }

  const proof = JSON.parse(st.proof);
  const publicInputs = JSON.parse(st.pubData);

  return { proof, publicInputs };
}
