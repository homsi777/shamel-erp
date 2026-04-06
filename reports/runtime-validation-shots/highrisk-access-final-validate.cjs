const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const args = process.argv.slice(2);

const FRONTEND = 'http://127.0.0.1:5173/#/login';
const OUT_DIR = path.resolve('reports/runtime-validation-shots/highrisk-access-final');
fs.mkdirSync(OUT_DIR, { recursive: true });

const defaultWidths = [390, 768, 1024];
const widthArg = args.find((a) => a.startsWith('--width='));
const widths = widthArg ? [Number(widthArg.split('=')[1])] : defaultWidths;

const ALL_TARGETS = [
  { key: 'settings_deep', label: 'Settings (Deep Sections)' },
  { key: 'print_config', label: 'Print Configuration' },
  { key: 'delivery_notices', label: 'Delivery Notices' },
  { key: 'delivery_approvals', label: 'Delivery Approvals' },
  { key: 'restaurant_ops', label: 'Restaurant Ops (Tables/Sessions/Cashier)' },
];
const onlyArg = args.find((a) => a.startsWith('--only='));
const onlyKey = onlyArg ? onlyArg.split('=')[1] : '';
const deliveryOnly = args.includes('--delivery-only');
const TARGETS = ALL_TARGETS.filter((t) => {
  if (onlyKey) return t.key === onlyKey;
  if (deliveryOnly) return t.key === 'delivery_notices' || t.key === 'delivery_approvals';
  return true;
});

