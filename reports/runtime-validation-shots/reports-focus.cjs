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
  await page.locator('button', { hasText: 'التقارير' }).first().click();
  await page.waitForTimeout(1500);

  const viewBtn = page.locator('button', { hasText: 'عرض التقرير' }).first();
  if (await viewBtn.count()) { await viewBtn.click(); await page.waitForTimeout(2000); }

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
        hasReportRows:t.includes('الحساب')||t.includes('مدين')||t.includes('دائن')
      }
    });
    const shot=path.resolve('reports/runtime-validation-shots',`reports-output-${w}.png`);
    await page.screenshot({path:shot});
    out.push({width:w,...m,screenshot:shot});
  }
  console.log(JSON.stringify({out},null,2));
  await browser.close();
})();
