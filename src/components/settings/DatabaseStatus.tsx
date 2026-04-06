﻿﻿﻿import React, { useState, useEffect } from 'react';
import { Database, AlertCircle, CheckCircle, XCircle } from 'lucide-react';
import { apiRequest } from '../../lib/api';

interface DatabaseStatus {
  status: 'connected' | 'error';
  dbPath: string;
  testQuery: boolean;
  timestamp: string;
  error?: string;
}

export function DatabaseStatus() {
  const [status, setStatus] = useState<DatabaseStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkDatabaseStatus();
  }, []);

  const checkDatabaseStatus = async () => {
    try {
      const data = await apiRequest('system/db-status');
      setStatus(data);
    } catch (error) {
      setStatus({
        status: 'error',
        dbPath: 'unknown',
        testQuery: false,
        timestamp: new Date().toISOString(),
        error: 'فشل الاتصال بالخادم'
      });
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = () => {
    if (loading) return <Database className="w-5 h-5 animate-pulse" />;
    if (!status) return <AlertCircle className="w-5 h-5 text-yellow-500" />;
    if (status.status === 'connected') return <CheckCircle className="w-5 h-5 text-green-500" />;
    return <XCircle className="w-5 h-5 text-red-500" />;
  };

  const getStatusText = () => {
    if (loading) return 'جاري التحقق...';
    if (!status) return 'غير متاح';
    if (status.status === 'connected') return 'متصل';
    return 'غير متصل';
  };

  const getStatusColor = () => {
    if (loading) return 'text-gray-500';
    if (!status) return 'text-yellow-600';
    if (status.status === 'connected') return 'text-green-600';
    return 'text-red-600';
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">حالة قاعدة البيانات</h3>
        <button
          onClick={checkDatabaseStatus}
          disabled={loading}
          className="px-3 py-1 text-sm bg-blue-50 text-blue-600 rounded-md hover:bg-blue-100 disabled:opacity-50"
        >
          تحديث
        </button>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-3">
          {getStatusIcon()}
          <span className={`font-medium ${getStatusColor()}`}>
            {getStatusText()}
          </span>
        </div>

        {status && (
          <>
            <div className="border-t pt-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">مسار قاعدة البيانات:</span>
                <span className="text-gray-900 font-mono text-xs">
                  {status.dbPath}
                </span>
              </div>
              
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">اختبار الاستعلام:</span>
                <span className={status.testQuery ? 'text-green-600' : 'text-red-600'}>
                  {status.testQuery ? 'ناجح' : 'فشل'}
                </span>
              </div>
              
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">آخر تحديث:</span>
                <span className="text-gray-900">
                  {new Date(status.timestamp).toLocaleString('ar-IQ')}
                </span>
              </div>
            </div>

            {status.error && (
              <div className="border-t pt-4">
                <div className="bg-red-50 border border-red-200 rounded-md p-3">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-red-500" />
                    <span className="text-sm font-medium text-red-800">خطأ:</span>
                  </div>
                  <p className="text-sm text-red-700 mt-1">{status.error}</p>
                </div>
              </div>
            )}
          </>
        )}

        <div className="border-t pt-4">
          <p className="text-xs text-gray-500">
            في حال وجود مشاكل في قاعدة البيانات، تأكد من أن التطبيق لديه صلاحيات الكتابة في مجلد البيانات.
          </p>
        </div>
      </div>
    </div>
  );
}
