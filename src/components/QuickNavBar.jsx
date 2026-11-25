import React from 'react';
import { CalendarIcon, CalendarClockIcon, EditIcon } from './Icons';

export default function QuickNavBar({ currentView, onSelectView }) {
  const items = [
    { id: 'main', label: '근무기록', icon: EditIcon },
    { id: 'myWeeklySchedule', label: '나의 주간', icon: CalendarIcon },
    { id: 'dailySchedule', label: '팀별 오늘', icon: CalendarClockIcon },
    {
      id: 'studentSearch',
      label: '대상자 검색',
      icon: ({ className }) => (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="10.5" cy="10.5" r="7" />
          <path d="m21 21-5.2-5.2" />
        </svg>
      )
    }
  ];

  return (
    <nav
      aria-label="핵심 화면 빠른 전환"
      className="fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 shadow-[0_-4px_16px_rgba(15,23,42,0.08)]"
    >
      <div className="max-w-5xl lg:max-w-[1536px] mx-auto grid grid-cols-4 gap-1 px-2 py-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))]">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = currentView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectView(item.id)}
              className={`flex flex-col items-center justify-center py-1.5 px-1 rounded-xl transition-all touch-manipulation active:scale-95 ${
                isActive
                  ? 'bg-blue-50 text-blue-700 font-extrabold'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 font-bold'
              }`}
            >
              <Icon className={`w-5 h-5 mb-0.5 ${isActive ? 'text-blue-600' : 'text-slate-500'}`} />
              <span className="text-[11.5px] sm:text-[12.5px] tracking-tight whitespace-nowrap">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
