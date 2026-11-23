// Test-only preload: deterministic sampling without adding a production knob.
// bootCli confines this process to the local mock server.
if (process.env.EP_TEST_BOOT !== '1' || process.env.EP_LOGIN_HOST !== '127.0.0.1') throw new Error('Local fixture only.');
const accuracy = require('../lib/accuracy');
const create = accuracy.createAccuracyRun;
accuracy.createAccuracyRun = config => {
 let first = true;
 return create(config, () => { if(first) {first=false;return 0;} return 0.99; });
};
