const { chromium } = require('playwright-core');
const path = require('path');

(async()=>{
  const browser = await chromium.launch({headless:true, executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const page = await browser.newPage({viewport:{width:1280,height:900}});
  await page.goto('http://127.0.0.1:5173/#/login',{waitUntil:'domcontentloaded'});
  await page.locator('input').nth(0).fill('admin');
  await page.locator('input').nth(1).fill('admin123');
  await page.locator('button').nth(2).click();
  await page.waitForTimeout(3500);

  await page.locator('button', { hasText: 'الفواتير' }).first().click();
  await page.waitForTimeout(1800);

  const regBtn = page.locator('button', { hasText: 'السجل' }).first();
  if (await regBtn.count()) {
    await regBtn.click();
    await page.waitForTimeout(1500);
  }

  let opened = 0;
  const rows = page.locator('tbody tr');
  const c = await rows.count().catch(()=>0);
  for(let i=0;i<Math.min(3,c);i++){
    try{ await rows.nth(i).click({timeout:1200}); await page.waitForTimeout(700); opened++; }catch{}
  }

  const widths=[360,768,1280];
  const out=[];
  for(const w of widths){
    await page.setViewportSize({width:w,height:900});
    await page.waitForTimeout(1000);
    const m=await page.evaluate(()=>{
      const t=document.body.innerText||'';
      return {
        url:location.href,
        hasTable:!!document.querySelector('table'),
        hasCards:document.querySelectorAll('div.rounded-2xl.border.border-gray-200.bg-white').length>0,
        overflow:document.documentElement.scrollWidth>window.innerWidth+2 || document.body.scrollWidth>window.innerWidth+2,
        hasOptions:t.includes('خيارات')||t.includes('تفاصيل')||t.includes('طباعة')
      }
    });
    const shot=path.resolve('reports/runtime-validation-shots',`invoices-register-${w}.png`);
    await page.screenshot({path:shot});
    out.push({width:w,...m,screenshot:shot});
  }
  console.log(JSON.stringify({opened,out},null,2));
  await browser.close();
})();
