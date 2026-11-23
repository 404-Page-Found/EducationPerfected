// Boolean accuracy, fixed 70-90 band, precedence and runtime helpers.
const assert = require('node:assert/strict');
const { DEFAULT_MIN, DEFAULT_MAX, parseAccuracyCliArgs, resolveAccuracyConfig, pickTarget, createAccuracyRun, makeTypo, makeTypoFor, pickDistractorIndex } = require('../lib/accuracy');
assert.equal(DEFAULT_MIN,70); assert.equal(DEFAULT_MAX,90);
for (const flag of ['--accuracy','-a']) {
 assert.deepEqual(parseAccuracyCliArgs([flag,'on']),{options:{on:true},error:null});
 assert.deepEqual(parseAccuracyCliArgs([flag,'off']),{options:{perfect:true},error:null});
 for(const bad of ['0','82','100','70-90','60-80','bad']) assert.ok(parseAccuracyCliArgs([flag,bad]).error);
}
assert.ok(parseAccuracyCliArgs(['--accuracy-range','70-90']).error);
assert.ok(parseAccuracyCliArgs(['-r','70-90']).error);
assert.ok(parseAccuracyCliArgs(['--accuracy']).error);
assert.ok(parseAccuracyCliArgs(['-p=1']).error);
assert.deepEqual(parseAccuracyCliArgs(['--perfect']),{options:{perfect:true},error:null});
for (const env of [{},{EP_TEST_BOOT:'1'}]) assert.equal(resolveAccuracyConfig({env}).enabled,false);
for (const env of [{EP_ACCURACY:'on'},{EP_PERFECT:'0'},{EP_TEST_BOOT:'1',EP_ACCURACY:'on'}]) {
 const c=resolveAccuracyConfig({env}); assert.equal(c.enabled,true); assert.equal(c.min,70); assert.equal(c.max,90); assert.equal(c.fixedTarget,null);
}
for (const value of ['0','82','100','60-80','70-90','bad']) assert.throws(()=>resolveAccuracyConfig({env:{EP_ACCURACY:value}}),/Invalid EP_ACCURACY/);
assert.throws(()=>resolveAccuracyConfig({env:{EP_ACCURACY_RANGE:'60-80'}}),/retired/);
assert.throws(()=>resolveAccuracyConfig({env:{EP_PERFECT:'tru'}}),/Invalid EP_PERFECT/);
assert.equal(resolveAccuracyConfig({cli:{on:true},env:{EP_PERFECT:'1'}}).enabled,true);
assert.equal(resolveAccuracyConfig({cli:{perfect:true},env:{EP_ACCURACY:'on'}}).enabled,false);
const normalized=resolveAccuracyConfig({env:{},config:{enabled:true,min:0,max:10,fixedTarget:0}});
assert.equal(normalized.min,70);assert.equal(normalized.max,90);assert.equal(normalized.fixedTarget,null);
assert.equal(pickTarget({enabled:false},()=>0),100);
assert.equal(pickTarget({enabled:true,min:0,max:1,fixedTarget:0},()=>0),70);
assert.equal(pickTarget({enabled:true},()=>0.999),90);
let draws=[0,0.99];const run=createAccuracyRun(normalized,()=>draws.shift());
assert.equal(run.target,70); assert.equal(run.shouldMistake(),true); run.recordFirstTry(true); assert.equal(run.accuracy(),0);
const correct=createAccuracyRun(normalized,()=>0.5);assert.equal(correct.shouldMistake(),false);correct.recordFirstTry(false);assert.equal(correct.accuracy(),100);
assert.equal(createAccuracyRun({enabled:false},()=>0.99).shouldMistake(),false);

// Typos: human-plausible, never empty, never identical, avoid-list respected.
for (const word of ['hello', 'Bonjour', 'hola', 'a', 'ab', 'I take']) {
    const typo = makeTypo(word, { random: () => 0.5 });
    assert.ok(typeof typo === 'string' && typo.trim() !== '', `typo for ${word}`);
    assert.notEqual(typo, word, `typo differs for ${word}`);
    assert.ok(typo.length <= word.length + 2, 'small edit, not garbage');
}
{
    const typo = makeTypoFor('hello', ['helol', 'hello']);
    assert.ok(typo && typo.toLowerCase() !== 'hello' && typo.toLowerCase() !== 'helol');
    // Options-object form.
    const typo2 = makeTypo('world', { avoid: ['world'], random: () => 0.1 });
    assert.notEqual(typo2.toLowerCase(), 'world');
    assert.equal(makeTypo('', { random: () => 0.5 }), null);
}
// Distractor: neighboring incorrect option.
assert.equal(pickDistractorIndex(['a', 'b', 'c'], 1), 2);
assert.equal(pickDistractorIndex(['a', 'b', 'c'], 2), 1);
assert.equal(pickDistractorIndex(['only'], 0), null);
assert.equal(pickDistractorIndex(['a', 'b'], 5), null);

console.log('Accuracy unit coverage passed (issue #222).');
