
import React, { useEffect } from 'react';
import { CheckCircle2, AlertCircle, X, Info } from 'lucide-react';

export interface ToastProps {
    message: string;
    type: 'success' | 'error' | 'warning';
    onClose: () => void;
}

const Toast: React.FC<ToastProps> = ({ message, type, onClose }) => {
    useEffect(() => {
        const timer = setTimeout(onClose, 5000);
        return () => clearTimeout(timer);
    }, [onClose]);

    const styles = {
        success: 'bg-emerald-600 border-emerald-500',
        error: 'bg-rose-600 border-rose-500',
        warning: 'bg-amber-600 border-amber-500'
    };

    const icons = {
        success: <CheckCircle2 size={20} />,
        error: <AlertCircle size={20} />,
        warning: <Info size={20} />
    };

    return (
        <div className={`toast-message-box animate-toast-in flex items-center gap-3 p-4 rounded-2xl border-b-4 text-white font-bold ${styles[type]}`}>
            <div className="bg-white/20 p-2 rounded-xl">
                {icons[type]}
            </div>
            <p className="flex-1 text-sm">{message}</p>
            <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-lg transition">
                <X size={18} />
            </button>
        </div>
    );
};

export default Toast;
