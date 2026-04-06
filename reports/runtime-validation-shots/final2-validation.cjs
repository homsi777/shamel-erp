const fs = require('fs');
const path = require('path');

(async () => {
  let chromium;
  let launchOptions = { headless: true };
  try {
    ({ chromium } = require('playwright'));
  } catch {
    ({ chromium } = require('playwright-core'));
    const chromeCandidates = [
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
      'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
    ];
    const executablePath = chromeCandidates.find((p) => fs.existsSync(p));
    if (executablePath) launchOptions.executablePath = executablePath;
  }

  const outDir = path.join(process.cwd(), 'reports', 'runtime-validation-shots');
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const result = {
    login: { ok: false, companyBranchHint: '' },
    inventory: [],
    reports: []
  };

  const hasOverflow = async () => page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth > window.innerWidth + 2;
  });

  async function clickVisibleButtonOrLink(text) {
    const candidate = page.locator(`button:has-text("${text}"):visible, a:has-text("${text}"):visible`).first();
    if (await candidate.count()) {
      await candidate.click({ timeout: 5000 });
      return true;
    }
    return false;
  }

  async function openModule(tabText) {
    const clicked = await clickVisibleButtonOrLink(tabText);
    if (!clicked) {
      const anyText = page.getByText(tabText, { exact: false }).first();
      if (await anyText.count()) {
        await anyText.click({ timeout: 5000, force: true });
      }
    }
    await page.waitForTimeout(1000);
  }

  await page.goto('http://127.0.0.1:5173', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1400);

  const userInput = page.locator('input[type="text"], input[name="username"], input[placeholder*="اسم"], input[placeholder*="user"]').first();
  const passInput = page.locator('input[type="password"]').first();

  if (await userInput.count() && await passInput.count()) {
    await userInput.fill('admin');
    await passInput.fill('admin123');
    const loginBtn = page.locator('button:has-text("دخول"):visible, button:has-text("تسجيل"):visible, button:has-text("Login"):visible, button:has-text("Sign in"):visible').first();
    if (await loginBtn.count()) {
      await loginBtn.click();
    } else {
      await passInput.press('Enter');
    }
  }

  await page.waitForTimeout(2800);
  result.login.ok = !!(await page.locator('button:has-text("المخزون"):visible, span:has-text("المخزون"):visible').count());
  const shellText = await page.locator('body').innerText();
  result.login.companyBranchHint = shellText.includes('Homsi') ? 'Homsi' : (shellText.includes('org-main') ? 'org-main' : 'not-found');

  const widths = [360, 768, 1024];

  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(700);

    await openModule('المخزون');
    const mobileCards = await page.locator('div.rounded-2xl.border.border-gray-200.bg-white.p-3.shadow-sm').count();
    const tableHeaderVisible = await page.locator('div[style*="grid-template-columns"] >> text=المستودع').first().isVisible().catch(() => false);
    const overflow = await hasOverflow();
    const invShot = path.join(outDir, `final2-inventory-${width}.png`);
    await page.screenshot({ path: invShot, fullPage: true });
    result.inventory.push({ width, mobileCards, tableHeaderVisible, overflow, screenshot: invShot });

    await openModule('التقارير');
    await page.waitForTimeout(1000);
    await clickVisibleButtonOrLink('ميزان المراجعة العام');
    await page.waitForTimeout(700);
    await clickVisibleButtonOrLink('عرض التقرير');
    await page.waitForTimeout(1700);

    const bodyText = await page.locator('body').innerText();
    const garbledMarkers = ['ط§', 'ظ', 'ï»¿', 'Ã'];
    const hasGarbled = garbledMarkers.some((m) => bodyText.includes(m));
    const hasArabicCore = ['مدين', 'دائن', 'الأصول', 'الخصوم', 'بحث داخل التقرير'].some((w) => bodyText.includes(w));
    const reportsOverflow = await hasOverflow();

    const repShot = path.join(outDir, `final2-reports-${width}.png`);
    await page.screenshot({ path: repShot, fullPage: true });
    result.reports.push({ width, hasGarbled, hasArabicCore, overflow: reportsOverflow, screenshot: repShot });
  }

  fs.writeFileSync(path.join(outDir, 'final2-validation-result.json'), JSON.stringify(result, null, 2), 'utf8');
  await browser.close();
  console.log(JSON.stringify(result, null, 2));
})();
