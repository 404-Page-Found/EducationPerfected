const assert = require('node:assert/strict');
const {pathToFileURL} = require('node:url');
const path = require('node:path');
const puppeteer = require('puppeteer');
(async () => {
 const browser = await puppeteer.launch({headless:'shell',executablePath:process.env.HANDLER_EXECUTABLE_PATH});
 try {
  const page = await browser.newPage();
  await page.setViewport({width:1100,height:760});
  await page.goto(pathToFileURL(path.join(__dirname,'../app/renderer/index.html')).href);
  await page.evaluate(() => { document.querySelector('#version').textContent='v2026.11.22'; });
  for (const tall of [false,true]) {
   await page.evaluate(tall => {
    const content=document.querySelector('#loading-screen');content.style.height=tall?'1500px':'60px';
    document.querySelector('#app').scrollTop=0;
   },tall);
   const bounds=await page.$eval('#app-footer',el=>({bottom:el.getBoundingClientRect().bottom,top:el.getBoundingClientRect().top}));
   assert.ok(Math.abs(bounds.bottom-760)<=1,JSON.stringify({tall,bounds}));
   assert.ok(bounds.top>=0);
   if(tall){await page.$eval('#app',el=>{el.scrollTop=el.scrollHeight;});assert.ok(Math.abs(await page.$eval('#app-footer',el=>el.getBoundingClientRect().bottom)-760)<=1);}
  }
  if(process.env.EP_FOOTER_SCREENSHOT)await page.screenshot({path:process.env.EP_FOOTER_SCREENSHOT,clip:{x:0,y:600,width:420,height:160}});
  console.log('Desktop footer stays flush to the viewport bottom for short and scrollable panes.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
