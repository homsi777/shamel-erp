const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

(async () => {
  const chromeCandidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
  ];
  const executablePath = chromeCandidates.find((p) => fs.existsSync(p));

  const outDir = path.join(process.cwd(), 'reports', 'runtime-validation-shots');
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true, executablePath });
  const context = await browser.newContext({ viewport: { width: 1024, height: 900 } });
  const page = await context.newPage();

  const result = {
    login: { ok: false, contextHint: '' },
    inventory: [],
    reports: []
  };

  const hasOverflow = async () => page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth > window.innerWidth + 2;
  });

  async function clickVisible(text) {
    const locator = page.locator(`button:has-text("${text}"):visible, a:has-text("${text}"):visible, [role="button"]:has-text("${text}"):visible`).first();
    if (await locator.count()) {
      await locator.evaluate((el) => (el).click());
      await page.waitForTimeout(900);
      return true;
    }
    return false;
  }

  await page.goto('http://127.0.0.1:5173', { waitUntil: 'domcontentloaded' });
  await page.fill('input[placeholder="اسم المستخدم"]', 'admin');
  await page.fill('input[placeholder="كلمة المرور"]', 'admin123');
  await page.click('button:has-text("دخول للنظام")');
  await page.waitForTimeout(2800);

  const shellText = await page.locator('body').innerText();
  result.login.ok = shellText.includes('المخزون') || shellText.includes('لوحة');
  result.login.contextHint = shellText.includes('Homsi') ? 'Homsi' : 'unknown';

  await clickVisible('المخزون');
  const invWidths = [360, 768, 1024];
  for (const width of invWidths) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(700);
    await clickVisible('المخزون');

    const cardCount = await page.locator('div.rounded-2xl.border.border-gray-200.bg-white.p-3.shadow-sm').count();
    const rowGridCount = await page.locator('div[style*="grid-template-columns: 2rem 1fr 8rem 8rem 9rem 7rem 7rem 5rem"]').count();
    const overflow = await hasOverflow();

    const shot = path.join(outDir, `final3-inventory-${width}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    result.inventory.push({ width, cardCount, rowGridCount, overflow, screenshot: shot });
  }

  await page.setViewportSize({ width: 1024, height: 900 });
  await page.waitForTimeout(600);
  await clickVisible('التقارير');
  await clickVisible('ميزان المراجعة العام');
  await clickVisible('عرض التقرير');
  await page.waitForTimeout(1800);

  const repWidths = [360, 768, 1024];
  for (const width of repWidths) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(700);

    const text = await page.locator('body').innerText();
    const hasCoreArabic = text.includes('مدين') && text.includes('دائن');
    const hasSearchPlaceholder = await page.locator('input[placeholder="بحث داخل التقرير..."]').count();
    const hasGarbled = ['ï»¿', 'Ã™', 'Ã˜'].some((m) => text.includes(m));
    const overflow = await hasOverflow();

    const shot = path.join(outDir, `final3-reports-${width}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    result.reports.push({ width, hasCoreArabic, hasSearchPlaceholder: !!hasSearchPlaceholder, hasGarbled, overflow, screenshot: shot });
  }

  const resultPath = path.join(outDir, 'final3-validation-result.json');
  fs.writeFileSync(resultPath, JSON.stringify(result, null, 2), 'utf8');

  await browser.close();
  console.log(JSON.stringify({ resultPath, result }, null, 2));
})();
