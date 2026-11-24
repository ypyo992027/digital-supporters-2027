//공휴일/휴무일 관리

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { supabaseClient } from '../utils/supabase';
import { Home, LucideCalendar } from './Icons';
import { getShiftWeight } from '../utils/helpers';
import { hasValidSavedAdminPassword } from '../utils/appSettings';

const WEEKDAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

const KOREA_PUBLIC_HOLIDAYS = {
  2026: [
    { date: '01-01', name: '신정' },
    { date: '02-16', name: '설날 연휴' },
    { date: '02-17', name: '설날' },
    { date: '02-18', name: '설날 연휴' },
    { date: '03-01', name: '삼일절' },
    { date: '03-02', name: '삼일절 대체공휴일' },
    { date: '05-05', name: '어린이날' },
    { date: '05-24', name: '부처님오신날' },
    { date: '05-25', name: '부처님오신날 대체공휴일' },
    { date: '06-03', name: '전국동시지방선거일' },
    { date: '06-06', name: '현충일' },
    { date: '08-15', name: '광복절' },
    { date: '08-17', name: '광복절 대체공휴일' },
    { date: '09-24', name: '추석 연휴' },
    { date: '09-25', name: '추석' },
    { date: '09-26', name: '추석 연휴' },
    { date: '10-03', name: '개천절' },
    { date: '10-05', name: '개천절 대체공휴일' },
    { date: '10-09', name: '한글날' },
    { date: '12-25', name: '성탄절' }
  ],
  2027: [
    { date: '01-01', name: '신정' },
    { date: '02-06', name: '설날 연휴' },
    { date: '02-07', name: '설날' },
    { date: '02-08', name: '설날 연휴' },
    { date: '02-09', name: '설날 대체공휴일' },
    { date: '03-01', name: '삼일절' },
    { date: '05-01', name: '근로자의 날' },
    { date: '05-03', name: '근로자의 날 대체공휴일' },
    { date: '05-05', name: '어린이날' },
    { date: '05-13', name: '부처님오신날' },
    { date: '06-06', name: '현충일' },
    { date: '07-17', name: '제헌절' },
    { date: '07-19', name: '제헌절 대체공휴일' },
    { date: '08-15', name: '광복절' },
    { date: '08-16', name: '광복절 대체공휴일' },
    { date: '09-14', name: '추석 연휴' },
    { date: '09-15', name: '추석' },
    { date: '09-16', name: '추석 연휴' },
    { date: '10-03', name: '개천절' },
    { date: '10-04', name: '개천절 대체공휴일' },
    { date: '10-09', name: '한글날' },
    { date: '10-11', name: '한글날 대체공휴일' },
    { date: '12-25', name: '성탄절' }
  ]
};

const parseMonthDay = (raw) => {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  const fullMatch = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (fullMatch) {
    return {
      year: parseInt(fullMatch[1], 10),
      month: parseInt(fullMatch[2], 10),
      day: parseInt(fullMatch[3], 10)
    };
  }
  const mdMatch = trimmed.match(/^(\d{1,2})[-/](\d{1,2})$/);
  if (mdMatch) {
    return {
      year: null,
      month: parseInt(mdMatch[1], 10),
      day: parseInt(mdMatch[2], 10)
    };
  }
  return null;
};

