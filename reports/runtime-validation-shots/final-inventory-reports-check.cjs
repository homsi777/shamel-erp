const { chromium } = require('playwright-core');
const path = require('path');

(async()=>{
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 1024, height: 900 } });

  await page.goto('http://127.0.0.1:5173/#/login', { waitUntil: 'domcontentloaded' });
  await page.locator('input').nth(0).fill('admin');
  await page.locator('input').nth(1).fill('admin123');
  await page.locator('button').nth(2).click();
  await page.waitForTimeout(3500);

  const result = { login: {}, inventory: [], reports: [] };

  result.login = await page.evaluate(() => ({
    url: location.href,
    hasToken: !!localStorage.getItem('shamel_token'),
    company: localStorage.getItem('selected_company_id'),
    branch: localStorage.getItem('selected_branch_id'),
    hasHomsi: (document.body.innerText || '').includes('Homsi')
  }));

  // Inventory checks
  await page.locator('button', { hasText: 'المخزون' }).first().click();
  await page.waitForTimeout(1800);

  for (const w of [360,768,1024]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(1200);
    const metrics = await page.evaluate(() => {
      const text = document.body.innerText || '';
      const tableVisible = !!document.querySelector('table');
      const mobileCards = document.querySelectorAll('div.rounded-2xl.border.border-gray-200.bg-white.p-3.shadow-sm').length;
      const overflow = document.documentElement.scrollWidth > window.innerWidth + 2 || document.body.scrollWidth > window.innerWidth + 2;
      return {
        tableVisible,
        mobileCards,
        overflow,
        hasEditText: text.includes('تعديل'),
        sample: text.slice(0, 500)
      };
    });
    const shot = path.resolve('reports/runtime-validation-shots', `final-inventory-${w}.png`);
    await page.screenshot({ path: shot });
    result.inventory.push({ width: w, ...metrics, screenshot: shot });
  }

  // Reports checks (trial balance output)
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.locator('button', { hasText: 'التقارير' }).first().click();
  await page.waitForTimeout(1500);
  const trial = page.locator('text=ميزان المراجعة العام').first();
  if (await trial.count()) { await trial.click(); await page.waitForTimeout(1200); }
  const view = page.locator('button', { hasText: 'عرض التقرير' }).first();
  if (await view.count()) { await view.click(); await page.waitForTimeout(2200); }

  for (const w of [360,768,1024]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(1200);
    const metrics = await page.evaluate(() => {
      const text = document.body.innerText || '';
      const hasHeaders = text.includes('مدين') && text.includes('دائن') && text.includes('الرصيد');
      const hasGarbled = /�|â€|أ¢|ط[A-Za-z]|ظ[A-Za-z]/.test(text);
      const hasSearchPlaceholder = text.includes('بحث داخل التقرير');
      const overflow = document.documentElement.scrollWidth > window.innerWidth + 2 || document.body.scrollWidth > window.innerWidth + 2;
      return { hasHeaders, hasGarbled, hasSearchPlaceholder, overflow, sample: text.slice(0, 700) };
    });
    const shot = path.resolve('reports/runtime-validation-shots', `final-reports-${w}.png`);
    await page.screenshot({ path: shot });
    result.reports.push({ width: w, ...metrics, screenshot: shot });
  }

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})();
