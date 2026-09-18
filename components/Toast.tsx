
import React from 'react';

interface ToastProps {
  message: string;
  type: 'success' | 'error';
}

const Toast: React.FC<ToastProps> = ({ message, type }) => {
  return (
    <div className={`pointer-events-auto px-4 py-3 rounded-lg shadow-lg border-l-4 flex items-center gap-3 animate-slide-in-right bg-white min-w-[280px] ${
      type === 'success' ? 'border-emerald-500 text-emerald-800' : 'border-rose-500 text-rose-800'
    }`}>
      <span className="material-symbols-outlined text-xl">
        {type === 'success' ? 'check_circle' : 'error'}
      </span>
      <span className="text-sm font-bold">{message}</span>
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        .animate-slide-in-right {
          animation: slideInRight 0.3s cubic-bezier(0.2, 0.9, 0.2, 1) forwards;
        }
      `}</style>
    </div>
  );
};

export default Toast;