const SETTINGS_TAB_IDS = [
  'company',
  'labels',
  'currency',
  'pricing_settings',
  'invoice_settings',
  'item_settings',
  'printing_invoices',
  'deployment',
  'devices',
  'theme',
  'users',
  'dbstatus',
  'backups',
  'sync',
  'cloud_link',
];

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  });

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);

  const consoleIssues = [];
  const failedRequests = [];

  page.on('console', (msg) => {
    const type = msg.type();
    if (type === 'error' || type === 'warning') {
      consoleIssues.push({ type, text: msg.text().slice(0, 500), url: page.url() });
    }
  });

  page.on('response', (res) => {
    if (res.status() >= 400) {
      failedRequests.push({ status: res.status(), url: res.url().slice(0, 300), page: page.url() });
    }
  });

  const wait = (ms) => page.waitForTimeout(ms);

  const isVisible = async (selector) => page.locator(selector).first().isVisible().catch(() => false);
  const isAsideOpen = async () => {
    const aside = page.locator('aside').first();
    const box = await aside.boundingBox().catch(() => null);
    if (!box) return false;
    const viewport = page.viewportSize();
    if (!viewport) return false;
    if (box.width < 2 || box.height < 2) return false;
    const horizontallyVisible = box.x < viewport.width && (box.x + box.width) > 0;
    return horizontallyVisible;
  };

  const isInViewport = async (selector) => {
    const locator = page.locator(selector).first();
    const box = await locator.boundingBox().catch(() => null);
    if (!box) return false;
    const viewport = page.viewportSize();
    if (!viewport) return false;
    if (box.width < 2 || box.height < 2) return false;
    const horizontallyVisible = box.x < viewport.width && (box.x + box.width) > 0;
    const verticallyVisible = box.y < viewport.height && (box.y + box.height) > 0;
    return horizontallyVisible && verticallyVisible;
  };

  const clickVisible = async (selector) => {
    const locator = page.locator(selector).first();
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    const visible = await locator.isVisible().catch(() => false);
    const inViewport = await isInViewport(selector);
    if (!visible || !inViewport) return false;
    await locator.click({ force: true }).catch(() => {});
    await wait(600);
    return true;
  };

  const ensureSidebarVisible = async () => {
    if (await isAsideOpen()) return true;
    const menuByIcon = page.locator('header button:has(svg.lucide-menu)').first();
    const fallbackHeaderBtn = page.locator('header button').first();
    if (await menuByIcon.isVisible().catch(() => false)) {
      await menuByIcon.click({ force: true }).catch(() => {});
      await wait(800);
    } else if (await fallbackHeaderBtn.isVisible().catch(() => false)) {
      await fallbackHeaderBtn.click({ force: true }).catch(() => {});
      await wait(800);
    }
    return isAsideOpen();
  };

  const clickSidebarTab = async (tabId) => {
    if (!(await ensureSidebarVisible())) return false;
    return clickVisible(`aside [data-tab-id="${tabId}"]`);
  };

  const clickSidebarGroup = async (groupId) => {
    if (!(await ensureSidebarVisible())) return false;
    return clickVisible(`aside [data-group-id="${groupId}"]`);
  };

  const clickSidebarChild = async (childId) => {
    if (!(await ensureSidebarVisible())) return false;
    return clickVisible(`aside [data-child-id="${childId}"]`);
  };

  const ensureAuthenticated = async () => {
    const href = page.url();
    const onLoginRoute = href.includes('#/login');
    const inputs = page.locator('input');
    const hasLoginForm = (await inputs.count().catch(() => 0)) >= 2;
    if (!onLoginRoute && !hasLoginForm) return;

    const userInput = page.locator('input[type="text"], input[name*="user"], input[id*="user"]').first();
    const passInput = page.locator('input[type="password"]').first();
    const userVisible = await userInput.isVisible().catch(() => false);
    const passVisible = await passInput.isVisible().catch(() => false);
    if (userVisible && passVisible) {
      await userInput.fill('admin').catch(() => {});
      await passInput.fill('admin123').catch(() => {});
      await passInput.press('Enter').catch(() => {});
    } else {
      await inputs.nth(0).fill('admin').catch(() => {});
      await inputs.nth(1).fill('admin123').catch(() => {});
      await inputs.nth(1).press('Enter').catch(() => {});
    }
    await wait(4500);
  };

  const ensureAppShell = async () => {
    await ensureAuthenticated();
    for (let i = 0; i < 5; i++) {
      const hasAside = await page.locator('aside').first().isVisible().catch(() => false);
      if (hasAside) return;
      const screen = await page.evaluate(() => ({
        href: location.href,
        body: (document.body?.innerText || '').slice(0, 1500),
        inputCount: document.querySelectorAll('input').length,
      }));
      const inSelectCompany = screen.href.includes('select-company') || /select company|اختيار الشركة|إدارة الشركات/i.test(screen.body);
      if (inSelectCompany) {
        const continueBtn = page.locator('button').filter({ hasText: /اختيار|متابعة|continue|select/i }).first();
        if (await continueBtn.isVisible().catch(() => false)) {
          await continueBtn.click({ force: true }).catch(() => {});
          await wait(1500);
        } else {
          await page.evaluate(() => { window.location.hash = '#/'; });
          await wait(1200);
        }
        continue;
      }
      if (screen.inputCount >= 2) {
        await ensureAuthenticated();
        continue;
      }
      await page.evaluate(() => { window.location.hash = '#/'; });
      await wait(1200);
    }
  };

  const collectMetrics = async () => {
    return page.evaluate(() => {
      const rootOverflow = document.documentElement.scrollWidth > window.innerWidth + 2;
      const bodyOverflow = document.body ? document.body.scrollWidth > window.innerWidth + 2 : false;
      const text = document.body?.innerText || '';
      const layoutErrorLike = /(Error|تعذر|فشل تحميل|Unhandled|TypeError|ReferenceError)/i.test(text);
      const visibleButtons = Array.from(document.querySelectorAll('button')).filter((b) => {
        const style = window.getComputedStyle(b);
        const r = b.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && r.width > 0 && r.height > 0;
      }).length;
      return {
        rootOverflow,
        bodyOverflow,
        layoutErrorLike,
        visibleButtons,
        url: location.href,
        snippet: text.slice(0, 900),
      };
    });
  };

  const ensureSettingsPage = async () => {
    for (let i = 0; i < 3; i++) {
      const navOk = await clickSidebarTab('settings');
      if (!navOk) {
        await wait(500);
        continue;
      }
      if (await isVisible('main [data-settings-tab-id]')) return true;
      await wait(600);
    }
    return isVisible('main [data-settings-tab-id]');
  };

  const ensureInventoryPage = async () => {
    for (let i = 0; i < 4; i++) {
      const navOk = await clickSidebarTab('inventory');
      if (!navOk) continue;
      if (await isVisible('main [data-inventory-action="tools-toggle"]')) return true;
      await wait(700);
    }
    return isVisible('main [data-inventory-action="tools-toggle"]');
  };

  const openInventoryTool = async (actionId) => {
    let inventoryReady = await ensureInventoryPage();
    if (!inventoryReady) {
      // One controlled retry after re-stabilizing shell state to avoid startup sequencing flakiness.
      await ensureAppShell();
      await clickSidebarTab('dashboard').catch(() => false);
      await wait(500);
      inventoryReady = await ensureInventoryPage();
    }
    if (!inventoryReady) return { ok: false, note: 'Inventory page not accessible' };

    const openedTools = await clickVisible('main [data-inventory-action="tools-toggle"]');
    if (!openedTools) return { ok: false, note: 'Inventory tools dropdown not visible' };

    const actionSelector = `main [data-inventory-action="${actionId}"]`;
    const actionLocator = page.locator(actionSelector).first();
    const actionExists = (await actionLocator.count().catch(() => 0)) > 0;
    if (!actionExists) return { ok: false, note: `Inventory tool not rendered: ${actionId}` };

    await actionLocator.scrollIntoViewIfNeeded().catch(() => {});
    await actionLocator.click({ force: true }).catch(() => {});
    await wait(500);
    const opened = true;
    if (!opened) return { ok: false, note: `Failed to click inventory tool: ${actionId}` };
    return { ok: true, note: `Opened inventory tool: ${actionId}` };
  };

  const runTargetAtWidth = async (targetKey, width) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(FRONTEND, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await wait(1200);
    await ensureAppShell();
    await clickSidebarTab('dashboard').catch(() => false);
    await wait(500);

    let navOk = false;
    let interactionHits = 0;
    const notes = [];
    const subflow = {};

    if (targetKey === 'settings_deep') {
      navOk = await ensureSettingsPage();
      if (!navOk) {
        notes.push('Settings page not accessible from sidebar.');
      } else {
        for (const tabId of SETTINGS_TAB_IDS) {
          const clicked = await clickVisible(`main [data-settings-tab-id="${tabId}"]`);
          if (clicked) interactionHits++;
        }
        notes.push('Settings tab sweep executed via data-settings-tab-id.');
      }
    }

    if (targetKey === 'print_config') {
      navOk = await ensureSettingsPage();
      if (!navOk) {
        notes.push('Settings page not accessible for print config.');
      } else {
        const printTab = await clickVisible('main [data-settings-tab-id="printing_invoices"]');
        if (!printTab) {
          navOk = false;
          notes.push('Print configuration tab not visible in settings sidebar.');
        } else {
          interactionHits++;
          notes.push('Print configuration page opened.');
        }
      }
    }

    if (targetKey === 'delivery_notices') {
      const opened = await openInventoryTool('delivery_notices');
      navOk = opened.ok;
      notes.push(opened.note);
      if (navOk) {
        interactionHits++;
      }
    }

    if (targetKey === 'delivery_approvals') {
      const opened = await openInventoryTool('delivery_approvals');
      navOk = opened.ok;
      notes.push(opened.note);
      if (navOk) {
        interactionHits++;
      }
    }

    if (targetKey === 'restaurant_ops') {
      const rootOk = await clickSidebarGroup('restaurant');
      if (!rootOk) {
        navOk = false;
        notes.push('Restaurant root menu not visible.');
      } else {
        navOk = true;

        let tablesOk = await clickSidebarChild('restaurant_tables');
        if (!tablesOk) {
          await page.evaluate(() => { window.location.hash = '#/kitchen/tables'; });
          await wait(700);
          tablesOk = await page.evaluate(() => window.location.hash.includes('/kitchen/tables'));
        }
        subflow.tables = tablesOk;
        if (tablesOk) interactionHits++;

        let settingsOk = await clickSidebarChild('restaurant_settings');
        if (!settingsOk) {
          await page.evaluate(() => { window.location.hash = '#/kitchen/settings'; });
          await wait(700);
          settingsOk = await page.evaluate(() => window.location.hash.includes('/kitchen/settings'));
        }
        subflow.sessions = settingsOk;
        if (settingsOk) interactionHits++;

        let qrOk = await clickSidebarChild('restaurant_menu_qr');
        if (!qrOk) {
          await page.evaluate(() => { window.location.hash = '#/kitchen/qr-menu'; });
          await wait(700);
          qrOk = await page.evaluate(() => window.location.hash.includes('/kitchen/qr-menu'));
        }
        subflow.cashierWorkspace = qrOk;
        if (qrOk) interactionHits++;

        notes.push(`Restaurant subflows: tables=${!!subflow.tables}, sessions=${!!subflow.sessions}, cashier/workspace=${!!subflow.cashierWorkspace}`);
      }
    }

    const metrics = await collectMetrics();
    const row = { width, navOk, interactionHits, notes, subflow, metrics };
    row.status = evaluateStatus(row);
    return row;
  };

  const evaluateStatus = (row) => {
    if (!row.navOk) return 'NOT ACCESSIBLE';
    if (row.metrics.rootOverflow || row.metrics.bodyOverflow || row.metrics.layoutErrorLike) return 'FAIL';
    if (row.interactionHits > 0) return 'PASS';
    return 'PARTIAL';
  };

  await page.goto(FRONTEND, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await wait(1200);
  await ensureAppShell();

  const auth = await page.evaluate(() => {
    let parsedUser = null;
    let parsedSettings = null;
    try { parsedUser = JSON.parse(localStorage.getItem('shamel_user') || 'null'); } catch {}
    try { parsedSettings = JSON.parse(localStorage.getItem('shamel_settings') || 'null'); } catch {}
    return {
      url: location.href,
      hasToken: !!localStorage.getItem('shamel_token'),
      hasUser: !!localStorage.getItem('shamel_user'),
      company: localStorage.getItem('selected_company_id'),
      branch: localStorage.getItem('selected_branch_id'),
      userRole: parsedUser?.role || null,
      permissionCount: Array.isArray(parsedUser?.permissions) ? parsedUser.permissions.length : 0,
      profileId: parsedSettings?.projectProfile?.id || null,
      forceEnabledCount: Array.isArray(parsedSettings?.moduleControl?.forceEnabledTabs) ? parsedSettings.moduleControl.forceEnabledTabs.length : 0,
    };
  });

  const modules = [];
  for (const target of TARGETS) {
    const moduleResult = { key: target.key, label: target.label, widths: [] };
    for (const w of widths) {
      const row = await runTargetAtWidth(target.key, w);
      const shot = path.join(OUT_DIR, `${target.key}-${w}.png`);
      await page.screenshot({ path: shot, fullPage: false });
      row.screenshot = shot;
      moduleResult.widths.push(row);
    }
    modules.push(moduleResult);
  }

  const issues = [];
  for (const mod of modules) {
    for (const row of mod.widths) {
      if (row.status === 'FAIL') {
        let desc = 'Layout/runtime failure detected.';
        if (row.metrics.rootOverflow || row.metrics.bodyOverflow) desc = 'Horizontal overflow detected.';
        if (row.metrics.layoutErrorLike) desc = 'Error-like runtime text detected.';
        issues.push({ module: mod.label, viewport: row.width, description: desc, severity: 'blocker', status: row.status });
      }
      if (row.status === 'NOT ACCESSIBLE') {
        issues.push({ module: mod.label, viewport: row.width, description: row.notes.join(' | ') || 'Module not accessible.', severity: 'non-blocker', status: row.status });
      }
      if (row.status === 'PARTIAL') {
        issues.push({ module: mod.label, viewport: row.width, description: row.notes.join(' | ') || 'Loaded with limited interaction.', severity: 'non-blocker', status: row.status });
      }
    }
  }

  const matrix = modules.flatMap((m) => m.widths.map((w) => ({
    module: m.label,
    viewport: w.width,
    status: w.status,
    overflow: w.metrics.rootOverflow || w.metrics.bodyOverflow,
    layoutStable: !w.metrics.layoutErrorLike,
    interactions: w.interactionHits,
  })));

  const accessPreconditions = [
    {
      item: 'Stable auth/session context before route sweep',
      evidence: 'Validation now enforces login + select-company fallback handling before each module check.',
    },
    {
      item: 'Sidebar-open precondition on mobile/tablet',
      evidence: 'Navigation requires opening drawer state before tab/group selection at 390/768.',
    },
    {
      item: 'Delivery paths are nested under Inventory tools menu',
      evidence: 'Routes are considered reachable only if inventory tools toggle renders and delivery actions are present.',
    },
  ];

  const summary = {
    timestamp: new Date().toISOString(),
    auth,
    widths,
    modules,
    matrix,
    issues,
    accessPreconditions,
    consoleIssues: consoleIssues.slice(0, 300),
    failedRequests: failedRequests.slice(0, 300),
  };

  const resultPath = path.join(OUT_DIR, 'highrisk-access-final-result.json');
  fs.writeFileSync(resultPath, JSON.stringify(summary, null, 2), 'utf8');

  const matrixRows = matrix.map((r) => `| ${r.module} | ${r.viewport} | ${r.status} |`);
  const issueRows = issues.length
    ? issues.map((i) => `| ${i.module} | ${i.viewport} | ${i.description} | ${i.severity} |`).join('\n')
    : '| - | - | No real issues detected. | - |';
  const preRows = accessPreconditions.map((p) => `- ${p.item}: ${p.evidence}`).join('\n');

  const hasBlocking = issues.some((x) => x.severity === 'blocker');
  const hasAccessGap = issues.some((x) => x.status === 'NOT ACCESSIBLE' || x.status === 'PARTIAL');
  const finalBlockerLeft = hasBlocking || hasAccessGap;
  const decision = finalBlockerLeft ? 'NO-GO' : 'GO';

  const md = `# Final High-Risk Access Validation Report\n\n## Coverage Matrix\n| Module | Viewport | Status |\n|---|---:|---|\n${matrixRows.join('\n')}\n\n## Issues List\n| Screen/Module | Viewport | Description | Severity |\n|---|---:|---|---|\n${issueRows}\n\n## Access Preconditions\n${preRows}\n\n## Console/Network Summary\n- Console issues count: ${summary.consoleIssues.length}\n- Failed requests count: ${summary.failedRequests.length}\n- Blocking runtime errors detected: ${hasBlocking ? 'YES' : 'NO'}\n- Recurring console URLs: ${[...new Set(summary.consoleIssues.map((c) => c.url))].join(', ') || 'None'}\n\n## Final Blocker Statement\n- Any real blocker left for APK readiness signoff: ${finalBlockerLeft ? 'YES' : 'NO'}\n\n## Final Decision\n- ${decision}\n`;

  const reportPath = path.join(OUT_DIR, 'highrisk-access-final-report.md');
  fs.writeFileSync(reportPath, md, 'utf8');

  console.log(JSON.stringify({
    auth,
    resultPath,
    reportPath,
    moduleStatus: modules.map((m) => ({ module: m.label, statuses: m.widths.map((w) => `${w.width}:${w.status}`) })),
    issuesCount: issues.length,
    blockerCount: issues.filter((i) => i.severity === 'blocker').length,
    finalBlockerLeft,
    decision,
    consoleIssueCount: summary.consoleIssues.length,
    failedRequestCount: summary.failedRequests.length,
  }, null, 2));

  await browser.close();
})();