const normalizeHolidayDate = (raw) => {
  const parsed = parseMonthDay(raw);
  if (!parsed) return '';
  const { year, month, day } = parsed;
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';
  const checkYear = year || 2024;
  const checkDate = new Date(checkYear, month - 1, day);
  if (checkDate.getMonth() !== month - 1 || checkDate.getDate() !== day) return '';
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const compareHolidayDates = (a, b) => {
  const pa = parseMonthDay(a?.date);
  const pb = parseMonthDay(b?.date);
  const scoreA = pa ? pa.month * 100 + pa.day : 9999;
  const scoreB = pb ? pb.month * 100 + pb.day : 9999;
  return scoreA - scoreB;
};

const toDateInputValue = (rawDate, year) => {
  const mmdd = normalizeHolidayDate(rawDate);
  if (!mmdd) return '';
  return `${year}-${mmdd}`;
};

const getHolidayDateMeta = (rawDate, year) => {
  const mmdd = normalizeHolidayDate(rawDate);
  if (!mmdd) {
    return {
      mmdd: rawDate || '',
      month: 0,
      day: 0,
      weekday: '',
      dayOfWeek: -1,
      isSaturday: false,
      isSunday: false,
      isWeekend: false,
      fullDate: '',
      diffDays: null,
      dDayLabel: ''
    };
  }
  const [mStr, dStr] = mmdd.split('-');
  const month = parseInt(mStr, 10);
  const day = parseInt(dStr, 10);
  const target = new Date(year, month - 1, day);
  const dayOfWeek = target.getDay();
  const weekday = WEEKDAY_NAMES[dayOfWeek];

  const now = new Date();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((target.getTime() - todayMidnight.getTime()) / (1000 * 60 * 60 * 24));
  let dDayLabel = '';
  if (diffDays === 0) dDayLabel = '오늘';
  else if (diffDays > 0) dDayLabel = `D-${diffDays}`;
  else dDayLabel = '';

  return {
    mmdd,
    month,
    day,
    weekday,
    dayOfWeek,
    isSaturday: dayOfWeek === 6,
    isSunday: dayOfWeek === 0,
    isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
    fullDate: `${year}-${mmdd}`,
    diffDays,
    dDayLabel
  };
};

export default function HolidayManagementApp({ onNavigateBack }) {
  const currentSystemYear = new Date().getFullYear();
  const availableYears = useMemo(() => {
    const set = new Set([2026, 2027, currentSystemYear]);
    return Array.from(set).sort((a, b) => a - b);
  }, [currentSystemYear]);

  const [targetYear, setTargetYear] = useState(currentSystemYear);
  const [holidays, setHolidays] = useState([]);
  const [formData, setFormData] = useState({ date: '', name: '', content1: '', content2: '', vacation_available: false });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [notice, setNotice] = useState("");
  const [editingCell, setEditingCell] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [showApplyPopup, setShowApplyPopup] = useState(false);
  const [popupMessage, setPopupMessage] = useState("");
  const popupTimerRef = useRef(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMonth, setSelectedMonth] = useState("all"); // 'all' | 1..12

  const [editModalData, setEditModalData] = useState(null);
  const [showPresetModal, setShowPresetModal] = useState(false);
  const [presetYear, setPresetYear] = useState(() => (currentSystemYear === 2026 || currentSystemYear === 2027 ? currentSystemYear : 2027));
  const [selectedPresetDates, setSelectedPresetDates] = useState([]);

  const [isAdmin] = useState(() => hasValidSavedAdminPassword());

  useEffect(() => {
    fetchHolidays();
    return () => {
      if (popupTimerRef.current) {
        clearTimeout(popupTimerRef.current);
      }
    };
  }, []);

  const closeStatusPopup = () => {
    if (popupTimerRef.current) {
      clearTimeout(popupTimerRef.current);
      popupTimerRef.current = null;
    }
    setShowApplyPopup(false);
    setPopupMessage("");
  };

  const showStatusPopup = (message, durationMs = 200) => {
    if (popupTimerRef.current) {
      clearTimeout(popupTimerRef.current);
    }
    setPopupMessage(message);
    setShowApplyPopup(true);
    popupTimerRef.current = setTimeout(() => {
      setShowApplyPopup(false);
      setPopupMessage("");
      popupTimerRef.current = null;
    }, durationMs);
  };

  const fetchHolidays = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabaseClient
        .from('holidays')
        .select('*')
        .order('date', { ascending: true });

      if (error) throw error;
      const sorted = [...(data || [])].sort(compareHolidayDates);
      setHolidays(sorted);
    } catch (err) {
      console.error(err);
      setNotice("데이터를 불러오는데 실패했습니다 (DB에 holidays 테이블이 없을 수 있습니다).");
    } finally {
      setLoading(false);
    }
  };

  const existingNormalizedDates = useMemo(() => {
    const set = new Set();
    holidays.forEach(h => {
      const norm = normalizeHolidayDate(h.date);
      if (norm) set.add(norm);
    });
    return set;
  }, [holidays]);

  const holidaySummary = useMemo(() => {
    const monthCounts = new Map();

    holidays.forEach(h => {
      const meta = getHolidayDateMeta(h.date, targetYear);
      if (meta.month >= 1 && meta.month <= 12) {
        monthCounts.set(meta.month, (monthCounts.get(meta.month) || 0) + 1);
      }
    });

    const months = Array.from(monthCounts.entries()).sort((a, b) => a[0] - b[0]);
    return { total: holidays.length, months };
  }, [holidays, targetYear]);

  const filteredHolidays = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return holidays.filter(h => {
      const meta = getHolidayDateMeta(h.date, targetYear);
      if (selectedMonth !== 'all' && meta.month !== selectedMonth) return false;
      if (q) {
        const hay = `${h.date || ''} ${meta.mmdd} ${meta.weekday} ${h.name || ''} ${h.content1 || ''} ${h.content2 || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [holidays, targetYear, selectedMonth, searchQuery]);

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    if (name === 'date') {
      const normalized = normalizeHolidayDate(value);
      setFormData(prev => ({ ...prev, date: normalized || value }));
      return;
    }
    setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const handleAdd = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const normalizedDate = normalizeHolidayDate(formData.date);
    const trimmedName = (formData.name || '').trim();

    if (!normalizedDate || !trimmedName) {
      alert("유효한 날짜(MM-DD)와 공휴일 이름은 필수입니다.");
      return;
    }

    if (existingNormalizedDates.has(normalizedDate)) {
      alert(`이미 등록된 날짜(${normalizedDate})입니다.`);
      return;
    }

    setSaving(true);
    setNotice("");
    try {
      const { data: existing, error: checkError } = await supabaseClient
        .from('holidays')
        .select('date')
        .eq('date', normalizedDate);

      if (checkError) throw checkError;
      if (existing && existing.length > 0) {
        alert("이미 등록된 날짜입니다.");
        setSaving(false);
        return;
      }

      const payload = {
        date: normalizedDate,
        name: trimmedName,
        content1: formData.content1 ? formData.content1.trim() : '',
        content2: formData.content2 ? formData.content2.trim() : '',
        vacation_available: Boolean(formData.vacation_available)
      };

      const { data: maxData } = await supabaseClient
        .from('holidays')
        .select('id')
        .order('id', { ascending: false })
        .limit(1);

      payload.id = maxData && maxData.length > 0 ? maxData[0].id + 1 : 1;

      const { error } = await supabaseClient
        .from('holidays')
        .insert(payload);

      if (error) throw error;

      setFormData({ date: '', name: '', content1: '', content2: '', vacation_available: false });
      await fetchHolidays();
      showStatusPopup("데이터가 저장되었습니다.");
    } catch (err) {
      console.error(err);
      setNotice("추가 중 오류가 발생했습니다: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleOpenEditModal = (holiday) => {
    setEditModalData({
      originalId: holiday.id ?? null,
      originalDate: holiday.date,
      date: normalizeHolidayDate(holiday.date) || holiday.date || '',
      name: holiday.name || '',
      content1: holiday.content1 || '',
      content2: holiday.content2 || '',
      vacation_available: Boolean(holiday.vacation_available)
    });
  };

  const handleSaveEditModal = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!editModalData) return;

    const normalizedDate = normalizeHolidayDate(editModalData.date);
    const trimmedName = (editModalData.name || '').trim();
    if (!normalizedDate || !trimmedName) {
      alert("유효한 날짜(MM-DD)와 공휴일 이름을 입력해 주세요.");
      return;
    }

    const originalNorm = normalizeHolidayDate(editModalData.originalDate);
    if (normalizedDate !== originalNorm) {
      const localDup = holidays.some(
        h => (editModalData.originalId != null ? h.id !== editModalData.originalId : h.date !== editModalData.originalDate) &&
          normalizeHolidayDate(h.date) === normalizedDate
      );
      if (localDup) {
        alert(`이미 등록된 날짜(${normalizedDate})입니다.`);
        return;
      }
      const { data: dbDup, error: dupErr } = await supabaseClient
        .from('holidays')
        .select('id, date')
        .eq('date', normalizedDate);
      if (dupErr) {
        alert("중복 확인 중 오류가 발생했습니다: " + dupErr.message);
        return;
      }
      if (dbDup && dbDup.some(d => d.id !== editModalData.originalId)) {
        alert(`이미 등록된 날짜(${normalizedDate})입니다.`);
        return;
      }
    }

    setSaving(true);
    setNotice("");
    try {
      const updatePayload = {
        date: normalizedDate,
        name: trimmedName,
        content1: (editModalData.content1 || '').trim(),
        content2: (editModalData.content2 || '').trim(),
        vacation_available: Boolean(editModalData.vacation_available)
      };

      const query = supabaseClient.from('holidays').update(updatePayload);
      const { error } = editModalData.originalId != null
        ? await query.eq('id', editModalData.originalId)
        : await query.eq('date', editModalData.originalDate);

      if (error) throw error;

      setEditModalData(null);
      await fetchHolidays();
      showStatusPopup("데이터가 저장되었습니다.");
    } catch (err) {
      console.error(err);
      alert("수정 중 오류가 발생했습니다: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (holiday) => {
    const label = holiday.name ? `'${holiday.name}' (${holiday.date})` : holiday.date;
    if (!confirm(`${label} 휴무일을 삭제하시겠습니까?`)) return;

    setSaving(true);
    setNotice("");
    try {
      const query = supabaseClient.from('holidays').delete();
      const { error } = holiday.id != null
        ? await query.eq('id', holiday.id)
        : await query.eq('date', holiday.date);

      if (error) throw error;

      await fetchHolidays();
      showStatusPopup("데이터가 삭제되었습니다.");
    } catch (err) {
      console.error(err);
      setNotice("삭제 중 오류가 발생했습니다: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveCell = async (date, field) => {
    if (!editingCell) return;
    setEditingCell(null);

    const original = holidays.find(h => h.date === date);
    if (!original) return;

    const trimmedValue = editValue.trim();
    if ((original[field] || '') === trimmedValue) return;
    if (field === 'name' && !trimmedValue) {
      alert("공휴일 이름은 비워둘 수 없습니다.");
      return;
    }

    setSaving(true);
    setNotice("");
    try {
      const { error } = await supabaseClient
        .from('holidays')
        .update({ [field]: trimmedValue })
        .eq('date', date);

      if (error) throw error;

      await fetchHolidays();
      showStatusPopup("데이터가 저장되었습니다.");
    } catch (err) {
      console.error(err);
      alert("수정 중 오류가 발생했습니다: " + err.message);
      await fetchHolidays();
    } finally {
      setSaving(false);
    }
  };

  const handleToggleVacation = async (date, currentValue) => {
    setSaving(true);
    setNotice("");
    try {
      const { error } = await supabaseClient
        .from('holidays')
        .update({ vacation_available: !currentValue })
        .eq('date', date);

      if (error) throw error;

      await fetchHolidays();
      showStatusPopup("데이터가 저장되었습니다.");
    } catch (err) {
      console.error(err);
      alert("수정 중 오류가 발생했습니다: " + err.message);
      await fetchHolidays();
    } finally {
      setSaving(false);
    }
  };

  const selectWeekdayPresetsForYear = (yearValue) => {
    const list = KOREA_PUBLIC_HOLIDAYS[yearValue] || [];
    return list
      .filter(item => {
        if (existingNormalizedDates.has(item.date)) return false;
        const meta = getHolidayDateMeta(item.date, yearValue);
        return !meta.isWeekend;
      })
      .map(item => item.date);
  };

  const handleOpenPresetModal = () => {
    const defaultPresetYear = targetYear === 2026 || targetYear === 2027 ? targetYear : 2027;
    setPresetYear(defaultPresetYear);
    setSelectedPresetDates(selectWeekdayPresetsForYear(defaultPresetYear));
    setShowPresetModal(true);
  };

  const handleChangePresetYear = (yearValue) => {
    setPresetYear(yearValue);
    setSelectedPresetDates(selectWeekdayPresetsForYear(yearValue));
  };

  const handleTogglePresetDate = (dateStr) => {
    if (existingNormalizedDates.has(dateStr)) return;
    setSelectedPresetDates(prev =>
      prev.includes(dateStr) ? prev.filter(d => d !== dateStr) : [...prev, dateStr]
    );
  };

  const handleBulkImportPresets = async () => {
    const list = KOREA_PUBLIC_HOLIDAYS[presetYear] || [];
    const toInsert = list.filter(
      item => selectedPresetDates.includes(item.date) && !existingNormalizedDates.has(item.date)
    );
    if (toInsert.length === 0) {
      alert("추가할 법정공휴일을 선택해 주세요.");
      return;
    }

    setSaving(true);
    setNotice("");
    try {
      const { data: maxData } = await supabaseClient
        .from('holidays')
        .select('id')
        .order('id', { ascending: false })
        .limit(1);

      let nextId = maxData && maxData.length > 0 ? maxData[0].id + 1 : 1;
      const payloads = toInsert.map(item => ({
        id: nextId++,
        date: item.date,
        name: item.name,
        content1: '휴관',
        content2: '휴강',
        vacation_available: false
      }));

      const { error } = await supabaseClient
        .from('holidays')
        .insert(payloads);

      if (error) throw error;

      setShowPresetModal(false);
      await fetchHolidays();
      showStatusPopup("데이터가 저장되었습니다.");
    } catch (err) {
      console.error(err);
      alert("법정공휴일 일괄 등록 중 오류가 발생했습니다: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const renderCell = (holiday, field, className) => {
    const isEditing = editingCell && editingCell.date === holiday.date && editingCell.field === field;
    const value = holiday[field] || '';

    if (isAdmin) {
      if (isEditing) {
        return (
          <input
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={() => handleSaveCell(holiday.date, field)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur();
              } else if (e.key === 'Escape') {
                setEditingCell(null);
              }
            }}
            className="w-full p-1.5 border border-indigo-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 text-sm font-medium text-black bg-white"
            autoFocus
          />
        );
      }
      return (
        <div
          onClick={() => {
            setEditingCell({ date: holiday.date, field });
            setEditValue(value);
          }}
          className={`${className} cursor-pointer hover:bg-blue-50/80 px-1.5 py-1 rounded-md transition-colors min-h-[28px] flex items-center`}
          title="클릭하여 바로 수정"
        >
          {value || <span className="text-gray-400 italic text-xs font-normal">(입력)</span>}
        </div>
      );
    }

    return (
      <span className={`${className} px-1.5 py-1 block min-h-[28px] flex items-center`}>
        {value || <span className="text-gray-300 italic text-xs font-normal">-</span>}
      </span>
    );
  };

  const handleApplyToSchedule = async (targetList = holidays) => {
    if (!targetList || targetList.length === 0) {
      alert("일정표에 적용할 공휴일 데이터가 없습니다.");
      return;
    }

    const generateUUID = () => {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
      }
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    };

    const confirmMsg = targetList.length === 1
      ? `${targetYear}년 일정표에 '${targetList[0].name || targetList[0].date}' (${targetList[0].date}) 데이터를 적용하시겠습니까?`
      : `${targetYear}년 일정표에 공휴일 데이터 ${targetList.length}건을 적용하시겠습니까?`;

    if (!confirm(confirmMsg)) return;

    setApplying(true);
    setNotice("");
    try {
      const { data: allTeachers, error: tErr } = await supabaseClient
        .from('teachers')
        .select('*');

      if (tErr) throw tErr;

      let totalUpdated = 0;
      for (const holiday of targetList) {
        const formattedMonthDay = normalizeHolidayDate(holiday.date) || holiday.date;
        const fullDate = `${targetYear}-${formattedMonthDay}`;

        const { data: logsData, error: fetchError } = await supabaseClient
          .from('daily_logs')
          .select('*')
          .eq('log_date', fullDate);

        if (fetchError) throw fetchError;

        const updatedLogs = [];

        allTeachers.forEach(teacher => {
          const teacherName = teacher.name.trim();
          const shifts = [teacher.shift1, teacher.shift2, teacher.shift3]
            .map(s => (s || "").trim())
            .filter(Boolean);

          if (shifts.length === 0) return;

          const sortedShifts = [...shifts].sort((a, b) => getShiftWeight(a) - getShiftWeight(b));
          const firstShift = sortedShifts[0];

          shifts.forEach(shift => {
            const existingLog = logsData ? logsData.find(l => l.teacher.trim() === teacherName && l.shift.trim() === shift) : null;

            if (existingLog) {
              if (shift === firstShift) {
                updatedLogs.push({
                  ...existingLog,
                  student: holiday.name,
                  location: holiday.content1,
                  status: holiday.content2,
                  attendance: ""
                });
              } else {
                updatedLogs.push({
                  ...existingLog,
                  student: "",
                  location: "",
                  status: "",
                  attendance: ""
                });
              }
            } else if (shift === firstShift) {
              updatedLogs.push({
                id: generateUUID(),
                team: teacher.team,
                log_date: fullDate,
                teacher: teacherName,
                shift: shift,
                student: holiday.name,
                location: holiday.content1,
                status: holiday.content2,
                attendance: ""
              });
            }
          });
        });

        if (updatedLogs.length > 0) {
          const { error: upsertError } = await supabaseClient
            .from('daily_logs')
            .upsert(updatedLogs, { onConflict: 'team,log_date,teacher,shift' });

          if (upsertError) throw upsertError;
          totalUpdated += updatedLogs.length;
        }
      }

      showStatusPopup(`성공적으로 ${targetYear}년 시간표에 적용되었습니다!\n(총 ${totalUpdated}건 업데이트)`, 2000);
    } catch (err) {
      console.error(err);
      setNotice("적용 중 오류가 발생했습니다: " + err.message);
    } finally {
      setApplying(false);
    }
  };

  const formMeta = useMemo(() => getHolidayDateMeta(formData.date, targetYear), [formData.date, targetYear]);
  const presetListForYear = KOREA_PUBLIC_HOLIDAYS[presetYear] || [];
  const availablePresetItems = presetListForYear.filter(item => !existingNormalizedDates.has(item.date));

  return (
    <div className="min-h-[100dvh] app-surface font-sans pb-10 flex flex-col">
      <header className="app-header text-white z-40 relative shrink-0">
        <div className={`max-w-5xl lg:max-w-[1536px] mx-auto px-2.5 sm:px-5 pt-safe-4 ${isAdmin ? 'pb-14 min-h-[120px]' : 'pb-4'} flex justify-between items-start relative`}>
          <div className="flex items-center">
            <div className="flex flex-col">
              <div className="flex items-center mb-1">
                <img src="/Logo_of_Seoul.jpg" alt="서울시 로고" className="h-7 hdr-logo object-contain mr-2 shrink-0" onError={(e) => e.target.style.display = 'none'} />
                <h1 className="font-black text-xl leading-tight">성동노인종합복지관</h1>
              </div>
              <p className="text-lg font-semibold text-yellow-300">디지털교육 서포터즈</p>
            </div>
          </div>

          {isAdmin && (
            <div className="absolute left-1/2 bottom-2 transform -translate-x-1/2 z-50">
              <span className="inline-block px-6 py-1.5 md:px-10 md:py-2 hdr-pill is-on font-bold text-sm md:text-base whitespace-nowrap select-none cursor-default">
                담당자 모드
              </span>
            </div>
          )}

          <button
            onClick={onNavigateBack}
            className="text-xs flex flex-col items-center font-bold p-2 rounded-lg shadow-md transition-all touch-manipulation hdr-btn shrink-0"
          >
            <Home className="w-5 h-5 mb-1" /> 처음으로
          </button>
        </div>
      </header>

      <main className={`px-2.5 sm:px-5 py-4 max-w-5xl lg:max-w-[1536px] mx-auto w-full flex-1 ${isAdmin ? 'space-y-4 mt-2' : 'mt-1'}`}>
        {/* 상단 타이틀 + 연도 선택 & 주요 작업 버튼 */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <h2 className="text-[19px] sm:text-xl font-extrabold text-gray-800 flex items-center tracking-tight">
            <LucideCalendar className="w-5 h-5 mr-2 text-blue-600 shrink-0" />
            <span>공휴일ㆍ휴무일 관리</span>
          </h2>

          {isAdmin && (
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              <select
                value={targetYear}
                onChange={(e) => setTargetYear(Number(e.target.value))}
                className="px-2.5 py-2 rounded-xl border border-slate-300 bg-white text-slate-800 text-xs sm:text-sm font-extrabold shadow-xs focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                title="요일 표시 및 시간표 적용 연도"
              >
                {availableYears.map(y => (
                  <option key={y} value={y}>{y}년 기준</option>
                ))}
              </select>

              <button
                type="button"
                onClick={handleOpenPresetModal}
                disabled={saving || loading}
                className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-bold shadow-sm active:scale-95 disabled:opacity-50 transition whitespace-nowrap cursor-pointer"
              >
                + 법정공휴일 불러오기
              </button>

              <button
                type="button"
                onClick={() => handleApplyToSchedule()}
                disabled={applying || loading || saving || holidays.length === 0}
                className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs sm:text-sm font-bold shadow-sm active:scale-95 disabled:opacity-50 transition whitespace-nowrap cursor-pointer"
              >
                {applying ? '적용 중...' : '전체 시간표 적용'}
              </button>
            </div>
          )}
        </div>

        {notice && (
          <div className={`p-3.5 rounded-xl font-bold shadow-sm animate-fadeIn text-sm ${notice.includes('실패') || notice.includes('오류') ? 'bg-red-100 text-red-700 border border-red-200' : 'bg-green-100 text-green-700 border border-green-200'}`}>
            {notice}
          </div>
        )}

        {!isAdmin ? (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl py-3.5 px-4 sm:py-4 sm:px-5 text-center shadow-xs w-full mt-1">
            <p className="font-extrabold text-amber-800 text-base sm:text-lg flex items-center justify-center gap-2">
              <span className="text-xl sm:text-2xl">💡</span>
              <span>메인 화면 우측 상단 [설정]에서 관리자 비밀번호를 저장해 주세요.</span>
            </p>
          </div>
        ) : (
          <>
            {/* 빠른 추가 카드 */}
            <form onSubmit={handleAdd} className="bg-white rounded-2xl shadow-sm border border-slate-300 p-3.5 sm:p-5 space-y-3 animate-fadeIn overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm sm:text-base font-extrabold text-slate-800">새 공휴일 / 휴무일 빠른 등록</span>
                <div className="flex items-center gap-2 shrink-0">
                  <label className="flex items-center gap-1.5 cursor-pointer bg-blue-50 px-3 py-1.5 rounded-xl border border-blue-200 hover:bg-blue-100 transition-colors whitespace-nowrap">
                    <input
                      type="checkbox"
                      name="vacation_available"
                      checked={formData.vacation_available}
                      onChange={handleInputChange}
                      className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                    />
                    <span className="text-xs sm:text-sm font-bold text-blue-800">개별수업 가능</span>
                  </label>

                  <button
                    type="submit"
                    disabled={saving || loading}
                    className="px-4 py-1.5 sm:py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-extrabold rounded-xl shadow-sm active:scale-95 disabled:opacity-50 transition whitespace-nowrap cursor-pointer"
                  >
                    + 등록
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-12 gap-2 sm:gap-2.5 items-end">
                {/* 날짜 선택과 이름을 한 줄에 배치 (모바일 6:6, 데스크톱 4:3) */}
                <div className="col-span-6 sm:col-span-6 lg:col-span-4 min-w-0">
                  <label className="flex items-center justify-between text-[11px] sm:text-[11.5px] font-bold text-blue-600 mb-1">
                    <span className="truncate">날짜 선택 *</span>
                    {formMeta.weekday && (
                      <span className={`px-1.5 py-px rounded text-[10px] sm:text-[10.5px] font-extrabold shrink-0 ${
                        formMeta.isSunday ? 'bg-rose-100 text-rose-700' : formMeta.isSaturday ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-700'
                      }`}>
                        {formMeta.mmdd} ({formMeta.weekday})
                      </span>
                    )}
                  </label>
                  <input
                    type="date"
                    value={toDateInputValue(formData.date, targetYear)}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (!val) {
                        setFormData(prev => ({ ...prev, date: '' }));
                      } else {
                        const mmdd = normalizeHolidayDate(val);
                        if (mmdd) setFormData(prev => ({ ...prev, date: mmdd }));
                      }
                    }}
                    className="w-full min-w-0 p-1.5 sm:p-2 border border-slate-300 rounded-xl text-xs sm:text-sm bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500 font-bold"
                  />
                </div>

                <div className="col-span-6 sm:col-span-6 lg:col-span-3 min-w-0">
                  <label className="block text-[11px] sm:text-[11.5px] font-bold text-blue-600 mb-1 truncate">이름 *</label>
                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleInputChange}
                    placeholder="예: 삼일절"
                    className="w-full min-w-0 p-1.5 sm:p-2 border border-slate-300 rounded-xl text-xs sm:text-sm bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500 font-bold"
                  />
                </div>

                <div className="col-span-6 sm:col-span-6 lg:col-span-2 min-w-0">
                  <label className="block text-[11px] sm:text-[11.5px] font-bold text-slate-600 mb-1 truncate">내용1</label>
                  <input
                    type="text"
                    name="content1"
                    value={formData.content1}
                    onChange={handleInputChange}
                    placeholder="예: 휴관"
                    className="w-full min-w-0 p-1.5 sm:p-2 border border-slate-300 rounded-xl text-xs sm:text-sm bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500 font-medium"
                  />
                </div>

                <div className="col-span-6 sm:col-span-6 lg:col-span-3 min-w-0">
                  <label className="block text-[11px] sm:text-[11.5px] font-bold text-slate-600 mb-1 truncate">내용2</label>
                  <input
                    type="text"
                    name="content2"
                    value={formData.content2}
                    onChange={handleInputChange}
                    placeholder="예: 휴강"
                    className="w-full min-w-0 p-1.5 sm:p-2 border border-slate-300 rounded-xl text-xs sm:text-sm bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500 font-medium"
                  />
                </div>
              </div>
            </form>

            {/* 검색 및 월별 필터 바 */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-300 p-3.5 sm:p-5 space-y-3 animate-fadeIn">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="relative flex-1 max-w-md">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="날짜, 공휴일 이름, 내용으로 검색..."
                    className="w-full pl-3.5 pr-8 py-2 border border-slate-300 rounded-xl text-xs sm:text-sm font-medium bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 text-xs font-extrabold cursor-pointer"
                      aria-label="검색어 지우기"
                    >
                      ✕
                    </button>
                  )}
                </div>

                <div className="text-xs font-bold text-slate-500 whitespace-nowrap">
                  표시 중: <span className="text-slate-900 font-extrabold">{filteredHolidays.length}건</span>
                  {(selectedMonth !== 'all' || searchQuery) && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedMonth('all');
                        setSearchQuery('');
                      }}
                      className="ml-2 text-blue-600 hover:underline font-bold cursor-pointer"
                    >
                      필터 초기화
                    </button>
                  )}
                </div>
              </div>

              {holidaySummary.months.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSelectedMonth('all')}
                    className={`px-2.5 py-1 rounded-full text-xs font-bold border transition cursor-pointer ${
                      selectedMonth === 'all'
                        ? 'bg-slate-800 text-white border-slate-800'
                        : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    전체 ({holidaySummary.total})
                  </button>
                  {holidaySummary.months.map(([month, count]) => (
                    <button
                      key={month}
                      type="button"
                      onClick={() => setSelectedMonth(prev => prev === month ? 'all' : month)}
                      className={`px-2.5 py-1 rounded-full text-xs font-bold border transition cursor-pointer ${
                        selectedMonth === month
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {month}월 ({count})
                    </button>
                  ))}
                </div>
              )}

              {loading ? (
                <div className="text-center py-10">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                </div>
              ) : holidays.length === 0 ? (
                <div className="text-center py-10 text-gray-500 text-sm font-medium bg-slate-50 rounded-xl border border-dashed border-slate-300 space-y-3">
                  <p>저장된 공휴일/휴무일이 없습니다.</p>
                  <button
                    type="button"
                    onClick={handleOpenPresetModal}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-bold shadow-sm transition cursor-pointer"
                  >
                    + {targetYear}년 법정공휴일 한번에 불러오기
                  </button>
                </div>
              ) : filteredHolidays.length === 0 ? (
                <div className="text-center py-8 text-slate-500 text-sm font-semibold bg-slate-50 rounded-xl border border-dashed border-slate-300">
                  조건에 맞는 일정이 없습니다.
                </div>
              ) : (
                <>
                  {/* 모바일 카드 뷰 */}
                  <div className="md:hidden space-y-2.5">
                    {filteredHolidays.map((h) => {
                      const meta = getHolidayDateMeta(h.date, targetYear);
                      const isPast = meta.diffDays !== null && meta.diffDays < 0;
                      return (
                        <div
                          key={h.id ?? h.date}
                          className={`rounded-2xl border-[1.5px] p-3.5 transition ${
                            isPast ? 'bg-slate-50/80 border-slate-400 opacity-90' : 'bg-white border-slate-400 shadow-xs'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center flex-wrap gap-1.5">
                                <span className="text-base font-black text-slate-900 tabular-nums">{meta.mmdd}</span>
                                {meta.weekday && (
                                  <span className={`px-2 py-0.5 rounded-md text-xs font-black border ${
                                    meta.isSunday
                                      ? 'bg-rose-100 text-rose-700 border-rose-300'
                                      : meta.isSaturday
                                        ? 'bg-blue-100 text-blue-700 border-blue-300'
                                        : 'bg-slate-100 text-slate-700 border-slate-300'
                                  }`}>
                                    {meta.weekday}
                                  </span>
                                )}
                                {meta.dDayLabel && (
                                  <span className="px-2 py-0.5 rounded-md text-[11px] font-extrabold bg-blue-600 text-white shadow-xs">
                                    {meta.dDayLabel}
                                  </span>
                                )}
                              </div>
                              <div className="text-base font-extrabold text-slate-900 mt-1 break-words leading-snug">{h.name}</div>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleToggleVacation(h.date, h.vacation_available)}
                              disabled={saving || loading}
                              className={`px-2.5 py-1 rounded-full text-xs font-bold shrink-0 transition cursor-pointer active:scale-95 ${
                                h.vacation_available
                                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-400'
                                  : 'bg-slate-100 text-slate-600 border border-slate-300'
                              }`}
                              title="클릭하여 개별수업 가능 여부 변경"
                            >
                              {h.vacation_available ? '개별수업 가능' : '개별수업 불가'}
                            </button>
                          </div>

                          {(h.content1 || h.content2) && (
                            <div className="flex flex-wrap gap-1.5 mt-2.5 pt-2.5 border-t border-slate-300 text-xs font-medium">
                              {h.content1 && (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-300 text-slate-700">
                                  <span className="font-extrabold text-slate-500">내용1</span>
                                  <span className="font-bold text-slate-900">{h.content1}</span>
                                </span>
                              )}
                              {h.content2 && (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-300 text-slate-700">
                                  <span className="font-extrabold text-slate-500">내용2</span>
                                  <span className="font-bold text-slate-900">{h.content2}</span>
                                </span>
                              )}
                            </div>
                          )}

                          <div className="flex items-center justify-end gap-1.5 mt-3 pt-2.5 border-t border-slate-300">
                            <button
                              type="button"
                              onClick={() => handleOpenEditModal(h)}
                              disabled={saving || loading}
                              className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 text-xs font-bold active:scale-95 transition cursor-pointer"
                            >
                              수정
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(h)}
                              disabled={saving || loading}
                              className="px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-300 text-xs font-bold active:scale-95 transition cursor-pointer"
                            >
                              삭제
                            </button>
                            <button
                              type="button"
                              onClick={() => handleApplyToSchedule([h])}
                              disabled={applying || saving || loading}
                              className="px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-300 text-xs font-bold active:scale-95 transition cursor-pointer"
                            >
                              일정적용
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* 데스크톱 테이블 뷰 (1행 레이아웃 + 인라인 클릭 수정) */}
                  <div className="hidden md:block overflow-x-auto overflow-y-auto max-h-[68vh] border border-slate-300 rounded-xl relative">
                    <table className="w-full text-left border-collapse text-sm">
                      <thead className="sticky top-0 z-20 bg-slate-100 shadow-xs">
                        <tr className="text-slate-700 border-b-2 border-slate-400 font-bold whitespace-nowrap">
                          <th className="p-3 w-40 border-r border-slate-300 text-center">날짜 · 요일</th>
                          <th className="p-3 w-48 border-r border-slate-300">공휴일 / 일정 이름</th>
                          <th className="p-3 min-w-[120px] border-r border-slate-300">내용1</th>
                          <th className="p-3 min-w-[120px] border-r border-slate-300">내용2</th>
                          <th className="p-3 w-28 border-r border-slate-300 text-center">개별수업</th>
                          <th className="p-3 w-44 text-center">관리</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-300">
                        {filteredHolidays.map((h) => {
                          const meta = getHolidayDateMeta(h.date, targetYear);
                          const isPast = meta.diffDays !== null && meta.diffDays < 0;
                          return (
                            <tr
                              key={h.id ?? h.date}
                              className={`transition-colors ${isPast ? 'bg-slate-50/70 text-slate-500 hover:bg-slate-100/70' : 'hover:bg-blue-50/30'}`}
                            >
                              <td className="p-2.5 border-r border-slate-300 text-center whitespace-nowrap">
                                <div className="inline-flex items-center gap-1.5">
                                  <span className="font-extrabold text-slate-900 tabular-nums">{meta.mmdd}</span>
                                  {meta.weekday && (
                                    <span className={`px-1.5 py-0.5 rounded text-[11px] font-extrabold ${
                                      meta.isSunday
                                        ? 'bg-rose-100 text-rose-700'
                                        : meta.isSaturday
                                          ? 'bg-blue-100 text-blue-700'
                                          : 'bg-slate-100 text-slate-700'
                                    }`}>
                                      {meta.weekday}
                                    </span>
                                  )}
                                  {meta.dDayLabel && (
                                    <span className={`px-1.5 py-0.5 rounded text-[10.5px] font-extrabold ${
                                      meta.diffDays === 0
                                        ? 'bg-blue-600 text-white'
                                        : isPast
                                          ? 'bg-slate-200 text-slate-500'
                                          : 'bg-indigo-100 text-indigo-700'
                                    }`}>
                                      {meta.dDayLabel}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="p-2 border-r border-slate-300">
                                {renderCell(h, 'name', 'text-slate-900 font-bold')}
                              </td>
                              <td className="p-2 border-r border-slate-300">
                                {renderCell(h, 'content1', 'text-slate-700 font-semibold')}
                              </td>
                              <td className="p-2 border-r border-slate-300">
                                {renderCell(h, 'content2', 'text-slate-700 font-semibold')}
                              </td>
                              <td className="p-2 border-r border-slate-300 text-center">
                                <button
                                  type="button"
                                  onClick={() => handleToggleVacation(h.date, h.vacation_available)}
                                  disabled={saving || loading}
                                  className={`px-3 py-1 rounded-full text-xs font-bold transition-colors shadow-xs cursor-pointer ${
                                    h.vacation_available
                                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-400 hover:bg-emerald-200'
                                      : 'bg-slate-100 text-slate-600 border border-slate-300 hover:bg-slate-200'
                                  }`}
                                >
                                  {h.vacation_available ? '가능 O' : '불가 X'}
                                </button>
                              </td>
                              <td className="p-2 text-center whitespace-nowrap">
                                <div className="inline-flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => handleOpenEditModal(h)}
                                    disabled={saving || loading}
                                    className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 rounded-lg text-xs font-bold disabled:opacity-50 transition cursor-pointer"
                                  >
                                    수정
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDelete(h)}
                                    disabled={saving || loading}
                                    className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-300 rounded-lg text-xs font-bold disabled:opacity-50 transition cursor-pointer"
                                  >
                                    삭제
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleApplyToSchedule([h])}
                                    disabled={applying || saving || loading}
                                    className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-300 rounded-lg text-xs font-bold disabled:opacity-50 transition cursor-pointer"
                                    title="이 날짜만 일정표에 적용"
                                  >
                                    일정적용
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </main>

      {/* 공휴일 / 휴무일 수정 모달 */}
      {editModalData && (
        <div
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-[3px] flex items-center justify-center z-[90] px-4"
          onClick={() => !saving && setEditModalData(null)}
        >
          <form
            onSubmit={handleSaveEditModal}
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200 animate-fadeIn"
          >
            <div className="bg-slate-800 text-white px-4 py-3.5 flex items-center justify-between">
              <h3 className="font-extrabold text-base sm:text-lg">공휴일 · 휴무일 수정</h3>
              <button
                type="button"
                onClick={() => !saving && setEditModalData(null)}
                className="p-1 rounded-lg text-white/80 hover:bg-white/15"
              >
                ✕
              </button>
            </div>
            <div className="p-4 sm:p-5 space-y-3.5 text-left">
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">날짜 선택 *</label>
                <input
                  type="date"
                  value={toDateInputValue(editModalData.date, targetYear)}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (!val) {
                      setEditModalData(prev => ({ ...prev, date: '' }));
                    } else {
                      const mmdd = normalizeHolidayDate(val);
                      if (mmdd) setEditModalData(prev => ({ ...prev, date: mmdd }));
                    }
                  }}
                  className="w-full p-2.5 border border-slate-300 rounded-xl text-sm font-bold bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">이름 *</label>
                <input
                  type="text"
                  value={editModalData.name}
                  onChange={(e) => setEditModalData(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full p-2.5 border border-slate-300 rounded-xl text-sm font-bold bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">내용1</label>
                  <input
                    type="text"
                    value={editModalData.content1}
                    onChange={(e) => setEditModalData(prev => ({ ...prev, content1: e.target.value }))}
                    className="w-full p-2.5 border border-slate-300 rounded-xl text-sm font-medium bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">내용2</label>
                  <input
                    type="text"
                    value={editModalData.content2}
                    onChange={(e) => setEditModalData(prev => ({ ...prev, content2: e.target.value }))}
                    className="w-full p-2.5 border border-slate-300 rounded-xl text-sm font-medium bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer bg-blue-50 px-3 py-2.5 rounded-xl border border-blue-200">
                <input
                  type="checkbox"
                  checked={editModalData.vacation_available}
                  onChange={(e) => setEditModalData(prev => ({ ...prev, vacation_available: e.target.checked }))}
                  className="w-4 h-4 text-blue-600 rounded border-gray-300"
                />
                <span className="text-sm font-bold text-blue-900">개별수업 가능</span>
              </label>
            </div>
            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setEditModalData(null)}
                disabled={saving}
                className="px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-bold cursor-pointer"
              >
                취소
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-extrabold shadow-sm disabled:opacity-50 cursor-pointer"
              >
                {saving ? '저장 중...' : '저장'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 대한민국 법정공휴일 일괄 불러오기 모달 */}
      {showPresetModal && (
        <div
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-[3px] flex items-center justify-center z-[90] px-3 sm:px-4"
          onClick={() => !saving && setShowPresetModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[86vh] flex flex-col overflow-hidden border border-slate-200 animate-fadeIn"
          >
            <div className="bg-emerald-700 text-white px-4 py-3.5 flex items-center justify-between shrink-0">
              <div>
                <h3 className="font-extrabold text-base sm:text-lg">법정공휴일 한번에 추가</h3>
                <p className="text-xs text-emerald-100 font-medium">원하는 공휴일을 선택해 바로 등록할 수 있습니다. (기본: 휴관/휴강)</p>
              </div>
              <button
                type="button"
                onClick={() => !saving && setShowPresetModal(false)}
                className="p-1 rounded-lg text-white/80 hover:bg-white/15"
              >
                ✕
              </button>
            </div>

            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-1.5">
                {[2026, 2027].map(y => (
                  <button
                    key={y}
                    type="button"
                    onClick={() => handleChangePresetYear(y)}
                    className={`px-3 py-1 rounded-lg text-xs sm:text-sm font-extrabold border transition cursor-pointer ${
                      presetYear === y
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    {y}년
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1.5 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setSelectedPresetDates(selectWeekdayPresetsForYear(presetYear))}
                  className="px-2.5 py-1 rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 cursor-pointer"
                >
                  평일만 선택
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedPresetDates(availablePresetItems.map(i => i.date))}
                  className="px-2.5 py-1 rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 cursor-pointer"
                >
                  전체
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedPresetDates([])}
                  className="px-2.5 py-1 rounded-lg bg-white border border-slate-300 text-slate-500 hover:bg-slate-100 cursor-pointer"
                >
                  해제
                </button>
              </div>
            </div>

            <div className="p-3 sm:p-4 overflow-y-auto space-y-1.5">
              {presetListForYear.map(item => {
                const alreadyAdded = existingNormalizedDates.has(item.date);
                const checked = selectedPresetDates.includes(item.date);
                const meta = getHolidayDateMeta(item.date, presetYear);
                return (
                  <label
                    key={`${presetYear}-${item.date}`}
                    className={`flex items-center justify-between gap-2 p-2.5 rounded-xl border transition ${
                      alreadyAdded
                        ? 'bg-slate-50 border-slate-200 opacity-60 cursor-not-allowed'
                        : checked
                          ? 'bg-emerald-50/70 border-emerald-300 cursor-pointer'
                          : 'bg-white border-slate-200 hover:bg-slate-50 cursor-pointer'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <input
                        type="checkbox"
                        disabled={alreadyAdded}
                        checked={alreadyAdded || checked}
                        onChange={() => handleTogglePresetDate(item.date)}
                        className="w-4 h-4 text-emerald-600 rounded border-slate-300 shrink-0"
                      />
                      <span className="text-sm font-extrabold text-slate-800 tabular-nums shrink-0">{item.date}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[11px] font-extrabold shrink-0 ${
                        meta.isSunday ? 'bg-rose-100 text-rose-700' : meta.isSaturday ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-700'
                      }`}>
                        {meta.weekday}
                      </span>
                      <span className="text-sm font-bold text-slate-900 truncate">{item.name}</span>
                    </div>
                    {alreadyAdded && (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-extrabold shrink-0">
                        등록됨
                      </span>
                    )}
                  </label>
                );
              })}
            </div>

            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-2 shrink-0">
              <span className="text-xs font-bold text-slate-600">
                미등록 {availablePresetItems.length}건 중 <strong className="text-emerald-700">{selectedPresetDates.length}건</strong> 선택
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowPresetModal(false)}
                  disabled={saving}
                  className="px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-bold cursor-pointer"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={handleBulkImportPresets}
                  disabled={saving || selectedPresetDates.length === 0}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-extrabold shadow-sm disabled:opacity-50 cursor-pointer"
                >
                  {saving ? '추가 중...' : `선택한 ${selectedPresetDates.length}건 추가`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showApplyPopup && (
        <div
          onClick={closeStatusPopup}
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100] px-4 backdrop-blur-sm animate-fadeIn cursor-pointer"
        >
          <div className="bg-white p-6 rounded-2xl shadow-2xl max-w-sm w-full border border-gray-100 flex flex-col items-center justify-center text-center">
            <div className="w-12 h-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-3">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-gray-800 font-extrabold text-base whitespace-pre-line leading-relaxed">
              {popupMessage}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
