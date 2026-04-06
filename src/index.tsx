
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

const ALERT_EVENT_NAME = 'shamel-alert';
if (typeof window !== 'undefined') {
  window.alert = (message?: any) => {
    window.dispatchEvent(new CustomEvent(ALERT_EVENT_NAME, { detail: { message } }));
  };
}

interface EBProps { children?: React.ReactNode; }
interface EBState { hasError: boolean; error: Error | null; }

class ErrorBoundary extends React.Component<EBProps, EBState> {
  constructor(props: EBProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
  componentDidCatch(error: any, info: any) { console.error(error, info); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen flex flex-col items-center justify-center p-8 text-center bg-gray-50">
          <h1 className="text-xl font-bold text-red-600 mb-4">حدث خطأ في تشغيل النظام</h1>
          <pre className="bg-white p-4 rounded border text-xs mb-4 max-w-full overflow-auto" dir="ltr">{this.state.error?.message}</pre>
          <button onClick={() => window.location.reload()} className="bg-primary text-white px-6 py-2 rounded-lg font-bold">إعادة محاولة</button>
        </div>
      );
    }
    return this.props.children;
  }
}

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<ErrorBoundary><App /></ErrorBoundary>);
