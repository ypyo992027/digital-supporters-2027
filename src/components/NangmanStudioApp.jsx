// 지하1층 낭만스튜디오 사용 보기

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { supabaseClient } from '../utils/supabase';
import { getSavedItem, setSavedItem, safeJsonSetItem, getLocalDateString } from '../utils/helpers';
import { hasValidSavedAdminPassword } from '../utils/appSettings';
import { showAlert, showConfirm } from '../utils/dialog';
import { LucideCalendar, Home } from './Icons';

const appId = typeof window.__app_id !== 'undefined' ? window.__app_id : 'default-app-id';

export default function NangmanStudioApp({ onNavigateBack, onNavigateToClassroom }) {
  const [saveErrorMsg, setSaveErrorMsg] = useState("");
  const [supabaseTableMissing, setSupabaseTableMissing] = useState(false);

  const [currentWeekStart, setCurrentWeekStart] = useState(() => {
    const d = new Date();
    const day = d.getDay();
    if (day === 0) d.setDate(d.getDate() + 1);
    else if (day === 6) d.setDate(d.getDate() + 2);

    const newDay = d.getDay();
    const diff = d.getDate() - newDay + (newDay === 0 ? -6 : 1);
    return new Date(d.setDate(diff));
  });

  const adjustedTodayStr = useMemo(() => {
    const d = new Date();
    const day = d.getDay();
    if (day === 0) d.setDate(d.getDate() + 1);
    else if (day === 6) d.setDate(d.getDate() + 2);
    return getLocalDateString(d);
  }, []);

  const [schedule, setSchedule] = useState(() => {
    try {
      const cached = getSavedItem('nangman_schedule_backup', null);
      return cached ? JSON.parse(cached) : {};
    } catch (e) { return {}; }
  });
  const scheduleRef = useRef(schedule);
  const savedScheduleRef = useRef(schedule);

  const [memo, setMemo] = useState(() => {
    return getSavedItem('nangman_memo_backup', "");
  });
  const memoRef = useRef(memo);
  const savedMemoRef = useRef(memo);
  const hasLocalEditRef = useRef(false);
  const [baselineVersion, setBaselineVersion] = useState(0);

  const [isAutoScheduling, setIsAutoScheduling] = useState(false);
  const [isManagerMode] = useState(() => hasValidSavedAdminPassword());
  const isManagerModeRef = useRef(isManagerMode);
  const [showExitSaveModal, setShowExitSaveModal] = useState(false);
  const [saveModalMode, setSaveModalMode] = useState('exit');
  const [isSavingExit, setIsSavingExit] = useState(false);
  const pendingExitActionRef = useRef(null);

  const [editingCell, setEditingCell] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [holidayDates, setHolidayDates] = useState(new Map());

  const todayStr = getLocalDateString(new Date());
  const touchStartY = useRef(null);

  const touchStartX = useRef(null);

  const checkHasUnsavedChanges = (baseSchedule, baseMemo, curSchedule, curMemo) => {
    if ((baseMemo || "") !== (curMemo || "")) return true;
    const b = baseSchedule || {};
    const c = curSchedule || {};
    const keys = new Set([...Object.keys(b), ...Object.keys(c)]);
    for (const k of keys) {
      const bv = b[k] === undefined ? false : b[k];
      const cv = c[k] === undefined ? false : c[k];
      if (bv !== cv) return true;
    }
    return false;
  };

  const hasUnsavedChanges = useMemo(
    () => isManagerMode && checkHasUnsavedChanges(savedScheduleRef.current, savedMemoRef.current, schedule, memo),
    [isManagerMode, schedule, memo, baselineVersion]
  );

  useEffect(() => {
    document.documentElement.style.overscrollBehaviorY = 'none';
    document.body.style.overscrollBehaviorY = 'none';
    return () => {
      document.documentElement.style.overscrollBehaviorY = 'auto';
      document.body.style.overscrollBehaviorY = 'auto';
    };
  }, []);

  useEffect(() => {
    isManagerModeRef.current = isManagerMode;
  }, [isManagerMode]);

  useEffect(() => {
    scheduleRef.current = schedule;
  }, [schedule]);

  useEffect(() => {
    memoRef.current = memo;
  }, [memo]);

  const handleTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;
    const deltaX = touchStartX.current - touchEndX;
    const deltaY = touchStartY.current - touchEndY;

    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 150) {
      if (deltaX > 0) changeWeek(1);
      else changeWeek(-1);
    }
    touchStartX.current = null;
    touchStartY.current = null;
  };

  const timeSlots = ["1팀", "2팀"];
  const weekDays = ['월', '화', '수', '목'];

  useEffect(() => {
    document.documentElement.style.overscrollBehaviorY = 'none';
    document.body.style.overscrollBehaviorY = 'none';

    const loadInitialData = async () => {
      try {
        const { data: hData } = await supabaseClient.from('holidays').select('date, name');
        if (hData) {
          const hMap = new Map();
          hData.forEach(h => {
            if (h.date) hMap.set(h.date, h.name || '공휴일');
          });
          setHolidayDates(hMap);
        }

        const { data, error } = await supabaseClient
          .from('nangman_schedules')
          .select('data, memo')
          .eq('id', appId)
          .maybeSingle();

        if (error) {
          if (error.code === '42P01' || error.code === 'PGRST205' || (error.message && error.message.includes('nangman_schedules'))) {
            setSupabaseTableMissing(true);
          }
          console.error("Supabase load error:", error);
        } else if (data) {
          const loadedData = data.data || {};
          const loadedMemo = data.memo || "";
          savedScheduleRef.current = loadedData;
          savedMemoRef.current = loadedMemo;
          safeJsonSetItem('nangman_schedule_backup', loadedData);
          setSavedItem('nangman_memo_backup', loadedMemo);
          if (!hasLocalEditRef.current) {
            scheduleRef.current = loadedData;
            memoRef.current = loadedMemo;
            setSchedule(loadedData);
            setMemo(loadedMemo);
          }
          setBaselineVersion(v => v + 1);
        }
      } catch (err) {
        console.error("Supabase exception:", err);
      }
    };

    loadInitialData();

    const channel = supabaseClient
      .channel('nangman_schedules_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'nangman_schedules', filter: `id=eq.${appId}` },
        (payload) => {
          const newData = payload.new;
          if (newData && !isManagerModeRef.current) {
            const nextData = newData.data || {};
            const nextMemo = newData.memo || "";
            savedScheduleRef.current = nextData;
            savedMemoRef.current = nextMemo;
            scheduleRef.current = nextData;
            memoRef.current = nextMemo;
            setSchedule(nextData);
            setMemo(nextMemo);
            setBaselineVersion(v => v + 1);
          }
        }
      )
      .subscribe();

    return () => {
      supabaseClient.removeChannel(channel);
    };
  }, []);

  const persistNangmanToDb = async (nextSchedule, nextMemo) => {
    try {
      const { error } = await supabaseClient
        .from('nangman_schedules')
        .upsert({
          id: appId,
          data: nextSchedule,
          memo: nextMemo,
          updated_at: new Date().toISOString()
        });

      if (error) {
        if (error.code === '42P01' || error.code === 'PGRST205' || (error.message && error.message.includes('nangman_schedules'))) {
          setSupabaseTableMissing(true);
        }
        throw error;
      }

      savedScheduleRef.current = nextSchedule;
      savedMemoRef.current = nextMemo;
      hasLocalEditRef.current = false;
      safeJsonSetItem('nangman_schedule_backup', nextSchedule);
      setSavedItem('nangman_memo_backup', nextMemo);
      setBaselineVersion(v => v + 1);
      setSaveErrorMsg("");
      setSupabaseTableMissing(false);
      return true;
    } catch (error) {
      console.error("⚠️ 데이터 저장 오류:", error);
      setSaveErrorMsg(`⚠️ 저장 실패: 슈파베이스 권한이나 테이블 설정이 잘못되었습니다. (${error.message})`);
      return false;
    }
  };

  const saveBulkChanges = (changes) => {
    if (Object.keys(changes).length === 0) return;
    const optimisticData = {};
    Object.keys(changes).forEach(k => {
      const cleanKey = k.replace('data.', '');
      optimisticData[cleanKey] = changes[k];
    });
    const newSchedule = { ...scheduleRef.current, ...optimisticData };
    scheduleRef.current = newSchedule;
    hasLocalEditRef.current = true;
    setSchedule(newSchedule);
  };

  const getScheduleKey = (dateStr, timeSlot) => {
    return `${dateStr}_${timeSlot.replace(/\s+/g, '').replace(/~/g, '-').replace(/:/g, '')}`;
  };

  // handleCellClick removed, using invisible select instead

  const handleSelectChange = (key, val) => {
    let finalValue = false;
    const trimmed = val.trim();
    if (val === '     ') {
      finalValue = '     ';
    } else if (trimmed !== "" && trimmed !== "false") {
      if (trimmed === "disabled") {
        finalValue = "disabled";
      } else if (trimmed === "공휴일" || trimmed === "부처님오신날" || trimmed === "어린이날" || trimmed.includes("공휴일")) {
        finalValue = `holiday:${trimmed}`;
      } else {
        finalValue = trimmed;
      }
    }

    const newSchedule = { ...scheduleRef.current, [key]: finalValue };
    scheduleRef.current = newSchedule;
    hasLocalEditRef.current = true;
    setSchedule(newSchedule);
    setEditingCell(null);
  };

  const copyPreviousWeek = async (e) => {
    e.stopPropagation();
    if (!isManagerMode) return;
    if (!(await showConfirm("이전 주의 데이터를 복제하시겠습니까?"))) return;

    const currentDays = getCurrentWeekDays();
    const changes = {};
    timeSlots.forEach(time => {
      currentDays.forEach(day => {
        const currentDateStr = formatDateString(day);
        const currentKey = getScheduleKey(currentDateStr, time);

        // 1. Get previous week's date
        const prevDate = new Date(day);
        prevDate.setDate(prevDate.getDate() - 7);
        const prevDateStr = formatDateString(prevDate);

        // 2. Resolve exactly what the previous week was displaying visually
        let state = schedule[getScheduleKey(prevDateStr, time)];

        // 3. If it was completely blank visually, save it explicitly as 'false' (blank).
        // Otherwise, save the exact state.
        changes[`data.${currentKey}`] = state === undefined ? false : state;
      });
    });

    await saveBulkChanges(changes);
  };

  const deleteCurrentWeek = async (e) => {
    e.stopPropagation();
    if (!isManagerMode) return;
    if (!(await showConfirm("일정 데이터를 지우시겠습니까?"))) return;

    const currentDays = getCurrentWeekDays();
    const changes = {};
    timeSlots.forEach(time => {
      currentDays.forEach(day => {
        const currentDateStr = formatDateString(day);
        const currentKey = getScheduleKey(currentDateStr, time);
        changes[`data.${currentKey}`] = false;
      });
    });

    await saveBulkChanges(changes);
  };

  const toggleAll = () => {
    if (!isManagerMode) return;
    const currentDays = getCurrentWeekDays();
    const allKeys = [];
    currentDays.forEach(day => {
      const ds = formatDateString(day);
      timeSlots.forEach(slot => allKeys.push(getScheduleKey(ds, slot)));
    });

    const allActive = allKeys.every(k => schedule[k] === true);
    const allNangman = allKeys.every(k => schedule[k] === 'nangman');
    const allPending = allKeys.every(k => schedule[k] === 'pending');

    let newValue;
    if (allActive) newValue = 'nangman';
    else if (allNangman) newValue = 'pending';
    else if (allPending) newValue = false;
    else newValue = true;

    const changes = {};
    allKeys.forEach(k => { changes[`data.${k}`] = newValue; });
    saveBulkChanges(changes);
  };

  const toggleWholeDay = (dateStr) => {
    if (!isManagerMode) return;
    const dayKeys = timeSlots.map(slot => getScheduleKey(dateStr, slot));
    const allActive = dayKeys.every(k => schedule[k] === true);
    const allNangman = dayKeys.every(k => schedule[k] === 'nangman');
    const allPending = dayKeys.every(k => schedule[k] === 'pending');

    let newValue;
    if (allActive) newValue = 'nangman';
    else if (allNangman) newValue = 'pending';
    else if (allPending) newValue = false;
    else newValue = true;

    const changes = {};
    dayKeys.forEach(k => { changes[`data.${k}`] = newValue; });
    saveBulkChanges(changes);
  };

  const toggleWholeWeek = (timeSlot) => {
    if (!isManagerMode) return;
    const currentDays = getCurrentWeekDays();
    const weekKeys = currentDays.map(day => getScheduleKey(formatDateString(day), timeSlot));
    const allActive = weekKeys.every(k => schedule[k] === true);
    const allNangman = weekKeys.every(k => schedule[k] === 'nangman');
    const allPending = weekKeys.every(k => schedule[k] === 'pending');

    let newValue;
    if (allActive) newValue = 'nangman';
    else if (allNangman) newValue = 'pending';
    else if (allPending) newValue = false;
    else newValue = true;

    const changes = {};
    weekKeys.forEach(k => { changes[`data.${k}`] = newValue; });
    saveBulkChanges(changes);
  };

  const handleOpenManualSaveModal = () => {
    if (!isManagerMode || !hasUnsavedChanges) return;
    pendingExitActionRef.current = null;
    setSaveModalMode('saveOnly');
    setShowExitSaveModal(true);
  };

  const handleRequestNavigate = (targetFn) => {
    if (
      isManagerMode &&
      checkHasUnsavedChanges(
        savedScheduleRef.current,
        savedMemoRef.current,
        scheduleRef.current,
        memoRef.current
      )
    ) {
      pendingExitActionRef.current = targetFn;
      setSaveModalMode('exit');
      setShowExitSaveModal(true);
      return;
    }
    targetFn();
  };

  const handleConfirmSaveAndExit = async () => {
    if (isSavingExit) return;
    setIsSavingExit(true);
    const ok = await persistNangmanToDb(scheduleRef.current, memoRef.current);
    setIsSavingExit(false);
    setShowExitSaveModal(false);
    if (ok) {
      const nextAction = pendingExitActionRef.current;
      pendingExitActionRef.current = null;
      if (nextAction) nextAction();
    } else {
      pendingExitActionRef.current = null;
    }
  };

  const handleDiscardAndExit = () => {
    if (isSavingExit) return;
    hasLocalEditRef.current = false;
    setShowExitSaveModal(false);
    const nextAction = pendingExitActionRef.current;
    pendingExitActionRef.current = null;
    if (nextAction) nextAction();
  };

  const handleCancelExit = () => {
    if (isSavingExit) return;
    setShowExitSaveModal(false);
    pendingExitActionRef.current = null;
  };

  const formatDateString = (date) => getLocalDateString(date);

  const getCurrentWeekDays = () => {
    const days = [];
    for (let i = 0; i < 4; i++) {
      const d = new Date(currentWeekStart);
      d.setDate(currentWeekStart.getDate() + i);
      days.push(d);
    }
    return days;
  };

  const changeWeek = (offsetWeeks) => {
    const newDate = new Date(currentWeekStart);
    newDate.setDate(newDate.getDate() + (offsetWeeks * 7));
    setCurrentWeekStart(newDate);
  };

  const handleCurrentWeekClick = () => {
    const d = new Date();
    const day = d.getDay();
    if (day === 0) d.setDate(d.getDate() + 1);
    else if (day === 6) d.setDate(d.getDate() + 2);

    const newDay = d.getDay();
    const diff = d.getDate() - newDay + (newDay === 0 ? -6 : 1);
    setCurrentWeekStart(new Date(d.setDate(diff)));
  };

  const currentDays = getCurrentWeekDays();
  const startMonth = currentDays[0].getMonth() + 1;
  const startDay = currentDays[0].getDate();
  const endMonth = currentDays[3].getMonth() + 1;
  const endDay = currentDays[3].getDate();

  return (
    <div className="min-h-[100dvh] flex flex-col app-surface font-sans text-gray-800">
      <div className="shrink-0 app-header text-white z-40 relative">
        <div className={`max-w-5xl lg:max-w-[1536px] mx-auto px-2.5 sm:px-5 ${isManagerMode ? 'pb-14 min-h-[120px]' : 'pb-4'} pt-safe-4 flex justify-between items-start relative`}>
          <div>
            <div className="flex items-center mb-1">
              <img src="/Logo_of_Seoul.jpg" alt="서울시 로고" className="h-7 hdr-logo object-contain mr-2 shrink-0" onError={(e) => e.target.style.display = 'none'} />
              <h1 className="font-black text-xl leading-tight">성동노인종합복지관</h1>
            </div>
            <p className="text-lg font-semibold text-yellow-300">디지털교육 서포터즈</p>
          </div>

          {isManagerMode && (
            <div className="absolute left-1/2 bottom-2 transform -translate-x-1/2 z-50">
              {hasUnsavedChanges ? (
                <button
                  type="button"
                  onClick={handleOpenManualSaveModal}
                  className="px-6 py-1.5 md:px-10 md:py-2 rounded-full bg-amber-400 hover:bg-amber-300 text-slate-900 font-extrabold text-sm md:text-base shadow-lg ring-2 ring-white/85 transition-all active:scale-95 touch-manipulation whitespace-nowrap cursor-pointer"
                >
                  데이터 저장
                </button>
              ) : (
                <span className="inline-block px-6 py-1.5 md:px-10 md:py-2 hdr-pill is-on font-bold text-sm md:text-base whitespace-nowrap select-none cursor-default">
                  담당자 모드
                </span>
              )}
            </div>
          )}

          <button onClick={() => handleRequestNavigate(onNavigateBack)} className="text-xs flex flex-col items-center font-bold p-2 rounded-lg shadow-md transition-all touch-manipulation hdr-btn shrink-0">
            <Home className="w-5 h-5 mb-1" /> 처음으로
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col pb-10">
        <div className="max-w-5xl lg:max-w-[1536px] w-full mx-auto flex-1 flex flex-col px-2.5 sm:px-5 py-3 md:py-6 mt-1">
          <div className="pb-2 px-1">
            <h2 className="text-[19px] sm:text-xl font-bold text-gray-800 flex items-center tracking-tight">
              <span className="flex items-center"><LucideCalendar className="w-5 h-5 mr-2 text-blue-600" /> 낭만스튜디오 사용 현황</span>
            </h2>
          </div>
          <div className="bg-white rounded-2xl shadow-lg overflow-hidden ring-1 ring-gray-900/5 flex flex-col">
            <div className="shrink-0 z-10 bg-white px-4 pt-4 pb-2 md:px-6 md:pt-6 md:pb-3 shadow-sm relative">
              <div className="bg-white rounded-xl p-3 md:p-4 border border-gray-200 flex flex-col items-center shadow-sm">
              {saveErrorMsg && (
                <div className="w-full mb-3 p-3 bg-red-100 text-red-700 font-bold rounded-lg border border-red-300 text-[14px] md:text-sm text-center">
                  🚨 {saveErrorMsg}
                </div>
              )}

              {supabaseTableMissing && (
                <div className="w-full mb-4 p-4 bg-amber-50 text-amber-900 rounded-xl border border-amber-300 shadow-sm text-xs sm:text-sm flex flex-col gap-2 text-left">
                  <div className="flex items-center gap-2 font-bold text-amber-800 text-[14px] sm:text-base">
                    ⚠️ 슈파베이스(Supabase) 테이블 생성이 필요합니다!
                  </div>
                  <p className="leading-relaxed">
                    낭만스튜디오 예약 데이터를 Supabase에 완전히 이전하여 활성화하려면 아래 SQL 쿼리를 복사하여 <b>Supabase Dashboard ➡️ SQL Editor</b>에 붙여넣고 실행(Run)해 주세요.
                  </p>
                  <pre className="bg-gray-900 text-green-400 p-3 rounded-lg overflow-x-auto font-mono text-[10px] sm:text-xs max-h-40 border border-gray-800 select-all">
                    {`CREATE TABLE IF NOT EXISTS public.nangman_schedules (
    id text NOT NULL DEFAULT 'default-app-id'::text,
    data jsonb NOT NULL DEFAULT '{}'::jsonb,
    memo text NOT NULL DEFAULT ''::text,
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT nangman_schedules_pkey PRIMARY KEY (id)
);

ALTER TABLE public.nangman_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access" ON public.nangman_schedules FOR SELECT USING (true);
CREATE POLICY "Allow public all access" ON public.nangman_schedules FOR ALL USING (true) WITH CHECK (true);`}
                  </pre>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(`CREATE TABLE IF NOT EXISTS public.nangman_schedules (
    id text NOT NULL DEFAULT 'default-app-id'::text,
    data jsonb NOT NULL DEFAULT '{}'::jsonb,
    memo text NOT NULL DEFAULT ''::text,
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT nangman_schedules_pkey PRIMARY KEY (id)
);

ALTER TABLE public.nangman_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access" ON public.nangman_schedules FOR SELECT USING (true);
CREATE POLICY "Allow public all access" ON public.nangman_schedules FOR ALL USING (true) WITH CHECK (true);`);
                      showAlert("SQL 쿼리가 클립보드에 복사되었습니다!");
                    }}
                    className="bg-amber-600 text-white font-bold py-1.5 px-4 rounded-lg hover:bg-amber-700 active:scale-95 transition-all self-start text-xs shadow-sm"
                  >
                    SQL 쿼리 복사하기
                  </button>
                </div>
              )}

              <div className="flex items-center gap-1.5 sm:gap-2 w-full mb-2">
                <button onClick={() => changeWeek(-1)} className="w-10 sm:w-12 h-10 sm:h-12 flex items-center justify-center border-[1.5px] border-gray-300 rounded-xl bg-white shadow-sm hover:bg-gray-50 active:bg-gray-100 active:scale-95 touch-manipulation text-gray-700 shrink-0 transition-all">
                  <svg className="w-6 h-6 sm:w-7 sm:h-7" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6 1.41-1.41z" /></svg>
                </button>
                <div className="flex-1 h-10 sm:h-12 flex items-center justify-center border-[1.5px] border-blue-300 rounded-xl bg-white text-center shadow-sm overflow-hidden px-1 transition-all">
                  <h2 className="font-extrabold text-[#1e3a8a] text-[16px] min-[360px]:text-[18px] sm:text-[20px] tracking-tighter whitespace-nowrap text-center -translate-y-[1px]">{startMonth}/{startDay} ~ {endMonth}/{endDay}</h2>
                </div>
                <button onClick={handleCurrentWeekClick} className="text-[13px] sm:text-[15px] px-3 sm:px-4 h-10 sm:h-12 border border-blue-600 rounded-xl font-bold bg-blue-600 text-white shadow-sm flex items-center justify-center hover:bg-blue-700 active:bg-blue-800 active:scale-95 touch-manipulation whitespace-nowrap shrink-0 transition-all">이번 주</button>
                <button onClick={() => changeWeek(1)} className="w-10 sm:w-12 h-10 sm:h-12 flex items-center justify-center border-[1.5px] border-gray-300 rounded-xl bg-white shadow-sm hover:bg-gray-50 active:bg-gray-100 active:scale-95 touch-manipulation text-gray-700 shrink-0 transition-all">
                  <svg className="w-6 h-6 sm:w-7 sm:h-7" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" /></svg>
                </button>
              </div>

            </div>
          </div>

          <div
            className="flex-1 px-2 min-[360px]:px-4 pb-4 pt-2 md:px-6 md:pb-6 md:pt-3 bg-gray-50/30"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            <div className="border-2 border-gray-400 rounded-lg shadow-sm overflow-hidden">
              <table className="w-full table-fixed text-center border-collapse">
                <thead>
                  <tr className="bg-sky-100 border-b-2 border-gray-400">
                    <th
                      className="pt-1 pb-1.5 px-0 border-r border-gray-400 font-extrabold text-gray-700 w-[14%] sm:w-28 select-none text-[11px] min-[360px]:text-[13px] landscape:text-[21px] md:text-[23px] leading-tight touch-manipulation"
                    >
                      <span>팀명</span><br /><span>요일</span>
                      {isManagerMode && (
                        <div className="mt-1 flex flex-col gap-1 items-center justify-center">
                          <button
                            onClick={copyPreviousWeek}
                            className="bg-blue-500 hover:bg-blue-600 text-white text-[14px] sm:text-[16px] px-3 py-1 rounded shadow-sm transition-colors active:scale-95 whitespace-nowrap"
                          >
                            복제
                          </button>
                          <button
                            onClick={deleteCurrentWeek}
                            className="bg-red-500 hover:bg-red-600 text-white text-[14px] sm:text-[16px] px-3 py-1 rounded shadow-sm transition-colors active:scale-95 whitespace-nowrap"
                          >
                            삭제
                          </button>
                        </div>
                      )}
                    </th>
                    {currentDays.map((day, i) => {
                      const dateStr = formatDateString(day);
                      const isToday = dateStr === adjustedTodayStr;
                      return (
                        <th
                          key={i}
                          className={`pt-0.5 pb-1.5 px-0 font-extrabold text-gray-900 select-none text-[11px] min-[360px]:text-[13px] landscape:text-[21px] md:text-[23px] leading-tight touch-manipulation tracking-tighter sm:tracking-normal ${isToday ? 'border-x-[4px] sm:border-x-[6px] border-t-[4px] sm:border-t-[6px] border-red-500 relative z-10' : 'border-r border-gray-400'}`}
                        >
                          {day.getMonth() + 1}/{day.getDate()}<br className="block md:hidden" /> ({weekDays[i]})
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {timeSlots.map((time, ti) => (
                    <tr key={ti} className={`${ti === 2 ? 'border-b-[3px] border-gray-500' : 'border-b border-gray-400 last:border-0'}`}>
                      <td
                        className={`p-0.5 sm:p-1.5 bg-sky-100 border-r border-gray-400 font-extrabold select-none text-[13px] min-[360px]:text-[15px] landscape:text-[21px] md:text-[25px] tracking-tighter sm:tracking-normal touch-manipulation ${ti === 0 ? 'text-blue-800' : 'text-indigo-800'}`}
                      >
                        {time}
                      </td>
                      {currentDays.map((day, di) => {
                        const dateStr = formatDateString(day);
                        const key = getScheduleKey(dateStr, time);

                        const mmdd = dateStr.substring(5);
                        const isSystemHoliday = holidayDates.has(mmdd);
                        let state = schedule[key];

                        if (isSystemHoliday) {
                          state = `holiday:${holidayDates.get(mmdd)}`;
                        }

                        const isToday = dateStr === adjustedTodayStr;
                        const isLastRow = ti === timeSlots.length - 1;

                        const isHolidayStr = typeof state === 'string' && state.startsWith('holiday:');
                        const isBlankStr = typeof state === 'string' && state.trim() === '';
                        const isCustomStr = typeof state === 'string' && !isBlankStr && state !== 'nangman' && state !== 'pending' && state !== 'disabled' && !state.startsWith('disabled:') && !state.startsWith('holiday:');
                        const isDisabledStr = typeof state === 'string' && (state.startsWith('disabled:') || state === 'disabled');
                        const cellBg = state === true ? 'bg-green-200' : state === 'nangman' ? 'bg-indigo-600' : state === 'pending' ? 'bg-gray-200' : isHolidayStr ? 'bg-red-50' : isBlankStr ? 'bg-white' : isCustomStr ? 'bg-emerald-100' : 'bg-rose-50';
                        const textCol = state === true ? 'text-green-900' : state === 'nangman' ? 'text-white' : state === 'pending' ? 'text-gray-700' : isHolidayStr ? 'text-red-600' : isBlankStr ? 'text-gray-500' : isCustomStr ? 'text-emerald-900' : 'text-rose-600';
                        const cellPadding = (state === 'nangman' || isCustomStr) ? 'px-0 py-1' : 'p-0.5 sm:p-2';

                        let cellContent = null;
                        if (state === true) cellContent = <>사용<br />가능</>;
                        else if (state === 'nangman') cellContent = <span className="block whitespace-nowrap -mx-1 tracking-tighter" style={{ letterSpacing: '-1px' }}>낭만<br /><span className="text-[9px] min-[360px]:text-[10px] landscape:text-[17px] md:text-[18px]">스튜디오</span></span>;
                        else if (state === 'pending') cellContent = <span>미정</span>;
                        else if (isHolidayStr) {
                          const hName = state.replace('holiday:', '');
                          cellContent = <span className="block whitespace-pre-wrap leading-tight text-[11px] sm:text-[13px] landscape:text-[15px] md:text-[18px] font-bold">{hName}</span>;
                        } else if (isDisabledStr) {
                          cellContent = <>사용<br />불가</>;
                        } else if (isCustomStr) {
                          const parts = state.split('\\n');
                          cellContent = <span className="block whitespace-nowrap -mx-1 tracking-tighter text-[13px] sm:text-[16px] landscape:text-[22px] md:text-[26px] font-black leading-tight drop-shadow-sm">{parts.map((p, idx) => <React.Fragment key={idx}>{p}<br /></React.Fragment>)}</span>;
                        }
                        return (
                          <td key={di}
                            className={`${cellPadding} transition-all h-10 min-[360px]:h-12 md:h-16 touch-manipulation ${(isManagerMode && !isSystemHoliday) ? 'hover:brightness-95 active:scale-95' : 'cursor-default'} ${cellBg} ${isToday ? (isLastRow ? 'border-x-[4px] sm:border-x-[6px] border-b-[4px] sm:border-b-[6px] border-red-500 relative z-10' : 'border-x-[4px] sm:border-x-[6px] border-red-500 relative z-10') : 'border-r border-gray-400 relative'}`}>
                            <span className={`text-[12px] min-[360px]:text-[13px] landscape:text-[22px] md:text-[24px] leading-tight inline-block font-semibold ${textCol} relative z-0 pointer-events-none`}>
                              {cellContent}
                            </span>
                            {isManagerMode && !isSystemHoliday && (
                              <select
                                value={typeof state === 'string' && state !== 'nangman' && state !== 'pending' ? state.replace('holiday:', '').replace('disabled:', '') : "false"}
                                onChange={(e) => handleSelectChange(key, e.target.value)}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                              >
                                <option value="false" hidden></option>
                                <option value="     ">     </option>
                                <option value="1조">1조</option>
                                <option value="2조">2조</option>
                                <option value="3조">3조</option>
                                <option value="4조">4조</option>
                                <option value="disabled">사용불가</option>
                                {isCustomStr && !["1조", "2조", "3조", "4조", "disabled", "     "].includes(state.replace('holiday:', '').replace('disabled:', '')) && (
                                  <option value={state.replace('holiday:', '').replace('disabled:', '')} hidden>
                                    {state.replace('holiday:', '').replace('disabled:', '')}
                                  </option>
                                )}
                              </select>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-6 bg-gray-100 p-4 rounded-xl border border-gray-200 shadow-inner">
              <div className="flex justify-between items-center mb-2">
                <h3 className="font-bold text-gray-700 flex items-center gap-2 text-sm landscape:text-[20px] md:text-[22px]">📢 공지 및 메모</h3>
                <button
                  onClick={() => handleRequestNavigate(onNavigateToClassroom)}
                  className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs md:text-sm font-bold shadow-sm transition-all active:scale-95 touch-manipulation"
                >
                  평생교육실2
                </button>
              </div>
              <textarea
                value={memo}
                onChange={(e) => {
                  if (!isManagerMode) return;
                  const nextVal = e.target.value;
                  memoRef.current = nextVal;
                  hasLocalEditRef.current = true;
                  setMemo(nextVal);
                }}
                readOnly={!isManagerMode}
                placeholder={isManagerMode ? "수정 후 상단 [데이터 저장] 버튼을 눌러 저장하세요." : "담당자 모드에서만 작성 가능합니다."}
                className={`w-full p-3 md:p-4 border rounded-xl font-bold h-[116px] md:h-[148px] outline-none transition-all text-sm landscape:text-[20px] md:text-[22px] leading-relaxed text-black bg-white ${isManagerMode ? 'border-blue-300' : 'border-gray-300'}`}
              />
              {hasUnsavedChanges && (
                <div className="text-[11px] text-amber-600 mt-1.5 font-bold text-right">
                  변경된 내용이 있습니다. 상단의 [데이터 저장] 또는 [처음으로]를 눌러 저장해 주세요.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>

      {showExitSaveModal && (
        <div
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-[3px] flex items-center justify-center z-[80] px-4"
          onClick={handleCancelExit}
        >
          <div
            className="bg-white p-6 rounded-2xl shadow-2xl max-w-sm w-full border border-slate-200 animate-fadeIn"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-extrabold text-slate-900 mb-2 text-center">
              {saveModalMode === 'saveOnly' ? '데이터 저장' : '변경 내용 저장'}
            </h3>
            <p className="text-sm text-slate-600 font-semibold text-center mb-5">
              변경된 내용을 저장하시겠습니까?
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleCancelExit}
                disabled={isSavingExit}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-sm transition active:scale-95 disabled:opacity-50 touch-manipulation cursor-pointer"
              >
                취소
              </button>
              {saveModalMode === 'exit' && (
                <button
                  type="button"
                  onClick={handleDiscardAndExit}
                  disabled={isSavingExit}
                  className="flex-1 py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-xl font-bold text-sm transition active:scale-95 disabled:opacity-50 touch-manipulation cursor-pointer whitespace-nowrap"
                >
                  저장 안 함
                </button>
              )}
              <button
                type="button"
                onClick={handleConfirmSaveAndExit}
                disabled={isSavingExit}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-extrabold text-sm shadow-md shadow-blue-600/25 transition active:scale-95 disabled:opacity-50 touch-manipulation cursor-pointer"
              >
                {isSavingExit ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
