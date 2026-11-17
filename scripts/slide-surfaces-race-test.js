const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');
const { createServer } = require('./mock-ep');
const { detectQuestion } = require('../lib/detect-question');
const { readDropdownNumberBox } = require('../lib/dropdown-numberbox-state');
const { probeAllSurfacesInPage } = require('../lib/slide-surfaces-state');
// Regression for the PR #215 review: the orchestrator's all-surface probe
// must never gate delegation to the established mixed reader. A probe
// snapshot can beat an asynchronously rendering second surface; the
// delegated reader's own mid-swap re-probe is the established answer.
(async()=>{
    const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
    let browser;
    try {
        browser=await puppeteer.launch({headless:true,executablePath:process.env.HANDLER_EXECUTABLE_PATH || undefined});
        const page=await browser.newPage(),origin='http://127.0.0.1:'+server.address().port;
        await page.goto(origin+'/lesson-dropdown-number-box');
        // The probe counts every recognised surface on the mixed fixture.
        const probe=await page.evaluate(probeAllSurfacesInPage);
        assert.deepEqual(probe,{selects:4,numberBoxes:6,textBoxes:0,gaps:0,choices:0,multiSelects:0,highlights:0});
        // Race regression: the all-surface probe's snapshot can beat an
        // asynchronously rendering surface. Hiding every box-family control
        // during the probe makes it report a no-box slide; the box-family
        // path must still delegate to the established mixed reader
        // unconditionally (its own mid-swap re-probe is the established
        // answer), so detection answers the slide exactly as before.
        const original=page.evaluate.bind(page);let raced=false;
        page.evaluate=async function(fn,...args){
            if(fn.name==='probeAllSurfacesInPage'){
                await original(()=>{window.heldControls=[...document.querySelectorAll('#ep-question-container select,#ep-question-container input')];window.heldControls.forEach(e=>e.hidden=true);});
                const result=await original(fn,...args);
                await original(()=>window.heldControls.forEach(e=>e.hidden=false));
                raced=true;return result;
            }
            return original(fn,...args);
        };
        const detected=await detectQuestion(page);
        const direct=await readDropdownNumberBox(page,'descriptor');
        assert.equal(raced,true); // the raced probe ran; delegation is unconditional anyway
        assert.equal(detected?.kind,'dropdown-numberbox');
        assert.equal(direct?.descriptor?.kind,'dropdown-numberbox');
        assert.equal(detected?.key,direct.descriptor.key);
        console.log('Slide orchestrator race regression: raced probe still delegates; probe counts all surfaces PASS');
    } finally { try { if(browser) await browser.close(); } finally { await new Promise(r=>server.close(r)); } }
})().catch(e=>{console.error(e);process.exitCode=1;});
