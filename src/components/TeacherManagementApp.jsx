// 선생님 명단 관리

import React, { useState, useEffect, useMemo } from 'react';
import { supabaseClient } from '../utils/supabase';
import { setGlobalTeachersList, formatTeacherRow, getLocalDateString } from '../utils/helpers';
import { User, Home } from './Icons';
import { hasValidSavedAdminPassword } from '../utils/appSettings';
import { showAlert, showConfirm } from '../utils/dialog';

const TEAM_OPTIONS = ['1팀', '2팀', '3팀', '취업팀'];

const getDefaultShifts = (team) => (
  team === '3팀'
    ? { shift1: '13:00~14:00', shift2: '14:00~15:00', shift3: '15:00~16:00' }
    : { shift1: '9:30~10:30', shift2: '10:30~11:30', shift3: '11:30~12:30' }
);

const createEmptyForm = (team = '1팀', seq = '') => ({
  team,
  group: '1조',
  seq_num: seq,
  name: '',
  ...getDefaultShifts(team),
  is_active: true,
  hire_date: '2026-02-01',
  resign_date: '2026-11-30'
});

const sortTeachers = (list) => [...list].sort((a, b) =>
  a.team.localeCompare(b.team) ||
  ((a.seq_num || 999) - (b.seq_num || 999)) ||
  a.group.localeCompare(b.group) ||
  a.name.localeCompare(b.name)
);

