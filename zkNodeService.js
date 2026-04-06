const ZKLib = require('zklib-js-zkteko');
const { REQUEST_DATA } = require('zklib-js-zkteko/constants');
const { decodeRecordData40, decodeRecordData49, decodeRecordData16 } = require('zklib-js-zkteko/utils');

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function safeDisconnect(zk) {
    try { await zk.disconnect(); } catch (e) {}
}

function isReasonableDate(d) {
    if (!d || isNaN(d.getTime())) return false;
    const year = d.getFullYear();
    if (year < 2010) return false;
    const now = Date.now();
    if (d.getTime() > now + 24 * 60 * 60 * 1000) return false;
    return true;
}

function normalizeAttendance(raw, deviceIp) {
    const userId = raw.deviceUserId ?? raw.userId ?? raw.uid ?? raw.userSn;
    if (!userId) return null;

    let timestamp = null;
    if (raw.recordTime instanceof Date) {
        timestamp = raw.recordTime;
    } else if (typeof raw.recordTime === 'string') {
        const d = new Date(raw.recordTime);
        if (!isNaN(d.getTime())) timestamp = d;
    } else if (raw.timestamp && typeof raw.timestamp === 'string') {
        const d = new Date(raw.timestamp);
        if (!isNaN(d.getTime())) timestamp = d;
    }

    if (!timestamp || !isReasonableDate(timestamp)) return null;

    const timeStr = new Date(timestamp.getTime() - (timestamp.getTimezoneOffset() * 60000))
        .toISOString()
        .replace('T', ' ')
        .split('.')[0];

    const eventType = raw.inOutMode ?? raw.inOutState ?? raw.attendanceType ?? raw.state ?? raw.type ?? null;

    return {
        user_id: String(userId).trim(),
        timestamp: timeStr,
        deviceIp: deviceIp,
        eventType: eventType !== null && eventType !== undefined ? String(eventType) : null
    };
}

function parseRecords(buffer, size, decoder) {
    let recordData = buffer.subarray(4);
    const records = [];
    while (recordData.length >= size) {
        const rec = decoder(recordData.subarray(0, size));
        records.push(rec);
        recordData = recordData.subarray(size);
    }
    return records;
}

function scoreRecords(records) {
    let score = 0;
    for (const r of records) {
        const id = r.deviceUserId ?? r.userId ?? r.uid ?? r.userSn;
        if (id && /^\d+$/.test(String(id).trim())) score += 2;
        let d = null;
        if (r.recordTime instanceof Date) d = r.recordTime;
        else if (typeof r.recordTime === 'string') {
            const tmp = new Date(r.recordTime);
            if (!isNaN(tmp.getTime())) d = tmp;
        }
        if (d && isReasonableDate(d)) score += 4;
    }
    return score;
}

async function readAttendanceBuffer(zk, transport) {
    if (transport === 'udp') {
        return zk.zklibUdp.readWithBuffer(REQUEST_DATA.GET_ATTENDANCE_LOGS);
    }
    return zk.zklibTcp.readWithBuffer(REQUEST_DATA.GET_ATTENDANCE_LOGS);
}

