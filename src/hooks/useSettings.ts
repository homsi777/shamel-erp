import { useState } from 'react';
import { AppSettings, RegisteredDevice, DEFAULT_LABELS, LabelSettings, PrintProfile, DEFAULT_CURRENCY_RATES, DEFAULT_PRINT_SETTINGS, CurrencyRates } from '../types';
import { apiRequest } from '../lib/api';
import { confirmDialog } from '../lib/confirm';
import { normalizeDeploymentConfigInput, persistRuntimeDeploymentConfig } from '../lib/deployment';
import { normalizeProjectProfile, resolveProjectProfile } from '../lib/projectProfiles';

const normalizeCurrencyCode = (value: unknown, fallback = 'USD') => {
    const normalized = String(value || fallback).trim().toUpperCase();
    return /^[A-Z]{3}$/.test(normalized) ? normalized : fallback;
};

const normalizeCurrencyRates = (value: unknown): CurrencyRates => {
    const next: Record<string, number> = { USD: 1 };
    if (!value || typeof value !== 'object') return { ...DEFAULT_CURRENCY_RATES, ...next };
    for (const [rawCode, rawRate] of Object.entries(value as Record<string, unknown>)) {
        const code = normalizeCurrencyCode(rawCode, '');
        const rate = Number(rawRate);
        if (!code || !Number.isFinite(rate) || rate <= 0) continue;
        next[code] = rate;
    }
    return { ...DEFAULT_CURRENCY_RATES, ...next };
};

