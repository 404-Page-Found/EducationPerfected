// Source-checkout entry. Electron's default app loads a file entry as a module,
// so require.main === module in main.js is not a reliable source-launch guard.
'use strict';
require('./main').startElectronApp();
