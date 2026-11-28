const assert=require('node:assert/strict');
const puppeteer=require('puppeteer');
const {createServer}=require('./mock-ep');
const {installControlMenu}=require('../lib/browser-controls');
(async()=>{
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let browser;
 try{
  browser=await puppeteer.launch({headless:'shell',executablePath:process.env.HANDLER_EXECUTABLE_PATH});
  const page=await browser.newPage();await page.setViewport({width:900,height:650});
  await page.goto('http://127.0.0.1:'+server.address().port+'/lesson');
  await page.setContent('<!doctype html><style>html{overflow:scroll;scrollbar-gutter:stable}body{margin:0;height:2000px;width:2000px}</style><p>Offline panel bounds fixture</p>');
  await page.evaluate(installControlMenu);
  // Model classic (non-overlay) scrollbars even on a Linux overlay-scrollbar host.
  await page.evaluate(()=>{
   Object.defineProperty(document.documentElement,'clientWidth',{configurable:true,get:()=>innerWidth-18});
   Object.defineProperty(document.documentElement,'clientHeight',{configurable:true,get:()=>innerHeight-18});
  });
  const drag=async()=>await page.evaluate(()=>{
   const host=document.getElementById('educationperfected-controls'),summary=host.shadowRoot.querySelector('summary');
   const r=summary.getBoundingClientRect();
   for(const [type,x,y]of [['pointerdown',r.left+20,r.top+10],['pointermove',3000,3000],['pointerup',3000,3000]])summary.dispatchEvent(new PointerEvent(type,{bubbles:true,composed:true,clientX:x,clientY:y,button:0,pointerId:1}));
  });
  const check=async()=>{
   const r=await page.evaluate(()=>{const r=document.getElementById('educationperfected-controls').getBoundingClientRect();return{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:document.documentElement.clientWidth,height:document.documentElement.clientHeight};});
   assert.ok(r.left>=0&&r.top>=0&&r.right<=r.width+1&&r.bottom<=r.height+1,JSON.stringify(r));
  };
  await drag();await check();
  assert.ok(await page.evaluate(()=>{const r=document.getElementById('educationperfected-controls').getBoundingClientRect();return Math.abs(r.right-document.documentElement.clientWidth)<1&&Math.abs(r.bottom-document.documentElement.clientHeight)<1;}),'drag reaches the client-area corner');
  await page.evaluate(()=>document.getElementById('educationperfected-controls').shadowRoot.querySelector('details').open=true);
  await new Promise(r=>setTimeout(r,50));await check();
  await page.evaluate(()=>{const h=document.getElementById('educationperfected-controls');h.shadowRoot.querySelector('section').style.maxHeight='65vh';h.shadowRoot.getElementById('guide').open=false;h.shadowRoot.getElementById('help').open=false;h.style.top=(document.documentElement.clientHeight-h.getBoundingClientRect().height)+'px';});
  await page.evaluate(()=>document.getElementById('educationperfected-controls').shadowRoot.getElementById('help').open=true);
  await new Promise(r=>setTimeout(r,100));await check();
  await page.evaluate(()=>{const h=document.getElementById('educationperfected-controls');h.shadowRoot.querySelector('section').style.maxHeight='65vh';h.shadowRoot.getElementById('result').textContent='Long result\n'.repeat(30);});
  await new Promise(r=>setTimeout(r,100));await check();
  await page.setViewport({width:650,height:450});await new Promise(r=>setTimeout(r,50));await check();
  await page.evaluate(()=>{document.getElementById('educationperfected-controls').remove();window.__epControlMenuInstalled=false;});
  await page.evaluate(installControlMenu);await check();
  if(process.env.EP_PANEL_BOUNDS_SCREENSHOT)await page.screenshot({path:process.env.EP_PANEL_BOUNDS_SCREENSHOT});
  console.log('Panel drag, expand, resize and restored positions stay within scrollbar-excluding page bounds.');
 }finally{if(browser)await browser.close();
 server.closeAllConnections();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
