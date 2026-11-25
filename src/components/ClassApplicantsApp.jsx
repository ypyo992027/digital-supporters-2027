import React, { useState, useEffect, useMemo, useRef } from 'react';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { supabaseClient } from '../utils/supabase';
import { teamList, fetchAllTeachersFromDb, getGlobalTeachersList } from '../utils/helpers';
import { Home, Clock, UsersIcon, DownloadIcon } from './Icons';
import { showAlert, showConfirm } from '../utils/dialog';

const Search = ({ className }) => <svg className={className} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>;
const Plus = ({ className }) => <svg className={className} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="M12 5v14" /></svg>;
const Edit2 = ({ className }) => <svg className={className} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>;
const Trash2 = ({ className }) => <svg className={className} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg>;
const Phone = ({ className }) => <svg className={className} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></svg>;
const X = ({ className }) => <svg className={className} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>;
const AlertCircle = ({ className }) => <svg className={className} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" x2="12" y1="8" y2="12" /><line x1="12" x2="12.01" y1="16" y2="16" /></svg>;
const CheckCircle2 = ({ className }) => <svg className={className} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></svg>;

const SQL_SETUP = `CREATE TABLE IF NOT EXISTS public.class_applicants (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    name text NOT NULL,
    phone text NOT NULL DEFAULT ''::text,
    preferred_time text NOT NULL DEFAULT ''::text,
    assigned_group text NOT NULL DEFAULT ''::text,
    note text NOT NULL DEFAULT ''::text,
    source text NOT NULL DEFAULT ''::text,
    is_urgent boolean NOT NULL DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT class_applicants_pkey PRIMARY KEY (id)
);

ALTER TABLE public.class_applicants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access" ON public.class_applicants FOR SELECT USING (true);
CREATE POLICY "Allow public all access" ON public.class_applicants FOR ALL USING (true) WITH CHECK (true);`;

const formatPhoneNumber = (val) => {
  if (!val) return '';
  const digits = String(val).replace(/[^0-9]/g, '');
  if (!digits) return '';
  if (digits.startsWith('02')) {
    if (digits.length <= 2) return digits;
    if (digits.length <= 5) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
    if (digits.length <= 9) return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
    return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6, 10)}`;
  }
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  if (digits.length <= 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 11)}`;
};

const EMPTY_FORM = {
  name: '',
  phone: '',
  preferred_time: '',
  assigned_group: '',
  note: '',
  source: '',
  is_urgent: false,
};

