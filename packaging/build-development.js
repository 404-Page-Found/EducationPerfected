// Shared local development SEA builder. No signing or distribution authority.
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { createGzip } = require('node:zlib');
const { createHash } = require('node:crypto');
const esbuild = require('esbuild');
const { packTar } = require('modern-tar/fs');
async function resolveBrowser(target) {
 let browserDir,archiveRoot,browserExecutable;
 const browser = await require('puppeteer').executablePath();browserDir = path.dirname(browser);
 if (!fs.existsSync(browser)) throw new Error('Chrome for Testing is not installed; run npx puppeteer browsers install chrome');
 archiveRoot=browserDir;browserExecutable=path.basename(browser);
 if(target.macosLayout) {
  if(process.platform!=='darwin' || !['arm64','x64'].includes(process.arch))throw new Error('macOS archive preparation requires native macOS arm64 or x64');
  const layout=require('./macos-browser-layout').macosBrowserLayout(browser,process.arch);
  archiveRoot=layout.archiveRoot; browserExecutable=layout.executable;
 } else if (path.basename(browserDir) !== target.browserDirectory || target.browserFiles.some(file => !fs.existsSync(path.join(browserDir,file)))) throw new Error('Expected a Chrome for Testing payload directory');
 return { archiveRoot, browserExecutable };
}
function copyRuntimeNotice(notices) {
 const runtime = require('./notices/runtime.json');
 if (process.versions.node !== runtime.version) throw new Error('Node runtime notice version mismatch');
 const runtimeNotice = fs.readFileSync(path.join(__dirname, 'notices', runtime.file));
 if (createHash('sha256').update(runtimeNotice).digest('hex') !== runtime.sha256) throw new Error('Node runtime notice checksum mismatch');
 fs.writeFileSync(path.join(notices, runtime.file), runtimeNotice);
 fs.copyFileSync(path.join(__dirname, 'notices/runtime.json'), path.join(notices, 'NODE-RUNTIME-PROVENANCE.json'));
}
// Copies the license files a dependency ships; returns the destination names.
function copyLicenseFiles(relative, directory, notices) {
 const copied = [];
  for (const filename of fs.readdirSync(directory).filter(name => /^(LICENSE|COPYING|NOTICE)/i.test(name))) {
   if (fs.statSync(path.join(directory, filename)).isFile()) {
    const destination = relative.replaceAll('/', '-') + '-' + filename;
    fs.copyFileSync(path.join(directory, filename), path.join(notices, destination)); copied.push(destination);
   }
  }
 return copied;
}
// A dependency without shipped notices may have a recovered notice on record.
function recoverNotice(pkg, notices, copied) {
   const recovered = require('./notices/provenance.json').find(item => item.name === pkg.name && item.version === pkg.version);
   if (recovered) {
    const source = path.join(__dirname, 'notices', recovered.file);
    const bytes = fs.readFileSync(source);
    if (createHash('sha256').update(bytes).digest('hex') !== recovered.sha256) throw new Error('Recovered notice checksum mismatch');
    fs.copyFileSync(source, path.join(notices, recovered.file)); copied.push(recovered.file);
   }
}
function noticeEntry(relative, directory, notices) {
  const pkg = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
 const copied = copyLicenseFiles(relative, directory, notices);
 if (!copied.length) recoverNotice(pkg, notices, copied);
 return { name: pkg.name, version: pkg.version, license: pkg.license || null, repository: pkg.repository || null, files: copied, status: copied.length ? 'files-copied-not-legally-reviewed' : 'MISSING-NOTICE-REQUIRES-REVIEW' };
}
function inventoryDependencies(lock, notices) {
 const inventory = [];
 for (const [relative, record] of Object.entries(lock.packages)) {
  if (!relative || record.dev) continue;
  const directory = path.join(__dirname, '..', relative);
  if (!fs.existsSync(directory)) {
   if (record.optional) continue; // Other-platform optional binary, not in this build.
   throw new Error('Missing required production dependency: ' + relative);
  }
  inventory.push(noticeEntry(relative, directory, notices));
 }
 return inventory;
}
// Inventory every installed production dependency, including missing notice files.
// This is an audit aid, not permission to redistribute an incomplete notice set.
function writeNotices(out) {
 const notices = path.join(out, 'THIRD-PARTY-NOTICES'); fs.rmSync(notices, {recursive:true,force:true}); fs.mkdirSync(notices, { recursive: true });
 const lock = JSON.parse(fs.readFileSync(path.join(__dirname, '../package-lock.json'), 'utf8'));

 copyRuntimeNotice(notices);
 const inventory = inventoryDependencies(lock, notices);
 fs.copyFileSync(path.join(__dirname, 'notices/provenance.json'), path.join(notices, 'RECOVERED-NOTICE-PROVENANCE.json'));
 fs.writeFileSync(path.join(notices, 'DEPENDENCY-INVENTORY.json'), JSON.stringify(inventory, null, 2));
 fs.writeFileSync(path.join(notices, 'BROWSER.txt'), 'Chrome for Testing browser files are bundled without removal of their accompanying notices. Redistribution and project licensing review remain release gates.\n');
 const missing = inventory.filter(item => !item.files.length);
 fs.writeFileSync(path.join(notices, 'NOT-FOR-DISTRIBUTION.txt'), 'Development artifact only. License/notice completeness and project rights are NOT cleared. Missing notices: ' + missing.map(item => item.name).join(', ') + '\n');
 if (missing.length) console.warn('Development build has missing third-party notice files; distribution is blocked. See DEPENDENCY-INVENTORY.json.');
 return notices;
}
async function writeBrowserPayload(out, notices, directDownload, archiveRoot, browserExecutable) {
 let archive;
 if(!directDownload){
 archive = path.join(out, 'browser.tar.gz');
 await pipeline(packTar(archiveRoot), createGzip(), fs.createWriteStream(archive));
 const hash = createHash('sha256'); for await (const chunk of fs.createReadStream(archive)) hash.update(chunk);
 // browserVersion is the expected public pin, not an observed cached-binary version.
 // The diagnostic observer must compare the actual post-ready version separately.
 fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ length: fs.statSync(archive).size, sha256: hash.digest('hex'), executable: browserExecutable, browserVersion: require('puppeteer').PUPPETEER_REVISIONS.chrome }));
 } else {
 fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({browserMode:'direct-google-download',browserVersion:require('./browser-downloads.json').version}));
 fs.writeFileSync(path.join(notices,'BROWSER.txt'),'No browser binary is included. First run offers a fixed-version direct Google download under Google terms; checksum pins are in browser-downloads.json. Browser notices remain with that download.\n');
 }
 return archive;
}
async function buildExecutable(target, out, directDownload, archive) {
 await esbuild.build({ entryPoints: [path.join(__dirname, 'bootstrap.js')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, 'main.cjs'), external: ['keytar', '@napi-rs/keyring'], define: { 'process.env.NODE_ENV': '"production"' } });
 const config = { main: path.join(out, 'main.cjs'), output: path.join(out, 'main.blob'), disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false, execArgvExtension: 'none', assets: { ...(directDownload?{}:{browser:archive}), manifest: path.join(out, 'manifest.json'), native: require.resolve(target.nativePackage) } };
 fs.writeFileSync(path.join(out, 'sea.json'), JSON.stringify(config));
 cp.execFileSync(process.execPath, ['--experimental-sea-config', path.join(out, 'sea.json')], { stdio: 'inherit' });
 const executable = path.join(out, target.executable); fs.copyFileSync(process.execPath, executable); fs.chmodSync(executable, 0o700);
 return { config, executable };
}
function injectBlob(target, executable, config) {
 if(target.macosLayout) {
  require('./macos-sea-steps').finishMacosSea({executable,blob:config.output,node:process.execPath,postject:require.resolve('postject/dist/cli.js')});
 } else {
 cp.execFileSync(process.execPath, [require.resolve('postject/dist/cli.js'), executable, 'NODE_SEA_BLOB', config.output, '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'], { stdio: 'inherit' });
 // Icon last: it is the final exe mutation, after the SEA blob injection.
 if (target.executable.endsWith('.exe')) require('./windows-icon').applyWindowsIcon(executable, path.join(__dirname, '..', 'branding', 'educationperfected.ico'), require('../package.json').version);
 }
}
async function buildDevelopment(target) {
 if (process.argv.length > 2) throw new Error('This development builder accepts no output path arguments');
 if (process.env.PUPPETEER_EXECUTABLE_PATH) throw new Error('Custom browser paths are not accepted by this development builder');
 const out = path.resolve(__dirname, '../build', target.directory); fs.mkdirSync(out, { recursive: true });
 const directDownload=target.browserMode==='direct-google-download';
 let archiveRoot,browserExecutable;
 if(!directDownload) ({ archiveRoot, browserExecutable } = await resolveBrowser(target));
 const notices = writeNotices(out);
 const archive = await writeBrowserPayload(out, notices, directDownload, archiveRoot, browserExecutable);
 const { config, executable } = await buildExecutable(target, out, directDownload, archive);
 injectBlob(target, executable, config);
 // Browser is a SEA asset; no data is appended after executable generation.
 console.log('Development executable: ' + executable);
}
module.exports = { buildDevelopment };
