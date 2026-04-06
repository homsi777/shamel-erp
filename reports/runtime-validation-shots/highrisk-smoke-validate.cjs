const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const FRONTEND = 'http://127.0.0.1:5173/#/login';
const OUT_DIR = path.resolve('reports/runtime-validation-shots/highrisk-smoke');
fs.mkdirSync(OUT_DIR, { recursive: true });

const widths = [390, 768, 1024];

const MODULES = [
  { key: 'dashboard', label: 'Dashboard', menuText: 'الرئيسية' },
  { key: 'settings', label: 'Settings', menuText: 'الإعدادات' },
  { key: 'print_config', label: 'Print Configuration', menuText: 'الإعدادات' },
  { key: 'delivery_notices', label: 'Delivery Notices', menuText: 'المخزون' },
  { key: 'delivery_approvals', label: 'Delivery Approvals', menuText: 'المخزون' },
  { key: 'restaurant_flows', label: 'Restaurant Flows', menuText: 'المطبخ' },
];

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  });

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
  await page.waitForTimeout(1200);

  await page.locator('input').nth(0).fill('admin');
  await page.locator('input').nth(1).fill('admin123');
  await page.locator('button').nth(2).click();
  await page.waitForTimeout(4500);

  const auth = await page.evaluate(() => ({
    url: location.href,
    hasToken: !!localStorage.getItem('shamel_token'),
    hasUser: !!localStorage.getItem('shamel_user'),
    company: localStorage.getItem('selected_company_id'),
    branch: localStorage.getItem('selected_branch_id'),
  }));

  async function ensureSidebarVisible() {
    const candidates = ['الرئيسية', 'المخزون', 'الإعدادات'];
    for (const c of candidates) {
      if (await page.locator('button', { hasText: c }).first().isVisible().catch(() => false)) return true;
    }

    const buttons = page.locator('button');
    const count = await buttons.count();
    for (let i = 0; i < Math.min(count, 12); i++) {
      const b = buttons.nth(i);
      const box = await b.boundingBox().catch(() => null);
      if (!box) continue;
      if (box.x < 90 && box.y < 120) {
        await b.click({ force: true }).catch(() => {});
        await page.waitForTimeout(600);
        for (const c of candidates) {
          if (await page.locator('button', { hasText: c }).first().isVisible().catch(() => false)) return true;
        }
      }
    }
    return false;
  }

  async function gotoMenu(menuText) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(250);
    await ensureSidebarVisible();
    const btn = page.locator('button', { hasText: menuText }).first();
    if (!(await btn.isVisible().catch(() => false))) return false;
    await btn.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1400);
    return true;
  }

  async function clickIfVisible(text) {
    const node = page.locator('button', { hasText: text }).first();
    if (await node.isVisible().catch(() => false)) {
      await node.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(500);
      return true;
    }
    return false;
  }

  async function openInventoryTools() {
    const opened = await clickIfVisible('أدوات');
    if (opened) return true;
    await page.waitForTimeout(300);
    return await clickIfVisible('أدوات');
  }

  async function runModuleAction(moduleKey) {
    let navOk = false;
    let interactionHits = 0;
    const notes = [];

    if (moduleKey === 'dashboard') {
      navOk = await gotoMenu('الرئيسية');
      if (!navOk) return { navOk, interactionHits, notes: ['Dashboard menu not accessible'] };
      if (await clickIfVisible('24س')) interactionHits++;
      if (await clickIfVisible('7ي')) interactionHits++;
      if (await clickIfVisible('30ي')) interactionHits++;
      if (await clickIfVisible('استعلام سريع')) {
        interactionHits++;
        await clickIfVisible('إغلاق');
      }
      notes.push('Dashboard sweep executed');
      return { navOk, interactionHits, notes };
    }

    if (moduleKey === 'settings') {
      navOk = await gotoMenu('الإعدادات');
      if (!navOk) return { navOk, interactionHits, notes: ['Settings menu not accessible'] };
      const tabs = [
        'هوية الشركة',
        'تسميات النظام',
        'أسعار الصرف',
        'إعدادات التسعير',
        'إعدادات الفواتير',
        'إعدادات المواد',
        'الطباعة والفواتير',
        'نمط التشغيل',
        'الأجهزة والاتصال',
        'المظهر والألوان',
        'المستخدمون والأمان',
        'حالة قاعدة البيانات',
        'النسخ الاحتياطي',
      ];
      for (const t of tabs) {
        if (await clickIfVisible(t)) interactionHits++;
      }
      notes.push('Settings tab sweep attempted');
      return { navOk, interactionHits, notes };
    }

    if (moduleKey === 'print_config') {
      navOk = await gotoMenu('الإعدادات');
      if (!navOk) return { navOk, interactionHits, notes: ['Settings menu not accessible for print config'] };
      if (!(await clickIfVisible('الطباعة والفواتير'))) {
        return { navOk: false, interactionHits: 0, notes: ['Print settings tab not accessible'] };
      }
      interactionHits++;
      if (await clickIfVisible('تجربة الطباعة')) interactionHits++;
      if (await clickIfVisible('سجل الطابعات')) interactionHits++;
      notes.push('Print config sweep attempted');
      return { navOk: true, interactionHits, notes };
    }

    if (moduleKey === 'delivery_notices') {
      const inventoryOk = await gotoMenu('المخزون');
      if (!inventoryOk) return { navOk: false, interactionHits, notes: ['Inventory menu not accessible'] };
      const toolsOk = await openInventoryTools();
      if (!toolsOk) return { navOk: false, interactionHits, notes: ['Inventory tools menu not accessible'] };
      const openOk = await clickIfVisible('إشعارات التسليم');
      if (!openOk) return { navOk: false, interactionHits, notes: ['Delivery notices shortcut not accessible'] };
      navOk = true;
      interactionHits++;
      if (await clickIfVisible('إضافة إشعار')) interactionHits++;
      if (await clickIfVisible('عرض')) interactionHits++;
      if (await clickIfVisible('تعديل')) interactionHits++;
      notes.push('Delivery notices sweep attempted');
      return { navOk, interactionHits, notes };
    }

    if (moduleKey === 'delivery_approvals') {
      const inventoryOk = await gotoMenu('المخزون');
      if (!inventoryOk) return { navOk: false, interactionHits, notes: ['Inventory menu not accessible'] };
      const toolsOk = await openInventoryTools();
      if (!toolsOk) return { navOk: false, interactionHits, notes: ['Inventory tools menu not accessible'] };
      const openOk = await clickIfVisible('اعتماد الإشعارات');
      if (!openOk) return { navOk: false, interactionHits, notes: ['Delivery approvals shortcut not accessible'] };
      navOk = true;
      interactionHits++;
      if (await clickIfVisible('فتح')) interactionHits++;
      if (await clickIfVisible('اعتماد')) interactionHits++;
      if (await clickIfVisible('رفض')) interactionHits++;
      notes.push('Delivery approvals sweep attempted');
      return { navOk, interactionHits, notes };
    }

    if (moduleKey === 'restaurant_flows') {
      navOk = await gotoMenu('المطبخ');
      if (!navOk) return { navOk, interactionHits, notes: ['Restaurant menu not accessible'] };

      if (await clickIfVisible('الطاولات')) interactionHits++;
      if (await clickIfVisible('الجلسات')) interactionHits++;
      if (await clickIfVisible('الكاشير')) interactionHits++;
      if (await clickIfVisible('نقطة البيع')) interactionHits++;
      if (await clickIfVisible('الطلبات')) interactionHits++;
      notes.push('Restaurant flow sweep attempted');
      return { navOk, interactionHits, notes };
    }

    return { navOk, interactionHits, notes: ['Unknown module key'] };
  }

  function evaluateStatus(row) {
    if (!row.navOk) return 'NOT ACCESSIBLE';
    if (row.metrics.rootOverflow || row.metrics.bodyOverflow || row.metrics.layoutErrorLike) return 'FAIL';
    if (row.interactionHits > 0) return 'PASS';
    return 'PARTIAL';
  }

  const results = [];

  for (const mod of MODULES) {
    const modResult = { key: mod.key, label: mod.label, widths: [] };

    for (const w of widths) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(700);

      const run = await runModuleAction(mod.key);

      const metrics = await page.evaluate(() => {
        const rootOverflow = document.documentElement.scrollWidth > window.innerWidth + 2;
        const bodyOverflow = document.body ? document.body.scrollWidth > window.innerWidth + 2 : false;
        const text = (document.body?.innerText || '').slice(0, 4000);
        const layoutErrorLike = /Error|خطأ|تعذر|فشل تحميل|Page failed/i.test(text);
        const visibleButtons = Array.from(document.querySelectorAll('button')).filter((b) => {
          const style = window.getComputedStyle(b);
          const rect = b.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        }).length;
        return {
          rootOverflow,
          bodyOverflow,
          layoutErrorLike,
          visibleButtons,
          url: location.href,
          snippet: text.slice(0, 700),
        };
      });

      const row = {
        width: w,
        navOk: run.navOk,
        interactionHits: run.interactionHits,
        notes: run.notes,
        metrics,
      };

      row.status = evaluateStatus(row);

      const shot = path.join(OUT_DIR, `${mod.key}-${w}.png`);
      await page.screenshot({ path: shot, fullPage: false });
      row.screenshot = shot;

      modResult.widths.push(row);
    }

    results.push(modResult);
  }

  const issues = [];
  for (const mod of results) {
    for (const row of mod.widths) {
      if (row.status === 'FAIL') {
        let reason = 'Layout/runtime failure detected.';
        if (row.metrics.rootOverflow || row.metrics.bodyOverflow) reason = 'Horizontal overflow detected.';
        if (row.metrics.layoutErrorLike) reason = 'Error-like UI state detected.';
        issues.push({
          module: mod.label,
          viewport: row.width,
          description: reason,
          severity: 'blocker',
          status: row.status,
        });
      }
      if (row.status === 'NOT ACCESSIBLE') {
        issues.push({
          module: mod.label,
          viewport: row.width,
          description: row.notes.join(' | ') || 'Module not accessible in current runtime/profile.',
          severity: 'non-blocker',
          status: row.status,
        });
      }
      if (row.status === 'PARTIAL') {
        issues.push({
          module: mod.label,
          viewport: row.width,
          description: 'Module loaded but interaction coverage was limited at this viewport.',
          severity: 'non-blocker',
          status: row.status,
        });
      }
    }
  }

  const summary = {
    timestamp: new Date().toISOString(),
    auth,
    widths,
    modules: results,
    issues,
    consoleIssues: consoleIssues.slice(0, 300),
    failedRequests: failedRequests.slice(0, 300),
  };

  const jsonPath = path.join(OUT_DIR, 'highrisk-smoke-result.json');
  fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2), 'utf8');

  const matrixRows = [];
  for (const mod of results) {
    for (const row of mod.widths) {
      matrixRows.push(`| ${mod.label} | ${row.width} | ${row.status} |`);
    }
  }

  const issueRows = issues.length
    ? issues.map((i) => `| ${i.module} | ${i.viewport} | ${i.description} | ${i.severity} |`).join('\n')
    : '| — | — | No real issues detected in this pass. | — |';

  const markdown = `# High-Risk Smoke Validation Report\n\n## Coverage Matrix\n| Module | Viewport | Status |\n|---|---:|---|\n${matrixRows.join('\n')}\n\n## Issues List\n| Screen/Module | Viewport | Description | Severity |\n|---|---:|---|---|\n${issueRows}\n\n## Console/Network Summary\n- Console issues count: ${summary.consoleIssues.length}\n- Failed requests count: ${summary.failedRequests.length}\n- Recurring console URLs: ${[...new Set(summary.consoleIssues.map((c) => c.url))].join(', ') || 'None'}\n- Blocking errors detected: ${summary.issues.some((i) => i.severity === 'blocker') ? 'YES' : 'NO'}\n\n## Final Readiness Update\n- Fully validated for APK preparation: ${summary.issues.some((i) => i.status === 'FAIL') ? 'NO' : 'PARTIAL (core + this high-risk pass)'}\n\n`; 

  const mdPath = path.join(OUT_DIR, 'highrisk-smoke-report.md');
  fs.writeFileSync(mdPath, markdown, 'utf8');

  console.log(JSON.stringify({
    auth,
    result: jsonPath,
    report: mdPath,
    moduleStatus: results.map((m) => ({
      module: m.label,
      statuses: m.widths.map((w) => `${w.width}:${w.status}`),
    })),
    issuesCount: issues.length,
    blockerCount: issues.filter((i) => i.severity === 'blocker').length,
    consoleIssueCount: summary.consoleIssues.length,
    failedRequestCount: summary.failedRequests.length,
  }, null, 2));

  await browser.close();
})();
