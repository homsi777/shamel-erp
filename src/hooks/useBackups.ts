import { useRef, useState } from 'react';
import { apiRequest, API_CONFIG, getCurrentOrgId } from '../lib/api';
import { confirmDialog } from '../lib/confirm';
import { shouldUseLocalApiRuntime } from '../lib/runtimeContext';
import { TESTING_RESET_CONFIRMATION_PHRASE } from '../lib/testingReset';

export type BackupEntry = {
    name: string;
    type: 'json' | 'db';
    size: number;
    createdAt?: string;
    createdBy?: string;
    scope?: string[];
};

export const useBackups = (isActive: boolean) => {
    const [isProcessing, setIsProcessing] = useState(false);
    const [isRestoreModalOpen, setIsRestoreModalOpen] = useState(false);
    const [backups, setBackups] = useState<BackupEntry[]>([]);
    const [isLoadingBackups, setIsLoadingBackups] = useState(false);
    const inFlightRef = useRef(false);
    const usesEmbeddedLocalRuntime = shouldUseLocalApiRuntime();
    const isPostgresRuntime = String(import.meta.env.VITE_DB_DIALECT || 'postgres').toLowerCase() === 'postgres';

    // --- وظيفة التحميل المباشر (Download to Disk) ---
    const triggerDownload = async (blob: Blob, fileName: string) => {
        const anyWindow = window as any;
        if (anyWindow?.showSaveFilePicker) {
            try {
                const handle = await anyWindow.showSaveFilePicker({
                    suggestedName: fileName,
                    types: [
                        { description: 'Backup File', accept: { 'application/octet-stream': isPostgresRuntime ? ['.dump'] : ['.db'], 'application/json': ['.json'] } }
                    ]
                });
                const writable = await handle.createWritable();
                await writable.write(blob);
                await writable.close();
                return;
            } catch (e) {
                // Fallback to normal download if user cancels or API fails
            }
        }
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
    };

    const handleCreateBackup = async (type: 'db' | 'json') => {
        if (inFlightRef.current) return;
        inFlightRef.current = true;
        setIsProcessing(true);
        try {
            const storedUser = localStorage.getItem('shamel_user');
            const currentUser = storedUser ? JSON.parse(storedUser) : null;
            const userTag = (currentUser?.name || currentUser?.username || 'user')
                .toString()
                .replace(/[^\w\u0600-\u06FF-]/g, '_');
            const now = new Date();
            const date = now.toISOString().split('T')[0];
            const time = now.toTimeString().slice(0, 8).replace(/:/g, '-');

            if (usesEmbeddedLocalRuntime) {
                // تصدير بيانات النمط المحلي (LocalStorage)
                const orgId = getCurrentOrgId();
                const keys = ['inventory', 'parties', 'invoices', 'accounts', 'vouchers', 'cash-boxes', 'warehouses', 'branches', 'categories', 'units'];
                const localExport: any = { metadata: { system: 'SHAMEL-ERP', mode: 'Standalone', timestamp: new Date().toISOString() }, data: {} };
                
                keys.forEach(k => {
                    const data = localStorage.getItem(`shamel_org_${orgId}_${k.replace(/-/g, '')}`);
                    if (data) localExport.data[k] = JSON.parse(data);
                });

                const jsonText = JSON.stringify(localExport, null, 2);
                if (!jsonText || jsonText.length === 0) throw new Error('النسخة فارغة');
                const blob = new Blob([jsonText], { type: 'application/json' });
                await triggerDownload(blob, `${userTag}_${date}_${time}.json`);
                alert("تم تصدير نسخة البيانات المحلية بنجاح ✅");
            } else {
                // تصدير من السيرفر
                const endpoint = type === 'db' ? 'backups/export/db' : 'backups/export/json';
                const response = await fetch(`${API_CONFIG.baseUrl}/${endpoint}?ts=${Date.now()}`, {
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('shamel_token')}` }
                });
                
                if (!response.ok) throw new Error("فشل السيرفر في توليد النسخة");
                
                const blob = await response.blob();
                if (!blob || blob.size === 0) throw new Error('النسخة فارغة');
                const ext = type === 'db' ? (isPostgresRuntime ? 'dump' : 'db') : 'json';
                await triggerDownload(blob, `${userTag}_${date}_${time}.${ext}`);
                alert("تم تحميل نسخة المحرك إلى جهازك بنجاح ✅");
            }
        } catch (e: any) {
            alert(`خطأ في النسخ الاحتياطي: ${e.message}`);
        } finally {
            setIsProcessing(false);
            inFlightRef.current = false;
        }
    };

    const loadBackups = async () => {
        if (usesEmbeddedLocalRuntime) {
            setBackups([]);
            return;
        }
        setIsLoadingBackups(true);
        try {
            const data = await apiRequest('backups/list');
            setBackups(Array.isArray(data) ? data : []);
        } catch {
            setBackups([]);
        } finally {
            setIsLoadingBackups(false);
        }
    };

    const handleCreateStoredBackup = async (type: 'db' | 'json', scope: string[], createdBy?: string, name?: string) => {
        if (usesEmbeddedLocalRuntime) {
            alert('هذه الميزة متاحة في وضع السيرفر فقط.');
            return;
        }
        setIsProcessing(true);
        try {
            const endpoint = type === 'db' ? 'backups/create/db' : 'backups/create/json';
            const payload = { scope, createdBy, name };
            const res = await apiRequest(endpoint, { method: 'POST', body: JSON.stringify(payload) });
            if (!res?.success) throw new Error(res?.error || 'فشل إنشاء النسخة.');
            await loadBackups();
            alert('تم إنشاء النسخة الاحتياطية بنجاح ✅');
        } catch (e: any) {
            alert(e?.message || 'فشل إنشاء النسخة.');
        } finally {
            setIsProcessing(false);
        }
    };

    const handleRestoreBackupByName = async (name: string) => {
        if (usesEmbeddedLocalRuntime) {
            alert('هذه الميزة متاحة في وضع السيرفر فقط.');
            return;
        }
        if (!(await confirmDialog('سيتم استبدال البيانات الحالية بهذه النسخة. هل أنت متأكد؟'))) return;
        setIsProcessing(true);
        try {
            const res = await apiRequest('backups/restore/from-backup', { method: 'POST', body: JSON.stringify({ name }) });
            if (res?.success) {
                alert('تمت الاستعادة بنجاح ✅');
                window.location.reload();
            } else {
                throw new Error(res?.error || 'فشل الاستعادة');
            }
        } catch (e: any) {
            alert(e?.message || 'فشل الاستعادة');
        } finally {
            setIsProcessing(false);
        }
    };

    const handleRestoreDbFromBackup = async (name: string) => {
        if (usesEmbeddedLocalRuntime) {
            alert('هذه الميزة متاحة في وضع السيرفر فقط.');
            return;
        }
        if (!(await confirmDialog('سيتم استبدال قاعدة البيانات الحالية بهذه النسخة. هل أنت متأكد؟'))) return;
        setIsProcessing(true);
        try {
            const res = await apiRequest('backups/restore/db-from-backup', { method: 'POST', body: JSON.stringify({ name }) });
            if (res?.success) {
                alert(res?.message || 'تمت الاستعادة. الرجاء إعادة تشغيل التطبيق.');
            } else {
                throw new Error(res?.error || 'فشل الاستعادة');
            }
        } catch (e: any) {
            alert(e?.message || 'فشل الاستعادة');
        } finally {
            setIsProcessing(false);
        }
    };

    const handleRestoreBackup = async (file: File) => {
        setIsProcessing(true);
        try {
            if (file.name.toLowerCase().endsWith('.db') || file.name.toLowerCase().endsWith('.dump')) {
                if (usesEmbeddedLocalRuntime) {
                    alert('استعادة DB المباشرة غير مدعومة في هذا الوضع حالياً.');
                    return;
                }
                if (!(await confirmDialog(isPostgresRuntime ? 'سيتم رفع ملف PostgreSQL dump واستبدال قاعدة البيانات الحالية بالكامل. هل أنت متأكد؟' : 'سيتم رفع ملف قاعدة البيانات واستبدال القاعدة الحالية بالكامل. هل أنت متأكد؟'))) return;
                const bytes = new Uint8Array(await file.arrayBuffer());
                let binary = '';
                const chunkSize = 0x8000;
                for (let i = 0; i < bytes.length; i += chunkSize) {
                    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
                }
                const base64 = btoa(binary);
                const uploadRes = await apiRequest('backups/restore/db-upload', {
                    method: 'POST',
                    body: JSON.stringify({ name: file.name, base64 }),
                });
                if (!uploadRes?.success || !uploadRes?.name) {
                    throw new Error(uploadRes?.error || 'فشل رفع نسخة DB.');
                }
                const restoreRes = await apiRequest('backups/restore/db-from-backup', {
                    method: 'POST',
                    body: JSON.stringify({ name: uploadRes.name }),
                });
                if (restoreRes?.success) {
                    alert(restoreRes?.message || 'تمت استعادة قاعدة البيانات. يرجى إعادة تشغيل التطبيق.');
                } else {
                    throw new Error(restoreRes?.error || 'فشل استعادة DB.');
                }
                return;
            }
            const text = await file.text();
            const json = JSON.parse(text);

            if (usesEmbeddedLocalRuntime) {
                if (!(await confirmDialog('سيتم مسح كافة البيانات الحالية واستبدالها بالنسخة المرفوعة. هل أنت متأكد؟'))) return;
                
                const orgId = getCurrentOrgId();
                const payload = json.data || json;
                Object.entries(payload).forEach(([key, val]) => {
                    localStorage.setItem(`shamel_org_${orgId}_${key.replace(/-/g, '')}`, JSON.stringify(val));
                });
                alert("تمت استعادة البيانات المحلية بنجاح! سيتم إعادة تشغيل الواجهة.");
                window.location.reload();
            } else {
                // استعادة للسيرفر
                const res = await apiRequest('backups/restore/json', { method: 'POST', body: JSON.stringify({ data: json.data || json, replaceExisting: true }) });
                if (res.success) {
                    alert("تمت استعادة بيانات السيرفر بنجاح ✅");
                    window.location.reload();
                }
            }
        } catch (e: any) {
            alert("فشل في قراءة أو معالجة ملف النسخة: " + e.message);
        } finally {
            setIsProcessing(false);
            setIsRestoreModalOpen(false);
        }
    };

    const handleCleanTestingReset = async (confirmationText: string) => {
        if (usesEmbeddedLocalRuntime) {
            throw new Error('Clean testing reset is available only in server mode.');
        }
        if (String(confirmationText || '').trim() !== TESTING_RESET_CONFIRMATION_PHRASE) {
            throw new Error('Invalid confirmation phrase.');
        }
        setIsProcessing(true);
        try {
            const res = await apiRequest('system/reset', {
                method: 'POST',
                body: JSON.stringify({ confirmationText }),
            });
            if (!res?.success) throw new Error(res?.error || 'Clean testing reset failed.');
            return res;
        } finally {
            setIsProcessing(false);
        }
    };

    return {
        state: { isProcessing, isRestoreModalOpen, backups, isLoadingBackups },
        setters: { setIsRestoreModalOpen, setBackups },
        actions: {
            handleCreateBackup,
            handleRestoreBackup,
            loadBackups,
            handleCreateStoredBackup,
            handleRestoreBackupByName,
            handleRestoreDbFromBackup,
            handleCleanTestingReset,
        }
    };
};
