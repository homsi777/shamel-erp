const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const FRONTEND = 'http://127.0.0.1:5173/#/login';
const OUT_DIR = path.resolve('reports/runtime-validation-shots');
fs.mkdirSync(OUT_DIR, { recursive: true });

const widths = [360,390,430,768,820,1024,1280,1440];
const modules = [
  { key: 'invoices', menuText: 'الفواتير' },
  { key: 'inventory', menuText: 'المخزون' },
  { key: 'clients', menuText: 'العملاء والموردين' },
  { key: 'accounts', menuText: 'شجرة الحسابات' },
  { key: 'reports', menuText: 'التقارير' },
];

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const consoleIssues = [];
  const failedRequests = [];

  page.on('console', (msg) => {
    const type = msg.type();
    if (type === 'error' || type === 'warning') {
      consoleIssues.push({ type, text: msg.text().slice(0, 400), url: page.url() });
    }
  });

  page.on('response', (res) => {
    if (res.status() >= 400) {
      failedRequests.push({ status: res.status(), url: res.url().slice(0, 300), page: page.url() });
    }
  });

  await page.goto(FRONTEND, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1500);

  await page.locator('input').nth(0).fill('admin');
  await page.locator('input').nth(1).fill('admin123');
  await page.locator('button').nth(2).click();
  await page.waitForTimeout(5000);

  const authState = await page.evaluate(() => ({
    url: location.href,
    hasToken: !!localStorage.getItem('shamel_token'),
    hasUser: !!localStorage.getItem('shamel_user'),
    company: localStorage.getItem('selected_company_id'),
    branch: localStorage.getItem('selected_branch_id'),
    hasHomsi: (document.body?.innerText || '').includes('Homsi'),
  }));

  async function ensureSidebarVisible() {
    const hasMenu = await page.locator('button', { hasText: 'المخزون' }).first().isVisible().catch(() => false);
    if (hasMenu) return;
    const buttons = page.locator('button');
    const count = await buttons.count();
    for (let i = 0; i < Math.min(count, 8); i++) {
      const b = buttons.nth(i);
      const box = await b.boundingBox().catch(() => null);
      if (!box) continue;
      if (box.x < 80 && box.y < 120) {
        await b.click({ force: true });
        await page.waitForTimeout(700);
        const ok = await page.locator('button', { hasText: 'المخزون' }).first().isVisible().catch(() => false);
        if (ok) return;
      }
    }
  }

  async function gotoModule(menuText) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(300);
    await ensureSidebarVisible();
    const btn = page.locator('button', { hasText: menuText }).first();
    await btn.click({ timeout: 5000 });
    await page.waitForTimeout(1800);
  }

  async function openRecordsHeuristic() {
    let opened = 0;
    const tableRows = page.locator('tbody tr');
    const rowCount = await tableRows.count().catch(() => 0);
    for (let i = 0; i < Math.min(3, rowCount); i++) {
      try {
        await tableRows.nth(i).click({ timeout: 1200 });
        await page.waitForTimeout(500);
        opened += 1;
      } catch {}
    }
    if (opened === 0) {
      const cards = page.locator('div.rounded-2xl.border');
      const c = await cards.count().catch(() => 0);
      for (let i = 0; i < Math.min(3, c); i++) {
        try {
          await cards.nth(i).click({ timeout: 1200 });
          await page.waitForTimeout(500);
          opened += 1;
        } catch {}
      }
    }
    return opened;
  }

  const moduleResults = [];

  for (const mod of modules) {
    const modResult = { key: mod.key, menuText: mod.menuText, widths: [], openedRecordsApprox: 0, navigationOk: false };
    try {
      await gotoModule(mod.menuText);
      modResult.navigationOk = true;
      modResult.openedRecordsApprox = await openRecordsHeuristic();
    } catch (e) {
      modResult.navigationOk = false;
    }

    for (const w of widths) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(1200);

      const metrics = await page.evaluate(() => {
        const bodyText = document.body?.innerText || '';
        const rootOverflow = document.documentElement.scrollWidth > window.innerWidth + 2;
        const bodyOverflow = document.body ? document.body.scrollWidth > window.innerWidth + 2 : false;
        const hasTable = !!document.querySelector('table');
        const hasCards = document.querySelectorAll('div.rounded-2xl.border.border-gray-200.bg-white').length > 0;
        const actionsVisible = /خيارات|تفاصيل|طباعة|PDF|حذف|الأصناف|قفل/.test(bodyText);
        const garbled = /�|ط[A-Za-z]|ظ[A-Za-z]|â€|أ¢/.test(bodyText);
        return {
          url: location.href,
          rootOverflow,
          bodyOverflow,
          hasTable,
          hasCards,
          actionsVisible,
          garbled,
          sample: bodyText.slice(0, 700),
        };
      });

      const shot = path.join(OUT_DIR, `${mod.key}-${w}.png`);
      await page.screenshot({ path: shot, fullPage: false });
      modResult.widths.push({ width: w, ...metrics, screenshot: shot });
    }

    moduleResults.push(modResult);
  }

  const result = {
    timestamp: new Date().toISOString(),
    authState,
    widths,
    modules: moduleResults,
    consoleIssues: consoleIssues.slice(0, 200),
    failedRequests: failedRequests.slice(0, 200),
  };

  fs.writeFileSync(path.join(OUT_DIR, 'runtime-validation-result.json'), JSON.stringify(result, null, 2), 'utf8');
  console.log(JSON.stringify({
    authState,
    moduleNav: moduleResults.map(m => ({ key: m.key, navigationOk: m.navigationOk, openedRecordsApprox: m.openedRecordsApprox })),
    consoleIssueCount: consoleIssues.length,
    failedRequestCount: failedRequests.length,
    report: path.join(OUT_DIR, 'runtime-validation-result.json')
  }, null, 2));

  await browser.close();
})();
