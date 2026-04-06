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
  const browser = await chromium.launch({ headless: true, executablePath });
  const page = await browser.newPage({ viewport: { width: 1024, height: 900 } });

  await page.goto('http://127.0.0.1:5173', { waitUntil: 'domcontentloaded' });
  await page.fill('input[placeholder="اسم المستخدم"]', 'admin');
  await page.fill('input[placeholder="كلمة المرور"]', 'admin123');
  await page.click('button:has-text("دخول للنظام")');
  await page.waitForTimeout(2500);

  // Inventory at 360 via bottom nav
  await page.setViewportSize({ width: 360, height: 900 });
  await page.waitForTimeout(700);
  const bottomInventory = page.locator('div.fixed.inset-x-0.bottom-0 button:has-text("المخزون")').first();
  if (await bottomInventory.count()) {
    await bottomInventory.click();
    await page.waitForTimeout(1200);
  }
  // close sidebar if opened accidentally
  const closeBtn = page.locator('button:has-text("×"), button[aria-label*="close" i]').first();
  if (await closeBtn.count()) {
    // only close if overlay menu is present
    const menuPanel = await page.locator('text=إدارة المؤسسات').count();
    if (menuPanel) {
      await closeBtn.click({ force: true }).catch(() => {});
      await page.waitForTimeout(500);
    }
  }
  const invShot = path.join(outDir, 'final4-inventory-360.png');
  await page.screenshot({ path: invShot, fullPage: true });

  // Reports at desktop then 768/360
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.waitForTimeout(500);
  const reportsBtn = page.locator('button:has-text("التقارير"), a:has-text("التقارير")').first();
  if (await reportsBtn.count()) {
    await reportsBtn.evaluate((el) => el.click());
    await page.waitForTimeout(1000);
  }
  const trial = page.locator('button:has-text("ميزان المراجعة العام"), div:has-text("ميزان المراجعة العام")').first();
  if (await trial.count()) {
    await trial.evaluate((el) => el.click());
    await page.waitForTimeout(700);
  }
  const showBtn = page.locator('button:has-text("عرض التقرير")').first();
  if (await showBtn.count()) {
    await showBtn.click();
    await page.waitForTimeout(1600);
  }

  const rep1024 = path.join(outDir, 'final4-reports-1024.png');
  await page.screenshot({ path: rep1024, fullPage: true });

  await page.setViewportSize({ width: 768, height: 900 });
  await page.waitForTimeout(700);
  const rep768 = path.join(outDir, 'final4-reports-768.png');
  await page.screenshot({ path: rep768, fullPage: true });

  await page.setViewportSize({ width: 360, height: 900 });
  await page.waitForTimeout(700);
  const rep360 = path.join(outDir, 'final4-reports-360.png');
  await page.screenshot({ path: rep360, fullPage: true });

  const text = await page.locator('body').innerText();
  const summary = {
    hasArabicCore: text.includes('مدين') && text.includes('دائن'),
    hasGarbled: ['ï»¿', 'Ã™', 'Ã˜'].some((m) => text.includes(m)),
    inventoryShot: invShot,
    reportsShots: [rep360, rep768, rep1024]
  };

  console.log(JSON.stringify(summary, null, 2));
  await browser.close();
})();
