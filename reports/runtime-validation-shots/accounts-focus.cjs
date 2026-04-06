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
  await page.locator('button', { hasText: 'شجرة الحسابات' }).first().click();
  await page.waitForTimeout(1500);

  const balBtn = page.locator('button', { hasText: 'جدول الأرصدة' }).first();
  if (await balBtn.count()) { await balBtn.click(); await page.waitForTimeout(1200); }

  let opened=0;
  const rows=page.locator('tbody tr');
  const count=await rows.count().catch(()=>0);
  for(let i=0;i<Math.min(3,count);i++){
    try{ await rows.nth(i).click({timeout:1000}); await page.waitForTimeout(500); opened++; }catch{}
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
        hasActions:t.includes('خيارات')||t.includes('تفاصيل')
      }
    });
    const shot=path.resolve('reports/runtime-validation-shots',`accounts-table-${w}.png`);
    await page.screenshot({path:shot});
    out.push({width:w,...m,screenshot:shot});
  }
  console.log(JSON.stringify({opened,out},null,2));
  await browser.close();
})();