async function syncAttendanceNode(device) {
    const CONFIG = {
        ip: device.ip,
        port: device.port || 4370,
        timeout: 20000,
        attempts: 2,
        pauseMs: 500
    };

    console.log(`[ZK Node] Sync start ${CONFIG.ip}:${CONFIG.port}`);

    const zk = new ZKLib(CONFIG.ip, CONFIG.port, CONFIG.timeout, 4000);
    let connectionMade = false;

    try {
        await zk.createSocket();
        connectionMade = true;
        console.log('[ZK Node] TCP connection established');

        try { await zk.disableDevice(); } catch (e) {}

        let raw = null;
        for (let i = 1; i <= CONFIG.attempts; i++) {
            try {
                raw = await readAttendanceBuffer(zk, 'tcp');
                if (raw && raw.data) break;
            } catch (e) {
                console.warn(`[ZK Node] TCP read attempt ${i} failed:`, e?.message || e);
            }
            await sleep(CONFIG.pauseMs);
        }

        if (!raw || !raw.data) {
            // UDP fallback
            try {
                if (!zk.zklibUdp.socket) {
                    await zk.zklibUdp.createSocket();
                    await zk.zklibUdp.connect();
                }
                zk.connectionType = 'udp';
                raw = await readAttendanceBuffer(zk, 'udp');
            } catch (e) {
                console.warn('[ZK Node] UDP fallback failed:', e?.message || e);
            }
        }

        if (!raw || !raw.data) {
            return { success: false, message: 'فشل جلب سجلات الحضور من الجهاز.', data: [] };
        }

        // Build allowed user id set from device users to filter out ghost IDs
        let allowedIds = null;
        try {
            const users = await zk.getUsers();
            let usersList = [];
            if (Array.isArray(users)) usersList = users;
            else if (users && users.data && Array.isArray(users.data)) usersList = users.data;
            const ids = new Set();
            for (const u of usersList) {
                const id = u.deviceUserId ?? u.userId ?? u.uid ?? u.userSn;
                if (id !== undefined && id !== null) ids.add(String(id).trim());
            }
            if (ids.size > 0) allowedIds = ids;
        } catch (e) {
            console.warn('[ZK Node] Failed to fetch users for filtering:', e?.message || e);
        }

        const buffer = raw.data;

        const candidates = [
            { size: 49, decoder: decodeRecordData49 },
            { size: 40, decoder: decodeRecordData40 },
            { size: 16, decoder: decodeRecordData16 }
        ];

        let best = { records: [], score: -1, size: 0 };
        for (const c of candidates) {
            const recs = parseRecords(buffer, c.size, c.decoder);
            const s = scoreRecords(recs);
            if (s > best.score) best = { records: recs, score: s, size: c.size };
        }

        console.log(`[ZK Node] Parsed with size=${best.size}, raw=${best.records.length}`);

        const normalized = best.records
            .map(r => {
                const n = normalizeAttendance(r, CONFIG.ip);
                if (!n) return null;
                if (allowedIds && !allowedIds.has(String(n.user_id).trim())) return null;
                return n;
            })
            .filter(Boolean);
        console.log(`[ZK Node] Normalized records: ${normalized.length}`);

        try { await zk.enableDevice(); } catch (e) {}
        await safeDisconnect(zk);

        return {
            success: true,
            message: `تم جلب ${normalized.length} سجل بصمة من الجهاز.`,
            data: normalized
        };
    } catch (err) {
        if (connectionMade) { await safeDisconnect(zk); }
        return { success: false, message: `فشل الاتصال: ${err.message || err}`, data: [] };
    }
}

async function getUsersNode(device) {
    const ip = device.ip;
    const port = device.port || 4370;
    const zk = new ZKLib(ip, port, 10000, 4000);

    try {
        await zk.createSocket();
        const users = await zk.getUsers();
        await safeDisconnect(zk);

        let usersList = [];
        if (Array.isArray(users)) usersList = users;
        else if (users && users.data && Array.isArray(users.data)) usersList = users.data;

        return {
            success: true,
            message: `تم جلب ${usersList.length} مستخدم بنجاح.`,
            data: usersList
        };
    } catch (error) {
        await safeDisconnect(zk);
        return { success: false, message: `فشل جلب المستخدمين: ${error.message}` };
    }
}

async function uploadUsersNode(device, employees) {
    const ip = device.ip;
    const port = device.port || 4370;
    const zk = new ZKLib(ip, port, 10000, 4000);
    let successCount = 0;
    let failedCount = 0;

    try {
        await zk.createSocket();
        for (const emp of employees || []) {
            const userIdStr = String(emp.biometricId || '').trim();
            if (!/^\d+$/.test(userIdStr)) {
                failedCount++;
                continue;
            }
            const uid = parseInt(userIdStr, 10);
            if (Number.isNaN(uid)) {
                failedCount++;
                continue;
            }
            const name = emp.name ? String(emp.name).trim() : ('User ' + userIdStr);
            try {
                await zk.setUser(uid, userIdStr, name, '', 0, 0);
                successCount++;
            } catch (e) {
                failedCount++;
            }
        }
        await safeDisconnect(zk);
        let message = `تم رفع ${successCount} مستخدم/ة إلى الجهاز.`;
        if (failedCount > 0) message += ` تعذر رفع ${failedCount} مستخدم/ة.`;
        return { success: true, message };
    } catch (error) {
        await safeDisconnect(zk);
        return { success: false, message: `فشل رفع المستخدمين: ${error.message}` };
    }
}

async function testConnectionNode(device) {
    const ip = device.ip;
    const port = device.port || 4370;

    const zk = new ZKLib(ip, port, 5000, 4000);

    try {
        await zk.createSocket();
        const info = await zk.getInfo();
        let timeObj = null;
        try { timeObj = await zk.getTime(); } catch (e) {}
        await safeDisconnect(zk);

        const deviceTime = timeObj ? new Date(timeObj).toLocaleString('ar-EG') : 'غير معروف';

        return {
            success: true,
            message: `تم الاتصال بنجاح!\nالموديل: ${info.deviceName || 'ZKTeco'}\nعدد السجلات: ${info.logCounts}\nالمستخدمين: ${info.userCounts}\nتوقيت الجهاز: ${deviceTime}`
        };

    } catch (error) {
        await safeDisconnect(zk);
        return {
            success: false,
            message: `فشل الاتصال: ${error.message || 'تأكد من كابل الشبكة وإعدادات الجهاز'}`
        };
    }
}

module.exports = {
    syncAttendanceNode,
    testConnectionNode,
    getUsersNode,
    uploadUsersNode,
};
