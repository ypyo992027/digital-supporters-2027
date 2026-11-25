// 보조강사 시간표 관리 (입력/수정/삭제/저장)

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Home, LucideCalendar } from './Icons';
import { hasValidSavedAdminPassword } from '../utils/appSettings';
import { showConfirm } from '../utils/dialog';
import { fetchAllTeachersFromDb, getTeacherSortWeight } from '../utils/helpers';
import {
  ASSISTANT_DAYS,
  ASSISTANT_TEAMS,
  DEFAULT_ASSISTANT_ROWS,
  getGroupOptions,
  fetchAssistantSchedules,
  saveAssistantSchedules,
  isMissingTableError
} from '../utils/assistantSchedule';

let tempKeySeq = 0;
const withKey = (row) => ({ ...row, _key: row.id ? `db-${row.id}` : `new-${++tempKeySeq}` });

const EMPTY_ROW = {
  program_name: '',
  subject: '보조강사',
  day_of_week: '월',
  start_time: '10:00',
  end_time: '10:50',
  location: '2층 디지털 배움터',
  team: '1팀',
  group_name: '1조',
  instructors: ''
};

const toMinutes = (t) => {
  const m = String(t || '').match(/(\d+):(\d+)/);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : -1;
};

const snapshot = (rows, start, end) =>
  JSON.stringify({ start, end, rows: rows.map(({ _key, created_at, updated_at, course_start, course_end, sort_order, ...rest }) => rest) });

const inputCls = 'w-full h-9 px-2 rounded-md border border-slate-300 bg-white text-[14.5px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400';
const selectCls = inputCls + ' pr-6 cursor-pointer';

