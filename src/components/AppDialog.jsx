import React, { useState, useEffect, useRef } from 'react';
import { registerDialogListener } from '../utils/dialog';

export default function AppDialog() {
  const [queue, setQueue] = useState([]);
  const confirmBtnRef = useRef(null);

  useEffect(() => {
    return registerDialogListener((item) => {
      setQueue((prev) => [...prev, item]);
    });
  }, []);

  const current = queue[0] || null;

  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(() => {
      confirmBtnRef.current?.focus();
    }, 30);
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [current]);

  if (!current) return null;

  const handleClose = (result) => {
    setQueue((prev) => prev.slice(1));
    current.resolve(current.type === 'confirm' ? Boolean(result) : undefined);
  };

  return (
    <div
      className="fixed inset-0 bg-slate-900/50 backdrop-blur-[3px] flex items-center justify-center z-[120] p-4"
      onClick={() => handleClose(false)}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-fadeIn border border-slate-200"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className={`px-4 py-3 text-white font-extrabold text-[17px] tracking-tight ${current.type === 'confirm' ? 'bg-gradient-to-r from-blue-600 to-indigo-600' : 'bg-gradient-to-r from-slate-700 to-slate-800'}`}>
          {current.type === 'confirm' ? '확인' : '안내'}
        </div>
        <div className="p-5 text-[15.5px] sm:text-[16px] font-bold text-slate-800 whitespace-pre-line leading-relaxed break-keep">
          {current.message}
        </div>
        <div className="px-4 pb-4 flex items-center justify-end gap-2">
          {current.type === 'confirm' && (
            <button
              type="button"
              onClick={() => handleClose(false)}
              className="flex-1 py-2.5 px-4 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-extrabold text-[15px] active:scale-95 transition touch-manipulation"
            >
              취소
            </button>
          )}
          <button
            ref={confirmBtnRef}
            type="button"
            onClick={() => handleClose(true)}
            className="flex-1 py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-[15px] shadow-sm active:scale-95 transition touch-manipulation"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