export const useSettings = (initialSettings: AppSettings, setGlobalSettings: (s: AppSettings) => void) => {
    const [localSettings, setLocalSettings] = useState<AppSettings>(initialSettings);
    const [activeTab, setActiveTab] = useState('company');
    const [isSaving, setIsSaving] = useState(false);

    const updateCompany = (field: string, value: string) => {
        setLocalSettings(prev => ({ ...prev, company: { ...prev.company, [field]: value } }));
    };

    const updateTheme = (field: string, value: string) => {
        setLocalSettings(prev => ({ ...prev, theme: { ...prev.theme, [field]: value } }));
    };

    const updateCurrencyRate = (currency: string, value: number) => {
        const code = normalizeCurrencyCode(currency, '');
        if (!code) return;
        setLocalSettings(prev => ({
            ...prev,
            currencyRates: {
                ...normalizeCurrencyRates(prev.currencyRates || DEFAULT_CURRENCY_RATES),
                [code]: value
            }
        }));
    };

    const updatePrintProfile = (profileId: string, field: keyof PrintProfile, value: any) => {
        const key = profileId as keyof NonNullable<AppSettings['print']>['profiles'];
        if (!localSettings.print) return;

        setLocalSettings(prev => {
            if (!prev.print) return prev;
            return {
                ...prev,
                print: {
                    ...prev.print,
                    profiles: {
                        ...prev.print.profiles,
                        [key]: { ...prev.print.profiles[key], [field]: value }
                    }
                }
            };
        });
    };

    const updatePrintField = (field: string, value: any) => {
        setLocalSettings(prev => ({
            ...prev,
            print: {
                ...(prev.print || DEFAULT_PRINT_SETTINGS),
                ...prev.print,
                [field]: value
            }
        }));
    };

    const updateLabel = (group: keyof LabelSettings, key: string, value: string) => {
        setLocalSettings(prev => ({
            ...prev,
            labels: { ...(prev.labels || DEFAULT_LABELS), [group]: { ...(prev.labels?.[group] || DEFAULT_LABELS[group]), [key]: value } }
        }));
    };

    const handleAddDevice = (device: RegisteredDevice) => {
        setLocalSettings(prev => ({ ...prev, registeredDevices: [...(prev.registeredDevices || []), { ...device, id: Date.now().toString() }] }));
    };

    const handleDeleteDevice = async (id: string) => {
        if (await confirmDialog('هل أنت متأكد من حذف هذا الجهاز؟')) {
            setLocalSettings(prev => ({ ...prev, registeredDevices: (prev.registeredDevices || []).filter(d => d.id !== id) }));
        }
    };

    const handleSaveSettings = async () => {
        setIsSaving(true);
        const safeDefaultCurrency = normalizeCurrencyCode(localSettings.defaultCurrency, 'USD');
        const safeCurrencyRates = normalizeCurrencyRates(localSettings.currencyRates || DEFAULT_CURRENCY_RATES);
        const safeDeployment = normalizeDeploymentConfigInput(localSettings.deployment || {});
        if (!safeCurrencyRates[safeDefaultCurrency]) safeCurrencyRates[safeDefaultCurrency] = 1;
        const nextSettings: AppSettings = {
            ...localSettings,
            defaultCurrency: safeDefaultCurrency,
            currencyRates: safeCurrencyRates,
            deployment: safeDeployment,
            projectProfile: normalizeProjectProfile(localSettings.projectProfile || resolveProjectProfile(localSettings)),
            itemSettings: {
                enableServiceItems: true,
                enableBarcodePerUnit: true,
                enableMultiUnitPricing: true,
                autoSyncAlternateCurrencyPrices: false,
                preferredPriceReferenceCurrency: 'USD',
                allowManualLockOfAlternatePrice: true,
                enableTextileMode: false,
                textileRequireWarehousePreparationForSales: true,
                ...(localSettings.itemSettings || {}),
            },
        };

        setGlobalSettings(nextSettings);
        document.documentElement.style.setProperty('--color-primary', nextSettings.theme.primaryColor || '#0f766e');
        document.documentElement.style.setProperty('--color-secondary', nextSettings.theme.secondaryColor || '#f59e0b');
        document.documentElement.style.setProperty('--color-background', nextSettings.theme.backgroundColor || '#f3f4f6');
        document.documentElement.style.setProperty('--color-text', nextSettings.theme.textColor || '#111827');
        document.documentElement.style.setProperty('--color-input-bg', nextSettings.theme.inputBgColor || '#ffffff');
        document.documentElement.style.setProperty('--color-sidebar-bg', nextSettings.theme.sidebarBgColor || '#ffffff');

        try {
            const safeCompany = {
                name: nextSettings.company?.name || '',
                address: nextSettings.company?.address || '',
                email: nextSettings.company?.email || '',
                phone1: nextSettings.company?.phone1 || '',
                phone2: nextSettings.company?.phone2 || '',
                logo: nextSettings.company?.logo || ''
            };
            const safeTheme = {
                primaryColor: nextSettings.theme?.primaryColor || '#0f766e',
                secondaryColor: nextSettings.theme?.secondaryColor || '#f59e0b',
                backgroundColor: nextSettings.theme?.backgroundColor || '#f3f4f6',
                textColor: nextSettings.theme?.textColor || '#111827',
                inputBgColor: nextSettings.theme?.inputBgColor || '#ffffff',
                sidebarBgColor: nextSettings.theme?.sidebarBgColor || '#ffffff'
            };
            const safePrint = nextSettings.print || DEFAULT_PRINT_SETTINGS;
            const safeLowStock = Number(nextSettings.lowStockThreshold ?? 5);
            const safeDevices = Array.isArray(nextSettings.registeredDevices) ? nextSettings.registeredDevices : [];
            const safeLabels = nextSettings.labels || DEFAULT_LABELS;
            const safeItemSettings = {
                enableServiceItems: true,
                enableBarcodePerUnit: true,
                enableMultiUnitPricing: true,
                autoSyncAlternateCurrencyPrices: false,
                preferredPriceReferenceCurrency: 'USD',
                allowManualLockOfAlternatePrice: true,
                enableTextileMode: false,
                textileRequireWarehousePreparationForSales: true,
                ...(nextSettings.itemSettings || {}),
            };

            await persistRuntimeDeploymentConfig(safeDeployment);

            await Promise.all([
                apiRequest('settings', { method: 'POST', body: JSON.stringify({ key: 'company', value: safeCompany }) }),
                apiRequest('settings', { method: 'POST', body: JSON.stringify({ key: 'theme', value: safeTheme }) }),
                apiRequest('settings', { method: 'POST', body: JSON.stringify({ key: 'print', value: safePrint }) }),
                apiRequest('settings', { method: 'POST', body: JSON.stringify({ key: 'lowStockThreshold', value: safeLowStock }) }),
                apiRequest('settings', { method: 'POST', body: JSON.stringify({ key: 'registeredDevices', value: safeDevices }) }),
                apiRequest('settings', { method: 'POST', body: JSON.stringify({ key: 'labels', value: safeLabels }) }),
                apiRequest('settings', { method: 'POST', body: JSON.stringify({ key: 'currencyRates', value: safeCurrencyRates }) }),
                apiRequest('settings', { method: 'POST', body: JSON.stringify({ key: 'defaultCurrency', value: safeDefaultCurrency }) }),
                apiRequest('settings', { method: 'POST', body: JSON.stringify({ key: 'primaryCurrency', value: safeDefaultCurrency }) }),
                apiRequest('settings', { method: 'POST', body: JSON.stringify({ key: 'projectProfile', value: nextSettings.projectProfile }) }),
                apiRequest('settings', { method: 'POST', body: JSON.stringify({ key: 'itemSettings', value: safeItemSettings }) }),
            ]);

            const restartHint =
                safeDeployment.mode !== 'standalone' || safeDeployment.role !== 'standalone'
                    ? '\nقد يلزم إعادة تشغيل التطبيق إذا تم تغيير دور هذا الجهاز.'
                    : '';
            alert(`تم حفظ الإعدادات بنجاح.${restartHint}`);
        } catch (e) {
            alert('فشل الحفظ في السيرفر.');
        } finally {
            setIsSaving(false);
        }
    };

    const updateDefaultCurrency = (currency: string) => {
        const normalizedCurrency = normalizeCurrencyCode(currency, 'USD');
        setLocalSettings(prev => ({
            ...prev,
            defaultCurrency: normalizedCurrency,
            currencyRates: {
                ...normalizeCurrencyRates(prev.currencyRates || DEFAULT_CURRENCY_RATES),
                [normalizedCurrency]: (prev.currencyRates || DEFAULT_CURRENCY_RATES)?.[normalizedCurrency] || 1,
            }
        }));
    };

    return {
        state: { localSettings, activeTab, isSaving },
        setters: { setActiveTab, setLocalSettings },
        actions: { updateCompany, updateTheme, updateCurrencyRate, updateDefaultCurrency, updatePrintProfile, updatePrintField, updateLabel, handleAddDevice, handleDeleteDevice, handleSaveSettings }
    };
};