export default function AssistantScheduleApp({ onNavigateBack }) {
  const [isAdmin] = useState(() => hasValidSavedAdminPassword());
  const [rows, setRows] = useState([]);
  const [originalIds, setOriginalIds] = useState([]);
  const [courseStart, setCourseStart] = useState('');
  const [courseEnd, setCourseEnd] = useState('');
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tableMissing, setTableMissing] = useState(false);
  const [message, setMessage] = useState(null); // { type: 'ok' | 'error', text }
  const teachersRef = useRef([]);

  // teachers 테이블에서 해당 팀·조의 재직 중인 선생님 이름을 '/'로 연결
  const instructorsFor = (team, group, fallback = '') => {
    const list = teachersRef.current || [];
    if (list.length === 0) return fallback;
    return list
      .filter(t => t.team === team && (t.group || t.group_name) === group && t.is_active !== false)
      .sort((a, b) => getTeacherSortWeight(team, a.name, list) - getTeacherSortWeight(team, b.name, list))
      .map(t => (t.name || '').trim())
      .join('/');
  };

  const withInstructors = (row) => ({ ...row, instructors: instructorsFor(row.team, row.group_name, row.instructors || '') });

  const applyLoaded = (data) => {
    const list = data.map(r => withKey(withInstructors(r)));
    const start = data.find(r => r.course_start)?.course_start || '';
    const end = data.find(r => r.course_end)?.course_end || '';
    setRows(list);
    setOriginalIds(data.filter(r => r.id).map(r => r.id));
    setCourseStart(start);
    setCourseEnd(end);
    setSavedSnapshot(snapshot(list, start, end));
  };

  const load = async () => {
    setLoading(true);
    setMessage(null);
    try {
      teachersRef.current = await fetchAllTeachersFromDb();
    } catch (e) {
      console.error('선생님 목록 로딩 실패:', e);
    }
    try {
      const data = await fetchAssistantSchedules();
      setTableMissing(false);
      applyLoaded(data);
    } catch (err) {
      console.error(err);
      if (isMissingTableError(err)) {
        setTableMissing(true);
        applyLoaded(DEFAULT_ASSISTANT_ROWS);
      } else {
        setMessage({ type: 'error', text: '불러오기 실패: ' + (err.message || err) });
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) load();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isDirty = useMemo(
    () => !loading && snapshot(rows, courseStart, courseEnd) !== savedSnapshot,
    [rows, courseStart, courseEnd, savedSnapshot, loading]
  );

  useEffect(() => {
    if (!isDirty) return undefined;
    const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const updateRow = (key, field, value) => {
    setRows(prev => prev.map(r => {
      if (r._key !== key) return r;
      const next = { ...r, [field]: value };
      if (field === 'team') {
        const opts = getGroupOptions(value);
        if (!opts.includes(next.group_name)) next.group_name = opts[0];
      }
      if (field === 'team' || field === 'group_name') {
        next.instructors = instructorsFor(next.team, next.group_name);
      }
      return next;
    }));
  };

  const addRow = () => {
    setRows(prev => [...prev, withKey(withInstructors({ ...EMPTY_ROW }))]);
    setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 50);
  };

  const deleteRow = async (row) => {
    const label = row.program_name || row.subject || '이 행';
    if (!(await showConfirm(`'${label}'을(를) 삭제할까요?\n[저장]을 눌러야 실제로 반영됩니다.`))) return;
    setRows(prev => prev.filter(r => r._key !== row._key));
  };

  const moveRow = (index, delta) => {
    setRows(prev => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const handleRevert = async () => {
    if (!isDirty) return;
    if (!(await showConfirm('저장하지 않은 변경 내용을 모두 취소할까요?'))) return;
    load();
  };

  const handleLoadDefaults = async () => {
    if (rows.length > 0 && !(await showConfirm('현재 목록을 기본 데이터(2026년 4분기 배정표)로 바꿀까요?\n[저장]을 눌러야 실제로 반영됩니다.'))) return;
    // 기존 DB 행은 originalIds에 남아 있으므로 저장 시 삭제되고 기본 데이터가 새로 추가됨
    setRows(DEFAULT_ASSISTANT_ROWS.map(r => withKey(withInstructors({ ...r }))));
    setCourseStart(DEFAULT_ASSISTANT_ROWS[0].course_start);
    setCourseEnd(DEFAULT_ASSISTANT_ROWS[0].course_end);
  };

  const validate = () => {
    if (!courseStart || !courseEnd) return '수강기간 시작일과 종료일을 입력해 주세요.';
    if (courseStart > courseEnd) return '수강기간 종료일이 시작일보다 빠릅니다.';
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const n = i + 1;
      if (!r.subject || !r.subject.trim()) return `${n}번: 시간표 과목명을 입력해 주세요.`;
      if (!r.start_time || !r.end_time) return `${n}번: 시작/종료 시간을 입력해 주세요.`;
      if (toMinutes(r.start_time) >= toMinutes(r.end_time)) return `${n}번: 종료 시간이 시작 시간보다 늦어야 합니다.`;
      if (!r.team || !r.group_name) return `${n}번: 배정팀과 조를 선택해 주세요.`;
    }
    return null;
  };

  const handleSave = async () => {
    if (tableMissing) {
      setMessage({ type: 'error', text: '데이터베이스 테이블이 아직 없어 저장할 수 없습니다. 아래 안내를 먼저 진행해 주세요.' });
      return;
    }
    const err = validate();
    if (err) {
      setMessage({ type: 'error', text: err });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await saveAssistantSchedules(rows, originalIds, courseStart, courseEnd);
      const data = await fetchAssistantSchedules();
      applyLoaded(data);
      setMessage({ type: 'ok', text: `저장했습니다. (총 ${data.length}건)` });
    } catch (e) {
      console.error(e);
      setMessage({ type: 'error', text: '저장 실패: ' + (e.message || e) });
    } finally {
      setSaving(false);
    }
  };

  const handleBack = async () => {
    if (isDirty && !(await showConfirm('저장하지 않은 변경 내용이 있습니다. 저장하지 않고 나갈까요?'))) return;
    onNavigateBack();
  };

  return (
    <div className="min-h-screen app-surface flex flex-col font-sans pb-6 overflow-y-auto">
      <header className="app-header text-white z-40 relative shrink-0">
        <div className="max-w-[1331px] lg:max-w-[1997px] mx-auto px-2.5 sm:px-5 pt-safe-4 pb-4 flex justify-between items-start relative">
          <div className="flex flex-col">
            <div className="flex items-center mb-1">
              <img src="/Logo_of_Seoul.jpg" alt="서울시 로고" className="h-7 hdr-logo object-contain mr-2 shrink-0" onError={(e) => e.target.style.display = 'none'} />
              <h1 className="font-black text-xl leading-tight">성동노인종합복지관</h1>
            </div>
            <p className="text-lg font-semibold text-yellow-300">디지털교육 서포터즈</p>
          </div>
          <button
            onClick={handleBack}
            className="text-xs flex flex-col items-center font-bold p-2 rounded-lg shadow-md transition-all touch-manipulation hdr-btn shrink-0"
          >
            <Home className="w-5 h-5 mb-1" /> 시간표 작성
          </button>
        </div>
      </header>

      <main className="flex-1 px-2.5 sm:px-5 pt-3 pb-12 w-full max-w-[1331px] lg:max-w-[1997px] mx-auto">
        <div className="px-1 mb-2 flex items-center justify-between gap-2">
          <h2 className="text-[19px] sm:text-xl font-bold text-gray-800 flex items-center tracking-tight">
            <LucideCalendar className="w-5 h-5 mr-2 text-blue-600" /> 보조강사 시간표
          </h2>
          {isDirty && (
            <span className="text-[13px] sm:text-sm font-bold text-amber-700 bg-amber-50 border border-amber-300 px-2.5 py-1 rounded-full">
              저장 안 됨
            </span>
          )}
        </div>

        {!isAdmin ? (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl py-4 px-5 text-center w-full mt-1">
            <p className="font-extrabold text-amber-800 text-base sm:text-lg">
              💡 메인 화면 우측 상단 [설정]에서 관리자 비밀번호를 저장해 주세요.
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-md ring-1 ring-gray-900/5 p-4 sm:p-5 w-full">
            {tableMissing && (
              <div className="mb-4 bg-amber-50 border border-amber-300 rounded-xl p-4 text-amber-900 text-[14.5px] leading-relaxed">
                <p className="font-extrabold text-base mb-1">⚠️ 데이터베이스에 보조강사 시간표 테이블이 아직 없습니다.</p>
                <p>Supabase 대시보드 → SQL Editor에서 프로젝트의
                  <code className="mx-1 px-1.5 py-0.5 bg-white border border-amber-200 rounded text-[13px]">supabase/migrations/007_create_assistant_schedules_table.sql</code>
                  내용을 실행한 뒤 이 화면을 다시 열어 주세요. (기본 데이터도 함께 입력됩니다)
                </p>
                <p className="mt-1 text-amber-700">아래 목록은 기본 데이터 미리보기이며, 지금은 저장되지 않습니다.</p>
              </div>
            )}

            {/* 수강기간 + 작업 버튼 */}
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 pb-4 mb-4">
              <div className="flex flex-wrap items-end gap-2 sm:gap-3">
                <div>
                  <label className="block text-[14px] sm:text-[15px] font-bold text-gray-700 mb-1">수강기간 시작</label>
                  <input type="date" value={courseStart} onChange={e => setCourseStart(e.target.value)} className={inputCls + ' w-[160px]'} />
                </div>
                <span className="pb-2 font-bold text-slate-500">~</span>
                <div>
                  <label className="block text-[14px] sm:text-[15px] font-bold text-gray-700 mb-1">수강기간 종료</label>
                  <input type="date" value={courseEnd} onChange={e => setCourseEnd(e.target.value)} className={inputCls + ' w-[160px]'} />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={addRow}
                  disabled={loading || saving}
                  className="px-3.5 py-2 bg-white border border-slate-300 text-slate-800 font-bold rounded-lg shadow-sm hover:bg-slate-50 active:scale-95 disabled:opacity-50 text-[14.5px]"
                >
                  + 행 추가
                </button>
                <button
                  onClick={handleRevert}
                  disabled={!isDirty || loading || saving}
                  className="px-3.5 py-2 bg-white border border-slate-300 text-slate-800 font-bold rounded-lg shadow-sm hover:bg-slate-50 active:scale-95 disabled:opacity-40 text-[14.5px]"
                >
                  변경 취소
                </button>
                <button
                  onClick={handleSave}
                  disabled={loading || saving || (!isDirty && !tableMissing)}
                  className="px-5 py-2 bg-blue-600 text-white font-extrabold rounded-lg shadow-md hover:bg-blue-700 active:scale-95 disabled:opacity-40 text-[15px]"
                >
                  {saving ? '저장 중...' : '저장'}
                </button>
              </div>
            </div>

            {message && (
              <div className={`mb-3 px-3.5 py-2.5 rounded-lg text-[14.5px] font-bold ${message.type === 'ok' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                {message.text}
              </div>
            )}

            {loading ? (
              <div className="py-10 text-center text-slate-500 font-bold animate-pulse">불러오는 중...</div>
            ) : rows.length === 0 ? (
              <div className="py-10 text-center text-slate-600">
                <p className="font-bold mb-3">등록된 보조강사 시간표가 없습니다.</p>
                <button
                  onClick={handleLoadDefaults}
                  className="px-4 py-2 bg-white border border-slate-300 text-slate-800 font-bold rounded-lg shadow-sm hover:bg-slate-50"
                >
                  기본 데이터 불러오기 (2026년 4분기)
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto -mx-1 px-1">
                <table className="w-full min-w-[1470px] table-fixed border-collapse text-left">
                  {/* 고정 폭: 창이 좁아도 요일·조 등 선택 칸이 잘리지 않고 가로 스크롤됨 (프로그램명이 남는 폭을 가져감) */}
                  <colgroup>
                    <col style={{ width: 44 }} />
                    <col />
                    <col style={{ width: 180 }} />
                    <col style={{ width: 80 }} />
                    <col style={{ width: 132 }} />
                    <col style={{ width: 132 }} />
                    <col style={{ width: 170 }} />
                    <col style={{ width: 110 }} />
                    <col style={{ width: 90 }} />
                    <col style={{ width: 150 }} />
                    <col style={{ width: 140 }} />
                  </colgroup>
                  <thead>
                    <tr className="bg-slate-100 text-slate-800 text-[14px] font-extrabold">
                      <th className="px-2 py-2 border-b-2 border-slate-300 text-center">#</th>
                      <th className="px-2 py-2 border-b-2 border-slate-300">프로그램명</th>
                      <th className="px-2 py-2 border-b-2 border-slate-300">시간표 과목명</th>
                      <th className="px-2 py-2 border-b-2 border-slate-300">요일</th>
                      <th className="px-2 py-2 border-b-2 border-slate-300">시작</th>
                      <th className="px-2 py-2 border-b-2 border-slate-300">종료</th>
                      <th className="px-2 py-2 border-b-2 border-slate-300">장소</th>
                      <th className="px-2 py-2 border-b-2 border-slate-300">배정팀</th>
                      <th className="px-2 py-2 border-b-2 border-slate-300">조</th>
                      <th className="px-2 py-2 border-b-2 border-slate-300">강사명</th>
                      <th className="px-2 py-2 border-b-2 border-slate-300 text-center whitespace-nowrap">순서 / 삭제</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={r._key} className={`border-b border-slate-300 ${r.id ? '' : 'bg-blue-50/50'}`}>
                        <td className="px-2 py-1.5 text-center font-bold text-slate-600">{i + 1}</td>
                        <td className="px-1 py-1.5">
                          <input className={inputCls} value={r.program_name} onChange={e => updateRow(r._key, 'program_name', e.target.value)} placeholder="예: 컴퓨터 기초 1반" />
                        </td>
                        <td className="px-1 py-1.5">
                          <input className={inputCls + ' font-bold'} value={r.subject} onChange={e => updateRow(r._key, 'subject', e.target.value)} placeholder="예: 보조강사컴기초1" />
                        </td>
                        <td className="px-1 py-1.5">
                          <select className={selectCls} value={r.day_of_week} onChange={e => updateRow(r._key, 'day_of_week', e.target.value)}>
                            {ASSISTANT_DAYS.map(dd => <option key={dd} value={dd}>{dd}</option>)}
                          </select>
                        </td>
                        <td className="px-1 py-1.5">
                          <input type="time" className={inputCls} value={r.start_time} onChange={e => updateRow(r._key, 'start_time', e.target.value)} />
                        </td>
                        <td className="px-1 py-1.5">
                          <input type="time" className={inputCls} value={r.end_time} onChange={e => updateRow(r._key, 'end_time', e.target.value)} />
                        </td>
                        <td className="px-1 py-1.5">
                          <input className={inputCls} value={r.location} onChange={e => updateRow(r._key, 'location', e.target.value)} />
                        </td>
                        <td className="px-1 py-1.5">
                          <select className={selectCls} value={r.team} onChange={e => updateRow(r._key, 'team', e.target.value)}>
                            {ASSISTANT_TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </td>
                        <td className="px-1 py-1.5">
                          <select className={selectCls} value={r.group_name} onChange={e => updateRow(r._key, 'group_name', e.target.value)}>
                            {getGroupOptions(r.team).map(g => <option key={g} value={g}>{g}</option>)}
                          </select>
                        </td>
                        <td className="px-1 py-1.5">
                          <div
                            title="배정팀·조를 선택하면 선생님 목록에서 자동으로 표시됩니다"
                            className={`w-full h-9 px-2 flex items-center rounded-md border border-slate-200 bg-slate-50 text-[14.5px] whitespace-nowrap overflow-hidden ${r.instructors ? 'text-slate-900 font-semibold' : 'text-slate-400'}`}
                          >
                            {r.instructors || '해당 조 선생님 없음'}
                          </div>
                        </td>
                        <td className="px-1 py-1.5">
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => moveRow(i, -1)} disabled={i === 0} title="위로" className="w-8 h-8 rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-30">▲</button>
                            <button onClick={() => moveRow(i, 1)} disabled={i === rows.length - 1} title="아래로" className="w-8 h-8 rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-30">▼</button>
                            <button onClick={() => deleteRow(r)} title="삭제" className="h-8 px-2 shrink-0 whitespace-nowrap rounded-md border border-red-300 bg-red-50 text-red-700 font-bold text-[13px] hover:bg-red-100">삭제</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <p className="mt-4 text-[13.5px] sm:text-sm text-slate-600 leading-relaxed">
              * 시간표 작성 화면의 [② 보조강사 적용]을 누르면 여기 저장된 내용이 시간표에 반영됩니다.<br />
              * 수강기간 이전 날짜는 기존 일정 유지, 종료일 이후 날짜는 빈칸으로 처리됩니다.<br />
              * 강사명은 배정팀·조에 맞춰 선생님 목록에서 자동으로 표시됩니다.<br />
              * 파란 배경 행은 새로 추가한 행입니다. 변경 후에는 반드시 [저장]을 눌러 주세요.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
