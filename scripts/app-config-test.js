const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const {normalizeConfig,readConfig,writeConfig}=require('../lib/app-config');
const {resolveAccuracyConfig}=require('../lib/accuracy'); const {createHumanDelay}=require('../lib/human-delay');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'ep-config-test-')); const options={home};
try {
 assert.deepEqual(readConfig(options),{version:2});
 const root=path.join(home,'.educationperfected'),file=path.join(root,'config.json');
 for(const enabled of [true,false]) {
  const old={version:1,accuracy:{enabled,min:0,max:100,fixedTarget:0},delay:{enabled,override:[1500,4000]}};
  fs.writeFileSync(file,JSON.stringify(old));
  const migrated=readConfig(options); assert.deepEqual(migrated,{version:2});
  assert.equal(resolveAccuracyConfig({env:{},config:migrated.accuracy}).enabled,false);
  assert.equal(createHumanDelay({env:{},config:migrated.delay}).isEnabled(),false);
  writeConfig(migrated,options); assert.equal(JSON.parse(fs.readFileSync(file)).version,2);
 }
 const on={version:2,accuracy:{enabled:true},delay:{enabled:true}};
 writeConfig({...on,password:'not-a-real-secret',email:'fixture'},options);
 assert.deepEqual(readConfig(options),on);
 assert(!fs.readFileSync(file,'utf8').includes('secret'));
 if(process.platform!=='win32')assert.equal(fs.statSync(file).mode&0o777,0o600);
 // Later user choices persist, but retired numeric/range fields never do.
 assert.deepEqual(normalizeConfig({version:2,accuracy:{enabled:true,min:0,max:10,fixedTarget:0},delay:{enabled:true,override:[1,2]}}),on);
 const off={version:2,accuracy:{enabled:false},delay:{enabled:false}};
 writeConfig(off,options);assert.deepEqual(readConfig(options),off);
 assert.equal(resolveAccuracyConfig({env:{EP_ACCURACY:'on'},config:off.accuracy}).enabled,true);
 assert.equal(createHumanDelay({env:{EP_HUMAN_DELAY:'on'},config:off.delay}).isEnabled(),true);
 for(const bad of ['','{broken','null','{"version":3}']) {fs.writeFileSync(file,bad);assert.deepEqual(readConfig(options),{version:2});}
 fs.unlinkSync(file); fs.mkdirSync(file); assert.deepEqual(readConfig(options),{version:2});
 assert.throws(()=>writeConfig(on,options));assert.deepEqual(fs.readdirSync(root),['config.json']);fs.rmdirSync(file);
 if(process.platform!=='win32') {
  const target=path.join(home,'outside.json');fs.writeFileSync(target,JSON.stringify(on));fs.symlinkSync(target,file);
  assert.deepEqual(readConfig(options),{version:2});writeConfig(off,options);assert(!fs.lstatSync(file).isSymbolicLink());assert.deepEqual(JSON.parse(fs.readFileSync(target)),on);
 }
 console.log('Config v2: upgrade resets both once, later choices persist, numeric fields dropped, private atomic writes pass.');
} finally {fs.rmSync(home,{recursive:true,force:true});}
