
import React, { useState, useEffect, useMemo } from 'react';
import { 
  UserRound, Plus, Wallet, History, ArrowDownCircle, 
  ArrowUpCircle, Banknote, UserPlus, RefreshCw, 
  Search, CheckCircle2, XCircle, Info, Trash2, Edit2,
  Camera, Upload, MapPin, Phone, Briefcase, GraduationCap, 
  Image as ImageIcon, MoreVertical, X, Save, Calendar, Globe, CreditCard, Fingerprint
} from 'lucide-react';
import { Employee, SalaryTransaction, CashBox, formatNumber, formatDate, ExperienceRecord, SalaryFrequency, BiometricDevice, AttendanceRecord } from '../types';
import { apiRequest } from '../lib/api';
import { confirmDialog } from '../lib/confirm';
import { SmartLink } from '../components/smart';

const Payroll: React.FC<{ cashBoxes: CashBox[], refreshData: () => Promise<void>, setActiveTab?: (tab: string) => void }> = ({ cashBoxes, refreshData, setActiveTab }) => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [transactions, setTransactions] = useState<SalaryTransaction[]>([]);
  const [activeView, setActiveView] = useState<'employees' | 'attendance' | 'payroll'>('employees');
  const [isEmployeeModalOpen, setIsEmployeeModalOpen] = useState(false);
  const [isDeviceModalOpen, setIsDeviceModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [formTab, setFormTab] = useState<'general' | 'financial' | 'experience'>('general');
  const [devices, setDevices] = useState<BiometricDevice[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [deviceForm, setDeviceForm] = useState<Partial<BiometricDevice>>({
    name: '',
    ip: '192.168.1.201',
    port: 4370,
    location: '',
    notes: '',
    isActive: true
  });
  const [attendanceFilters, setAttendanceFilters] = useState({
    from: '',
    to: '',
    employeeId: '',
    position: '',
    deviceId: '',
    eventType: '',
    shiftStart: '08:00',
    shiftEnd: '16:00'
  });
  const [activeDeviceAction, setActiveDeviceAction] = useState<{ id: string; action: 'test' | 'sync' } | null>(null);
  const [paymentMode, setPaymentMode] = useState<'general' | 'salary_delivery'>('general');
  const [deductAdvance, setDeductAdvance] = useState(false);
  const [advanceToDeduct, setAdvanceToDeduct] = useState(0);

  const [employeeForm, setEmployeeForm] = useState<Partial<Employee>>({
    name: '', phone: '', email: '', idNumber: '', birthDate: '', address: '', maritalStatus: 'أعزب',
    biometricId: '', position: '', baseSalary: 0, currency: 'USD', salaryFrequency: 'monthly',
    education: '', courses: '', notes: '', imageUrl: '', idFrontUrl: '', idBackUrl: ''
  });

  const [expRows, setExpRows] = useState<ExperienceRecord[]>([{ position: '', company: '', duration: '', responsibilities: '' }]);

  const [paymentForm, setPaymentForm] = useState({ 
    employeeId: '', amount: '', type: 'full_salary' as 'full_salary' | 'advance' | 'bonus' | 'deduction', 
    cashBoxId: cashBoxes[0]?.id || '', notes: '', date: new Date().toISOString().split('T')[0],
    period: ''
  });

  const loadData = async () => {
    try {
      const [emp, trans] = await Promise.all([
        apiRequest('employees'),
        apiRequest('payroll/transactions')
      ]);
      setEmployees(emp);
      setTransactions(trans);
    } catch (e) { console.error("HR load error", e); }
  };

  const loadBiometricData = async () => {
    try {
      const [devs, logs] = await Promise.all([
        apiRequest('biometric-devices'),
        apiRequest('biometric/attendance')
      ]);
      setDevices(devs || []);
      setAttendanceRecords(logs || []);
    } catch (e) { console.error("Biometric load error", e); }
  };

  useEffect(() => { loadData(); }, []);
  useEffect(() => { loadBiometricData(); }, []);

  const handleImageUpload = (field: 'imageUrl' | 'idFrontUrl' | 'idBackUrl') => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = (e: any) => {
          const file = e.target.files[0];
          if (file) {
              const reader = new FileReader();
              reader.onloadend = () => {
                  setEmployeeForm(prev => ({ ...prev, [field]: reader.result as string }));
              };
              reader.readAsDataURL(file);
          }
      };
      input.click();
  };

  
  const handleOpenEmployee = (emp?: Employee) => {
    if (emp) {
      setEditingEmployee(emp);
      setEmployeeForm({
        name: emp.name || '',
        phone: emp.phone || '',
        email: emp.email || '',
        idNumber: emp.idNumber || '',
        birthDate: emp.birthDate || '',
        address: emp.address || '',
        maritalStatus: (emp.maritalStatus as any) === 'single'
          ? 'أعزب'
          : (emp.maritalStatus as any) === 'married'
          ? 'متزوج'
          : (emp.maritalStatus as any) || 'أعزب',
        biometricId: (emp as any).biometricId || '',
        position: emp.position || '',
        baseSalary: emp.baseSalary || 0,
        currency: emp.currency || 'USD',
        salaryFrequency: (emp.salaryFrequency as any) || 'monthly',
        education: emp.education || '',
        courses: emp.courses || '',
        notes: emp.notes || '',
        imageUrl: emp.imageUrl || '',
        idFrontUrl: emp.idFrontUrl || '',
        idBackUrl: emp.idBackUrl || ''
      });
      try {
        const exp = emp.experience ? JSON.parse(emp.experience as any) : [];
        setExpRows(Array.isArray(exp) && exp.length ? exp : [{ position: '', company: '', duration: '', responsibilities: '' }]);
      } catch {
        setExpRows([{ position: '', company: '', duration: '', responsibilities: '' }]);
      }
    } else {
      setEditingEmployee(null);
      setEmployeeForm({ name: '', phone: '', email: '', idNumber: '', birthDate: '', address: '', maritalStatus: 'أعزب', biometricId: '', position: '', baseSalary: 0, currency: 'USD', salaryFrequency: 'monthly', education: '', courses: '', notes: '', imageUrl: '', idFrontUrl: '', idBackUrl: '' });
      setExpRows([{ position: '', company: '', duration: '', responsibilities: '' }]);
    }
    setFormTab('general');
    setIsEmployeeModalOpen(true);
  };

  const handleAddExpRow = () => setExpRows([...expRows, { position: '', company: '', duration: '', responsibilities: '' }]);
  const updateExpRow = (idx: number, field: keyof ExperienceRecord, val: string) => {
      const newRows = [...expRows];
      newRows[idx][field] = val;
      setExpRows(newRows);
  };

  const handleCreateEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    const payload = {
      ...(employeeForm as any),
      id: editingEmployee ? editingEmployee.id : `emp-${Date.now()}`,
      experience: JSON.stringify(expRows),
      status: editingEmployee?.status || 'active',
      joinDate: editingEmployee?.joinDate || new Date().toISOString()
    };
    try {
      if (editingEmployee) {
        await apiRequest(`employees/${editingEmployee.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await apiRequest('employees', { method: 'POST', body: JSON.stringify(payload) });
      }
      await loadData();
      setIsEmployeeModalOpen(false);
      setEditingEmployee(null);
      setEmployeeForm({ name: '', phone: '', email: '', idNumber: '', birthDate: '', address: '', maritalStatus: 'أعزب', biometricId: '', position: '', baseSalary: 0, currency: 'USD', salaryFrequency: 'monthly', education: '', courses: '', notes: '', imageUrl: '', idFrontUrl: '', idBackUrl: '' });
      setExpRows([{ position: '', company: '', duration: '', responsibilities: '' }]);
      alert("تمت إضافة الموظف بنجاح ✅");
    } catch (e) { alert("فشل إضافة الموظف"); }
    finally { setIsSubmitting(false); }
  };

  
  const handleDeleteEmployee = async (emp: Employee) => {
    if (!(await confirmDialog('هل أنت متأكد من حذف هذا الموظف؟'))) return;
    try {
      await apiRequest(`employees/${emp.id}`, { method: 'DELETE' });
      await loadData();
    } catch (e: any) {
      alert(e.message || 'فشل حذف الموظف.');
    }
  };

  const handleProcessPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentForm.employeeId || !paymentForm.amount || !paymentForm.date) return;
    
    setIsSubmitting(true);
    try {
      const emp = employees.find(x => x.id === paymentForm.employeeId);
      if (paymentMode === 'salary_delivery') {
        const baseSalary = Number(emp?.baseSalary || 0);
        const outstanding = Math.max(0, Number(advanceMap.get(paymentForm.employeeId) || 0));
        const deductAmount = deductAdvance ? Math.min(outstanding, Number(advanceToDeduct || 0), baseSalary) : 0;
        const netPay = Math.max(0, baseSalary - deductAmount);

        if (netPay > 0 && !paymentForm.cashBoxId) {
          alert('يرجى اختيار الصندوق للصرف.');
          setIsSubmitting(false);
          return;
        }

        if (deductAmount > 0) {
          await apiRequest('payroll/process', {
            method: 'POST',
            body: JSON.stringify({
              employeeId: paymentForm.employeeId,
              employeeName: emp?.name,
              amount: deductAmount,
              currency: emp?.currency || 'USD',
              type: 'deduction',
              period: paymentForm.period,
              date: paymentForm.date,
              notes: `خصم سلفة من الراتب (${deductAmount})`,
              affectCashBox: false
            })
          });
        }

        if (netPay > 0) {
          await apiRequest('payroll/process', {
            method: 'POST',
            body: JSON.stringify({
              ...paymentForm,
              amount: netPay,
              currency: emp?.currency || 'USD',
              type: 'full_salary',
              notes: deductAmount > 0 ? `تم خصم سلفة بقيمة ${deductAmount}` : paymentForm.notes
            })
          });
        }
      } else {
        if (!paymentForm.cashBoxId) {
          alert('يرجى اختيار الصندوق للصرف.');
          setIsSubmitting(false);
          return;
        }
        await apiRequest('payroll/process', { 
          method: 'POST', 
          body: JSON.stringify({ 
            ...paymentForm, 
            amount: Number(paymentForm.amount),
            currency: emp?.currency || 'USD'
          }) 
        });
      }
      await loadData();
      await refreshData();
      setIsPaymentModalOpen(false);
      setPaymentForm({ employeeId: '', amount: '', type: 'full_salary', cashBoxId: cashBoxes[0]?.id || '', notes: '', date: new Date().toISOString().split('T')[0], period: '' });
      setPaymentMode('general');
      setDeductAdvance(false);
      setAdvanceToDeduct(0);
      alert("تم صرف المستحق بنجاح ✅");
    } catch (e: any) { alert(e.response?.data?.error || "فشلت العملية"); }
    finally { setIsSubmitting(false); }
  };

  const openSalaryDelivery = (emp: Employee) => {
    const outstanding = Math.max(0, Number(advanceMap.get(emp.id) || 0));
    setPaymentMode('salary_delivery');
    setDeductAdvance(outstanding > 0);
    setAdvanceToDeduct(Math.min(outstanding, Number(emp.baseSalary || 0)));
    setPaymentForm({
      employeeId: emp.id,
      amount: String(emp.baseSalary || 0),
      type: 'full_salary',
      cashBoxId: cashBoxes[0]?.id || '',
      notes: '',
      date: new Date().toISOString().split('T')[0],
      period: ''
    });
    setIsPaymentModalOpen(true);
  };

  const handleAddDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deviceForm.name || !deviceForm.ip) {
      alert('الرجاء إدخال اسم الجهاز وعنوان IP.');
      return;
    }
    const payload = {
      ...deviceForm,
      port: Number(deviceForm.port || 4370),
      isActive: deviceForm.isActive ?? true
    };
    try {
      await apiRequest('biometric-devices', { method: 'POST', body: JSON.stringify(payload) });
      setDeviceForm({ name: '', ip: '192.168.1.201', port: 4370, location: '', notes: '', isActive: true });
      await loadBiometricData();
      alert('تمت إضافة جهاز البصمة.');
    } catch (e: any) {
      alert(e?.message || 'فشل إضافة الجهاز.');
    }
  };

  const handleTestDevice = async (device: BiometricDevice) => {
    setActiveDeviceAction({ id: device.id, action: 'test' });
    try {
      const result = await apiRequest('biometric/test-connection', { method: 'POST', body: JSON.stringify(device) });
      alert(result?.message || 'تم التنفيذ.');
    } catch (e: any) {
      alert(e?.message || 'فشل اختبار الاتصال.');
    } finally {
      setActiveDeviceAction(null);
    }
  };

  const handleSyncDevice = async (device: BiometricDevice) => {
    setActiveDeviceAction({ id: device.id, action: 'sync' });
    try {
      const result = await apiRequest('biometric/sync', { method: 'POST', body: JSON.stringify({ deviceId: device.id }) });
      alert(result?.message || 'تمت المزامنة.');
      await loadBiometricData();
    } catch (e: any) {
      alert(e?.message || 'فشل المزامنة.');
    } finally {
      setActiveDeviceAction(null);
    }
  };

  const handleSyncAllDevices = async () => {
    if (devices.length === 0) return;
    let inserted = 0;
    let skipped = 0;
    for (const device of devices) {
      try {
        const result = await apiRequest('biometric/sync', { method: 'POST', body: JSON.stringify({ deviceId: device.id }) });
        inserted += Number(result?.inserted || 0);
        skipped += Number(result?.skipped || 0);
      } catch {}
    }
    await loadBiometricData();
    alert(`تمت مزامنة كل الأجهزة. جديد: ${inserted}، مكرر: ${skipped}.`);
  };

  const handleDeleteDevice = async (device: BiometricDevice) => {
    if (!(await confirmDialog('هل أنت متأكد من حذف هذا الجهاز؟'))) return;
    try {
      await apiRequest(`biometric-devices/${device.id}`, { method: 'DELETE' });
      await loadBiometricData();
    } catch (e: any) {
      alert(e?.message || 'فشل حذف الجهاز.');
    }
  };

  const filteredEmployees = employees.filter(e => e.name.toLowerCase().includes(searchTerm.toLowerCase()));

  const advanceMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of transactions) {
      const current = map.get(t.employeeId) || 0;
      if (t.type === 'advance') map.set(t.employeeId, current + Number(t.amount || 0));
      if (t.type === 'deduction') map.set(t.employeeId, current - Number(t.amount || 0));
    }
    return map;
  }, [transactions]);

  const formatTime = (ts: string | undefined) => {
    if (!ts) return '-';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
  };

  const formatDuration = (minutes: number) => {
    if (!minutes || minutes <= 0) return '-';
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    if (h && m) return `${h}س ${m}د`;
    if (h) return `${h}س`;
    return `${m}د`;
  };

  type AttendanceSummary = {
    id: string;
    date: string;
    employeeName: string;
    position: string;
    biometricId: string;
    deviceId?: string;
    deviceIp?: string;
    inTime?: string;
    outTime?: string;
    delay: number;
    overtime: number;
    totalMinutes: number;
  };

  const attendanceSummaries = useMemo<AttendanceSummary[]>(() => {
    const filtered = attendanceRecords.filter((rec) => {
      const recTs = new Date(rec.timestamp).getTime();
      if (attendanceFilters.from) {
        const fromTs = new Date(attendanceFilters.from + ' 00:00:00').getTime();
        if (!isNaN(fromTs) && recTs < fromTs) return false;
      }
      if (attendanceFilters.to) {
        const toTs = new Date(attendanceFilters.to + ' 23:59:59').getTime();
        if (!isNaN(toTs) && recTs > toTs) return false;
      }
      if (attendanceFilters.employeeId && rec.employeeId !== attendanceFilters.employeeId) return false;
      if (attendanceFilters.deviceId && rec.deviceId !== attendanceFilters.deviceId) return false;
      if (attendanceFilters.eventType && String(rec.eventType || '') !== attendanceFilters.eventType) return false;
      if (attendanceFilters.position) {
        const emp = employees.find(e => e.id === rec.employeeId);
        if (!emp || !String(emp.position || '').includes(attendanceFilters.position)) return false;
      }
      return true;
    });

    const shiftStart = attendanceFilters.shiftStart || '08:00';
    const shiftEnd = attendanceFilters.shiftEnd || '16:00';

    const toMinutes = (timeStr: string) => {
      const [h, m] = timeStr.split(':').map(x => parseInt(x, 10));
      if (Number.isNaN(h) || Number.isNaN(m)) return 0;
      return h * 60 + m;
    };

    const groups = new Map<string, AttendanceRecord[]>();
    for (const rec of filtered) {
      const dateKey = new Date(rec.timestamp).toISOString().slice(0, 10);
      const key = `${rec.employeeId || rec.biometricId || 'unknown'}-${dateKey}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(rec);
    }

    const summaries: AttendanceSummary[] = [];
    for (const [key, records] of groups) {
      records.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      const first = records[0];
      const last = records[records.length - 1];
      const inTime = first?.timestamp;
      const outTime = records.length > 1 ? last?.timestamp : undefined;
      const inMin = inTime ? new Date(inTime).getHours() * 60 + new Date(inTime).getMinutes() : 0;
      const outMin = outTime ? new Date(outTime).getHours() * 60 + new Date(outTime).getMinutes() : 0;
      const shiftStartMin = toMinutes(shiftStart);
      const shiftEndMin = toMinutes(shiftEnd);
      const delay = inTime ? Math.max(0, inMin - shiftStartMin) : 0;
      const overtime = outTime ? Math.max(0, outMin - shiftEndMin) : 0;
      const totalMinutes = outTime && inTime ? Math.max(0, (new Date(outTime).getTime() - new Date(inTime).getTime()) / 60000) : 0;

      const emp = employees.find(e => e.id === first.employeeId);
      summaries.push({
        id: key,
        date: new Date(first.timestamp).toISOString().slice(0, 10),
        employeeName: emp?.name || first.employeeName || 'غير مرتبط',
        position: emp?.position || '-',
        biometricId: first.biometricId || emp?.biometricId || '-',
        deviceId: first.deviceId,
        deviceIp: first.deviceIp,
        inTime,
        outTime,
        delay,
        overtime,
        totalMinutes
      });
    }

    return summaries.sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [attendanceRecords, attendanceFilters, employees]);

  return (
    <div className="p-4 space-y-4 animate-fadeIn bg-gray-50/50 min-h-screen">
      
      {/* Header Strategy */}
      <div className="flex flex-col md:flex-row justify-between items-center gap-3 bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
        <div className="flex items-center gap-4">
            <div className="bg-rose-50 p-3 rounded-2xl text-rose-500 shadow-inner">
                <UserRound size={32}/>
            </div>
            <div>
                <h2 className="text-2xl font-black text-gray-900 tracking-tight">نظام إدارة الموارد البشرية</h2>
                <p className="text-xs text-gray-400 font-bold uppercase mt-1">HR, Payroll & Employee Assets</p>
            </div>
        </div>
        
        <div className="flex bg-gray-100 p-1 rounded-xl border border-gray-200">
            <button onClick={() => setActiveView('employees')} className={`px-6 py-2 rounded-lg text-xs font-bold transition-all ${activeView === 'employees' ? 'bg-white shadow-md text-rose-600' : 'text-gray-500'}`}>بطاقات الموظفين</button>
            <button onClick={() => setActiveView('attendance')} className={`px-6 py-2 rounded-lg text-xs font-bold transition-all ${activeView === 'attendance' ? 'bg-white shadow-md text-rose-600' : 'text-gray-500'}`}>الحضور</button>
            <button onClick={() => setActiveView('payroll')} className={`px-6 py-2 rounded-lg text-xs font-bold transition-all ${activeView === 'payroll' ? 'bg-white shadow-md text-rose-600' : 'text-gray-500'}`}>رواتب وسلف</button>
        </div>

        <div className="flex gap-2">
            <button onClick={() => setIsDeviceModalOpen(true)} className="bg-white text-gray-800 border border-gray-200 px-6 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-rose-50 transition shadow-sm active:scale-95">
                <Fingerprint size={18}/> إضافة جهاز جديد
            </button>
            {activeView === 'employees' && (
                <button onClick={() => handleOpenEmployee()} className="bg-white text-gray-800 border border-gray-200 px-6 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-rose-50 transition shadow-sm active:scale-95">
                    <UserPlus size={18}/> موظف جديد
                </button>
            )}
            {activeView === 'payroll' && (
                <button onClick={() => { setPaymentMode('general'); setDeductAdvance(false); setAdvanceToDeduct(0); setIsPaymentModalOpen(true); }} className="bg-rose-600 text-white px-8 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 shadow-lg hover:bg-rose-700 transition active:scale-95">
                  <Banknote size={18}/> صرف مستحق
                </button>
            )}
        </div>
      </div>

      {activeView === 'employees' ? (
          <div className="space-y-4">
              <div className="relative max-w-md">
                  <Search className="absolute right-3 top-3 text-gray-400" size={18}/>
                  <input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="بحث عن موظف بالاسم..." className="w-full pr-10 pl-4 py-2.5 bg-white border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-rose-500/20 font-bold text-sm" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {filteredEmployees.length === 0 ? (
                    <div className="col-span-full py-20 text-center bg-white rounded-3xl border-2 border-dashed border-gray-200">
                        <UserRound size={64} className="mx-auto text-gray-100 mb-4"/>
                        <p className="text-gray-400 font-bold">لا يوجد سجلات موظفين مطابقة</p>
                    </div>
                ) : (
                    filteredEmployees.map(emp => (
                        <div key={emp.id} className="bg-white rounded-[2rem] p-5 shadow-sm border border-gray-100 hover:shadow-xl transition-all group relative overflow-hidden flex flex-col h-full">
                            <div className="flex justify-between items-start mb-4">
                                    <div className="flex items-center gap-2">
                                        <button onClick={() => handleOpenEmployee(emp)} className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition" title="تعديل"><Edit2 size={16}/></button>
                                        <button onClick={() => handleDeleteEmployee(emp)} className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition" title="حذف"><Trash2 size={16}/></button>
                                    </div>
                                <div className="w-16 h-16 rounded-2xl bg-gray-50 border border-gray-100 overflow-hidden flex items-center justify-center shrink-0 shadow-inner">
                                    {emp.imageUrl ? <img src={emp.imageUrl} className="w-full h-full object-cover" /> : <UserRound className="text-gray-200" size={32}/>}
                                </div>
                                <span className={`text-[9px] font-black px-2 py-1 rounded-full uppercase tracking-tighter ${emp.status === 'active' ? 'bg-green-50 text-green-600' : 'bg-gray-50 text-gray-400'}`}>
                                    {emp.status === 'active' ? 'على رأس العمل' : 'منقطع'}
                                </span>
                            </div>

                            <div className="flex-1">
                                <h3 className="text-lg font-black text-gray-900 mb-1 truncate"><SmartLink type="employee" id={emp.id}>{emp.name}</SmartLink></h3>
                                <div className="flex items-center gap-1.5 text-rose-500 text-[11px] font-bold mb-3">
                                    <Briefcase size={12}/> {emp.position}
                                </div>

                                <div className="space-y-2 border-t pt-3">
                                    <div className="flex justify-between items-center text-[10px]">
                                        <span className="text-gray-400 font-bold uppercase">الراتب ({emp.currency})</span>
                                        <span className="font-black text-rose-700 font-numeric">{formatNumber(emp.baseSalary)}</span>
                                    </div>
                                    <div className="flex justify-between items-center text-[10px]">
                                        <span className="text-gray-400 font-bold uppercase">الدورة</span>
                                        <span className="font-bold text-gray-600">{emp.salaryFrequency === 'monthly' ? 'شهري' : emp.salaryFrequency === 'weekly' ? 'أسبوعي' : 'يومي'}</span>
                                    </div>
                                </div>
                            </div>
                            
                            <button onClick={() => handleOpenEmployee(emp)} className="mt-5 w-full py-2 bg-gray-50 text-gray-500 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-rose-50 hover:text-rose-600 transition">
                                عرض الملف الكامل
                            </button>
                            {setActiveTab && (
                                <button
                                    onClick={() => {
                                        localStorage.setItem('shamel_report_prefill', JSON.stringify({ reportId: 'employee_payroll', entityId: emp.id }));
                                        setActiveTab('reports');
                                    }}
                                    className="mt-2 w-full py-2 bg-white text-rose-600 border border-rose-200 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-rose-50 transition"
                                >
                                    تقرير الموظف
                                </button>
                            )}
                        </div>
                    ))
                )}
              </div>
          </div>
      ) : activeView === 'attendance' ? (
          <div className="space-y-4">
              <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden animate-fadeIn">
                  <div className="p-6 border-b flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
                      <h3 className="font-bold text-gray-800 flex items-center gap-2"><History size={20} className="text-rose-500"/> سجلات الحضور والانصراف</h3>
                      <div className="flex flex-wrap gap-2">
                          <button onClick={handleSyncAllDevices} className="px-4 py-2 rounded-xl text-xs font-black bg-rose-50 text-rose-700 hover:bg-rose-100 transition">مزامنة الحضور</button>
                          <input type="date" value={attendanceFilters.from} onChange={e => setAttendanceFilters(prev => ({ ...prev, from: e.target.value }))} className="border rounded-xl px-3 py-2 text-xs font-bold" />
                          <input type="date" value={attendanceFilters.to} onChange={e => setAttendanceFilters(prev => ({ ...prev, to: e.target.value }))} className="border rounded-xl px-3 py-2 text-xs font-bold" />
                          <select value={attendanceFilters.employeeId} onChange={e => setAttendanceFilters(prev => ({ ...prev, employeeId: e.target.value }))} className="border rounded-xl px-3 py-2 text-xs font-bold bg-white">
                              <option value="">كل الموظفين</option>
                              {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
                          </select>
                          <input value={attendanceFilters.position} onChange={e => setAttendanceFilters(prev => ({ ...prev, position: e.target.value }))} placeholder="مسمى وظيفي" className="border rounded-xl px-3 py-2 text-xs font-bold" />
                          <select value={attendanceFilters.deviceId} onChange={e => setAttendanceFilters(prev => ({ ...prev, deviceId: e.target.value }))} className="border rounded-xl px-3 py-2 text-xs font-bold bg-white">
                              <option value="">كل الأجهزة</option>
                              {devices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                          </select>
                          <input type="time" value={attendanceFilters.shiftStart} onChange={e => setAttendanceFilters(prev => ({ ...prev, shiftStart: e.target.value }))} className="border rounded-xl px-3 py-2 text-xs font-bold" />
                          <input type="time" value={attendanceFilters.shiftEnd} onChange={e => setAttendanceFilters(prev => ({ ...prev, shiftEnd: e.target.value }))} className="border rounded-xl px-3 py-2 text-xs font-bold" />
                          <input value={attendanceFilters.eventType} onChange={e => setAttendanceFilters(prev => ({ ...prev, eventType: e.target.value }))} placeholder="نوع الحركة" className="border rounded-xl px-3 py-2 text-xs font-bold" />
                      </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-right text-xs">
                        <thead className="bg-gray-50 text-gray-500 font-black uppercase tracking-tighter">
                            <tr>
                                <th className="px-6 py-5">الموظف</th>
                                <th className="px-4 py-5 text-center">المسمى</th>
                                <th className="px-4 py-5 text-center">معرف البصمة</th>
                                <th className="px-4 py-5 text-center">التاريخ</th>
                                <th className="px-4 py-5 text-center">وقت الحضور</th>
                                <th className="px-4 py-5 text-center">وقت الانصراف</th>
                                <th className="px-4 py-5 text-center">التأخير</th>
                                <th className="px-4 py-5 text-center">إضافي</th>
                                <th className="px-4 py-5 text-center">إجمالي ساعات</th>
                                <th className="px-4 py-5 text-center">الجهاز</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {attendanceSummaries.length === 0 ? (
                                <tr><td colSpan={10} className="text-center text-gray-400 py-10">لا يوجد سجلات</td></tr>
                            ) : (
                                attendanceSummaries.map(rec => (
                                    <tr key={rec.id} className="hover:bg-rose-50/10 transition-colors">
                                        <td className="px-6 py-4 font-bold text-gray-800">{rec.employeeName}</td>
                                        <td className="px-4 py-4 text-center text-gray-500">{rec.position}</td>
                                        <td className="px-4 py-4 text-center font-mono text-gray-600">{rec.biometricId}</td>
                                        <td className="px-4 py-4 text-center font-numeric text-gray-500">{rec.date}</td>
                                        <td className="px-4 py-4 text-center text-gray-500">{formatTime(rec.inTime)}</td>
                                        <td className="px-4 py-4 text-center text-gray-500">{formatTime(rec.outTime)}</td>
                                        <td className="px-4 py-4 text-center text-amber-600">{formatDuration(rec.delay)}</td>
                                        <td className="px-4 py-4 text-center text-emerald-600">{formatDuration(rec.overtime)}</td>
                                        <td className="px-4 py-4 text-center text-gray-500">{formatDuration(rec.totalMinutes)}</td>
                                        <td className="px-4 py-4 text-center text-gray-500">{devices.find(d => d.id === rec.deviceId)?.name || rec.deviceIp || '-'}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                  </div>
              </div>
          </div>
      ) : (
          <div className="space-y-4">
              <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6">
                  <h3 className="font-bold text-gray-800 flex items-center gap-2 mb-4"><Wallet size={20} className="text-rose-500"/> تسليم الرواتب والسلف</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                      {employees.map(emp => {
                        const outstanding = Math.max(0, Number(advanceMap.get(emp.id) || 0));
                        return (
                          <div key={emp.id} className="border rounded-2xl p-4 flex flex-col gap-3">
                              <div className="flex items-center justify-between">
                                  <div>
                                      <div className="font-black text-gray-800"><SmartLink type="employee" id={emp.id}>{emp.name}</SmartLink></div>
                                      <div className="text-xs text-gray-400">{emp.position}</div>
                                  </div>
                                  <div className="text-right">
                                      <div className="text-xs text-gray-400">الراتب</div>
                                      <div className="font-black text-rose-700">{formatNumber(emp.baseSalary)} {emp.currency}</div>
                                  </div>
                              </div>
                              <div className="flex items-center justify-between text-xs">
                                  <span className="text-gray-400">سلفة معلقة</span>
                                  <span className={`font-black ${outstanding > 0 ? 'text-orange-600' : 'text-gray-400'}`}>{formatNumber(outstanding)} {emp.currency}</span>
                              </div>
                              <button onClick={() => openSalaryDelivery(emp)} className="w-full bg-rose-600 text-white py-2.5 rounded-xl text-sm font-black hover:bg-rose-700 transition">تسليم راتب</button>
                          </div>
                        );
                      })}
                  </div>
              </div>

              <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden animate-fadeIn">
                  <div className="p-6 border-b flex justify-between items-center">
                      <h3 className="font-bold text-gray-800 flex items-center gap-2"><History size={20} className="text-rose-500"/> سجل الحركات المالية للموظفين</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-right text-xs">
                        <thead className="bg-gray-50 text-gray-500 font-black uppercase tracking-tighter">
                            <tr>
                                <th className="px-6 py-5">الموظف</th>
                                <th className="px-4 py-5 text-center">نوع الحركة</th>
                                <th className="px-4 py-5 text-center">القيمة</th>
                                <th className="px-4 py-5 text-center">الفترة</th>
                                <th className="px-4 py-5">الصندوق</th>
                                <th className="px-4 py-5">التاريخ</th>
                                <th className="px-6 py-5">البيان</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {transactions.map(t => (
                                <tr key={t.id} className="hover:bg-rose-50/10 transition-colors group">
                                    <td className="px-6 py-4 font-black text-gray-800 text-sm">
                                      <div className="flex flex-col gap-1">
                                        <SmartLink type="employee" id={t.employeeId}>{t.employeeName}</SmartLink>
                                        {t.journalEntryId ? (
                                          <span className="text-[10px] font-bold bg-green-100 text-green-700 px-2 py-0.5 rounded w-fit">
                                            قيد #{t.journalEntryNumber || t.journalEntryId} — مرحّل
                                          </span>
                                        ) : (
                                          <span className="text-[10px] font-bold bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded w-fit">
                                            بدون قيد محاسبي
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                    <td className="px-4 py-4 text-center">
                                        <span className={`px-3 py-1 rounded-full text-[9px] font-black border uppercase tracking-tighter ${
                                            t.type === 'advance' ? 'bg-orange-50 text-orange-600 border-orange-100' : 
                                            t.type === 'full_salary' ? 'bg-green-50 text-green-600 border-green-100' :
                                            t.type === 'deduction' ? 'bg-red-50 text-red-600 border-red-100' :
                                            'bg-blue-50 text-blue-600 border-blue-100'
                                        }`}>
                                            {t.type === 'advance' ? 'سلفة' : t.type === 'full_salary' ? 'راتب كامل' : t.type === 'deduction' ? 'خصم' : 'مكافأة'}
                                        </span>
                                    </td>
                                    <td className="px-4 py-4 text-center font-black text-rose-600 font-numeric text-lg">{formatNumber(t.amount)} {t.currency}</td>
                                    <td className="px-4 py-4 text-center font-bold text-gray-400">{t.period || '-'}</td>
                                    <td className="px-4 py-4 text-gray-500 font-bold">{t.cashBoxId}</td>
                                    <td className="px-4 py-4 text-gray-400 font-numeric">{formatDate(t.date)}</td>
                                    <td className="px-6 py-4 text-gray-400 italic max-w-xs truncate">{t.notes}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                  </div>
              </div>
          </div>
      )}

      {/* --- ADD EMPLOYEE MODAL (COMPREHENSIVE) --- */}
      {isEmployeeModalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
              <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-4xl overflow-hidden animate-fadeIn border-t-8 border-rose-500 flex flex-col max-h-[95vh]">
                  <div className="p-6 bg-gray-900 text-white flex justify-between items-center relative overflow-hidden">
                      <div className="absolute top-0 right-0 w-32 h-32 bg-rose-500/10 rounded-full -translate-x-10 -translate-y-10"></div>
                      <div className="relative z-10">
                          <h3 className="text-xl font-black flex items-center gap-3"><UserPlus size={24} className="text-rose-400"/> تجهيز ملف موظف جديد</h3>
                          <p className="text-xs text-gray-400 mt-1 uppercase tracking-widest font-bold">HR Management System v3.0</p>
                      </div>
                      <button onClick={() => setIsEmployeeModalOpen(false)} className="p-2 hover:bg-rose-500 rounded-full transition relative z-10"><X size={24}/></button>
                  </div>

                  {/* Tabs within Form */}
                  <div className="flex border-b bg-gray-50 px-6 gap-2 shrink-0">
                      {[
                        { id: 'general', label: 'البيانات الشخصية', icon: <UserRound size={16}/> },
                        { id: 'financial', label: 'الضبط المالي والرواتب', icon: <Wallet size={16}/> },
                        { id: 'experience', label: 'الخبرات والوثائق', icon: <GraduationCap size={16}/> },
                      ].map(tab => (
                          <button key={tab.id} onClick={() => setFormTab(tab.id as any)} className={`px-6 py-4 text-xs font-black flex items-center gap-2 transition-all border-b-4 ${formTab === tab.id ? 'border-rose-500 text-rose-600 bg-white' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
                              {tab.icon} {tab.label}
                          </button>
                      ))}
                  </div>

                  <form onSubmit={handleCreateEmployee} className="flex-1 overflow-y-auto custom-scrollbar p-8 space-y-8 bg-white">
                    {formTab === 'general' && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 animate-fadeIn">
                            <div className="md:col-span-1 space-y-6">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block">الصورة الشخصية</label>
                                    <div className="aspect-square rounded-3xl bg-gray-50 border-2 border-dashed border-gray-200 flex flex-col items-center justify-center overflow-hidden cursor-pointer hover:bg-rose-50 transition" onClick={() => handleImageUpload('imageUrl')}>
                                        {employeeForm.imageUrl ? <img src={employeeForm.imageUrl} className="w-full h-full object-cover" /> : <Camera size={32} className="text-gray-300"/>}
                                        {!employeeForm.imageUrl && <span className="text-[10px] font-bold text-gray-400 mt-2">انقر للرفع</span>}
                                    </div>
                                </div>
                                <div className="space-y-4">
                                    <div><label className="text-[10px] font-black text-gray-400 block mb-1">الرقم القومي / الهوية</label><input type="text" value={employeeForm.idNumber} onChange={e => setEmployeeForm({...employeeForm, idNumber: e.target.value})} className="w-full border rounded-xl p-3 text-sm font-numeric focus:border-rose-500 outline-none transition" /></div>
                                    <div><label className="text-[10px] font-black text-gray-400 block mb-1">معرف البصمة</label><input type="text" value={employeeForm.biometricId || ''} onChange={e => setEmployeeForm({...employeeForm, biometricId: e.target.value})} className="w-full border rounded-xl p-3 text-sm font-numeric focus:border-rose-500 outline-none transition" placeholder="مثال: 1001" /></div>
                                    <div><label className="text-[10px] font-black text-gray-400 block mb-1">تاريخ الميلاد</label><input type="date" value={employeeForm.birthDate} onChange={e => setEmployeeForm({...employeeForm, birthDate: e.target.value})} className="w-full border rounded-xl p-3 text-sm font-numeric" /></div>
                                </div>
                            </div>

                            <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="md:col-span-2"><label className="text-[10px] font-black text-gray-400 block mb-1 uppercase tracking-widest">الاسم الثلاثي الكامل</label><input required type="text" value={employeeForm.name} onChange={e => setEmployeeForm({...employeeForm, name: e.target.value})} className="w-full border-2 border-gray-100 rounded-2xl p-4 text-lg font-black focus:border-rose-500 outline-none transition shadow-sm" placeholder="أدخل اسم الموظف..." /></div>
                                <div><label className="text-[10px] font-black text-gray-400 block mb-1">رقم الهاتف</label><div className="relative"><Phone className="absolute left-3 top-3.5 text-gray-300" size={18}/><input required type="tel" value={employeeForm.phone} onChange={e => setEmployeeForm({...employeeForm, phone: e.target.value})} className="w-full border rounded-xl p-3 pl-10 text-sm font-numeric focus:border-rose-500 outline-none" placeholder="09xxxxxxx" /></div></div>
                                <div><label className="text-[10px] font-black text-gray-400 block mb-1">البريد الإلكتروني</label><input type="email" value={employeeForm.email} onChange={e => setEmployeeForm({...employeeForm, email: e.target.value})} className="w-full border rounded-xl p-3 text-sm focus:border-rose-500 outline-none" placeholder="email@company.com" /></div>
                                <div className="md:col-span-2"><label className="text-[10px] font-black text-gray-400 block mb-1">العنوان السكني الحالي</label><div className="relative"><MapPin className="absolute left-3 top-3.5 text-gray-300" size={18}/><input type="text" value={employeeForm.address} onChange={e => setEmployeeForm({...employeeForm, address: e.target.value})} className="w-full border rounded-xl p-3 pl-10 text-sm focus:border-rose-500 outline-none" /></div></div>
                                <div>
                                    <label className="text-[10px] font-black text-gray-400 block mb-1">الحالة الاجتماعية</label>
                                    <select value={employeeForm.maritalStatus} onChange={e => setEmployeeForm({...employeeForm, maritalStatus: e.target.value as any})} className="w-full border rounded-xl p-3 text-sm bg-white font-bold">
                                        <option value="أعزب">أعزب</option><option value="متزوج">متزوج</option><option value="أخرى">أخرى</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[10px] font-black text-gray-400 block mb-1">المسمى الوظيفي</label>
                                    <div className="relative"><Briefcase className="absolute left-3 top-3.5 text-gray-300" size={18}/><input required type="text" value={employeeForm.position} onChange={e => setEmployeeForm({...employeeForm, position: e.target.value})} className="w-full border rounded-xl p-3 pl-10 text-sm font-bold focus:border-rose-500 outline-none" placeholder="مثلاً: كاشير، أمين مستودع..." /></div>
                                </div>
                            </div>
                        </div>
                    )}

                    {formTab === 'financial' && (
                        <div className="space-y-8 animate-fadeIn">
                            <div className="bg-rose-50/50 p-8 rounded-[2rem] border-2 border-rose-100 flex flex-col md:flex-row items-center gap-10">
                                <div className="bg-white p-6 rounded-3xl shadow-xl border border-rose-100 shrink-0">
                                    <label className="text-xs font-black text-rose-400 uppercase tracking-widest block mb-4 text-center">الراتب الأساسي المتفق عليه</label>
                                    <div className="flex items-center gap-3">
                                        <input required type="number" value={employeeForm.baseSalary} onChange={e => setEmployeeForm({...employeeForm, baseSalary: Number(e.target.value)})} className="w-40 bg-transparent border-none text-5xl font-black text-rose-700 outline-none font-numeric text-center" placeholder="0" />
                                        <select value={employeeForm.currency} onChange={e => setEmployeeForm({...employeeForm, currency: e.target.value as any})} className="bg-white border rounded-xl p-2 font-black text-lg text-rose-600 shadow-sm">
                                            <option value="USD">$</option><option value="SYP">SYP</option><option value="TRY">TRY</option>
                                        </select>
                                    </div>
                                </div>
                                
                                <div className="flex-1 space-y-4">
                                    <label className="text-xs font-black text-gray-400 uppercase tracking-widest block">دورة صرف الراتب</label>
                                    <div className="grid grid-cols-3 gap-3">
                                        {[
                                            { id: 'monthly', label: 'شهري', desc: 'كل 30 يوم' },
                                            { id: 'weekly', label: 'أسبوعي', desc: 'كل 7 أيام' },
                                            { id: 'daily', label: 'يومي', desc: 'أجرة يومية' },
                                        ].map(freq => (
                                            <button key={freq.id} type="button" onClick={() => setEmployeeForm({...employeeForm, salaryFrequency: freq.id as SalaryFrequency})} className={`p-4 rounded-2xl border-2 transition-all text-center ${employeeForm.salaryFrequency === freq.id ? 'bg-rose-600 text-white border-rose-600 shadow-lg' : 'bg-white text-gray-400 border-gray-100 hover:border-rose-200'}`}>
                                                <div className="font-black text-sm">{freq.label}</div>
                                                <div className="text-[9px] font-bold opacity-60 uppercase">{freq.desc}</div>
                                            </button>
                                        ))}
                                    </div>
                                    <p className="text-[10px] text-rose-400 font-bold bg-white px-3 py-2 rounded-lg border border-rose-100 flex items-center gap-2">
                                        <Info size={14}/> تنبيه: سيتم احتساب المستحقات المالية بناءً على هذه الدورة عند إصدار كشوفات الرواتب.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {formTab === 'experience' && (
                        <div className="space-y-8 animate-fadeIn">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-gray-400 block mb-1">المؤهل العلمي</label>
                                    <div className="relative"><GraduationCap className="absolute left-3 top-3.5 text-gray-300" size={18}/><input type="text" value={employeeForm.education} onChange={e => setEmployeeForm({...employeeForm, education: e.target.value})} className="w-full border rounded-xl p-3 pl-10 text-sm focus:border-rose-500 outline-none" placeholder="جامعة، معهد، إلخ..." /></div>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-gray-400 block mb-1">الدورات التدريبية</label>
                                    <input type="text" value={employeeForm.courses} onChange={e => setEmployeeForm({...employeeForm, courses: e.target.value})} className="w-full border rounded-xl p-3 text-sm focus:border-rose-500 outline-none" placeholder="لغات، مهارات تقنية..." />
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="flex justify-between items-center border-b pb-2">
                                    <h4 className="font-black text-gray-700 text-sm flex items-center gap-2"><Briefcase size={18} className="text-rose-500"/> الخبرات السابقة</h4>
                                    <button type="button" onClick={handleAddExpRow} className="text-xs font-black text-rose-600 bg-rose-50 px-3 py-1 rounded-full hover:bg-rose-100 transition">+ إضافة خبرة</button>
                                </div>
                                <div className="space-y-4">
                                    {expRows.map((row, idx) => (
                                        <div key={idx} className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-gray-50 p-4 rounded-2xl border border-gray-100 relative group">
                                            <input placeholder="المسمى الوظيفي" value={row.position} onChange={e => updateExpRow(idx, 'position', e.target.value)} className="border rounded-lg p-2 text-xs" />
                                            <input placeholder="الشركة / المؤسسة" value={row.company} onChange={e => updateExpRow(idx, 'company', e.target.value)} className="border rounded-lg p-2 text-xs" />
                                            <input placeholder="المدة (مثلاً: سنتين)" value={row.duration} onChange={e => updateExpRow(idx, 'duration', e.target.value)} className="border rounded-lg p-2 text-xs" />
                                            <input placeholder="المهام الرئيسية" value={row.responsibilities} onChange={e => updateExpRow(idx, 'responsibilities', e.target.value)} className="border rounded-lg p-2 text-xs" />
                                            {expRows.length > 1 && (
                                                <button type="button" onClick={() => setExpRows(expRows.filter((_, i) => i !== idx))} className="absolute -left-2 -top-2 bg-white text-red-500 rounded-full p-1 shadow-md opacity-0 group-hover:opacity-100 transition"><X size={14}/></button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="bg-gray-50 p-6 rounded-3xl border-2 border-dashed border-gray-200">
                                <label className="text-[10px] font-black text-gray-400 block mb-4 uppercase text-center">صور الوثائق الشخصية (هوية/جواز)</label>
                                <div className="grid grid-cols-2 gap-6">
                                    <div className="aspect-video bg-white rounded-2xl border flex flex-col items-center justify-center cursor-pointer hover:bg-rose-50 transition" onClick={() => handleImageUpload('idFrontUrl')}>
                                        {employeeForm.idFrontUrl ? <img src={employeeForm.idFrontUrl} className="w-full h-full object-contain p-2" /> : <><Upload size={20} className="text-gray-300 mb-1"/><span className="text-[9px] font-bold text-gray-400">وجه الهوية</span></>}
                                    </div>
                                    <div className="aspect-video bg-white rounded-2xl border flex flex-col items-center justify-center cursor-pointer hover:bg-rose-50 transition" onClick={() => handleImageUpload('idBackUrl')}>
                                        {employeeForm.idBackUrl ? <img src={employeeForm.idBackUrl} className="w-full h-full object-contain p-2" /> : <><Upload size={20} className="text-gray-300 mb-1"/><span className="text-[9px] font-bold text-gray-400">خلفية الهوية</span></>}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="border-t pt-8 flex justify-end gap-3 mt-4">
                        <button type="button" onClick={() => setIsEmployeeModalOpen(false)} className="px-10 py-4 text-sm font-black text-gray-400 hover:text-gray-600 transition">إلغاء الإجراء</button>
                        <button type="submit" disabled={isSubmitting} className="bg-rose-600 text-white px-16 py-4 rounded-2xl font-black text-lg shadow-xl flex items-center gap-3 hover:bg-rose-700 transition active:scale-95 disabled:bg-gray-400">
                            {isSubmitting ? <RefreshCw className="animate-spin" size={24}/> : <Save size={24}/>} 
                            حفظ واعتماد الموظف
                        </button>
                    </div>
                  </form>
              </div>
          </div>
      )}

      {/* --- DEVICE MODAL --- */}
      {isDeviceModalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
              <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-3xl overflow-hidden animate-fadeIn border-t-8 border-rose-500">
                  <div className="p-6 bg-gray-900 text-white flex justify-between items-center">
                      <h3 className="text-lg font-black flex items-center gap-2"><Fingerprint size={20} className="text-rose-400"/> إدارة أجهزة البصمة</h3>
                      <button onClick={() => setIsDeviceModalOpen(false)} className="p-2 hover:bg-rose-500 rounded-full transition"><X size={20}/></button>
                  </div>
                  <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <form onSubmit={handleAddDevice} className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
                          <div>
                              <label className="text-[10px] font-black text-gray-400 block mb-1">اسم الجهاز</label>
                              <input value={deviceForm.name || ''} onChange={e => setDeviceForm(prev => ({ ...prev, name: e.target.value }))} className="w-full border rounded-xl p-3 text-sm" />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                              <div>
                                  <label className="text-[10px] font-black text-gray-400 block mb-1">IP</label>
                                  <input value={deviceForm.ip || ''} onChange={e => setDeviceForm(prev => ({ ...prev, ip: e.target.value }))} className="w-full border rounded-xl p-3 text-sm font-mono" />
                              </div>
                              <div>
                                  <label className="text-[10px] font-black text-gray-400 block mb-1">المنفذ</label>
                                  <input type="number" value={deviceForm.port || 4370} onChange={e => setDeviceForm(prev => ({ ...prev, port: Number(e.target.value || 4370) }))} className="w-full border rounded-xl p-3 text-sm font-mono" />
                              </div>
                          </div>
                          <div>
                              <label className="text-[10px] font-black text-gray-400 block mb-1">الموقع (اختياري)</label>
                              <input value={deviceForm.location || ''} onChange={e => setDeviceForm(prev => ({ ...prev, location: e.target.value }))} className="w-full border rounded-xl p-3 text-sm" />
                          </div>
                          <div>
                              <label className="text-[10px] font-black text-gray-400 block mb-1">ملاحظات</label>
                              <input value={deviceForm.notes || ''} onChange={e => setDeviceForm(prev => ({ ...prev, notes: e.target.value }))} className="w-full border rounded-xl p-3 text-sm" />
                          </div>
                          <button type="submit" className="w-full bg-rose-600 text-white py-2.5 rounded-xl text-sm font-black hover:bg-rose-700 transition">إضافة الجهاز</button>
                      </form>

                      <div className="bg-white rounded-2xl border border-gray-100 p-4">
                          <div className="flex items-center justify-between mb-3">
                              <h4 className="font-black text-gray-800">الأجهزة المسجلة</h4>
                              <button onClick={handleSyncAllDevices} className="px-3 py-2 rounded-xl text-xs font-black bg-rose-50 text-rose-700 hover:bg-rose-100 transition">مزامنة الكل</button>
                          </div>
                          <div className="space-y-3">
                              {devices.length === 0 ? (
                                  <div className="text-center text-gray-400 text-sm py-8">لا يوجد أجهزة بعد</div>
                              ) : (
                                  devices.map(device => (
                                      <div key={device.id} className="border rounded-2xl p-3 flex flex-col gap-2">
                                          <div>
                                              <div className="font-bold text-gray-800">{device.name}</div>
                                              <div className="text-xs text-gray-500 font-mono">{device.ip}:{device.port}</div>
                                              {device.location && <div className="text-xs text-gray-400">{device.location}</div>}
                                          </div>
                                          <div className="flex gap-2">
                                              <button onClick={() => handleTestDevice(device)} disabled={activeDeviceAction?.id === device.id} className="px-3 py-2 rounded-xl text-xs font-black bg-white border hover:bg-gray-50 transition">
                                                  {activeDeviceAction?.id === device.id && activeDeviceAction?.action === 'test' ? 'جارٍ الاختبار...' : 'اختبار اتصال'}
                                              </button>
                                              <button onClick={() => handleSyncDevice(device)} disabled={activeDeviceAction?.id === device.id} className="px-3 py-2 rounded-xl text-xs font-black bg-rose-600 text-white hover:bg-rose-700 transition">
                                                  {activeDeviceAction?.id === device.id && activeDeviceAction?.action === 'sync' ? 'جارٍ المزامنة...' : 'مزامنة'}
                                              </button>
                                              <button onClick={() => handleDeleteDevice(device)} className="px-3 py-2 rounded-xl text-xs font-black bg-white border text-red-600 hover:bg-red-50 transition">حذف</button>
                                          </div>
                                      </div>
                                  ))
                              )}
                          </div>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* --- PAYMENT MODAL (SALARY/ADVANCE/BONUS) --- */}
      {isPaymentModalOpen && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
              <div className="bg-white rounded-[3rem] shadow-2xl w-full max-w-lg overflow-hidden animate-fadeIn border-t-8 border-rose-500">
                  <div className="p-8 flex flex-col items-center">
                      <div className="w-20 h-20 bg-rose-50 rounded-3xl flex items-center justify-center text-rose-600 mb-6 shadow-inner rotate-3">
                          <Banknote size={40}/>
                      </div>
                      <h3 className="text-2xl font-black text-gray-900 mb-1">صرف مستحقات مالية</h3>
                      <p className="text-sm text-gray-400 font-bold mb-8">تسجيل حركة نقدية في سجل الرواتب</p>
                      
                      <form onSubmit={handleProcessPayment} className="w-full space-y-6">
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block ml-2">اختر الموظف</label>
                                <select required value={paymentForm.employeeId} onChange={e => setPaymentForm({...paymentForm, employeeId: e.target.value})} className="w-full border-2 border-gray-100 rounded-2xl p-4 font-black bg-gray-50 focus:bg-white focus:border-rose-500 outline-none transition">
                                    <option value="">-- اختر من القائمة --</option>
                                    {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name} (الراتب: {emp.baseSalary} {emp.currency})</option>)}
                                </select>
                            </div>

                            {paymentMode === 'salary_delivery' && (
                                <div className="border rounded-2xl p-4 bg-rose-50/30">
                                    <div className="flex items-center justify-between text-sm font-bold text-gray-700">
                                        <span>الرصيد الأساسي</span>
                                        <span className="font-black text-rose-700">{formatNumber(employees.find(x => x.id === paymentForm.employeeId)?.baseSalary || 0)} {employees.find(x => x.id === paymentForm.employeeId)?.currency || 'USD'}</span>
                                    </div>
                                    <div className="flex items-center justify-between text-sm mt-2">
                                        <span className="text-gray-500">السلفة المعلقة</span>
                                        <span className="font-black text-orange-600">{formatNumber(Math.max(0, Number(advanceMap.get(paymentForm.employeeId) || 0)))} {employees.find(x => x.id === paymentForm.employeeId)?.currency || 'USD'}</span>
                                    </div>
                                    <label className="flex items-center gap-2 mt-3 text-xs font-bold text-gray-600">
                                        <input type="checkbox" checked={deductAdvance} onChange={e => setDeductAdvance(e.target.checked)} />
                                        خصم السلفة من الراتب الآن
                                    </label>
                                    {deductAdvance && (
                                        <div className="mt-2">
                                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block ml-2">قيمة الخصم</label>
                                            <input type="number" step="0.01" value={advanceToDeduct} onChange={e => setAdvanceToDeduct(Number(e.target.value || 0))} className="w-full border-2 border-rose-100 rounded-2xl p-3 font-black text-center text-rose-700 bg-white focus:border-rose-500 outline-none transition font-numeric" />
                                        </div>
                                    )}
                                </div>
                            )}
                            
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block ml-2">نوع العملية</label>
                                    {paymentMode === 'salary_delivery' ? (
                                        <div className="w-full border-2 border-gray-100 rounded-2xl p-4 font-black bg-gray-50 text-gray-600">راتب دوري</div>
                                    ) : (
                                        <select value={paymentForm.type} onChange={e => setPaymentForm({...paymentForm, type: e.target.value as any})} className="w-full border-2 border-gray-100 rounded-2xl p-4 font-black bg-white focus:border-rose-500 outline-none">
                                            <option value="full_salary">راتب دوري</option>
                                            <option value="advance">سلفة مالية</option>
                                            <option value="bonus">مكافأة / حافز</option>
                                            <option value="deduction">خصم مالي</option>
                                        </select>
                                    )}
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block ml-2">المبلغ المطلوب</label>
                                    <div className="relative">
                                        <input required type="number" step="0.01" value={paymentMode === 'salary_delivery' ? String(Math.max(0, Number((employees.find(x => x.id === paymentForm.employeeId)?.baseSalary || 0) - (deductAdvance ? Number(advanceToDeduct || 0) : 0))) ) : paymentForm.amount} onChange={e => setPaymentForm({...paymentForm, amount: e.target.value})} disabled={paymentMode === 'salary_delivery'} className="w-full border-2 border-rose-100 rounded-2xl p-4 font-black text-2xl text-center text-rose-700 bg-rose-50/20 focus:bg-white focus:border-rose-500 outline-none transition font-numeric disabled:bg-gray-100" placeholder="0.00" />
                                        <div className="absolute left-4 top-4 text-xs font-black text-rose-300">{employees.find(x => x.id === paymentForm.employeeId)?.currency || 'USD'}</div>
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block ml-2">فترة الاستحقاق</label>
                                    <input type="text" placeholder="مثلاً: شهر 05-2024" value={paymentForm.period} onChange={e => setPaymentForm({...paymentForm, period: e.target.value})} className="w-full border-2 border-gray-100 rounded-2xl p-4 font-bold text-sm outline-none focus:border-rose-500" />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block ml-2">تاريخ الصرف</label>
                                    <input type="date" value={paymentForm.date} onChange={e => setPaymentForm({...paymentForm, date: e.target.value})} className="w-full border-2 border-gray-100 rounded-2xl p-4 font-numeric text-sm outline-none" />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block ml-2">يخصم من الصندوق</label>
                                <select required value={paymentForm.cashBoxId} onChange={e => setPaymentForm({...paymentForm, cashBoxId: e.target.value})} className="w-full border-2 border-gray-100 rounded-2xl p-4 font-bold bg-gray-50 focus:bg-white outline-none">
                                    {cashBoxes.map(box => <option key={box.id} value={box.id}>{box.name} (الرصيد: {box.balance} $)</option>)}
                                </select>
                            </div>

                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block ml-2">ملاحظات إضافية</label>
                                <input type="text" placeholder="أي تفاصيل أخرى..." value={paymentForm.notes} onChange={e => setPaymentForm({...paymentForm, notes: e.target.value})} className="w-full border-2 border-gray-100 rounded-2xl p-4 font-bold text-sm outline-none focus:border-rose-500" />
                            </div>
                        </div>

                        <div className="pt-6">
                            <button type="submit" disabled={isSubmitting} className="w-full bg-rose-600 text-white py-5 rounded-[2rem] font-black text-xl shadow-2xl hover:bg-rose-700 transition-all flex items-center justify-center gap-4 transform active:scale-95 disabled:bg-gray-300">
                                {isSubmitting ? <RefreshCw className="animate-spin" size={24}/> : <CheckCircle2 size={24}/>} تأكيد وصرف المبلغ
                            </button>
                            <button type="button" onClick={() => setIsPaymentModalOpen(false)} className="w-full py-4 text-xs text-gray-400 font-bold hover:text-gray-600 transition">إلغاء العملية</button>
                        </div>
                      </form>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default Payroll;