export default function ClassApplicantsApp({ onNavigateBack }) {
  const [applicants, setApplicants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [supabaseTableMissing, setSupabaseTableMissing] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Filters & search
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'unassigned' | 'assigned' | 'urgent'
  const [searchQuery, setSearchQuery] = useState('');

  // Add / Edit modal
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [allTeachers, setAllTeachers] = useState(() => getGlobalTeachersList());
  const [assignTeam, setAssignTeam] = useState('');
  const [assignTeacher, setAssignTeacher] = useState('');

  // Long press to delete on mobile card
  const longPressTimerRef = useRef(null);
  const longPressTriggeredRef = useRef(false);
  const longPressStartPosRef = useRef({ x: 0, y: 0 });

  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const startLongPress = (item, clientX = 0, clientY = 0) => {
    clearLongPress();
    longPressTriggeredRef.current = false;
    longPressStartPosRef.current = { x: clientX, y: clientY };
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true;
      longPressTimerRef.current = null;
      handleDelete(item);
    }, 650);
  };

  const teamTeachers = useMemo(() => {
    if (!assignTeam) return [];
    return allTeachers.filter(t => t.team === assignTeam && t.is_active !== false);
  }, [allTeachers, assignTeam]);

  // Load data from Supabase
  const loadApplicants = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const { data, error } = await supabaseClient
        .from('class_applicants')
        .select('*')
        .order('is_urgent', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) {
        if (
          error.code === '42P01' ||
          error.code === 'PGRST205' ||
          (error.message && error.message.includes('class_applicants'))
        ) {
          setSupabaseTableMissing(true);
        } else {
          setErrorMsg('데이터를 불러오는 중 오류가 발생했습니다: ' + error.message);
        }
        setApplicants([]);
      } else {
        setSupabaseTableMissing(false);
        setApplicants(data || []);
      }
    } catch (err) {
      setErrorMsg('네트워크 오류가 발생했습니다: ' + (err.message || err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadApplicants();
    fetchAllTeachersFromDb().then(list => {
      if (Array.isArray(list) && list.length > 0) setAllTeachers(list);
    });
  }, []);

  // Stats
  const stats = useMemo(() => {
    const total = applicants.length;
    const assigned = applicants.filter(a => (a.assigned_group || '').trim() !== '').length;
    const unassigned = total - assigned;
    const urgent = applicants.filter(a => a.is_urgent || (a.name || '').includes('긴급')).length;
    return { total, assigned, unassigned, urgent };
  }, [applicants]);

  // Filtered list
  const filteredList = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return applicants
      .filter(item => {
        const isAssigned = (item.assigned_group || '').trim() !== '';
        const isUrgent = Boolean(item.is_urgent || (item.name || '').includes('긴급'));

        if (statusFilter === 'unassigned' && isAssigned) return false;
        if (statusFilter === 'assigned' && !isAssigned) return false;
        if (statusFilter === 'urgent' && !isUrgent) return false;

        if (!q) return true;
        return (
          (item.name || '').toLowerCase().includes(q) ||
          (item.phone || '').toLowerCase().includes(q) ||
          (item.preferred_time || '').toLowerCase().includes(q) ||
          (item.assigned_group || '').toLowerCase().includes(q) ||
          (item.note || '').toLowerCase().includes(q) ||
          (item.source || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const aAssigned = (a.assigned_group || '').trim() !== '' ? 1 : 0;
        const bAssigned = (b.assigned_group || '').trim() !== '' ? 1 : 0;
        if (aAssigned !== bAssigned) return aAssigned - bAssigned;
        if (aAssigned === 1) {
          const aTime = new Date(a.updated_at || a.created_at || 0).getTime();
          const bTime = new Date(b.updated_at || b.created_at || 0).getTime();
          return aTime - bTime;
        }
        return 0;
      });
  }, [applicants, statusFilter, searchQuery]);

  // Open modal for new applicant
  const handleOpenAdd = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, phone: '010-' });
    setAssignTeam('');
    setAssignTeacher('');
    setShowFormModal(true);
  };

  // Open modal for edit
  const handleOpenEdit = (item) => {
    setEditingId(item.id);
    const ag = (item.assigned_group || '').trim();
    let matchedTeam = teamList.find(t => ag.includes(t)) || '';
    let matchedTeacher = '';
    if (ag) {
      const candidates = matchedTeam ? allTeachers.filter(t => t.team === matchedTeam) : allTeachers;
      const found = candidates.find(t => {
        const cleanName = (t.name || '').replace(/\n/g, ' ').trim();
        return cleanName && ag.includes(cleanName);
      });
      if (found) {
        matchedTeam = found.team;
        matchedTeacher = found.name;
      }
    }
    setAssignTeam(matchedTeam);
    setAssignTeacher(matchedTeacher);
    const formattedPhone = formatPhoneNumber(item.phone || '');
    setForm({
      name: item.name || '',
      phone: formattedPhone || '010-',
      preferred_time: item.preferred_time || '',
      assigned_group: ag,
      note: item.note || '',
      source: item.source || '',
      is_urgent: Boolean(item.is_urgent || (item.name || '').includes('긴급')),
    });
    setShowFormModal(true);
  };

  // Save (Insert or Update)
  const handleSaveForm = async (e) => {
    e.preventDefault();
    const cleanName = form.name.trim();
    if (!cleanName) {
      showAlert('성명을 입력해 주세요.');
      return;
    }

    setSaving(true);
    try {
      const rawPhone = (form.phone || '').trim();
      const normalizedPhone = (rawPhone === '010-' || rawPhone === '010') ? '' : formatPhoneNumber(rawPhone);
      const payload = {
        name: cleanName,
        phone: normalizedPhone,
        preferred_time: form.preferred_time.trim(),
        assigned_group: form.assigned_group.trim(),
        note: form.note.trim(),
        source: form.source.trim(),
        is_urgent: Boolean(form.is_urgent || cleanName.includes('긴급')),
        updated_at: new Date().toISOString(),
      };

      if (editingId) {
        const { error } = await supabaseClient
          .from('class_applicants')
          .update(payload)
          .eq('id', editingId);
        if (error) throw error;
      } else {
        const { error } = await supabaseClient
          .from('class_applicants')
          .insert([payload]);
        if (error) throw error;
      }

      setShowFormModal(false);
      await loadApplicants();
    } catch (err) {
      showAlert('저장 중 오류가 발생했습니다: ' + (err.message || err));
    } finally {
      setSaving(false);
    }
  };

  // Delete applicant
  const handleDelete = async (item) => {
    if (!(await showConfirm(`'${item.name}' 님의 수업 희망자 내역을 삭제하시겠습니까?`))) return;
    try {
      const { error } = await supabaseClient
        .from('class_applicants')
        .delete()
        .eq('id', item.id);
      if (error) throw error;
      setApplicants(prev => prev.filter(a => a.id !== item.id));
    } catch (err) {
      showAlert('삭제 중 오류가 발생했습니다: ' + (err.message || err));
    }
  };

  // Export to Excel
  const handleExportExcel = async () => {
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = '성동노인종합복지관';
      wb.created = new Date();

      const ws = wb.addWorksheet('수업_희망자_관리', {
        pageSetup: {
          paperSize: 9,
          orientation: 'portrait',
          fitToPage: true,
          fitToWidth: 1,
          fitToHeight: 0,
          margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
        },
      });

      ws.mergeCells('A1:G1');
      const titleCell = ws.getCell('A1');
      titleCell.value = '2027년 1:1 디지털 교육 수업 희망자 현황표';
      titleCell.font = { name: '맑은 고딕', size: 15, bold: true, color: { argb: 'FF0F172A' } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getRow(1).height = 34;

      ws.mergeCells('A2:G2');
      const metaCell = ws.getCell('A2');
      metaCell.value = `출력일시: ${new Date().toLocaleString('ko-KR')} | 총 ${filteredList.length}명 (미배정: ${filteredList.filter(a => !(a.assigned_group || '').trim()).length}명)`;
      metaCell.font = { name: '맑은 고딕', size: 10, color: { argb: 'FF475569' } };
      metaCell.alignment = { horizontal: 'right', vertical: 'middle' };
      ws.getRow(2).height = 20;

      const headers = ['연번', '성명', '전화번호', '희망요일 및 시간', '비고', '출처', '배정된 조(선생님)'];
      ws.addRow(headers);
      const headerRow = ws.getRow(3);
      headerRow.height = 26;
      headerRow.eachCell((cell, colNum) => {
        cell.font = { name: '맑은 고딕', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = {
          top: { style: 'medium', color: { argb: 'FF1E293B' } },
          left: colNum === 1 ? { style: 'medium', color: { argb: 'FF1E293B' } } : { style: 'thin', color: { argb: 'FF475569' } },
          bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
          right: colNum === headers.length ? { style: 'medium', color: { argb: 'FF1E293B' } } : { style: 'thin', color: { argb: 'FF475569' } },
        };
      });

      const totalRows = filteredList.length;
      filteredList.forEach((item, idx) => {
        const row = ws.addRow([
          idx + 1,
          item.name || '',
          formatPhoneNumber(item.phone || ''),
          item.preferred_time || '',
          item.note || '',
          item.source || '',
          item.assigned_group || '',
        ]);
        const isLastRow = idx === totalRows - 1;
        const isEvenRow = idx % 2 === 1;
        const isUrgent = Boolean(item.is_urgent || (item.name || '').includes('긴급'));
        row.height = 22;
        row.eachCell((cell, colNum) => {
          cell.font = {
            name: '맑은 고딕',
            size: 10,
            bold: colNum === 2 || colNum === 7,
            color: { argb: (colNum === 2 && isUrgent) ? 'FFDC2626' : (colNum === 2 ? 'FF1D4ED8' : 'FF1E293B') },
          };
          cell.alignment = {
            horizontal: (colNum === 4 || colNum === 5 || colNum === 7) ? 'left' : 'center',
            vertical: 'middle',
            wrapText: true,
          };
          if (isEvenRow) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
          }
          cell.border = {
            top: { style: 'thin', color: { argb: 'FF94A3B8' } },
            left: colNum === 1 ? { style: 'medium', color: { argb: 'FF334155' } } : { style: 'thin', color: { argb: 'FF94A3B8' } },
            bottom: isLastRow ? { style: 'medium', color: { argb: 'FF334155' } } : { style: 'thin', color: { argb: 'FF94A3B8' } },
            right: colNum === headers.length ? { style: 'medium', color: { argb: 'FF334155' } } : { style: 'thin', color: { argb: 'FF94A3B8' } },
          };
        });
      });

      ws.columns = [
        { width: 7 },  // 연번
        { width: 22 }, // 성명
        { width: 16 }, // 전화번호
        { width: 24 }, // 희망요일 및 시간
        { width: 32 }, // 비고
        { width: 18 }, // 출처
        { width: 18 }, // 배정된 조(선생님)
      ];

      ws.pageSetup.printArea = `A1:G${3 + totalRows}`;
      ws.pageSetup.printTitlesRow = '1:3';

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      saveAs(blob, `수업_희망자_관리_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (err) {
      showAlert('엑셀 파일 생성 중 오류가 발생했습니다: ' + (err.message || err));
    }
  };

  return (
    <div className="min-h-[100dvh] flex flex-col app-surface font-sans text-slate-800">
      {/* 상단 헤더 */}
      <header className="shrink-0 app-header text-white z-40 relative">
        <div className="max-w-5xl lg:max-w-[1536px] mx-auto px-2.5 sm:px-5 pb-4 pt-safe-4 flex justify-between items-center">
          <div>
            <div className="flex items-center mb-1">
              <img src="/Logo_of_Seoul.jpg" alt="서울시 로고" className="h-7 hdr-logo object-contain mr-2 shrink-0" onError={(e) => e.target.style.display = 'none'} />
              <h1 className="font-black text-xl leading-tight">성동노인종합복지관</h1>
            </div>
            <p className="text-lg font-semibold text-yellow-300">디지털교육 서포터즈</p>
          </div>
          <button
            type="button"
            onClick={onNavigateBack}
            className="text-xs flex flex-col items-center font-bold p-2 rounded-lg shadow-md transition-all touch-manipulation hdr-btn shrink-0 cursor-pointer"
          >
            <Home className="w-5 h-5 mb-1" /> 처음으로
          </button>
        </div>
      </header>

      {/* 본문 영역 */}
      <main className="flex-1 max-w-5xl lg:max-w-[1536px] w-full mx-auto px-2.5 sm:px-5 py-3 md:py-5 space-y-3 pb-12">
        {/* 섹션 타이틀 + 우측 액션 버튼 */}
        <div className="px-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[19px] sm:text-xl font-bold text-gray-800 flex items-center tracking-tight whitespace-nowrap">
            <span className="flex items-center"><UsersIcon className="w-5 h-5 mr-2 text-teal-600" /> 수업 희망자 관리</span>
          </h2>
          {!supabaseTableMissing && (
            <div className="flex items-center gap-1.5 sm:gap-2">
              <button
                type="button"
                onClick={handleExportExcel}
                className="px-2.5 sm:px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-xl text-xs sm:text-sm font-bold transition flex items-center gap-1 cursor-pointer shadow-sm touch-manipulation whitespace-nowrap"
                title="현재 목록 엑셀 파일로 다운로드"
              >
                <DownloadIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white" />
                <span>엑셀</span>
              </button>
              <button
                type="button"
                onClick={handleOpenAdd}
                className="px-3 sm:px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white rounded-xl text-xs sm:text-sm font-bold transition flex items-center gap-1 cursor-pointer shadow-sm touch-manipulation whitespace-nowrap"
              >
                <Plus className="w-4 h-4" />
                <span>희망자 등록</span>
              </button>
            </div>
          )}
        </div>

        {/* Supabase 테이블 미생성 안내 */}
        {supabaseTableMissing && (
          <div className="bg-amber-50 text-amber-900 rounded-2xl border border-amber-300 shadow-sm p-4 text-xs sm:text-sm flex flex-col gap-2.5">
            <div className="flex items-center gap-2 font-bold text-amber-800 text-[15px] sm:text-base">
              ⚠️ 슈파베이스(Supabase) `class_applicants` 테이블 생성이 필요합니다!
            </div>
            <p className="leading-relaxed">
              앱에서 수업 희망자 데이터를 저장·조회하려면 아래 SQL 쿼리를 복사하여 <b>Supabase Dashboard ➡️ SQL Editor</b>에 붙여넣고 실행(Run)해 주세요.
            </p>
            <pre className="bg-gray-900 text-green-400 p-3 rounded-xl overflow-x-auto font-mono text-[11px] sm:text-xs max-h-48 border border-gray-800 select-all">
              {SQL_SETUP}
            </pre>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(SQL_SETUP);
                  showAlert('SQL 쿼리가 클립보드에 복사되었습니다!');
                }}
                className="bg-amber-600 text-white font-bold py-2 px-4 rounded-xl hover:bg-amber-700 active:scale-95 transition-all text-xs sm:text-sm shadow-sm cursor-pointer"
              >
                SQL 쿼리 복사하기
              </button>
              <button
                type="button"
                onClick={loadApplicants}
                className="bg-white text-amber-900 border border-amber-300 font-bold py-2 px-4 rounded-xl hover:bg-amber-100 active:scale-95 transition-all text-xs sm:text-sm shadow-sm cursor-pointer"
              >
                생성 후 다시 불러오기
              </button>
            </div>
          </div>
        )}

        {errorMsg && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm font-bold flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {!supabaseTableMissing && (
          <>
            {/* 상태 필터 칩 + 검색 바 */}
            <div className="bg-white rounded-2xl border border-slate-200 p-3 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-2.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                {[
                  { key: 'all', label: `전체 ${stats.total}`, activeClass: 'bg-blue-600 text-white border-blue-600' },
                  { key: 'unassigned', label: `미배정 ${stats.unassigned}`, activeClass: 'bg-amber-500 text-white border-amber-500' },
                  { key: 'assigned', label: `배정완료 ${stats.assigned}`, activeClass: 'bg-emerald-600 text-white border-emerald-600' },
                  { key: 'urgent', label: `긴급 ${stats.urgent}`, activeClass: 'bg-rose-600 text-white border-rose-600' },
                ].map(tab => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setStatusFilter(tab.key)}
                    className={`px-3 py-1.5 rounded-xl text-xs sm:text-[13px] font-bold border transition cursor-pointer touch-manipulation whitespace-nowrap ${statusFilter === tab.key
                      ? `${tab.activeClass} shadow-xs`
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="relative flex-1 md:max-w-sm">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="성명, 전화번호, 희망요일/시간, 배정조, 출처 검색..."
                  className="w-full pl-9 pr-8 py-1.5 sm:py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15 transition"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* 목록 표시 영역 */}
            {loading ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-blue-600 font-bold flex flex-col items-center gap-2">
                <Clock className="w-7 h-7 animate-spin" />
                <span>수업 희망자 목록을 불러오는 중입니다...</span>
              </div>
            ) : filteredList.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-400 font-semibold">
                {applicants.length === 0
                  ? '등록된 수업 희망자가 없습니다. 상단의 [희망자 등록]을 눌러 추가해 주세요.'
                  : '검색 조건에 일치하는 수업 희망자가 없습니다.'}
              </div>
            ) : (
              <>
                {/* PC / 태블릿 테이블 뷰 */}
                <div className="hidden md:block bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
                  <div className="overflow-x-auto max-h-[76vh] overflow-y-auto">
                    <table className="w-full text-left border-separate border-spacing-0">
                      <thead className="sticky top-0 z-20 bg-slate-100 shadow-2xs">
                        <tr className="text-slate-700 font-bold text-[13.5px]">
                          <th className="py-2 px-2.5 border-b border-slate-200 text-center w-12 whitespace-nowrap">연번</th>
                          <th className="py-2 px-2.5 border-b border-slate-200 whitespace-nowrap">성명</th>
                          <th className="py-2 px-2.5 border-b border-slate-200 whitespace-nowrap w-32">전화번호</th>
                          <th className="py-2 px-2.5 border-b border-slate-200 min-w-[160px]">희망요일 및 시간</th>
                          <th className="py-2 px-2.5 border-b border-slate-200 min-w-[200px]">비고</th>
                          <th className="py-2 px-2.5 border-b border-slate-200 whitespace-nowrap">출처</th>
                          <th className="py-2 px-2.5 border-b border-slate-200 text-center w-20 whitespace-nowrap">관리</th>
                          <th className="py-2 px-2.5 border-b border-slate-200 whitespace-nowrap">배정된 조(선생님)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-[13.5px]">
                        {filteredList.map((item, idx) => {
                          const isUrgent = Boolean(item.is_urgent || (item.name || '').includes('긴급'));
                          const isAssigned = (item.assigned_group || '').trim() !== '';
                          return (
                            <tr key={item.id} className={`transition-colors ${isAssigned ? 'bg-sky-50/80 hover:bg-sky-100/70' : 'hover:bg-blue-50/40'}`}>
                              <td className="py-1.5 px-2.5 text-center text-slate-400 font-bold border-b border-slate-100">
                                {idx + 1}
                              </td>
                              <td className="py-1.5 px-2.5 border-b border-slate-100 whitespace-nowrap">
                                <div className="flex items-center gap-1.5 flex-nowrap">
                                  {isUrgent && (
                                    <span className="px-1.5 py-px rounded bg-rose-100 text-rose-700 text-[11px] font-extrabold shrink-0">
                                      긴급
                                    </span>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => handleOpenEdit(item)}
                                    title="클릭하여 수정"
                                    className={`font-extrabold text-left cursor-pointer hover:underline ${isUrgent ? 'text-rose-700' : 'text-slate-900 hover:text-blue-600'}`}
                                  >
                                    {item.name}
                                  </button>
                                </div>
                              </td>
                              <td className="py-1.5 px-2.5 border-b border-slate-100 whitespace-nowrap font-semibold text-slate-700 tabular-nums">
                                {item.phone ? (
                                  <a href={`tel:${item.phone.replace(/[^0-9]/g, '')}`} className="hover:text-blue-600 hover:underline">
                                    {formatPhoneNumber(item.phone)}
                                  </a>
                                ) : '-'}
                              </td>
                              <td className="py-1.5 px-2.5 border-b border-slate-100 bg-amber-50/50 font-bold text-slate-900 break-keep">
                                {item.preferred_time || '-'}
                              </td>
                              <td className="py-1.5 px-2.5 border-b border-slate-100 text-slate-900 font-medium text-[13px] leading-snug break-keep">
                                {item.note || '-'}
                              </td>
                              <td className="py-1.5 px-2.5 border-b border-slate-100 text-slate-900 font-medium text-[13px] whitespace-nowrap">
                                {item.source || '-'}
                              </td>
                              <td className="py-1.5 px-2.5 border-b border-slate-100 text-center">
                                <div className="inline-flex items-center gap-0.5">
                                  <button
                                    type="button"
                                    onClick={() => handleOpenEdit(item)}
                                    className="p-1 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition cursor-pointer"
                                    title="수정"
                                  >
                                    <Edit2 className="w-4 h-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDelete(item)}
                                    className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                                    title="삭제"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </td>
                              <td className="py-1.5 px-2.5 border-b border-slate-100 whitespace-nowrap">
                                {isAssigned ? (
                                  <button
                                    type="button"
                                    onClick={() => handleOpenEdit(item)}
                                    title="클릭하여 수정"
                                    className="inline-flex items-center gap-1 px-2 py-px rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold text-[12.5px] cursor-pointer hover:bg-emerald-100 transition"
                                  >
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    {item.assigned_group}
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => handleOpenEdit(item)}
                                    title="클릭하여 수정"
                                    className="inline-flex items-center px-2 py-px rounded-md bg-slate-100 text-slate-400 font-semibold text-[12px] cursor-pointer hover:bg-amber-50 hover:text-amber-700 hover:border hover:border-amber-200 transition"
                                  >
                                    미배정
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* 스마트폰 카드 리스트 뷰 */}
                <div className="md:hidden space-y-2.5">
                  {filteredList.map((item, idx) => {
                    const isUrgent = Boolean(item.is_urgent || (item.name || '').includes('긴급'));
                    const isAssigned = (item.assigned_group || '').trim() !== '';
                    return (
                      <div
                        key={item.id}
                        onClick={() => {
                          if (longPressTriggeredRef.current) {
                            longPressTriggeredRef.current = false;
                            return;
                          }
                          handleOpenEdit(item);
                        }}
                        onTouchStart={(e) => {
                          const t = e.touches[0];
                          startLongPress(item, t?.clientX || 0, t?.clientY || 0);
                        }}
                        onTouchMove={(e) => {
                          const t = e.touches[0];
                          if (!t) return;
                          const dx = Math.abs(t.clientX - longPressStartPosRef.current.x);
                          const dy = Math.abs(t.clientY - longPressStartPosRef.current.y);
                          if (dx > 10 || dy > 10) clearLongPress();
                        }}
                        onTouchEnd={clearLongPress}
                        onTouchCancel={clearLongPress}
                        onMouseDown={(e) => {
                          if (e.button === 0) startLongPress(item, e.clientX, e.clientY);
                        }}
                        onMouseUp={clearLongPress}
                        onMouseLeave={clearLongPress}
                        onContextMenu={(e) => e.preventDefault()}
                        className={`rounded-2xl border-[1.5px] p-3.5 shadow-xs space-y-2 cursor-pointer select-none transition active:scale-[0.995] hover:border-blue-400 ${isAssigned ? 'bg-sky-50 border-sky-300' : isUrgent ? 'bg-rose-50/20 border-rose-400' : 'bg-white border-slate-300'}`}
                      >
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 flex-nowrap min-w-0 flex-1">
                              {isUrgent && (
                                <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 text-[11px] font-extrabold shrink-0">
                                  긴급
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (longPressTriggeredRef.current) {
                                    longPressTriggeredRef.current = false;
                                    return;
                                  }
                                  handleOpenEdit(item);
                                }}
                                title={item.name}
                                className={`font-extrabold text-[15px] text-left whitespace-nowrap truncate min-w-0 cursor-pointer hover:underline active:opacity-70 ${isUrgent ? 'text-rose-700' : 'text-slate-900 hover:text-blue-600'}`}
                              >
                                {item.name}
                              </button>
                            </div>

                            <div className="shrink-0">
                              {isAssigned ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (longPressTriggeredRef.current) {
                                      longPressTriggeredRef.current = false;
                                      return;
                                    }
                                    handleOpenEdit(item);
                                  }}
                                  title="클릭하여 수정"
                                  className="px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold text-xs whitespace-nowrap cursor-pointer hover:bg-emerald-100 active:scale-95 transition"
                                >
                                  {item.assigned_group}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (longPressTriggeredRef.current) {
                                      longPressTriggeredRef.current = false;
                                      return;
                                    }
                                    handleOpenEdit(item);
                                  }}
                                  title="클릭하여 수정"
                                  className="px-2 py-0.5 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 font-bold text-xs whitespace-nowrap cursor-pointer hover:bg-amber-100 active:scale-95 transition"
                                >
                                  미배정
                                </button>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center justify-between gap-2">
                            {item.phone ? (
                              <a
                                href={`tel:${item.phone.replace(/[^0-9]/g, '')}`}
                                onClick={e => e.stopPropagation()}
                                className="inline-flex items-center gap-1 text-[13.5px] font-bold text-blue-600"
                              >
                                <Phone className="w-3.5 h-3.5" />
                                {formatPhoneNumber(item.phone)}
                              </a>
                            ) : (
                              <span />
                            )}

                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); handleOpenEdit(item); }}
                                className="p-1 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-blue-50"
                                title="수정"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); handleDelete(item); }}
                                className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                                title="삭제"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        </div>

                        <div className="text-[13.5px] space-y-1 pt-1 border-t border-slate-100">
                          {item.preferred_time && (
                            <div className="flex items-start gap-1.5 bg-amber-50 border border-amber-200/80 rounded-lg px-2.5 py-1">
                              <span className="text-amber-700 font-bold shrink-0">희망:</span>
                              <span className="text-slate-900 font-extrabold">{item.preferred_time}</span>
                            </div>
                          )}
                          {item.note && (
                            <div className="flex items-start gap-1.5">
                              <span className="text-slate-600 font-bold shrink-0">비고:</span>
                              <span className="text-slate-900 font-medium break-keep">{item.note}</span>
                            </div>
                          )}
                          {item.source && (
                            <div className="flex items-start gap-1.5">
                              <span className="text-slate-600 font-bold shrink-0">출처:</span>
                              <span className="text-slate-900 font-medium">{item.source}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}
      </main>

      {/* 등록 / 수정 모달 */}
      {showFormModal && (
        <div className="fixed inset-0 bg-slate-900/45 backdrop-blur-[3px] flex items-center justify-center z-50 px-4" onClick={() => setShowFormModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden animate-fadeIn" onClick={e => e.stopPropagation()}>
            <div className="bg-blue-600 px-5 py-3.5 flex items-center justify-between text-white">
              <h3 className="text-lg font-bold">{editingId ? '수업 희망자 수정' : '수업 희망자 등록'}</h3>
              <button type="button" onClick={() => setShowFormModal(false)} className="p-1 rounded-lg hover:bg-white/20 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveForm} className="p-5 space-y-3.5 max-h-[82vh] overflow-y-auto">
              <div className="flex items-center justify-between gap-2">
                <div className="flex-1">
                  <label className="block text-[15px] sm:text-base font-bold text-slate-700 mb-1.5">성명 *</label>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="예: 홍길동 또는 (긴급)OO경로당"
                    className="w-full px-3 py-2 bg-blue-50/70 border border-blue-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
                <label className="flex items-center gap-1.5 pt-5 px-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={form.is_urgent}
                    onChange={e => setForm(prev => ({ ...prev, is_urgent: e.target.checked }))}
                    className="w-4 h-4 text-rose-600 rounded focus:ring-rose-500"
                  />
                  <span className="text-sm font-extrabold text-rose-600 whitespace-nowrap">긴급</span>
                </label>
              </div>

              <div>
                <label className="block text-[15px] sm:text-base font-bold text-slate-700 mb-1.5">전화번호</label>
                <input
                  type="text"
                  value={form.phone}
                  onChange={e => setForm(prev => ({ ...prev, phone: formatPhoneNumber(e.target.value) }))}
                  placeholder="010-0000-0000"
                  className="w-full px-3 py-2 bg-blue-50/70 border border-blue-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              <div>
                <label className="block text-[15px] sm:text-base font-bold text-slate-700 mb-1.5">희망요일 및 시간</label>
                <input
                  type="text"
                  value={form.preferred_time}
                  onChange={e => setForm(prev => ({ ...prev, preferred_time: e.target.value }))}
                  placeholder="예: 화 13:00, 목 오후 1시 이후 가능"
                  className="w-full px-3 py-2 bg-blue-50/70 border border-blue-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              <div>
                <label className="block text-[15px] sm:text-base font-bold text-slate-700 mb-1.5">비고</label>
                <textarea
                  rows={3}
                  value={form.note}
                  onChange={e => setForm(prev => ({ ...prev, note: e.target.value }))}
                  placeholder="특이사항, 요청사항, 통화 전 문자 요망 등"
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-semibold text-slate-900 placeholder:text-slate-500 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 resize-none"
                />
              </div>

              <div>
                <label className="block text-[15px] sm:text-base font-bold text-slate-700 mb-1.5">출처</label>
                <input
                  type="text"
                  value={form.source}
                  onChange={e => setForm(prev => ({ ...prev, source: e.target.value }))}
                  placeholder="예: 복지관접수(11/18), 이혜섭 선생님"
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-semibold text-slate-900 placeholder:text-slate-500 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-[15px] sm:text-base font-bold text-blue-600">배정된 조(선생님)</label>
                  {form.assigned_group && (
                    <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
                      배정: {form.assigned_group}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <select
                    value={assignTeam}
                    onChange={e => {
                      const nextTeam = e.target.value;
                      setAssignTeam(nextTeam);
                      setAssignTeacher('');
                      setForm(prev => ({ ...prev, assigned_group: nextTeam }));
                    }}
                    className={`w-full px-3 py-2 border rounded-xl text-sm font-bold outline-none transition cursor-pointer ${assignTeam
                      ? 'bg-blue-50/70 border-blue-400 text-blue-700'
                      : 'bg-white border-slate-300 text-blue-600'
                      } focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20`}
                  >
                    <option value="">팀 선택</option>
                    {teamList.map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>

                  <select
                    value={assignTeacher}
                    disabled={!assignTeam}
                    onChange={e => {
                      const nextTeacher = e.target.value;
                      setAssignTeacher(nextTeacher);
                      if (!nextTeacher) {
                        setForm(prev => ({ ...prev, assigned_group: assignTeam }));
                      } else {
                        const found = teamTeachers.find(t => t.name === nextTeacher);
                        const cleanName = nextTeacher.replace(/\n/g, ' ').trim();
                        const formatted = found?.group_name
                          ? `${assignTeam} ${found.group_name} ${cleanName}`
                          : `${assignTeam} ${cleanName}`;
                        setForm(prev => ({ ...prev, assigned_group: formatted }));
                      }
                    }}
                    className={`w-full px-3 py-2 border rounded-xl text-sm font-bold outline-none transition cursor-pointer disabled:bg-slate-100 disabled:text-blue-400 disabled:cursor-not-allowed ${assignTeacher
                      ? 'bg-blue-50/70 border-blue-400 text-blue-700'
                      : 'bg-white border-slate-300 text-blue-600'
                      } focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20`}
                  >
                    <option value="">{assignTeam ? '선생님 선택' : '팀 먼저 선택'}</option>
                    {teamTeachers.map(t => {
                      const cleanName = (t.name || '').replace(/\n/g, ' ').trim();
                      return (
                        <option key={`${t.team}-${t.name}`} value={t.name}>
                          {cleanName}
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowFormModal(false)}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-sm transition cursor-pointer"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-sm shadow-sm transition cursor-pointer disabled:opacity-50"
                >
                  {saving ? '저장 중...' : (editingId ? '수정 저장' : '등록하기')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