export default function TeacherManagementApp({ onNavigateBack }) {
  const [teachers, setTeachers] = useState([]);
  const [isEditing, setIsEditing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [currentId, setCurrentId] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isAdmin] = useState(() => hasValidSavedAdminPassword());
  const [formData, setFormData] = useState(() => createEmptyForm());
  const [searchQuery, setSearchQuery] = useState('');
  const [teamFilter, setTeamFilter] = useState('all');
  const [showInactive, setShowInactive] = useState(false);
  const [notice, setNotice] = useState('');
  const [editingCell, setEditingCell] = useState(null); // { id, field }
  const [editValue, setEditValue] = useState('');

  const showNotice = (msg) => {
    setNotice(msg);
    setTimeout(() => setNotice(''), 1500);
  };

  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferTargetName, setTransferTargetName] = useState("");
  const [transferDate, setTransferDate] = useState("");
  const [transferSource, setTransferSource] = useState(null);

  const fetchTeachers = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabaseClient.from('teachers').select('*').order('team').order('group_name').order('seq_num').order('name');
      if (error) throw error;
      const formatted = data.map(formatTeacherRow);
      setTeachers(formatted);
      setGlobalTeachersList(formatted);
    } catch (e) {
      console.error("Error fetching teachers:", e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTeachers();
  }, []);

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    const finalValue = type === 'checkbox' ? checked : value;
    setFormData(prev => {
      const next = { ...prev, [name]: finalValue };
      if (name === 'team') {
        Object.assign(next, getDefaultShifts(value));
      }
      return next;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      showAlert('이름을 입력해주세요.');
      return;
    }

    const payload = {
      team: formData.team,
      group_name: formData.group,
      seq_num: formData.seq_num ? parseInt(formData.seq_num, 10) : null,
      name: formData.name,
      shift1: formData.shift1,
      shift2: formData.shift2,
      shift3: formData.shift3,
      is_active: formData.is_active,
      hire_date: formData.hire_date || null,
      resign_date: formData.resign_date || null
    };

    setIsLoading(true);
    try {
      if (isEditing && currentId) {
        const { error } = await supabaseClient.from('teachers').update(payload).eq('id', currentId);
        if (error) throw error;
      } else {
        const { error } = await supabaseClient.from('teachers').insert([payload]);
        if (error) throw error;
      }
      await fetchTeachers();
      showNotice(isEditing ? `${formData.name} 선생님 정보가 수정되었습니다.` : `${formData.name} 선생님이 등록되었습니다.`);
      closeForm();
    } catch (err) {
      console.error(err);
      showAlert('저장에 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleEdit = (teacher) => {
    setFormData({
      team: teacher.team,
      group: teacher.group,
      seq_num: teacher.seq_num || '',
      name: teacher.name,
      shift1: teacher.shift1 || '',
      shift2: teacher.shift2 || '',
      shift3: teacher.shift3 || '',
      is_active: teacher.is_active !== false,
      hire_date: teacher.hire_date || '',
      resign_date: teacher.resign_date || ''
    });
    setCurrentId(teacher.id);
    setIsEditing(true);
    setShowForm(true);
  };

  const handleOpenNew = () => {
    const team = teamFilter !== 'all' ? teamFilter : '1팀';
    const sameTeam = teachers.filter(t => t.team === team && t.seq_num);
    const maxSeq = sameTeam.reduce((m, t) => Math.max(m, parseInt(t.seq_num, 10) || 0), 0);
    setFormData(createEmptyForm(team, maxSeq ? String(maxSeq + 1) : ''));
    setCurrentId(null);
    setIsEditing(false);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setIsEditing(false);
    setCurrentId(null);
  };

  const handleSaveCell = async (teacherId, field, overrideValue) => {
    if (!editingCell && overrideValue === undefined) return;
    setEditingCell(null);

    const original = teachers.find(t => t.id === teacherId);
    if (!original) return;

    const rawVal = overrideValue !== undefined ? overrideValue : editValue;
    const trimmed = typeof rawVal === 'string' ? rawVal.trim() : rawVal;

    if (field === 'name' && !trimmed) {
      showAlert('이름은 비워둘 수 없습니다.');
      return;
    }

    let dbField = field;
    let dbValue = trimmed;

    if (field === 'group') {
      dbField = 'group_name';
      if ((original.group || '') === trimmed) return;
    } else if (field === 'seq_num') {
      if (trimmed === '') {
        dbValue = null;
      } else {
        const parsed = parseInt(trimmed, 10);
        if (Number.isNaN(parsed)) {
          showAlert('번호는 숫자로 입력해 주세요.');
          return;
        }
        dbValue = parsed;
      }
      const origSeq = original.seq_num != null ? String(original.seq_num) : '';
      if ((dbValue != null ? String(dbValue) : '') === origSeq) return;
    } else if (field === 'hire_date' || field === 'resign_date') {
      dbValue = trimmed || null;
      if ((dbValue || '') === (original[field] || '')) return;
    } else if ((original[field] || '') === trimmed) {
      return;
    }

    setIsLoading(true);
    try {
      const { error } = await supabaseClient
        .from('teachers')
        .update({ [dbField]: dbValue })
        .eq('id', teacherId);
      if (error) throw error;
      await fetchTeachers();
      showNotice('데이터가 저장되었습니다.');
    } catch (err) {
      console.error(err);
      showAlert('수정 중 오류가 발생했습니다: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleActive = async (teacher) => {
    const nextActive = teacher.is_active === false;
    setIsLoading(true);
    try {
      const { error } = await supabaseClient
        .from('teachers')
        .update({ is_active: nextActive })
        .eq('id', teacher.id);
      if (error) throw error;
      await fetchTeachers();
      showNotice(nextActive ? `${teacher.name} 선생님이 재직 상태로 변경되었습니다.` : `${teacher.name} 선생님이 퇴직처리 완료되었습니다.`);
    } catch (err) {
      console.error(err);
      showAlert('상태 변경 중 오류가 발생했습니다: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const renderCell = (teacher, field, { type = 'text', align = 'center', className = '', placeholder = '(입력)' } = {}) => {
    const isCellEditing = editingCell && editingCell.id === teacher.id && editingCell.field === field;
    const rawValue = field === 'seq_num'
      ? (teacher.seq_num != null ? String(teacher.seq_num) : '')
      : (teacher[field] || '');

    if (isCellEditing) {
      if (type === 'select') {
        return (
          <select
            value={editValue}
            onChange={(e) => handleSaveCell(teacher.id, field, e.target.value)}
            onBlur={() => setEditingCell(null)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEditingCell(null);
            }}
            className="w-full p-1 border border-indigo-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 text-xs font-bold text-black bg-white"
            autoFocus
          >
            {TEAM_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        );
      }
      return (
        <input
          type={type === 'date' ? 'date' : 'text'}
          inputMode={type === 'numeric' ? 'numeric' : undefined}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={() => handleSaveCell(teacher.id, field)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              setEditingCell(null);
            }
          }}
          className={`w-full p-1 border border-indigo-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 text-xs font-semibold text-black bg-white ${align === 'center' ? 'text-center' : 'text-left'}`}
          autoFocus
        />
      );
    }

    return (
      <div
        onClick={() => {
          setEditingCell({ id: teacher.id, field });
          setEditValue(rawValue);
        }}
        className={`${className} cursor-pointer hover:bg-blue-50/80 px-1.5 py-1 rounded-md transition-colors min-h-[28px] flex items-center ${align === 'center' ? 'justify-center' : 'justify-start'}`}
        title="클릭하여 바로 수정"
      >
        {rawValue || <span className="text-gray-400 italic text-xs font-normal">{placeholder}</span>}
      </div>
    );
  };

  const teamCounts = useMemo(() => {
    const base = showInactive ? teachers : teachers.filter(t => t.is_active !== false);
    const counts = { all: base.length };
    TEAM_OPTIONS.forEach(team => { counts[team] = base.filter(t => t.team === team).length; });
    return counts;
  }, [teachers, showInactive]);

  const filteredTeachers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sortTeachers(teachers).filter(t => {
      if (!showInactive && t.is_active === false) return false;
      if (teamFilter !== 'all' && t.team !== teamFilter) return false;
      if (!q) return true;
      return [t.name, t.group, t.team, String(t.seq_num ?? '')].some(v => (v || '').toLowerCase().includes(q));
    });
  }, [teachers, searchQuery, teamFilter, showInactive]);

  const handleDelete = async (id) => {
    if (await showConfirm('정말 삭제하시겠습니까?')) {
      setIsLoading(true);
      try {
        const { error } = await supabaseClient.from('teachers').delete().eq('id', id);
        if (error) throw error;
        await fetchTeachers();
        showNotice('삭제되었습니다.');
      } catch (err) {
        console.error(err);
        showAlert('삭제에 실패했습니다.');
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleTransferClick = (teacher) => {
    setTransferSource(teacher);
    setTransferDate(getLocalDateString(new Date()));
    setTransferTargetName("");
    setShowTransferModal(true);
  };

  const handleTransferSubmit = async () => {
    if (!transferTargetName) return showAlert("이관 받을 선생님을 선택하세요.");
    if (!transferDate) return showAlert("기준 일자를 선택하세요.");
    if (await showConfirm(`${transferSource.name} 선생님의 ${transferDate} 이후 일정을 ${transferTargetName} 선생님으로 모두 이관하시겠습니까?`)) {
      setIsLoading(true);
      try {
        const { error } = await supabaseClient
          .from('daily_logs')
          .update({ teacher: transferTargetName })
          .eq('team', transferSource.team)
          .eq('teacher', transferSource.name)
          .gte('log_date', transferDate);
        if (error) throw error;
        await showAlert("일정 이관이 완료되었습니다.");
        setShowTransferModal(false);
      } catch (e) {
        showAlert("이관 오류: " + e.message);
      } finally {
        setIsLoading(false);
      }
    }
  };

  return (
    <div className="min-h-screen app-surface flex flex-col font-sans pb-6 overflow-y-auto">
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

      <main className="flex-1 px-2.5 sm:px-5 pt-3 pb-12 w-full max-w-5xl lg:max-w-[1536px] mx-auto">
        <div className="px-1 mb-1">
          <h2 className="text-[19px] sm:text-xl font-bold text-gray-800 flex items-center tracking-tight">
            <span className="flex items-center"><User className="w-5 h-5 mr-2 text-blue-600" /> 선생님 명단 관리</span>
          </h2>
        </div>
        {!isAdmin ? (
          <div
            className="bg-amber-50 border border-amber-200 rounded-2xl py-3.5 px-4 sm:py-4 sm:px-5 text-center shadow-xs w-full mt-1"
          >
            <p className="font-extrabold text-amber-800 text-base sm:text-lg flex items-center justify-center gap-2">
              <span className="text-xl sm:text-2xl">💡</span>
              <span>메인 화면 우측 상단 [설정]에서 관리자 비밀번호를 저장해 주세요.</span>
            </p>
          </div>
        ) : (
          <div className="space-y-3 mt-2">
            {notice && (
              <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold shadow-lg animate-fadeIn">
                {notice}
              </div>
            )}

            {/* 상단 도구 모음: 검색 / 팀 필터 / 새 선생님 등록 */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-300 p-3.5 sm:p-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="이름, 조, 번호로 검색..."
                    className="w-full pl-3.5 pr-8 py-2 border border-slate-300 rounded-xl text-sm font-medium bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 text-xs font-extrabold cursor-pointer"
                      aria-label="검색어 지우기"
                    >
                      ✕
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <label className="flex items-center gap-1.5 cursor-pointer px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={showInactive}
                      onChange={(e) => setShowInactive(e.target.checked)}
                      className="w-4 h-4 text-indigo-600 rounded border-gray-300"
                    />
                    <span className="text-xs sm:text-sm font-bold text-slate-700">퇴직자 보기</span>
                  </label>
                  <button
                    type="button"
                    onClick={handleOpenNew}
                    disabled={isLoading}
                    className="flex-1 sm:flex-none px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-extrabold shadow-sm active:scale-95 disabled:opacity-50 transition whitespace-nowrap cursor-pointer"
                  >
                    + 새 선생님 등록
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {['all', ...TEAM_OPTIONS].map(team => (
                  <button
                    key={team}
                    type="button"
                    onClick={() => setTeamFilter(team)}
                    className={`px-3 py-1 rounded-full text-xs sm:text-sm font-bold border transition cursor-pointer ${
                      teamFilter === team
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {team === 'all' ? '전체' : team} ({teamCounts[team] || 0})
                  </button>
                ))}
                <span className="ml-auto text-xs font-bold text-slate-500">
                  표시 중 <span className="text-slate-900 font-extrabold">{filteredTeachers.length}명</span>
                </span>
              </div>
            </div>

            {/* 선생님 목록: 모바일 카드 뷰 + PC 엑셀형 표 뷰 */}
            {isLoading && teachers.length === 0 ? (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-300 text-center py-10">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
              </div>
            ) : filteredTeachers.length === 0 ? (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-300 py-10 text-center text-slate-500 text-sm font-semibold">
                {teachers.length === 0 ? '등록된 선생님이 없습니다.' : '조건에 맞는 선생님이 없습니다.'}
              </div>
            ) : (
              <>
                {/* 모바일 카드 뷰 */}
                <div className="md:hidden grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {filteredTeachers.map(t => {
                    const inactive = t.is_active === false;
                    const isSky = t.team === '2팀' || t.team === '취업팀';
                    return (
                      <div
                        key={t.id}
                        className={`flex flex-col rounded-2xl border-[1.5px] shadow-sm p-4 transition ${
                          inactive
                            ? 'bg-slate-100 border-slate-400 opacity-85'
                            : `bg-white border-slate-400 border-t-4 ${isSky ? 'border-t-sky-400' : 'border-t-indigo-400'}`
                        }`}
                      >
                        <div className="flex items-center flex-wrap gap-1.5">
                          <span className={`px-2 py-0.5 rounded-md text-xs font-black ${isSky ? 'bg-sky-100 text-sky-800' : 'bg-indigo-100 text-indigo-800'}`}>{t.team}</span>
                          <span className="px-2 py-0.5 rounded-md text-xs font-bold bg-slate-100 text-slate-700 border border-slate-300">{t.group}</span>
                          {t.seq_num && <span className="text-xs font-bold text-slate-500">#{t.seq_num}</span>}
                          {inactive && <span className="ml-auto px-1.5 py-0.5 rounded text-[11px] font-extrabold bg-red-100 text-red-600 border border-red-300">퇴직</span>}
                        </div>

                        <div className={`mt-1.5 text-lg font-extrabold break-words ${inactive ? 'line-through text-slate-400' : 'text-slate-900'}`}>{t.name}</div>

                        <div className="mt-2.5 grid grid-cols-3 gap-1.5 text-xs font-semibold text-slate-700">
                          {[t.shift1, t.shift2, t.shift3].map((s, i) => (
                            <span key={i} className="px-1 py-1 rounded-lg bg-slate-50 border border-slate-300 text-center tabular-nums truncate" title={s || ''}>{s || '-'}</span>
                          ))}
                        </div>

                        <div className="mt-2 mb-3 text-xs font-medium text-slate-500 tabular-nums">
                          입사 {t.hire_date || '-'} · 퇴사 {t.resign_date || '-'}
                        </div>

                        <div className="flex items-center justify-end gap-1.5 mt-auto pt-3 border-t border-slate-300">
                          <button onClick={() => handleEdit(t)} className="px-3 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-300 text-xs font-bold active:scale-95 transition cursor-pointer">수정</button>
                          <button onClick={() => handleDelete(t.id)} className="px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-300 text-xs font-bold active:scale-95 transition cursor-pointer">삭제</button>
                          <button onClick={() => handleTransferClick(t)} className="px-3 py-1.5 rounded-xl bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-300 text-xs font-bold active:scale-95 transition cursor-pointer">이관</button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* PC 엑셀형 테이블 뷰 (셀 클릭 바로 수정) */}
                <div className="hidden md:block bg-white rounded-2xl shadow-sm border border-slate-300 p-4">
                  <div className="overflow-x-auto overflow-y-auto max-h-[70vh] border border-slate-300 rounded-xl relative">
                    <table className="w-full text-center border-collapse text-sm">
                      <thead className="sticky top-0 z-20 bg-slate-100 shadow-xs">
                        <tr className="text-slate-700 border-b-2 border-slate-400 font-bold whitespace-nowrap">
                          <th className="p-2.5 w-20 border-r border-slate-300">팀</th>
                          <th className="p-2.5 w-16 border-r border-slate-300">조</th>
                          <th className="p-2.5 w-16 border-r border-slate-300">번호</th>
                          <th className="p-2.5 min-w-[96px] border-r border-slate-300">이름</th>
                          <th className="p-2.5 min-w-[110px] border-r border-slate-300">시간대 1</th>
                          <th className="p-2.5 min-w-[110px] border-r border-slate-300">시간대 2</th>
                          <th className="p-2.5 min-w-[110px] border-r border-slate-300">시간대 3</th>
                          <th className="p-2.5 w-32 border-r border-slate-300">입사일</th>
                          <th className="p-2.5 w-32 border-r border-slate-300">퇴사일</th>
                          <th className="p-2.5 w-24 border-r border-slate-300">상태</th>
                          <th className="p-2.5 w-44">관리</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-300">
                        {filteredTeachers.map(t => {
                          const inactive = t.is_active === false;
                          const isSky = t.team === '2팀' || t.team === '취업팀';
                          return (
                            <tr
                              key={t.id}
                              className={`transition-colors ${
                                inactive
                                  ? 'bg-slate-100 text-slate-400'
                                  : (isSky ? 'bg-sky-50/40 hover:bg-sky-50' : 'hover:bg-blue-50/30')
                              }`}
                            >
                              <td className="p-1.5 border-r border-slate-300 font-bold whitespace-nowrap">
                                {renderCell(t, 'team', {
                                  type: 'select',
                                  className: isSky ? 'text-sky-800 font-extrabold' : 'text-indigo-800 font-extrabold'
                                })}
                              </td>
                              <td className="p-1.5 border-r border-slate-300 whitespace-nowrap">
                                {renderCell(t, 'group', { className: 'text-slate-700 font-semibold' })}
                              </td>
                              <td className="p-1.5 border-r border-slate-300 whitespace-nowrap tabular-nums">
                                {renderCell(t, 'seq_num', { type: 'numeric', className: 'text-slate-700 font-bold tabular-nums', placeholder: '-' })}
                              </td>
                              <td className="p-1.5 border-r border-slate-300 font-bold whitespace-nowrap">
                                {renderCell(t, 'name', {
                                  className: inactive ? 'line-through text-slate-400 font-bold' : 'text-slate-900 font-extrabold'
                                })}
                              </td>
                              <td className="p-1.5 border-r border-slate-300 whitespace-nowrap">
                                {renderCell(t, 'shift1', { className: 'text-slate-700 font-medium tabular-nums' })}
                              </td>
                              <td className="p-1.5 border-r border-slate-300 whitespace-nowrap">
                                {renderCell(t, 'shift2', { className: 'text-slate-700 font-medium tabular-nums' })}
                              </td>
                              <td className="p-1.5 border-r border-slate-300 whitespace-nowrap">
                                {renderCell(t, 'shift3', { className: 'text-slate-700 font-medium tabular-nums' })}
                              </td>
                              <td className="p-1.5 border-r border-slate-300 whitespace-nowrap">
                                {renderCell(t, 'hire_date', { type: 'date', className: 'text-slate-600 text-xs font-medium tabular-nums', placeholder: '-' })}
                              </td>
                              <td className="p-1.5 border-r border-slate-300 whitespace-nowrap">
                                {renderCell(t, 'resign_date', { type: 'date', className: 'text-slate-600 text-xs font-medium tabular-nums', placeholder: '-' })}
                              </td>
                              <td className="p-1.5 border-r border-slate-300 whitespace-nowrap">
                                <button
                                  type="button"
                                  onClick={() => handleToggleActive(t)}
                                  disabled={isLoading}
                                  className={`px-2.5 py-1 rounded-full text-xs font-bold transition-colors shadow-xs cursor-pointer ${
                                    inactive
                                      ? 'bg-rose-100 text-rose-700 border border-rose-300 hover:bg-rose-200'
                                      : 'bg-emerald-100 text-emerald-800 border border-emerald-400 hover:bg-emerald-200'
                                  }`}
                                  title="클릭하여 재직/퇴직 상태 변경"
                                >
                                  {inactive ? '퇴직완료' : '재직중'}
                                </button>
                              </td>
                              <td className="p-1.5 whitespace-nowrap">
                                <div className="inline-flex items-center gap-1.5">
                                  <button type="button" onClick={() => handleEdit(t)} disabled={isLoading} className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 rounded-lg text-xs font-bold disabled:opacity-50 transition cursor-pointer">수정</button>
                                  <button type="button" onClick={() => handleDelete(t.id)} disabled={isLoading} className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-300 rounded-lg text-xs font-bold disabled:opacity-50 transition cursor-pointer">삭제</button>
                                  <button type="button" onClick={() => handleTransferClick(t)} disabled={isLoading} className="px-2.5 py-1 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-300 rounded-lg text-xs font-bold disabled:opacity-50 transition cursor-pointer">이관</button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-2 text-xs text-slate-500 font-medium">
                    💡 표의 각 셀을 클릭하면 바로 수정하고 Enter 또는 바깥 영역 클릭 시 자동 저장됩니다.
                  </p>
                </div>
              </>
            )}
          </div>
        )}
      </main>

      {/* 선생님 등록 / 수정 모달 */}
      {showForm && (
        <div className="fixed inset-0 bg-slate-900/45 backdrop-blur-[3px] flex items-center justify-center z-50 px-3 py-4">
          <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[92vh] overflow-y-auto">
            <div className={`flex items-center justify-between px-5 py-3.5 rounded-t-2xl text-white ${isEditing ? 'bg-indigo-600' : 'bg-emerald-600'}`}>
              <h3 className="text-base sm:text-lg font-extrabold">
                {isEditing ? '선생님 정보 수정' : '새 선생님 등록'}
              </h3>
              <button type="button" onClick={closeForm} className="p-1 rounded-lg text-white/80 hover:bg-white/15 cursor-pointer" aria-label="닫기">✕</button>
            </div>

            <div className="p-4 sm:p-5 space-y-3.5 text-left">
              <div className="grid grid-cols-12 gap-2.5">
                <div className="col-span-4">
                  <label className="block text-xs font-bold text-slate-600 mb-1">팀</label>
                  <select name="team" value={formData.team} onChange={handleInputChange} className="w-full border border-slate-300 rounded-xl p-2 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-400 outline-none text-sm font-bold">
                    {TEAM_OPTIONS.map(team => <option key={team} value={team}>{team}</option>)}
                  </select>
                </div>
                <div className="col-span-4">
                  <label className="block text-xs font-bold text-slate-600 mb-1">조</label>
                  <input type="text" name="group" value={formData.group} onChange={handleInputChange} placeholder="예: 1조" className="w-full border border-slate-300 rounded-xl p-2 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-400 outline-none text-sm font-bold" />
                </div>
                <div className="col-span-4">
                  <label className="block text-xs font-bold text-slate-600 mb-1">번호</label>
                  <input type="text" inputMode="numeric" name="seq_num" value={formData.seq_num} onChange={handleInputChange} placeholder="번호" className="w-full border border-slate-300 rounded-xl p-2 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-400 outline-none text-sm font-bold text-center" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-indigo-600 mb-1">이름 *</label>
                <input type="text" name="name" value={formData.name} onChange={handleInputChange} placeholder="선생님 이름" autoFocus={!isEditing} className="w-full border border-slate-300 rounded-xl p-2.5 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-400 outline-none text-sm sm:text-base font-bold" />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">근무 시간대</label>
                <div className="grid grid-cols-3 gap-2">
                  {['shift1', 'shift2', 'shift3'].map((key, i) => (
                    <input key={key} type="text" name={key} value={formData[key]} onChange={handleInputChange} placeholder={`시간대 ${i + 1}`} className="w-full min-w-0 border border-slate-300 rounded-xl p-2 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-400 outline-none text-xs sm:text-sm font-medium text-center tabular-nums" />
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">입사일</label>
                  <input type="date" name="hire_date" value={formData.hire_date || ''} onChange={handleInputChange} className="w-full min-w-0 border border-slate-300 rounded-xl p-2 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-400 outline-none text-xs sm:text-sm font-semibold" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">퇴사일</label>
                  <input type="date" name="resign_date" value={formData.resign_date || ''} onChange={handleInputChange} className="w-full min-w-0 border border-slate-300 rounded-xl p-2 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-400 outline-none text-xs sm:text-sm font-semibold" />
                </div>
              </div>

              <label htmlFor="is_resigned" className={`flex items-start gap-2 p-2.5 rounded-xl border cursor-pointer ${formData.is_active === false ? 'border-rose-300 bg-rose-50' : 'border-slate-200 bg-slate-50'}`}>
                <input type="checkbox" id="is_resigned" checked={formData.is_active === false} onChange={(e) => setFormData(prev => ({ ...prev, is_active: !e.target.checked }))} className="mt-0.5 w-4 h-4 text-rose-600 rounded border-gray-300 focus:ring-rose-500" />
                <span className={`text-sm font-bold select-none ${formData.is_active === false ? 'text-rose-700' : 'text-slate-700'}`}>
                  퇴직처리 완료
                  <span className="block text-xs font-medium text-slate-500">체크하면 선생님 목록과 메인 화면의 선생님 목록에서 숨김 처리됩니다.</span>
                </span>
              </label>
            </div>

            <div className="flex gap-2 px-4 sm:px-5 pb-4 sm:pb-5">
              <button type="button" onClick={closeForm} className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold transition cursor-pointer">취소</button>
              <button type="submit" disabled={isLoading} className={`flex-1 py-2.5 text-white rounded-xl font-extrabold disabled:opacity-50 transition cursor-pointer ${isEditing ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
                {isLoading ? '처리중...' : (isEditing ? '수정 저장' : '등록')}
              </button>
            </div>
          </form>
        </div>
      )}

      {showTransferModal && transferSource && (
        <div className="fixed inset-0 bg-slate-900/45 backdrop-blur-[3px] flex items-center justify-center z-50 px-4 backdrop-blur-sm">
          <div className="bg-white p-6 rounded-2xl shadow-2xl max-w-sm w-full">
            <h3 className="text-lg font-bold text-gray-800 mb-2 border-b pb-2">일정 이관</h3>
            <p className="text-sm text-gray-600 mb-4">
              <strong>{transferSource.team} {transferSource.name}</strong> 선생님의 향후 일정을 다른 선생님에게 일괄 이관합니다.
            </p>
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">기준 일자 (해당일 포함 이후)</label>
                <input type="date" value={transferDate} onChange={e => setTransferDate(e.target.value)} className="w-full border p-2 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">이관 받을 선생님</label>
                <select value={transferTargetName} onChange={e => setTransferTargetName(e.target.value)} className="w-full border p-2 rounded-lg text-sm bg-gray-50 outline-none focus:ring-2 focus:ring-purple-400">
                  <option value="">-- 선생님 선택 --</option>
                  {teachers.filter(t => t.team === transferSource.team && t.is_active !== false && t.id !== transferSource.id).map(t => (
                    <option key={t.id} value={t.name}>{t.name} ({t.group})</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowTransferModal(false)} className="flex-1 py-2.5 bg-gray-100 text-gray-700 rounded-lg font-bold">취소</button>
              <button onClick={handleTransferSubmit} disabled={isLoading} className="flex-1 py-2.5 bg-purple-600 text-white rounded-lg font-bold disabled:opacity-50">이관 실행</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
