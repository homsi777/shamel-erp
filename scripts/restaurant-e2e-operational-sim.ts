import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { io, type Socket } from 'socket.io-client';
import { and, eq } from 'drizzle-orm';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getFreePort() {
  return await new Promise<number>((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address() as any;
      const port = address?.port || 3333;
      srv.close(() => resolve(port));
    });
  });
}

async function httpJson(url: string, opts?: RequestInit & { json?: any; headers?: Record<string, string> }) {
  const finalOpts: RequestInit = {
    ...(opts || {}),
    headers: {
      'content-type': 'application/json',
      Accept: 'application/json',
      ...((opts?.headers as any) || {}),
    },
  };
  if (opts?.json !== undefined) finalOpts.body = JSON.stringify(opts.json);

  const res = await fetch(url, finalOpts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err: any = new Error((data as any)?.error || (data as any)?.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.code = (data as any)?.code;
    err.details = (data as any)?.details;
    throw err;
  }
  return data;
}

function fmtTs(ts: string | number | Date) {
  const d = ts instanceof Date ? ts : new Date(ts);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

type ScenarioStatus = 'PASS' | 'FAIL' | 'PARTIAL';
type ScenarioResult = {
  key: string;
  status: ScenarioStatus;
  steps: string[];
  observed: any;
  expected: any;
  notes?: string[];
  error?: string;
};

async function main() {
  const startedAt = new Date();

  const [{ server }, dbModule, schemaModule, serverConfigModule] = await Promise.all([
    import('../backend/server.ts'),
    import('../backend/db/index.ts'),
    import('../backend/db/schema.ts'),
    import('../backend/lib/serverConfig.ts'),
  ]);
  const { db, closeDb } = dbModule as any;
  const schema = schemaModule as any;
  const serverConfig = serverConfigModule.serverConfig as any;

  await server.ready();

  const companies = await db.select().from(schema.companies).all();
  const activeCompany = (companies || []).find((c: any) => c?.isActive !== false && Number(c?.isActive ?? 1) !== 0) || companies?.[0];
  if (!activeCompany) throw new Error('No company row found in DB.');
  const companyId = String(activeCompany.id);

  const branches = await db.select().from(schema.branches).all();
  const activeBranch =
    (branches || []).find((b: any) => String(b?.companyId) === String(companyId) && b?.isActive !== false && Number(b?.isActive ?? 1) !== 0) ||
    branches?.[0];
  if (!activeBranch) throw new Error('No branch row found in DB.');
  const branchId = String(activeBranch.id);

  // Auth user (cashier): create temp admin.
  const cashierUserId = `u-rest-e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const cashierUsername = `cashier.e2e.${Date.now()}`;
  const cashierPassword = 'e2e-admin-pass';
  const passwordHash = bcrypt.hashSync(cashierPassword, bcrypt.genSaltSync(10));

  await db.insert(schema.users).values({
    id: cashierUserId,
    username: cashierUsername,
    passwordHash,
    name: cashierUsername,
    role: 'admin',
    permissions: '*',
    companyId,
    defaultBranchId: branchId,
    branchScope: 'company_wide',
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }).run();

  // Optional stability.
  try {
    await db.insert(schema.userBranchAccess).values({
      id: `uba-${cashierUserId}-${branchId}`,
      userId: cashierUserId,
      branchId,
      isDefault: true,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).onConflictDoNothing().run();
  } catch {
    /* ignore */
  }

  const cashierToken = server.jwt.sign({
    id: cashierUserId,
    role: 'admin',
    companyId,
    allowedBranchIds: [branchId],
    defaultBranchId: branchId,
    currentBranchId: branchId,
    branchScope: 'company_wide',
  });

  const authHeaders: Record<string, string> = {
    authorization: `Bearer ${cashierToken}`,
    'x-active-org': companyId,
    'x-company-id': companyId,
    'x-branch-id': branchId,
  };

  let port = await getFreePort();
  let base = `http://127.0.0.1:${port}`;
  let baseApi = `${base}/api`;

  let didListen = false;
  try {
    await server.listen({ port, host: '127.0.0.1' });
    didListen = true;
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (!/already listening/i.test(msg)) throw e;
    // Another process already started the Fastify server in this environment.
    // In that case we assume default server port=3333 (as defined in backend/server.ts).
    port = 3333;
    base = `http://127.0.0.1:${port}`;
    baseApi = `${base}/api`;
  }

  if (didListen) {
    const { initRestaurantSocket } = await import('../backend/lib/restaurantSocket.ts');
    initRestaurantSocket((server as any).server, serverConfig.jwtSecret);
  }

  const cashierSocket: Socket = io(base, { path: '/socket.io', transports: ['websocket', 'polling'], auth: { token: cashierToken } });
  await new Promise<void>((resolve) => {
    if (cashierSocket.connected) return resolve();
    cashierSocket.on('connect', () => resolve());
    setTimeout(resolve, 1500);
  });

  const socketLog = {
    requestNew: [] as any[],
    requestSeen: [] as any[],
    requestAccepted: [] as any[],
    requestRejected: [] as any[],
    sessionUpdated: [] as any[],
    sessionClosed: [] as any[],
  };

  cashierSocket.on('restaurant:request-new', (p) => socketLog.requestNew.push({ at: Date.now(), p }));
  cashierSocket.on('restaurant:request-seen', (p) => socketLog.requestSeen.push({ at: Date.now(), p }));
  cashierSocket.on('restaurant:request-accepted', (p) => socketLog.requestAccepted.push({ at: Date.now(), p }));
  cashierSocket.on('restaurant:request-rejected', (p) => socketLog.requestRejected.push({ at: Date.now(), p }));
  cashierSocket.on('restaurant:session-updated', (p) => socketLog.sessionUpdated.push({ at: Date.now(), p }));
  cashierSocket.on('restaurant:session-closed', (p) => socketLog.sessionClosed.push({ at: Date.now(), p }));

  const results: ScenarioResult[] = [];
  const add = (key: string, status: ScenarioStatus, steps: string[], observed: any, expected: any, notes?: string[], error?: string) => {
    results.push({ key, status, steps, observed, expected, notes, error });
  };

  const api = {
    openSession: async (tableId: string) => {
      const res = await httpJson(`${baseApi}/restaurant/tables/${encodeURIComponent(tableId)}/open-session`, { method: 'POST', headers: authHeaders, json: {} });
      return res.session as any;
    },
    closeSession: async (sessionId: string, force?: boolean) => {
      const res = await httpJson(`${baseApi}/restaurant/sessions/${encodeURIComponent(sessionId)}/close`, {
        method: 'POST',
        headers: authHeaders,
        json: force ? { forceCloseWithUnreadRequests: true } : {},
      });
      return res.session as any;
    },
    transition: async (requestId: string, action: 'mark-seen' | 'accept' | 'reject' | 'archive') => {
      return httpJson(`${baseApi}/restaurant/requests/${encodeURIComponent(requestId)}/${action}`, { method: 'POST', headers: authHeaders, json: {} });
    },
    getSession: async (sessionId: string) => httpJson(`${baseApi}/restaurant/sessions/${encodeURIComponent(sessionId)}`, { headers: authHeaders }),
    getRequests: async (sessionId: string) => httpJson(`${baseApi}/restaurant/sessions/${encodeURIComponent(sessionId)}/requests`, { headers: authHeaders }),
    upsertMenu: async (itemId: string, patch: any) => httpJson(`${baseApi}/restaurant/menu-items`, { method: 'POST', headers: authHeaders, json: { itemId, ...patch } }),
    getPublicMenu: async (publicToken: string, customerSessionToken?: string | null) => {
      const q = customerSessionToken ? `?customerSessionToken=${encodeURIComponent(customerSessionToken)}` : '';
      return httpJson(`${baseApi}/restaurant/public/menu/${encodeURIComponent(publicToken)}${q}`, { headers: { Accept: 'application/json' } });
    },
    submitPublic: async (publicToken: string, body: any) => httpJson(`${baseApi}/restaurant/public/menu/${encodeURIComponent(publicToken)}/request`, { method: 'POST', headers: { 'content-type': 'application/json', Accept: 'application/json' }, json: body }),
    reportHub: async (mode: string, from: string, to: string) =>
      httpJson(`${baseApi}/reports/hub?mode=${encodeURIComponent(mode)}&from=${from}&to=${to}&branchId=${encodeURIComponent(branchId)}&topN=20`, { headers: authHeaders }),
  };

  const dbComputedNew = async (sessionId: string) => {
    const reqs = await db.select().from(schema.restaurantTableRequests).where(eq(schema.restaurantTableRequests.sessionId, sessionId)).all();
    return (reqs || []).filter((r: any) => String(r.requestStatus || '') === 'new').length;
  };

  const dbStoredUnread = async (sessionId: string) => {
    const s = await db.select().from(schema.restaurantTableSessions).where(eq(schema.restaurantTableSessions.id, sessionId)).get();
    return Number(s?.unreadRequestCount ?? 0);
  };

  const dbGetRequests = async (sessionId: string) => {
    return await db.select().from(schema.restaurantTableRequests).where(eq(schema.restaurantTableRequests.sessionId, sessionId)).all();
  };

  const startCustomerSocket = (publicToken: string) =>
    io(base, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      auth: { publicToken },
    });

  // Create menu items and restaurant tables.
  const now = Date.now();
  const runTag = String(now);
  const itemIds = {
    i1: `item-e2e-qr1-${now}`,
    i2: `item-e2e-qr2-${now}`,
    i3: `item-e2e-qr3-${now}`,
    i4: `item-e2e-qr4-${now}`,
    i5: `item-e2e-qr5-${now}`,
    iHidden: `item-e2e-qrHidden-${now}`,
    iUnavailable: `item-e2e-qrUnavailable-${now}`,
  };

  const mkItem = async (id: string, name: string, code: string, price: number) => {
    await db.insert(schema.items).values({
      id,
      companyId,
      branchId,
      name,
      code,
      unitName: 'pcs',
      quantity: 0,
      costPrice: 0,
      salePrice: price,
      posPrice: price,
      inactive: 0,
      itemType: 'STOCK',
      priceCurrency: 'USD',
      lastUpdated: new Date().toISOString(),
    }).onConflictDoNothing().run();
  };

  await mkItem(itemIds.i1, 'QR Item 1', `QR1-${now}`, 10);
  await mkItem(itemIds.i2, 'QR Item 2', `QR2-${now}`, 12);
  await mkItem(itemIds.i3, 'QR Item 3', `QR3-${now}`, 8);
  await mkItem(itemIds.i4, 'QR Item 4', `QR4-${now}`, 5);
  await mkItem(itemIds.i5, 'QR Item 5', `QR5-${now}`, 7);
  await mkItem(itemIds.iHidden, 'QR Hidden Item', `QRH-${now}`, 20);
  await mkItem(itemIds.iUnavailable, 'QR Unavailable Item', `QRU-${now}`, 15);

  const mkMenu = async (itemId: string, sortOrder: number, categoryName: string) => {
    await db.insert(schema.restaurantMenuItems).values({
      id: `rmi-${randomUUID()}`,
      companyId,
      branchId,
      itemId,
      isVisibleInQr: true,
      isAvailableNow: true,
      categoryName,
      sortOrder,
      displayNameOverride: null,
      description: null,
      imageUrl: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).run();
  };

  await mkMenu(itemIds.i1, 1, 'مشروبات');
  await mkMenu(itemIds.i2, 2, 'مشروبات');
  await mkMenu(itemIds.i3, 3, 'حلويات');
  await mkMenu(itemIds.i4, 4, 'أساسيات');
  await mkMenu(itemIds.i5, 5, 'أساسيات');
  await mkMenu(itemIds.iHidden, 6, 'خفي');
  await mkMenu(itemIds.iUnavailable, 7, 'خفي2');

  const mkTable = async (code: string) => {
    const id = `rst-${randomUUID()}`;
    const publicQrToken = randomUUID();
    await db.insert(schema.restaurantTables).values({
      id,
      companyId,
      branchId,
      code,
      name: `Table ${code}`,
      zoneName: 'E2E',
      capacity: 10,
      sortOrder: 1,
      isActive: true,
      notes: null,
      publicQrToken,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).run();
    return { id, publicQrToken };
  };

  const tables = {
    t1: await mkTable(`T1-E2E-${runTag}`),
    t2: await mkTable(`T2-E2E-${runTag}`),
    t3: await mkTable(`T3-E2E-${runTag}`),
  };

  // ----------------------------
  // Scenario A: open session + first request
  // ----------------------------
  let sessionMainT1: any = null;
  let customerTokenMainT1: string | null = null;
  let req1Id: string | null = null;
  try {
    sessionMainT1 = await api.openSession(tables.t1.id);
    const s0 = await api.getSession(sessionMainT1.id);
    const unread0 = Number(s0?.session?.unreadRequestCount ?? 0);

    const publicMenuA2 = await api.getPublicMenu(tables.t1.publicQrToken);
    if (!publicMenuA2.sessionOpen) throw new Error('Expected sessionOpen=true after open-session');

    const clientRequestId1 = `cr-${randomUUID()}`;
    const req1 = await api.submitPublic(tables.t1.publicQrToken, {
      clientRequestId: clientRequestId1,
      customerSessionToken: null,
      note: 'A-Request1',
      items: [
        { itemId: itemIds.i1, quantity: 2 },
        { itemId: itemIds.i2, quantity: 1 },
        { itemId: itemIds.i3, quantity: 1 },
      ],
    });

    customerTokenMainT1 = req1.customerSessionToken;
    req1Id = req1.requestId;
    await delay(200);

    const computedNew = await dbComputedNew(sessionMainT1.id);
    const storedUnread = await dbStoredUnread(sessionMainT1.id);
    if (storedUnread !== computedNew) throw new Error(`Unread mismatch after A. stored=${storedUnread} computed=${computedNew}`);

    const panelReqs = await api.getRequests(sessionMainT1.id);
    const exists = (panelReqs?.requests || []).some((r: any) => r.id === req1Id && r.requestStatus === 'new');
    if (!exists) throw new Error('Request not found in cashier panel as new.');

    const sockCount = socketLog.requestNew.filter((x) => x.p?.requestId === req1Id).length;
    if (sockCount !== 1) throw new Error(`Expected exactly 1 request-new emit for requestId ${req1Id}, got=${sockCount}`);

    add(
      'A',
      'PASS',
      ['cashier open session T1', 'customer open public menu', 'customer submit request1'],
      { sessionId: sessionMainT1.id, unreadBefore: unread0, requestId: req1Id, unreadAfter: storedUnread, socketRequestNewEmits: sockCount, customerSessionToken: customerTokenMainT1 },
      { unreadAfter: 1, requestStatus: 'new' },
    );
  } catch (e: any) {
    add('A', 'FAIL', ['cashier open session T1', 'customer submit request1'], {}, {}, undefined, e?.message || String(e));
    throw e;
  }

  // ----------------------------
  // Scenario B: multi-request same customer same session
  // ----------------------------
  let req2Id: string | null = null;
  let req3Id: string | null = null;
  try {
    if (!customerTokenMainT1) throw new Error('Missing customerTokenMainT1 for scenario B.');
    const req2 = await api.submitPublic(tables.t1.publicQrToken, {
      clientRequestId: `cr-${randomUUID()}`,
      customerSessionToken: customerTokenMainT1,
      note: 'B-Request2',
      items: [
        { itemId: itemIds.i4, quantity: 1 },
        { itemId: itemIds.i1, quantity: 1 },
      ],
    });
    req2Id = req2.requestId;

    const req3 = await api.submitPublic(tables.t1.publicQrToken, {
      clientRequestId: `cr-${randomUUID()}`,
      customerSessionToken: customerTokenMainT1,
      note: 'B-Request3',
      items: [{ itemId: itemIds.i2, quantity: 2 }],
    });
    req3Id = req3.requestId;

    await delay(250);

    const allReq = await dbGetRequests(sessionMainT1.id);
    const idsSet = new Set(allReq.map((r: any) => String(r.id)));
    const ok = [req1Id, req2Id, req3Id].every((id) => id && idsSet.has(id));
    if (!ok) throw new Error('Expected 3 distinct request batches in session.');

    const computedNew = await dbComputedNew(sessionMainT1.id);
    const storedUnread = await dbStoredUnread(sessionMainT1.id);
    if (storedUnread !== computedNew) throw new Error(`Unread mismatch after B. stored=${storedUnread} computed=${computedNew}`);

    add(
      'B',
      'PASS',
      ['customer submit request2', 'customer submit request3'],
      { sessionId: sessionMainT1.id, requestIds: [req1Id, req2Id, req3Id], unreadAfter: storedUnread },
      { newRequestsCount: computedNew },
    );
  } catch (e: any) {
    add('B', 'FAIL', ['customer multi requests'], {}, {}, undefined, e?.message || String(e));
    throw e;
  }

  // ----------------------------
  // Scenario C: cashier request review + FSM + invalid archive
  // ----------------------------
  try {
    const panel = await api.getRequests(sessionMainT1.id);
    const list = panel?.requests || [];
    if (list.length < 3) throw new Error('Scenario C expected 3 requests.');

    // Backend orders newest first
    const rSeen = list[0];
    const rAccepted = list[1];
    const rRejected = list[2];

    // C2 mark-seen on one
    await api.transition(rSeen.id, 'mark-seen');
    // C3 accept on another
    await api.transition(rAccepted.id, 'accept');
    // C4 reject on another
    await api.transition(rRejected.id, 'reject');

    const sAfter = await api.getSession(sessionMainT1.id);
    const unread = Number(sAfter?.session?.unreadRequestCount ?? 0);
    if (unread !== 0) throw new Error(`Expected unread=0 after C4, got=${unread}`);

    // C5: attempt archive on seen (FSM disallow: seen -> archived invalid)
    let archiveBlocked = false;
    try {
      await api.transition(rSeen.id, 'archive');
    } catch (err: any) {
      archiveBlocked = String(err.code || '').toUpperCase() === 'RESTAURANT_INVALID_REQUEST_TRANSITION' || Boolean(err.code);
    }
    if (!archiveBlocked) throw new Error('FSM archive should be blocked for seen request.');

    add(
      'C',
      'PASS',
      ['mark-seen', 'accept', 'reject', 'archive blocked on seen'],
      { markedSeen: rSeen.id, accepted: rAccepted.id, rejected: rRejected.id, unreadAfterC: unread, archiveBlocked },
      { unreadAfterC: 0 },
    );
  } catch (e: any) {
    add('C', 'FAIL', ['cashier review flow'], {}, {}, undefined, e?.message || String(e));
    throw e;
  }

  // ----------------------------
  // Scenario D: duplicate submit protection
  // ----------------------------
  try {
    if (!customerTokenMainT1) throw new Error('Missing customerTokenMainT1.');

    const dupClientRequestId = `cr-${randomUUID()}`;
    const payload = {
      clientRequestId: dupClientRequestId,
      customerSessionToken: customerTokenMainT1,
      note: 'D-dup-test',
      items: [
        { itemId: itemIds.i1, quantity: 1 },
        { itemId: itemIds.i2, quantity: 1 },
      ],
    };

    const res1 = await api.submitPublic(tables.t1.publicQrToken, payload);
    const res2 = await api.submitPublic(tables.t1.publicQrToken, payload);
    await delay(200);

    if (res1.requestId !== res2.requestId) throw new Error('Duplicate submit produced different requestId.');
    if (!res2.idempotentReplay) throw new Error('Expected idempotentReplay=true on duplicate submit.');

    const dupRows = await db.select().from(schema.restaurantTableRequests).where(and(eq(schema.restaurantTableRequests.sessionId, sessionMainT1.id), eq(schema.restaurantTableRequests.clientRequestId, dupClientRequestId))).all();
    if ((dupRows || []).length !== 1) throw new Error(`Expected 1 request row for duplicate clientRequestId. got=${(dupRows || []).length}`);

    const unread = await dbComputedNew(sessionMainT1.id);
    const storedUnread = await dbStoredUnread(sessionMainT1.id);
    if (storedUnread !== unread) throw new Error('Unread mismatch after D.');

    const sockCount = socketLog.requestNew.filter((x) => x.p?.requestId === res1.requestId).length;
    if (sockCount !== 1) throw new Error(`Expected only one request-new emit for duplicate requestId. got=${sockCount}`);

    add(
      'D',
      'PASS',
      ['submit duplicate twice with same clientRequestId'],
      { requestId: res1.requestId, idempotentReplay: res2.idempotentReplay, unreadNewCount: unread, socketRequestNewEmits: sockCount },
      { newCount: 1 },
    );
  } catch (e: any) {
    add('D', 'FAIL', ['duplicate submit twice'], {}, {}, undefined, e?.message || String(e));
    throw e;
  }

  // ----------------------------
  // Scenario E: item visibility / availability safety
  // ----------------------------
  let unreadBeforeE = 0;
  let requestsBeforeE = 0;
  const originalUnavailableInactive = await (async () => {
    const row = await db.select().from(schema.items).where(eq(schema.items.id, itemIds.iUnavailable)).get();
    return Number(row?.inactive ?? 0);
  })();

  try {
    unreadBeforeE = await dbStoredUnread(sessionMainT1.id);
    const reqAll = await db.select().from(schema.restaurantTableRequests).where(eq(schema.restaurantTableRequests.sessionId, sessionMainT1.id)).all();
    requestsBeforeE = (reqAll || []).length;

    // E1 hide iHidden from QR menu
    await api.upsertMenu(itemIds.iHidden, { isVisibleInQr: false });
    let e1ExpectedOk = false;
    try {
      await api.submitPublic(tables.t1.publicQrToken, {
        clientRequestId: `cr-${randomUUID()}`,
        customerSessionToken: customerTokenMainT1,
        note: 'E1-hidden-stale',
        items: [{ itemId: itemIds.iHidden, quantity: 1 }],
      });
    } catch (err: any) {
      e1ExpectedOk = String(err.code || '') === 'RESTAURANT_ITEM_NOT_VISIBLE_IN_QR';
    }
    if (!e1ExpectedOk) throw new Error('E1 expected RESTAURANT_ITEM_NOT_VISIBLE_IN_QR.');

    // Restore iHidden visible
    await api.upsertMenu(itemIds.iHidden, { isVisibleInQr: true });

    // E2 make iUnavailable unavailable by setting item inactive=1
    await db.update(schema.items).set({ inactive: 1, lastUpdated: new Date().toISOString() }).where(eq(schema.items.id, itemIds.iUnavailable)).run();
    let e2ExpectedOk = false;
    try {
      await api.submitPublic(tables.t1.publicQrToken, {
        clientRequestId: `cr-${randomUUID()}`,
        customerSessionToken: customerTokenMainT1,
        note: 'E2-unavailable-stale',
        items: [{ itemId: itemIds.iUnavailable, quantity: 1 }],
      });
    } catch (err: any) {
      e2ExpectedOk = String(err.code || '') === 'RESTAURANT_ITEM_UNAVAILABLE';
    }
    if (!e2ExpectedOk) throw new Error('E2 expected RESTAURANT_ITEM_UNAVAILABLE.');

    // Restore item inactive
    await db.update(schema.items).set({ inactive: originalUnavailableInactive, lastUpdated: new Date().toISOString() }).where(eq(schema.items.id, itemIds.iUnavailable)).run();

    const unreadAfter = await dbStoredUnread(sessionMainT1.id);
    const reqAllAfter = await db.select().from(schema.restaurantTableRequests).where(eq(schema.restaurantTableRequests.sessionId, sessionMainT1.id)).all();
    const reqCountAfter = (reqAllAfter || []).length;

    if (unreadAfter !== unreadBeforeE) throw new Error(`E unread should remain unchanged. before=${unreadBeforeE} after=${unreadAfter}`);
    if (reqCountAfter !== requestsBeforeE) throw new Error(`E request count should remain unchanged. before=${requestsBeforeE} after=${reqCountAfter}`);

    add(
      'E',
      'PASS',
      ['hide QR item then submit stale', 'inactivate item then submit stale'],
      { e1ExpectedOk, e2ExpectedOk, unreadBeforeE, unreadAfter: unreadAfter, requestsBeforeE, requestsAfter: reqCountAfter },
      { requestsCreated: 0 },
    );
  } catch (e: any) {
    // try to restore item states if fail
    try {
      await api.upsertMenu(itemIds.iHidden, { isVisibleInQr: true });
    } catch {}
    try {
      await db.update(schema.items).set({ inactive: originalUnavailableInactive, lastUpdated: new Date().toISOString() }).where(eq(schema.items.id, itemIds.iUnavailable)).run();
    } catch {}

    add('E', 'FAIL', ['item visibility/unavailability safety'], {}, {}, undefined, e?.message || String(e));
    throw e;
  }

  // ----------------------------
  // Scenario F: session close protection
  // ----------------------------
  try {
    let blocked = false;
    try {
      await api.closeSession(sessionMainT1.id, false);
    } catch (err: any) {
      blocked = String(err.code || '') === 'RESTAURANT_SESSION_HAS_UNREAD_REQUESTS';
    }
    if (!blocked) throw new Error('F1 expected RESTAURANT_SESSION_HAS_UNREAD_REQUESTS.');

    const closed = await api.closeSession(sessionMainT1.id, true);
    const closedMenu = await api.getPublicMenu(tables.t1.publicQrToken, customerTokenMainT1);
    const sessionClosed = String(closed?.sessionStatus) === 'closed';
    if (!sessionClosed) throw new Error('F2 expected sessionStatus=closed.');
    if (closedMenu.sessionOpen) throw new Error('Customer menu should be read-only (sessionOpen=false).');

    add(
      'F',
      'PASS',
      ['close blocked without force', 'force close with override'],
      { blocked, closedSessionId: closed?.id, customerSessionOpenAfterClose: closedMenu.sessionOpen },
      { customerSessionOpenAfterClose: false },
    );
  } catch (e: any) {
    add('F', 'FAIL', ['session close protection'], {}, {}, undefined, e?.message || String(e));
    throw e;
  }

  // ----------------------------
  // Scenario G: closed session race
  // ----------------------------
  try {
    let ok = false;
    try {
      await api.submitPublic(tables.t1.publicQrToken, {
        clientRequestId: `cr-${randomUUID()}`,
        customerSessionToken: customerTokenMainT1,
        note: 'G-after-close',
        items: [{ itemId: itemIds.i1, quantity: 1 }],
      });
    } catch (err: any) {
      const code = String(err.code || '');
      ok = code === 'RESTAURANT_SESSION_CLOSED' || code === 'RESTAURANT_NO_OPEN_SESSION';
    }
    if (!ok) throw new Error('G expected RESTAURANT_SESSION_CLOSED/NO_OPEN_SESSION.');
    add('G', 'PASS', ['submit after close'], { ok }, { ok: true });
  } catch (e: any) {
    add('G', 'FAIL', ['submit after close'], {}, {}, undefined, e?.message || String(e));
    throw e;
  }

  // ----------------------------
  // Scenario H: socket reconnect resilience
  // ----------------------------
  let sessionT1b: any = null;
  let sessionT2b: any = null;
  let requestHId: string | null = null;
  let customerTokenT1b: string | null = null;
  try {
    sessionT1b = await api.openSession(tables.t1.id);
    sessionT2b = await api.openSession(tables.t2.id);
    await delay(150);

    // Customer submits request on T1b to create new request.
    const resH = await api.submitPublic(tables.t1.publicQrToken, {
      clientRequestId: `cr-${randomUUID()}`,
      customerSessionToken: null,
      note: 'H-open-session',
      items: [{ itemId: itemIds.i2, quantity: 1 }],
    });
    requestHId = resH.requestId;
    customerTokenT1b = resH.customerSessionToken;

    const unreadBeforeReconnect = await dbStoredUnread(sessionT1b.id);
    if (unreadBeforeReconnect < 1) throw new Error('Expected unread>=1 during socket reconnect scenario.');

    // Reconnect cashier socket: clear any request-new events and ensure no duplicates for requestHId.
    const cashierSocketCountBefore = socketLog.requestNew.length;
    cashierSocket.close();
    await delay(400);

    const cashierSocket2: Socket = io(base, { path: '/socket.io', transports: ['websocket', 'polling'], auth: { token: cashierToken } });
    await new Promise<void>((resolve) => {
      if (cashierSocket2.connected) return resolve();
      cashierSocket2.on('connect', () => resolve());
      setTimeout(resolve, 1500);
    });

    const seenAfterReconnect: string[] = [];
    cashierSocket2.on('restaurant:request-new', (p) => {
      if (p?.requestId) seenAfterReconnect.push(String(p.requestId));
    });
    await delay(900);

    const dupForH = seenAfterReconnect.filter((rid) => rid === requestHId).length;
    // Should be 0 because reconnect shouldn't cause server to replay request-new.
    if (dupForH !== 0) throw new Error(`H expected no duplicate request-new after reconnect for requestId=${requestHId}, got=${dupForH}`);

    // Customer reconnect: reconnect socket and reload menu state.
    const custSock = startCustomerSocket(tables.t1.publicQrToken);
    await new Promise<void>((resolve) => {
      if (custSock.connected) return resolve();
      custSock.on('connect', () => resolve());
      setTimeout(resolve, 1500);
    });
    custSock.close();
    await delay(200);

    const menuAfterReload = await api.getPublicMenu(tables.t1.publicQrToken, customerTokenT1b);
    if (!menuAfterReload.sessionOpen) throw new Error('Customer menu should still report sessionOpen=true after reconnect.');
    const expectedPrior = menuAfterReload.priorRequests?.length || 0;
    if (expectedPrior < 1) throw new Error('Expected priorRequests to include submitted request after reload.');

    add(
      'H',
      'PASS',
      ['open sessions on T1/T2', 'submit request on T1', 'cashier socket reconnect', 'customer socket reconnect + reload menu'],
      { sessionT1b: sessionT1b.id, sessionT2b: sessionT2b.id, requestHId, unreadBeforeReconnect, dupForH, priorRequestsCount: expectedPrior, customerTokenT1b },
      { dupForH: 0, sessionOpen: true, priorRequestsCountMin: 1 },
    );

    cashierSocket2.close();
    try { cashierSocket.close(); } catch {}
  } catch (e: any) {
    add('H', 'FAIL', ['socket reconnect resilience'], {}, {}, undefined, e?.message || String(e));
    throw e;
  }

  // ----------------------------
  // Scenario I: multi-table isolation
  // ----------------------------
  try {
    if (!sessionT1b || !sessionT2b || !customerTokenT1b) throw new Error('Missing H sessions/tokens for scenario I.');
    const unreadBeforeT2 = await dbStoredUnread(sessionT2b.id);
    const unreadBeforeT1 = await dbStoredUnread(sessionT1b.id);

    // I2: request on T1 only, verify T2 unchanged.
    const resI2 = await api.submitPublic(tables.t1.publicQrToken, {
      clientRequestId: `cr-${randomUUID()}`,
      customerSessionToken: customerTokenT1b,
      note: 'I2-T1-only',
      items: [{ itemId: itemIds.i3, quantity: 1 }],
    });
    await delay(250);

    const unreadAfterT2 = await dbStoredUnread(sessionT2b.id);
    const unreadAfterT1 = await dbStoredUnread(sessionT1b.id);

    if (unreadAfterT2 !== unreadBeforeT2) throw new Error(`I2 failed: T2 unread changed. before=${unreadBeforeT2} after=${unreadAfterT2}`);
    if (unreadAfterT1 <= unreadBeforeT1) throw new Error('I2 failed: T1 unread should increase after new request.');

    // I3: request on T2
    const resT2 = await api.submitPublic(tables.t2.publicQrToken, {
      clientRequestId: `cr-${randomUUID()}`,
      customerSessionToken: null,
      note: 'I3-T2-request',
      items: [{ itemId: itemIds.i4, quantity: 2 }],
    });
    await delay(250);

    const unreadAfterT2_2 = await dbStoredUnread(sessionT2b.id);
    const unreadAfterT1_2 = await dbStoredUnread(sessionT1b.id);

    if (unreadAfterT2_2 <= unreadAfterT2) throw new Error('I3 failed: T2 unread should increase.');
    if (unreadAfterT1_2 !== unreadAfterT1) throw new Error('I3 failed: T1 unread should not change when submitting on T2.');

    add(
      'I',
      'PASS',
      ['T1 request doesn\'t affect T2', 'T2 request affects only T2'],
      {
        requestIdT1_I2: resI2.requestId,
        requestIdT2_I3: resT2.requestId,
        unreadBeforeT1,
        unreadAfterT1,
        unreadBeforeT2,
        unreadAfterT2,
        unreadAfterT2_2,
      },
      { T2unreadUnchangedInI2: true, T2unreadIncreasedInI3: true },
    );
  } catch (e: any) {
    add('I', 'FAIL', ['multi-table isolation'], {}, {}, undefined, e?.message || String(e));
    throw e;
  }

  // ----------------------------
  // Scenario J: report consistency (basic summary checks)
  // ----------------------------
  try {
    // تقرير reports.hub يستخدم Date.parse على submittedAt بتفسير قد يختلف بين Local/UTC؛
    // لذلك نستخدم نطاقًا واسعًا لتجنب استبعاد الطلبات خطأً أثناء المقارنة.
    const fromDate = '2000-01-01';
    const toDate = '2100-12-31';
    const allReq = await db.select().from(schema.restaurantTableRequests).all();
    const actualTotal = (allReq || []).filter(
      (r: any) => String(r.branchId) === branchId && String(r.companyId) === companyId,
    ).length;

    const repAct = await api.reportHub('restaurant_qr_activity', fromDate, toDate);
    const actTotal = repAct?.summary?.find((s: any) => String(s?.title || '').includes('إجمالي الطلبات'))?.value;

    const repMenu = await api.reportHub('restaurant_qr_menu_usage', fromDate, toDate);
    const menuRequests = repMenu?.summary?.find((s: any) => String(s?.title || '').includes('طلبات في الفترة'))?.value;

    const repTimeline = await api.reportHub('restaurant_session_request_timeline', fromDate, toDate);
    const timelineRows = Array.isArray(repTimeline?.tableRows) ? repTimeline.tableRows : [];

    const ok = Number(actTotal) === Number(actualTotal) && Number(menuRequests) === Number(actualTotal) && timelineRows.length > 0;
    if (!ok) throw new Error(`Report mismatch. actualTotal=${actualTotal}, actTotal=${actTotal}, menuRequests=${menuRequests}, timelineRows=${timelineRows.length}`);

    add(
      'J',
      'PASS',
      ['validate reports hub summary counts'],
      { fromDate, toDate, actualTotal, actTotal, menuRequests, timelineRowsCount: timelineRows.length },
      { actualTotalEqualsReportTotals: true },
    );
  } catch (e: any) {
    add('J', 'FAIL', ['report consistency'], {}, {}, undefined, e?.message || String(e));
    throw e;
  }

  // Cleanup: force close the two open sessions to avoid leaving tables occupied.
  try {
    if (sessionT1b?.id) await api.closeSession(sessionT1b.id, true);
    if (sessionT2b?.id) await api.closeSession(sessionT2b.id, true);
  } catch {
    /* ignore */
  }

  // Write report markdown.
  const outDir = path.join(process.cwd(), 'reports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `restaurant-e2e-operational-sim-${Date.now()}.md`);

  const overall: ScenarioStatus = results.some((r) => r.status === 'FAIL') ? 'FAIL' : results.some((r) => r.status === 'PARTIAL') ? 'PARTIAL' : 'PASS';
  const verdict = overall === 'PASS' ? 'READY FOR CONTROLLED PILOT' : overall === 'PARTIAL' ? 'READY AFTER MINOR FIXES' : 'NOT READY YET';

  const md = [
    '# Restaurant Module E2E Operational Simulation',
    '',
    '## Environment',
    `- host: 127.0.0.1`,
    `- port: ${port}`,
    `- devices: automation (API + Socket.IO, no browser screenshots)`,
    `- companyId: ${companyId}`,
    `- branchId: ${branchId}`,
    `- startAt: ${fmtTs(startedAt)}`,
    '',
    '## Scenario Results',
    ...results.map((r) => {
      const head = `### ${r.key} — ${r.status}`;
      const stepLines = r.steps?.length ? `- Steps: ${r.steps.join(' → ')}` : '';
      const obs = r.observed ? `- Observed: \n\n\`\`\`\n${JSON.stringify(r.observed, null, 2)}\n\`\`\`` : '';
      const exp = r.expected ? `- Expected: \n\n\`\`\`\n${JSON.stringify(r.expected, null, 2)}\n\`\`\`` : '';
      const err = r.error ? `- Error: ${r.error}` : '';
      const notes = r.notes?.length ? `- Notes: ${r.notes.join(' | ')}` : '';
      return [head, stepLines, notes, err, obs, exp].filter(Boolean).join('\n');
    }),
    '',
    '## Critical Issues',
    '- If any scenario is FAIL: fix blockers before deeper kitchen/finance stages.',
    '',
    '## Final Readiness Verdict',
    verdict,
    '',
  ].join('\n');

  fs.writeFileSync(outPath, md, 'utf8');

  try { cashierSocket.close(); } catch {}
  try { await server.close(); } catch {}
  try { await closeDb?.(); } catch {}

  console.log(`E2E simulation finished: ${verdict}`);
  console.log(`Report: ${outPath}`);
}

main().catch(async (e) => {
  console.error('E2E simulation failed:', e?.message || String(e));
  process.exit(1);
});

