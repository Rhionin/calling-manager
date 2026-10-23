const assert = require('assert');
const CMCrypto = require('../js/crypto-file.js');

async function main() {
  assert.strictEqual(CMCrypto.canEncrypt(), true);
  const state = { version: 1, boardHtml: '<ul><li>Sample, Avery</li></ul>', pipeline: {} };
  const wrapped = await CMCrypto.encryptState(state, 'correct horse');
  assert.strictEqual(wrapped.encrypted, true);
  assert.ok(!JSON.stringify(wrapped).includes('Sample, Avery'));
  const opened = await CMCrypto.decryptExport(wrapped, 'correct horse');
  assert.deepStrictEqual(opened, state);
  await assert.rejects(() => CMCrypto.decryptExport(wrapped, 'wrong passphrase'), /did not open/);
  await assert.rejects(() => CMCrypto.encryptState(state, 'short'), /at least 8/);
  await assert.rejects(
    () => CMCrypto.decryptExport(Object.assign({}, wrapped, { iterations: 999999999 }), 'correct horse'),
    /unsupported passphrase/
  );
  console.log('crypto-file.test.js ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
