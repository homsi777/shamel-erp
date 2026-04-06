const fs = require('fs');
const { chromium } = require('playwright-core');
(async()=>{
 const chromeCandidates = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
 ];
 const executablePath = chromeCandidates.find((p)=>fs.existsSync(p));
 const browser = await chromium.launch({headless:true, executablePath});
 const page= await browser.newPage({viewport:{width:390,height:844}});
 await page.goto('http://127.0.0.1:5173',{waitUntil:'domcontentloaded'});
 await page.fill('input[placeholder="اسم المستخدم"]','admin');
 await page.fill('input[placeholder="كلمة المرور"]','admin123');
 await page.click('button:has-text("دخول للنظام")');
 await page.waitForTimeout(3000);
 const txt = await page.locator('body').innerText();
 console.log('hasMenu', txt.includes('المخزون'), 'hasDash', txt.includes('لوحة'), 'hasLogin', txt.includes('دخول للنظام'));
 await page.screenshot({path:'reports/runtime-validation-shots/login-check.png',fullPage:true});
 await browser.close();
})();
