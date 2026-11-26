const ATTENDANCE_TAGS = ['출석', '결석', '종료', '선생님휴가'];
const PARSEABLE_ATTENDANCE_TAGS = ['1', '출석', '결석', '종료', '선생님휴가'];
const normalizeAttendanceTag = (t) => (t === '1' ? '출석' : t);

const parseStatusString = (statusStr, cleanMyStudent) => {
  const rawParts = statusStr.split(',').map(s => s.trim()).filter(Boolean);
  const isShowHeadcount = cleanMyStudent.includes("보조강사") || cleanMyStudent.includes("경로당");
  const isKyungrodang = cleanMyStudent.includes("경로당");

  let tagParts = [];
  let memoParts = [];
  let isMemoStarted = false;
  let loadedHeadcount = "";
  let startIndex = 0;

  if (isShowHeadcount && rawParts.length > 0 && /^\d{1,2}$/.test(rawParts[0])) {
    loadedHeadcount = rawParts[0];
    startIndex = 1;
  }

  for (let i = startIndex; i < rawParts.length; i++) {
    const part = rawParts[i];
    if (!isMemoStarted) {
      const subParts = part.split('/').map(p => p.trim());
      const isAllTags = subParts.every(p => {
        if (p === "") return true;
        const spaceParts = p.split(/\s+/);
        return spaceParts.every(sp => PARSEABLE_ATTENDANCE_TAGS.includes(sp));
      });

      if (isAllTags) {
        tagParts.push(part);
      } else {
        isMemoStarted = true;
        memoParts.push(part);
      }
    } else {
      memoParts.push(part);
    }
  }

  if (isShowHeadcount && tagParts.length > 0 && !loadedHeadcount) {
    const lastTag = tagParts[tagParts.length - 1];
    if (/^\d{1,2}$/.test(lastTag)) {
      if (isKyungrodang || tagParts.length > 1) {
        tagParts.pop();
        memoParts.unshift(lastTag);
      }
    }
  }

  let loadedTags = [[]];
  if (tagParts.length > 0) {
    const combinedTagStr = tagParts.join(',');
    const studentTagStrs = combinedTagStr.split('/');
    loadedTags = studentTagStrs.map(str =>
      str.split(/[,\s]+/).map(t => normalizeAttendanceTag(t.trim())).filter(t => ATTENDANCE_TAGS.includes(t))
    );
  }
  loadedTags = loadedTags.map(tags => tags.sort((a, b) => ATTENDANCE_TAGS.indexOf(a) - ATTENDANCE_TAGS.indexOf(b)));

  if (isShowHeadcount && memoParts.length > 0 && !loadedHeadcount) {
    if (/^\d{1,2}$/.test(memoParts[0].trim())) {
      loadedHeadcount = memoParts[0].trim();
      memoParts.shift();
    }
  }
  const loadedMemo = memoParts.join(', ').replace(/\u200B/g, '');

  return { loadedTags, loadedMemo, loadedHeadcount };
};

// 메인메뉴, 일지 작성 프로그램

import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import { supabaseClient } from '../utils/supabase';
import {
  getSavedItem,
  setSavedItem,
  removeSavedItem,
  safeJsonSetItem,
  clearExpendableStorage,
  getSessionItem,
  setSessionItem,
  getInitialWeekday,
  getLocalDateString,
  formatStatusIfDate,
  getDirectImageUrl,
  teamList,
  formatTeacherRow,
  setGlobalTeachersList,
  getTeamTeacherNames,
  getTeacherSortWeight,
  getTeacherGroup,
  getTeamDefaultShifts,
  getDayName,
  attachRoEuro,
  mergeAttendanceAndStatus
} from '../utils/helpers';
import QuickNavBar from './QuickNavBar';
import StudentPhotoModal from './StudentPhotoModal';
import { fetchPhotoSummaryByStudent, normalizeStudentPhotoKey } from '../utils/studentPhotoDrive';
import { showAlert, showConfirm } from '../utils/dialog';
import {
  DEFAULT_BG_GRAY_LEVEL,
  DEFAULT_FONT_SCALE,
  getBgGrayLevel,
  getRoomPopupMode,
  getFontScale,
  saveBgGrayLevel,
  saveRoomPopupMode,
  saveFontScale,
  hasValidSavedAdminPassword,
  saveAdminPassword,
  clearSavedAdminPassword
} from '../utils/appSettings';
import {
  User,
  MainCalendarIcon,
  CalendarIcon,
  Clock,
  Home,
  SaveIcon,
  EditIcon,
  RefreshCw,
  CalendarClockIcon,
  CalendarDaysIcon,
  UsersIcon,
  PresentationIcon,
  LucideCalendar,
  Settings
} from './Icons';

// 주어진 문자열을 쉼표(,)나 슬래시(/) 단위로 쪼갠 뒤,
// 특정 키워드 배열에 포함된 단어와 "정확히 일치"하는 토큰이 있는지 확인합니다.
// 예: "쿠팡 취소" -> [ "쿠팡 취소" ] 이므로 "취소" 키워드와 불일치.
// 예: "1, 취소, 쿠팡" -> [ "1", "취소", "쿠팡" ] 이므로 "취소" 키워드와 정확히 일치.
const hasIndependentKeyword = (str, keywords) => {
  if (!str) return false;
  const tokens = str.split(/[,/]+/).map(t => t.trim());
  return tokens.some(token => keywords.includes(token));
};

// ───────── 메인 화면 메뉴 아이콘 ─────────
const svgProps = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" };
const IconClassroom = (p) => (<svg {...svgProps} {...p}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M7 20h10M12 16v4M7 8h6M7 11h4" /></svg>);
const IconStudio = (p) => (<svg {...svgProps} {...p}><rect x="2" y="7" width="14" height="10" rx="2" /><path d="m16 11 6-3v8l-6-3" /><circle cx="6.5" cy="10.5" r="0.6" fill="currentColor" /></svg>);
const IconMegaphone = (p) => (<svg {...svgProps} {...p}><path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></svg>);
const IconCalendarStar = (p) => (
  <svg {...svgProps} {...p}>
    <path d="M3 9.5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v1H3v-1Z" fill="currentColor" fillOpacity="0.2" stroke="none" />
    <rect x="3" y="4.5" width="18" height="16.5" rx="3" />
    <path d="M8 2.5v3.5M16 2.5v3.5M3 10h18" />
    <path d="m12 12.2 1.15 2.3 2.55.38-1.85 1.8.44 2.52L12 18l-2.29 1.2.44-2.52-1.85-1.8 2.55-.38Z" fill="currentColor" fillOpacity="0.25" />
  </svg>
);
const IconTimetable = (p) => (
  <svg {...svgProps} {...p}>
    <rect x="3" y="3.5" width="18" height="5.5" rx="2" fill="currentColor" fillOpacity="0.18" stroke="none" />
    <rect x="9" y="9" width="6" height="5.5" fill="currentColor" fillOpacity="0.25" stroke="none" />
    <rect x="3" y="3.5" width="18" height="17" rx="3" />
    <path d="M3 9h18M3 14.5h18M9 9v11.5M15 9v11.5" />
  </svg>
);
const IconSearchUser = (p) => (<svg {...svgProps} {...p}><circle cx="10.5" cy="10.5" r="7" /><path d="m21 21-5.5-5.5" /><circle cx="10.5" cy="9" r="2.2" /><path d="M6.8 14.3a4.3 4.3 0 0 1 7.4 0" /></svg>);
const IconPeople = (p) => (
  <svg {...svgProps} {...p}>
    <circle cx="9" cy="8" r="3.2" fill="currentColor" fillOpacity="0.16" />
    <path d="M3 19.5a6 6 0 0 1 12 0" />
    <path d="M15.8 5.2a3 3 0 0 1 0 5.6M17.5 14.2a5.5 5.5 0 0 1 3.5 5.3" />
  </svg>
);
const IconChevronRight = (p) => (<svg {...svgProps} strokeWidth={2.5} {...p}><path d="m9 18 6-6-6-6" /></svg>);
const IconExternal = (p) => (<svg {...svgProps} strokeWidth={2.3} {...p}><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" /></svg>);
const IconLock = (p) => (<svg {...svgProps} {...p}><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></svg>);
const IconCheck = (p) => (<svg {...svgProps} strokeWidth={3} {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>);
const IconDocumentCheck = (p) => (
  <svg {...svgProps} {...p}>
    <path d="M14 2H6.5A2.5 2.5 0 0 0 4 4.5v15A2.5 2.5 0 0 0 6.5 22h11a2.5 2.5 0 0 0 2.5-2.5V8L14 2Z" fill="currentColor" fillOpacity="0.14" stroke="none" />
    <path d="M14 2H6.5A2.5 2.5 0 0 0 4 4.5v15A2.5 2.5 0 0 0 6.5 22h11a2.5 2.5 0 0 0 2.5-2.5V8z" />
    <path d="M14 2v5a1 1 0 0 0 1 1h5" />
    <path d="m9 15.2 2 2 4.2-4.2" strokeWidth={2.3} />
  </svg>
);
const IconNameCard = (p) => (
  <svg {...svgProps} {...p}>
    <rect x="2.5" y="5" width="19" height="14" rx="3" fill="currentColor" fillOpacity="0.14" stroke="none" />
    <rect x="2.5" y="5" width="19" height="14" rx="3" />
    <circle cx="8.2" cy="10.8" r="2" fill="currentColor" fillOpacity="0.22" />
    <path d="M5.6 15.6a3 3 0 0 1 5.2 0M13.5 10.2h4.5M13.5 14h3.5" />
  </svg>
);

// 메뉴 그룹 (제목 + 묶음 목록)
const MenuGroup = ({ title, icon, children }) => (
  <section className="menu-group">
    <h3 className="menu-group-title">{icon}{title}</h3>
    <div className="menu-list">{children}</div>
  </section>
);

// 목록형 메뉴 한 줄 (아이콘 + 이름/설명 + 외부링크 표시)
const MenuRow = ({ icon, label, desc, onClick, href, disabled, variant, chipColor = "chip-blue" }) => {
  const className = `menu-row${variant === 'admin' ? ' is-admin' : ''}${disabled ? ' is-disabled' : ''}`;
  const content = (
    <>
      <span className={`row-chip ${disabled ? '' : chipColor}`}>{icon}</span>
      <span className="row-text">
        <span className="row-label">{label}</span>
        {desc && <span className="row-desc">{desc}</span>}
      </span>
      {href && <IconExternal className="row-trail" aria-label="새 창에서 열림" />}
    </>
  );
  if (href) {
    return <a href={href} target="_blank" rel="noopener noreferrer" className={className}>{content}</a>;
  }
  return <button type="button" onClick={onClick} className={className} aria-disabled={disabled || undefined}>{content}</button>;
};

// 타일형 메뉴 (2칸 나란히)
const MenuTile = ({ icon, label, sub, onClick, chipColor = "chip-blue" }) => (
  <button type="button" onClick={onClick} className="menu-tile">
    <span className={`row-chip ${chipColor}`}>{icon}</span>
    <span className="tile-text">
      <span className="row-label">{label}</span>
      {sub && <span className="row-desc">{sub}</span>}
    </span>
  </button>
);

// 단계 표시 배지: 선택 전에는 빈 원, 선택 후에만 체크
const StepBadge = ({ done }) => (
  <span className={`step-badge${done ? ' is-done' : ''}`} aria-hidden="true">
    {done ? <IconCheck className="w-3.5 h-3.5" /> : null}
  </span>
);

const AnimatedRefreshButton = ({ onClick, isFetching }) => (
  <button
    onClick={onClick}
    disabled={isFetching}
    className="w-[76px] sm:w-[88px] h-[52px] sm:h-[58px] md:h-[62px] shrink-0 bg-white border border-gray-200 hover:border-blue-300 hover:bg-blue-50/60 text-gray-600 hover:text-blue-600 font-semibold rounded-2xl shadow-sm flex flex-col items-center justify-center gap-0.5 transition-all disabled:opacity-50 active:scale-95 px-1 touch-manipulation"
    title="선생님 목록 새로고침"
  >
    <RefreshCw className={`w-[18px] h-[18px] sm:w-5 sm:h-5 ${isFetching ? 'animate-spin' : ''}`} />
    <span className="text-[13px] sm:text-[15px] tracking-tight whitespace-nowrap">새로고침</span>
  </button>
);

export default function MainApp({
  onNavigateToClassroom,
  onNavigateToDailySchedule,
  onNavigateToStudentSearch,
  onNavigateToMyWeeklySchedule,
  onNavigateToTeamSchedule,
  onNavigateToTeacherManagement,
  onNavigateToAutoSchedule,
  onNavigateToHolidayManagement,
  onNavigateToNangmanStudio,
  onNavigateToNoticeManagement,
  onNavigateToStudentFormsAdmin,
  onNavigateToClassApplicants,
  onNavigateToNameCard
}) {
  const [selectedTeam, setSelectedTeam] = useState(() => getSavedItem('sungdong_team', ""));
  const [currentUser, setCurrentUser] = useState(() => getSavedItem('sungdong_teacher', ""));
  const [date, setDate] = useState(() => getInitialWeekday());
  const [isLoggedIn, setIsLoggedIn] = useState(() => getSessionItem('sungdong_is_logged_in', "") === 'true');
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [teachers, setTeachers] = useState([]);
  const [allScheduleData, setAllScheduleData] = useState({});
  const [isFetchingTeachers, setIsFetchingTeachers] = useState(false);
  const [isFetchingSchedule, setIsFetchingSchedule] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isLoggedInRef = useRef(isLoggedIn);
  useEffect(() => { isLoggedInRef.current = isLoggedIn; }, [isLoggedIn]);
  const isSubmittingRef = useRef(isSubmitting);
  useEffect(() => { isSubmittingRef.current = isSubmitting; }, [isSubmitting]);
  const hasChangesRef = useRef(false);
  const isDataLoading = isFetchingSchedule || isSyncing || isSubmitting;
  const [specialAlerts, setSpecialAlerts] = useState([]);
  const [studentCounts, setStudentCounts] = useState({});
  const [records, setRecords] = useState([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [showSavePopup, setShowSavePopup] = useState(false);
  const [showValidationError, setShowValidationError] = useState(false);
  const [validationErrorMsg, setValidationErrorMsg] = useState("");
  const [validationErrorIndex, setValidationErrorIndex] = useState(null);
  const [validationErrorType, setValidationErrorType] = useState(""); // 에러 유형 (attendance, headcount 등)
  const [showDetailedSchedule, setShowDetailedSchedule] = useState(false);


  const [saveProgress, setSaveProgress] = useState([]);
  const [isSaveComplete, setIsSaveComplete] = useState(false);

  const [showRepeatConfirm, setShowRepeatConfirm] = useState(false);
  const [showAssistantConflictModal, setShowAssistantConflictModal] = useState(false);
  const [assistantConflictData, setAssistantConflictData] = useState(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const showLogoutConfirmRef = useRef(false);
  useEffect(() => { showLogoutConfirmRef.current = showLogoutConfirm; }, [showLogoutConfirm]);
  const [repeatTargetDates, setRepeatTargetDates] = useState([]);
  const [repeatMode, setRepeatMode] = useState('all');
  const [repeatShiftIndex, setRepeatShiftIndex] = useState(null);
  const [undoLogs, setUndoLogs] = useState({});
  const [clearConfirmIndex, setClearConfirmIndex] = useState(null);


  const handleAssistantConflictProceed = () => {
    setShowAssistantConflictModal(false);
    if (!assistantConflictData) return;

    if (assistantConflictData.mode === 'all') {
      setRepeatMode('all');
      setRepeatTargetDates(assistantConflictData.validTargetDates);
      setShowRepeatConfirm(true);
    } else {
      setRepeatMode('shift');
      setRepeatShiftIndex(assistantConflictData.index);
      setRepeatTargetDates(assistantConflictData.validTargetDates);
      setShowRepeatConfirm(true);
    }
  };

  const [selectedStudentDates, setSelectedStudentDates] = useState(null);
  const [selectedStudentHistory, setSelectedStudentHistory] = useState(null);
  const [studentHistoryLogs, setStudentHistoryLogs] = useState([]);
  const [isFetchingHistory, setIsFetchingHistory] = useState(false);
  const [roomStatusPopup, setRoomStatusPopup] = useState(null);
  const roomPopupDismissedRef = useRef(null);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [bgGrayLevel, setBgGrayLevel] = useState(() => getBgGrayLevel());
  const [roomPopupMode, setRoomPopupMode] = useState(() => getRoomPopupMode());
  const [fontScale, setFontScale] = useState(() => getFontScale());
  const [focusedMemoIndex, setFocusedMemoIndex] = useState(null);
  const [photoModalTarget, setPhotoModalTarget] = useState(null);
  const [studentPhotoCounts, setStudentPhotoCounts] = useState({});
  const [studentPhotoDateCounts, setStudentPhotoDateCounts] = useState({});

  useEffect(() => {
    if (!isLoggedIn) return;
    let isMounted = true;
    fetchPhotoSummaryByStudent()
      .then(({ counts, dateCounts }) => {
        if (isMounted) {
          setStudentPhotoCounts(counts);
          setStudentPhotoDateCounts(dateCounts);
        }
      })
      .catch(() => { });
    return () => { isMounted = false; };
  }, [isLoggedIn, refreshTrigger]);
  const studentLongPressTimerRef = useRef(null);
  const studentLongPressOriginRef = useRef(null);

  const cancelStudentLongPress = () => {
    if (studentLongPressTimerRef.current) {
      clearTimeout(studentLongPressTimerRef.current);
      studentLongPressTimerRef.current = null;
    }
    studentLongPressOriginRef.current = null;
  };

  const startStudentLongPress = (e, index) => {
    const studentName = (logs[index]?.student || '').trim();
    if (!studentName || isDataLoading) return;
    cancelStudentLongPress();
    const targetEl = e.currentTarget;
    const touch = e.touches?.[0];
    studentLongPressOriginRef.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
    studentLongPressTimerRef.current = setTimeout(() => {
      studentLongPressTimerRef.current = null;
      try {
        targetEl?.blur?.();
        window.getSelection?.()?.removeAllRanges?.();
      } catch (_) { }
      setPhotoModalTarget({
        studentName,
        date,
        shift: shifts[index] || '',
        teacher: currentUser || '',
        location: (logs[index]?.location || '').trim()
      });
    }, 550);
  };

  const handleStudentLongPressMove = (e) => {
    if (!studentLongPressOriginRef.current || !e.touches?.[0]) return;
    const dx = Math.abs(e.touches[0].clientX - studentLongPressOriginRef.current.x);
    const dy = Math.abs(e.touches[0].clientY - studentLongPressOriginRef.current.y);
    if (dx > 10 || dy > 10) {
      cancelStudentLongPress();
    }
  };
  const [isEditingProfile, setIsEditingProfile] = useState(() => !(getSavedItem('sungdong_team', '') && getSavedItem('sungdong_teacher', '')));
  const [todaySummary, setTodaySummary] = useState(null);
  const [hasAdminPassword, setHasAdminPassword] = useState(() => hasValidSavedAdminPassword());
  const [adminPwdInput, setAdminPwdInput] = useState('');
  const [adminPwdError, setAdminPwdError] = useState('');
  const [adminPwdNotice, setAdminPwdNotice] = useState('');

  const openSettingsModal = () => {
    setAdminPwdInput('');
    setAdminPwdError('');
    setAdminPwdNotice('');
    setHasAdminPassword(hasValidSavedAdminPassword());
    setShowSettingsModal(true);
  };

  const closeSettingsModal = () => {
    setAdminPwdInput('');
    setAdminPwdError('');
    setAdminPwdNotice('');
    setShowSettingsModal(false);
  };

  const handleSaveAdminPassword = () => {
    if (!adminPwdInput) {
      setAdminPwdError('관리자 비밀번호를 입력해주세요.');
      setAdminPwdNotice('');
      return;
    }
    const res = saveAdminPassword(adminPwdInput);
    if (res.ok && res.saved) {
      setHasAdminPassword(true);
      setAdminPwdInput('');
      setAdminPwdError('');
      setAdminPwdNotice('관리자 비밀번호가 저장되었습니다. 이제 관리자 메뉴를 사용할 수 있습니다.');
    } else {
      setAdminPwdError(res.error || '관리자 비밀번호가 일치하지 않습니다.');
      setAdminPwdNotice('');
    }
  };

  const handleClearAdminPassword = () => {
    clearSavedAdminPassword();
    setHasAdminPassword(false);
    setAdminPwdInput('');
    setAdminPwdError('');
    setAdminPwdNotice('저장된 관리자 비밀번호가 삭제되었습니다.');
  };

  const handleChangeBgGrayLevel = (level) => {
    const saved = saveBgGrayLevel(level);
    setBgGrayLevel(saved);
  };

  const handleChangeRoomPopupMode = (mode) => {
    const saved = saveRoomPopupMode(mode);
    setRoomPopupMode(saved);
    if (saved === 'always') {
      try {
        window.__sungdong_initial_room_popup_shown = false;
        window.sessionStorage.removeItem('sungdong_room_popup_session_done');
        const todayStr = getLocalDateString(new Date());
        removeSavedItem(`sungdong_room_popup_hide_today_${todayStr}`);
      } catch (_) { }
      roomPopupDismissedRef.current = null;
    } else {
      try {
        window.__sungdong_initial_room_popup_shown = true;
        window.sessionStorage.setItem('sungdong_room_popup_session_done', 'true');
      } catch (_) { }
    }
  };

  // 당일이 지난 오래된 팝업 숨김 키 정리 (오늘 저장된 키는 보존)
  useEffect(() => {
    try {
      const todayStr = getLocalDateString(new Date());
      const currentTodayKey = `sungdong_room_popup_hide_today_${todayStr}`;
      Object.keys(window.localStorage).forEach(k => {
        if (k.startsWith('sungdong_room_popup_hide_') && k !== currentTodayKey) {
          window.localStorage.removeItem(k);
        }
      });
    } catch (_) { }
  }, []);

  const closeRoomStatusPopup = (hideToday = false) => {
    try {
      if (getRoomPopupMode() !== 'always') {
        window.__sungdong_initial_room_popup_shown = true;
        window.sessionStorage.setItem('sungdong_room_popup_session_done', 'true');
      }
      if (hideToday === true) {
        const todayStr = (roomStatusPopup && roomStatusPopup.dateStr) || getLocalDateString(new Date());
        setSavedItem(`sungdong_room_popup_hide_today_${todayStr}`, 'true');
      }
    } catch (_) { }
    roomPopupDismissedRef.current = `${selectedTeam}_${currentUser || ''}`;
    setRoomStatusPopup(null);
  };

  useEffect(() => {
    if (!selectedStudentHistory || !selectedStudentHistory.name) {
      setStudentHistoryLogs([]);
      return;
    }

    let isMounted = true;
    const fetchHistory = async () => {
      setIsFetchingHistory(true);
      try {
        const studentName = selectedStudentHistory.name;
        let allRecords = [];
        let start = 0;
        const limit = 1000;
        let hasMore = true;

        while (hasMore) {
          const { data: chunk, error: chunkErr } = await supabaseClient
            .from('daily_logs')
            .select('log_date, student, status, attendance, teacher, shift, team')
            .ilike('student', `%${studentName}%`)
            .range(start, start + limit - 1)
            .order('log_date', { ascending: false });

          if (chunkErr) throw chunkErr;

          if (chunk && chunk.length > 0) {
            allRecords = allRecords.concat(chunk);
            if (chunk.length < limit) hasMore = false;
            else start += limit;
          } else {
            hasMore = false;
          }
        }

        if (!isMounted) return;

        // 정확한 학생 이름 필터링 (쉼표나 슬래시 분할 및 괄호 제거 고려)
        const matchedLogs = allRecords.filter(row => {
          if (!row.student) return false;
          const parsedNames = row.student.split(/[/,]/).map(s => s.trim().split('(')[0].trim()).filter(Boolean);
          return parsedNames.includes(studentName);
        }).map(row => ({
          ...row,
          status: mergeAttendanceAndStatus(row.attendance, row.status)
        }));

        setStudentHistoryLogs(matchedLogs);
      } catch (err) {
        console.error("이전 교육 기록 패치 실패:", err);
      } finally {
        if (isMounted) setIsFetchingHistory(false);
      }
    };

    fetchHistory();
    return () => {
      isMounted = false;
    };
  }, [selectedStudentHistory]);

  const [shifts, setShifts] = useState(["9:30~10:30", "10:30~11:30", "11:30~12:30"]);

  // 신청서, 사전설문지, 사후설문지 작성 완료 여부 추적 상태
  const [submittedForms, setSubmittedForms] = useState({
    apps: new Set(),
    preSurveys: new Set(),
    postSurveys: new Set()
  });

  const checkFormSubmitted = useCallback((set, name) => {
    if (!name || !set || set.size === 0) return false;
    const clean = String(name).trim();
    if (!clean) return false;
    if (set.has(clean)) return true;
    const baseName = clean.split('(')[0].trim();
    if (baseName && set.has(baseName)) return true;
    return false;
  }, []);

  const fetchFormSubmissionStatus = useCallback(async () => {
    try {
      const appSet = new Set();
      const preSet = new Set();
      const postSet = new Set();

      const addNameToSet = (set, rawName) => {
        if (!rawName) return;
        const clean = String(rawName).trim();
        if (clean) {
          set.add(clean);
          const base = clean.split('(')[0].trim();
          if (base) set.add(base);
        }
      };

      // 1. LocalStorage 백업 데이터 확인
      try {
        const localApps = JSON.parse(localStorage.getItem('application_forms_backup') || '[]');
        localApps.forEach(item => {
          addNameToSet(appSet, item.applicant_name || item.applicantName || item.name);
        });

        const localPres = JSON.parse(localStorage.getItem('digital_surveys_backup') || '[]');
        localPres.forEach(item => {
          addNameToSet(preSet, item.participant_name || item.participantName);
        });

        const localPosts = JSON.parse(localStorage.getItem('digital_surveys_post_backup') || '[]');
        localPosts.forEach(item => {
          addNameToSet(postSet, item.participant_name || item.participantName);
        });
      } catch (e) {
        console.warn('LocalStorage form status parse error:', e);
      }

      // 2. Supabase DB 조회
      if (supabaseClient) {
        try {
          const [appRes, preRes, postRes] = await Promise.allSettled([
            supabaseClient.from('application_forms').select('applicant_name'),
            supabaseClient.from('pre_surveys').select('participant_name'),
            supabaseClient.from('post_surveys').select('participant_name')
          ]);

          if (appRes.status === 'fulfilled' && appRes.value?.data) {
            appRes.value.data.forEach(r => addNameToSet(appSet, r.applicant_name));
          }
          if (preRes.status === 'fulfilled' && preRes.value?.data) {
            preRes.value.data.forEach(r => addNameToSet(preSet, r.participant_name));
          }
          if (postRes.status === 'fulfilled' && postRes.value?.data) {
            postRes.value.data.forEach(r => addNameToSet(postSet, r.participant_name));
          }
        } catch (err) {
          console.warn('Supabase form status fetch error:', err);
        }
      }

      setSubmittedForms({
        apps: appSet,
        preSurveys: preSet,
        postSurveys: postSet
      });
    } catch (err) {
      console.error('Error fetching form submission status:', err);
    }
  }, []);

  useEffect(() => {
    fetchFormSubmissionStatus();

    const handleFocus = () => {
      fetchFormSubmissionStatus();
    };
    const handleStorage = (e) => {
      if (!e.key || e.key.includes('form') || e.key.includes('survey')) {
        fetchFormSubmissionStatus();
      }
    };

    let channel = null;
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        channel = new BroadcastChannel('form_status_channel');
        channel.onmessage = (msg) => {
          if (msg?.data?.name) {
            setSubmittedForms(prev => {
              const next = {
                apps: new Set(prev.apps),
                preSurveys: new Set(prev.preSurveys),
                postSurveys: new Set(prev.postSurveys)
              };
              const target = msg.data.surveyType === 'app'
                ? next.apps
                : (msg.data.surveyType === 'post' ? next.postSurveys : next.preSurveys);
              const clean = String(msg.data.name).trim();
              if (clean) {
                target.add(clean);
                const base = clean.split('(')[0].trim();
                if (base) target.add(base);
              }
              return next;
            });
          }
          fetchFormSubmissionStatus();
        };
      }
    } catch (e) { }

    window.addEventListener('focus', handleFocus);
    window.addEventListener('storage', handleStorage);

    const pollInterval = setInterval(() => {
      fetchFormSubmissionStatus();
    }, 10000);

    return () => {
      if (channel) channel.close();
      clearInterval(pollInterval);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('storage', handleStorage);
    };
  }, [date, refreshTrigger, fetchFormSubmissionStatus]);

  const [weatherData, setWeatherData] = useState(null);

  // 서버의 최신 버전을 저장할 상태 (초기 접속 시 기록)
  const [appVersion, setAppVersion] = useState(null);

  // [버전 체크 및 자동 새로고침 로직]
  // 브라우저 탭을 다시 열거나, 처음 앱에 들어왔을 때 서버의 /version.json 을 확인하여
  // 현재 버전과 다르면 강제로 새로고침(최신화)을 수행합니다.
  useEffect(() => {
    const checkVersion = async () => {
      try {
        // 캐시를 피하기 위해 타임스탬프 쿼리 파라미터를 붙여 항상 최신 상태를 요청합니다.
        const res = await fetch(`/version.json?t=${new Date().getTime()}`);
        if (res.ok) {
          const contentType = res.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            const data = await res.json();
            if (data && data.version) {
              const serverVersion = Number(data.version);
              const clientVersion = Number(import.meta.env.VITE_APP_VERSION);

              // 현재 실행 중인 프로그램 버전이 배포된 버전보다 낮으면 새로고침
              if (clientVersion && serverVersion > clientVersion) {
                console.log('새로운 업데이트가 감지되어 새로고침합니다.', { clientVersion, serverVersion });
                window.location.reload(true);
                return;
              }

              setAppVersion((prevVersion) => {
                // 처음 접속해서 버전이 없을 때는 기억만 해둡니다.
                if (!prevVersion) {
                  return data.version;
                }
                // 이미 기억하는 버전이 있는데, 서버 버전과 다르면 새로운 버전이 배포된 것입니다.
                if (prevVersion !== data.version) {
                  console.log('새로운 업데이트가 감지되어 새로고침합니다.');
                  window.location.reload(true);
                  return prevVersion;
                }
                return data.version;
              });
            }
          }
        }
      } catch (e) {
        // 오프라인이거나 에러 발생 시엔 무시합니다.
        console.warn('버전 체크 실패:', e);
      }
    };

    // 앱 처음 켤 때 1번 확인
    checkVersion();

    // 사용자가 다른 앱(또는 다른 브라우저 탭)을 보다가 현재 화면으로 다시 돌아올 때마다 확인
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkVersion();
      }
    };

    window.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    const fetchWeather = async () => {
      try {
        const now = new Date();
        const targetDate = new Date(now);
        const targetDateStr = `${targetDate.getFullYear()}${String(targetDate.getMonth() + 1).padStart(2, '0')}${String(targetDate.getDate()).padStart(2, '0')}`;

        // 캐시 확인 (하루 한 번만 호출, 단 시간대별 예보를 저장하여 현재 시간에 맞게 렌더링)
        const cachedData = getSavedItem('sungdong_weather_v3', null);
        if (cachedData) {
          try {
            const parsed = JSON.parse(cachedData);
            if (parsed.date === targetDateStr && parsed.data && !parsed.data.error) {
              const currentHour = now.getHours();
              let weatherDesc = parsed.data.hourlyDesc ? parsed.data.hourlyDesc[currentHour] : parsed.data.weatherDesc;
              if (!weatherDesc && parsed.data.hourlyDesc) {
                const availableHours = Object.keys(parsed.data.hourlyDesc).map(Number).sort((a, b) => a - b);
                const futureHours = availableHours.filter(h => h >= currentHour);
                if (futureHours.length > 0) weatherDesc = parsed.data.hourlyDesc[futureHours[0]];
                else if (availableHours.length > 0) weatherDesc = parsed.data.hourlyDesc[availableHours[availableHours.length - 1]];
              }

              if (weatherDesc && parsed.data.hourlyDesc) {
                setWeatherData({ ...parsed.data, weatherDesc });
                return;
              }
            }
          } catch (e) { }
        }

        const apiKey = '1dcc5e3c0b79c084c3a779e391b69d90bf46c75579a6889130b84185a14c844a';

        // 날짜/시간 계산 (기상청 단기예보 Base Time: 0200, 0500, 0800...)
        let baseDate = new Date(now);
        // 새벽 2시 10분 이전이면 어제 23시 데이터를 사용
        if (now.getHours() < 2 || (now.getHours() === 2 && now.getMinutes() < 10)) {
          baseDate.setDate(baseDate.getDate() - 1);
        }

        const year = baseDate.getFullYear();
        const month = String(baseDate.getMonth() + 1).padStart(2, '0');
        const day = String(baseDate.getDate()).padStart(2, '0');
        const formattedDate = `${year}${month}${day}`;

        let baseTime = '0200'; // 오늘의 최고/최저 기온(TMX, TMN)이 모두 포함된 02:00 발표 기준
        if (now.getHours() < 2 || (now.getHours() === 2 && now.getMinutes() < 10)) {
          baseTime = '2300';
        }

        // 기상청 API는 CORS를 허용하므로 프록시를 거치지 않고 직접 호출하여 Vite Proxy 통신 행(hang) 이슈 방지
        const url = `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst?serviceKey=${apiKey}&pageNo=1&numOfRows=1000&dataType=JSON&base_date=${formattedDate}&base_time=${baseTime}&nx=60&ny=127`;

        let res;
        let text;
        let fetchSuccess = false;

        // 공공데이터포털 서버 불안정(ERR_CONNECTION_RESET 등) 대응을 위한 3회 재시도 로직
        for (let i = 0; i < 3; i++) {
          try {
            res = await fetch(url);
            text = await res.text();
            fetchSuccess = true;
            break;
          } catch (err) {
            if (i === 2) throw err;
            await new Promise(resolve => setTimeout(resolve, 1000)); // 1초 대기 후 재시도
          }
        }

        if (!fetchSuccess) throw new Error("Failed to fetch after retries");

        if (res && res.status === 429) {
          setWeatherData({ error: true, msg: '일일 트래픽 초과' });
          return;
        }

        if (text.includes("Unauthorized")) {
          setWeatherData({ error: true, msg: 'API 키 미승인(동기화 1~2시간 소요)' });
          return;
        }

        let data;
        try {
          data = JSON.parse(text);
        } catch (e) {
          console.error("JSON 파싱 에러 (응답 원본):", text);
          // XML 에러 메시지가 온 경우 추출 (예: <returnReasonCode>22</returnReasonCode> 또는 <errMsg>SERVICE ERROR</errMsg>)
          let extractedError = '응답 형식 오류';
          const errMsgMatch = text.match(/<errMsg>(.*?)<\/errMsg>/);
          const reasonMatch = text.match(/<returnAuthMsg>(.*?)<\/returnAuthMsg>/);

          if (reasonMatch) {
            extractedError = reasonMatch[1]; // 예: HTTP_ERROR, SERVICE_KEY_IS_NOT_REGISTERED_ERROR
          } else if (errMsgMatch) {
            extractedError = errMsgMatch[1];
          } else if (text.includes('API rate limit exceeded')) {
            extractedError = '일일 트래픽 초과';
          }

          if (extractedError.includes('SERVICE_KEY_IS_NOT_REGISTERED_ERROR')) {
            extractedError = 'API 키 미등록(동기화 중)';
          }

          setWeatherData({ error: true, msg: extractedError });
          return;
        }

        if (data.response && data.response.header.resultCode === '00' && data.response.body.items) {
          const items = data.response.body.items.item;

          // 오늘 날짜 문자열 (상단에서 이미 정의함)

          let maxTemp = null;
          let minTemp = null;
          const hourlyWeather = {};

          items.forEach(item => {
            // 오늘 날짜의 데이터만 추출
            if (item.fcstDate === targetDateStr) {
              if (item.category === 'TMX') maxTemp = parseFloat(item.fcstValue);
              if (item.category === 'TMN') minTemp = parseFloat(item.fcstValue);

              const hour = parseInt(item.fcstTime.substring(0, 2), 10);
              if (!hourlyWeather[hour]) hourlyWeather[hour] = { sky: null, pty: null, pop: null };

              if (item.category === 'SKY') hourlyWeather[hour].sky = item.fcstValue;
              if (item.category === 'PTY') hourlyWeather[hour].pty = item.fcstValue;
              if (item.category === 'POP') hourlyWeather[hour].pop = item.fcstValue;
            }
          });

          const hourlyDesc = {};
          let amPop = 0;
          let pmPop = 0;

          Object.keys(hourlyWeather).forEach(h => {
            const { sky, pty, pop } = hourlyWeather[h];

            const hourNum = Number(h);
            const popNum = Number(pop || 0);
            if (hourNum < 12) amPop = Math.max(amPop, popNum);
            else pmPop = Math.max(pmPop, popNum);

            if (sky === null || pty === null) return;
            let desc = '날씨 정보';
            if (pty === '0') {
              if (sky === '1') desc = '☀️ 맑음';
              else if (sky === '3') desc = '⛅ 구름많음';
              else if (sky === '4') desc = '☁️ 흐림';
            } else {
              if (pty === '1' || pty === '4') desc = '☔ 비';
              else if (pty === '2') desc = '🌨️ 비/눈';
              else if (pty === '3') desc = '❄️ 눈';
            }
            hourlyDesc[h] = desc;
          });

          if (maxTemp !== null && minTemp !== null) {
            const currentHour = now.getHours();
            let weatherDesc = hourlyDesc[currentHour];
            if (!weatherDesc) {
              const availableHours = Object.keys(hourlyDesc).map(Number).sort((a, b) => a - b);
              const futureHours = availableHours.filter(h => h >= currentHour);
              if (futureHours.length > 0) weatherDesc = hourlyDesc[futureHours[0]];
              else if (availableHours.length > 0) weatherDesc = hourlyDesc[availableHours[availableHours.length - 1]];
              else weatherDesc = '정보 없음';
            }

            const isRain = weatherDesc.includes('비') || weatherDesc.includes('눈');

            const resultData = { minTemp, maxTemp, hourlyDesc, amPop, pmPop, isRain, isTomorrow: false };
            setWeatherData({ ...resultData, weatherDesc });
            safeJsonSetItem('sungdong_weather_v3', { date: targetDateStr, data: resultData });
          } else {
            setWeatherData({ error: true, msg: '데이터 없음' });
          }
        } else {
          console.error("기상청 API 응답 오류:", data.response?.header?.resultMsg || data);
          setWeatherData({ error: true, msg: '데이터 호출 오류' });
        }
      } catch (e) {
        console.error("날씨 정보 가져오기 실패:", e);
        let errMsg = e.message || '연결 실패';
        if (errMsg === 'Failed to fetch' || errMsg.includes('NetworkError') || errMsg.includes('fetch')) {
          errMsg = '기상청 서버 응답 지연/점검 중';
        }
        setWeatherData({ error: true, msg: errMsg });
      }
    };
    fetchWeather();
  }, []);

  const [todayNotices, setTodayNotices] = useState(() => {
    try {
      const cached = getSavedItem('sungdong_today_notices', null);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) { }
    return [];
  });

  useEffect(() => {
    const fetchTodayNotices = async () => {
      try {
        const { data, error } = await supabaseClient
          .from('notices')
          .select('id, title, is_top, start_date, end_date');

        if (!error && data) {
          const today = new Date();
          today.setHours(0, 0, 0, 0);

          const validNotices = (data || []).filter(notice => {
            if (!notice.end_date) return true;
            const endDate = new Date(notice.end_date);
            endDate.setHours(0, 0, 0, 0);
            return endDate >= today;
          });

          const sorted = validNotices.sort((a, b) => {
            const isTopA = a.is_top || false;
            const isTopB = b.is_top || false;
            if (isTopA !== isTopB) {
              return isTopB ? 1 : -1;
            }
            const dateA = a.start_date ? new Date(a.start_date) : new Date('1970-01-01');
            const dateB = b.start_date ? new Date(b.start_date) : new Date('1970-01-01');
            dateA.setHours(0, 0, 0, 0);
            dateB.setHours(0, 0, 0, 0);

            const diffA = Math.abs(dateA - today);
            const diffB = Math.abs(dateB - today);

            if (diffA === diffB) {
              return dateB - dateA;
            }
            return diffA - diffB;
          });
          setTodayNotices(sorted);
          safeJsonSetItem('sungdong_today_notices', sorted);
        } else {
          setTodayNotices([]);
        }
      } catch (e) {
        setTodayNotices([]);
      }
    };

    if (date) {
      fetchTodayNotices();
    }

    let lastRefreshedHour = new Date().getMinutes() === 0 ? new Date().getHours() : -1;

    const intervalId = setInterval(() => {
      const now = new Date();
      const h = now.getHours();
      const m = now.getMinutes();
      const targets = [9, 10, 11, 12, 13, 14, 15, 16];

      if (targets.includes(h) && m === 0 && lastRefreshedHour !== h) {
        lastRefreshedHour = h;
        if (date) fetchTodayNotices();
      }
    }, 20000);

    return () => clearInterval(intervalId);
  }, [date]);



  const [dbTeachers, setDbTeachers] = useState(() => {
    try {
      const stored = getSavedItem('sungdong_teacher_list', null);
      if (!stored) return [];
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) { return []; }
  });

  const [holidaysDbList, setHolidaysDbList] = useState(() => {
    try {
      const cached = getSavedItem('sungdong_holidays', null);
      if (!cached) return [];
      const parsed = JSON.parse(cached);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  });

  // holidays 전체 정보(이름/내용 포함)를 저장하는 상태
  const [holidaysFullList, setHolidaysFullList] = useState([]);

  useEffect(() => {
    // 오늘 다시 보지 않기를 누른 경우 오늘 하루 동안 어떤 경우에도 다시 표시하지 않음
    try {
      const todayStr = getLocalDateString(new Date());
      if (getSavedItem(`sungdong_room_popup_hide_today_${todayStr}`, '') === 'true') {
        setRoomStatusPopup(null);
        return;
      }
    } catch (_) { }

    // 다른 작업을 하다가 메인화면으로 돌아온 경우 또는 이미 팝업을 표시한 경우 다시 띄우지 않음 ('항시 표시' 모드 제외)
    if (roomPopupMode !== 'always') {
      try {
        if (window.__sungdong_initial_room_popup_shown) {
          setRoomStatusPopup(null);
          return;
        }
        if (window.sessionStorage.getItem('sungdong_room_popup_session_done') === 'true') {
          setRoomStatusPopup(null);
          return;
        }
      } catch (_) { }
    }

    if (isLoggedIn || !selectedTeam) {
      setRoomStatusPopup(null);
      return;
    }

    // 취업팀은 선생님 이름까지 선택해야 팝업 표시
    if (selectedTeam === '취업팀' && !currentUser) {
      setRoomStatusPopup(null);
      return;
    }

    if (showSettingsModal) {
      return;
    }

    const teamUserKey = `${selectedTeam}_${currentUser || ''}`;
    if (roomPopupDismissedRef.current === teamUserKey) {
      return;
    }

    const now = new Date();
    let showClassroom = true;
    let showNangman = true;
    let teamKey = selectedTeam;
    let teamLabel = selectedTeam;
    let scheduleType = 'morning';

    if (selectedTeam === '1팀' || selectedTeam === '2팀') {
      showClassroom = true;
      showNangman = true;
      teamKey = selectedTeam;
      teamLabel = `${selectedTeam} (오전)`;
      scheduleType = 'morning';
    } else if (selectedTeam === '3팀') {
      showClassroom = true;
      showNangman = false;
      teamKey = '3팀';
      teamLabel = '3팀 (오후)';
      scheduleType = 'afternoon';
    } else if (selectedTeam === '취업팀') {
      const group = (currentUser ? getTeacherGroup('취업팀', currentUser, dbTeachers) : '') || '';
      if (group.includes('오후')) {
        showClassroom = true;
        showNangman = false;
        teamKey = '취업팀-오후';
        teamLabel = '취업팀 오후조';
        scheduleType = 'afternoon';
      } else {
        showClassroom = true;
        showNangman = true;
        teamKey = '취업팀-오전';
        teamLabel = '취업팀 오전조';
        scheduleType = 'morning';
      }
    }

    const todayStr = getLocalDateString(now);
    let isMounted = true;
    const loadRoomStatus = async () => {
      try {
        const roomAppId = typeof window.__app_id !== 'undefined' ? window.__app_id : 'default-app-id';
        const mmdd = todayStr.substring(5);
        const holidayInfo = holidaysFullList.find(h => h && h.date && (h.date === todayStr || h.date === mmdd || h.date.endsWith(mmdd)));

        const isMorning = scheduleType === 'morning';

        const classroomSlotsList = isMorning
          ? ["09:30 - 10:30", "10:30 - 11:30", "11:30 - 12:30"]
          : ["13:00 - 14:00", "14:00 - 15:00", "15:00 - 16:00"];

        const nangmanSlotsList = ["1팀", "2팀"];

        const [classroomRes, nangmanRes] = await Promise.all([
          showClassroom
            ? supabaseClient.from('classroom_schedules').select('data, memo').eq('id', roomAppId).maybeSingle()
            : Promise.resolve({ data: null }),
          showNangman
            ? supabaseClient.from('nangman_schedules').select('data, memo').eq('id', roomAppId).maybeSingle()
            : Promise.resolve({ data: null })
        ]);

        if (!isMounted) return;

        const cData = classroomRes?.data?.data || {};
        const cMemo = classroomRes?.data?.memo || '';
        const classroomSlots = classroomSlotsList.map(slot => {
          const key = `${todayStr}_${slot.replace(/\s+/g, '').replace(/~/g, '-').replace(/:/g, '')}`;
          const val = cData[key];
          const isAvailable = val === '사용가능';
          return {
            slot: slot.replace(' - ', '~'),
            isAvailable,
            label: isAvailable ? '사용 가능' : '사용 불가'
          };
        });

        const nData = nangmanRes?.data?.data || {};
        const nMemo = nangmanRes?.data?.memo || '';
        const nangmanSlots = nangmanSlotsList.map(slot => {
          const key = `${todayStr}_${slot}`;
          const state = nData[key];
          let label = '사용 불가';
          let tone = 'rose';
          if (state === true) {
            label = '사용 가능';
            tone = 'emerald';
          } else if (state === 'nangman') {
            label = '낭만스튜디오';
            tone = 'indigo';
          } else if (state === 'pending') {
            label = '미정';
            tone = 'slate';
          } else if (typeof state === 'string' && state.trim() === '') {
            label = '미입력';
            tone = 'slate';
          } else if (typeof state === 'string' && !state.startsWith('disabled:') && state !== 'disabled') {
            label = state.replace(/\\n/g, ' ');
            tone = 'emerald';
          }
          return { slot, label, tone };
        });

        setRoomStatusPopup({
          dateStr: todayStr,
          dateLabel: now.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' }),
          teamKey,
          teamLabel,
          showClassroom,
          showNangman,
          isMorning,
          classroomSlots,
          classroomMemo: cMemo,
          nangmanSlots,
          nangmanMemo: nMemo,
          holidayName: holidayInfo ? (holidayInfo.name || '휴무일') : ''
        });
        if (roomPopupMode !== 'always') {
          try {
            window.__sungdong_initial_room_popup_shown = true;
            window.sessionStorage.setItem('sungdong_room_popup_session_done', 'true');
          } catch (_) { }
        }
      } catch (err) {
        console.error('교육실 사용현황 로드 실패:', err);
      }
    };

    loadRoomStatus();
    return () => { isMounted = false; };
  }, [isLoggedIn, selectedTeam, currentUser, dbTeachers, holidaysFullList, roomPopupMode, showSettingsModal]);

  // 메인 화면: 선택된 선생님의 오늘 수업 요약 및 미입력 건수 로드
  useEffect(() => {
    if (isLoggedIn || !selectedTeam || !currentUser) {
      setTodaySummary(null);
      return;
    }
    let isMounted = true;
    const loadTodaySummary = async () => {
      try {
        const todayStr = getLocalDateString(new Date());
        const { data, error } = await supabaseClient
          .from('daily_logs')
          .select('shift, student, location, attendance, status')
          .eq('team', selectedTeam)
          .eq('teacher', currentUser)
          .eq('log_date', todayStr);
        if (!isMounted || error || !Array.isArray(data)) return;
        const activeItems = data
          .filter(r => {
            const st = (r.student || '').trim();
            const loc = (r.location || '').trim();
            return st && st !== '-' && !st.includes('자체학습') && !st.includes('대상자발굴') && !st.includes('공휴일') && !loc.includes('공휴일') && !loc.includes('휴무일');
          })
          .map(r => {
            const merged = mergeAttendanceAndStatus(r.attendance, formatStatusIfDate(r.status)).replace(/\u200B/g, '').trim();
            return {
              shift: r.shift || '',
              student: (r.student || '').trim(),
              isPending: merged === ''
            };
          })
          .sort((a, b) => {
            const toMin = (s) => {
              const m = (s || '').match(/(\d+):(\d+)/);
              return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : 9999;
            };
            return toMin(a.shift) - toMin(b.shift);
          });
        setTodaySummary({
          total: activeItems.length,
          pending: activeItems.filter(x => x.isPending).length,
          items: activeItems
        });
      } catch (_) { }
    };
    loadTodaySummary();
    return () => { isMounted = false; };
  }, [isLoggedIn, selectedTeam, currentUser]);

  useEffect(() => {
    const loadHolidays = async () => {
      try {
        // date와 함께 name, content1 도 함께 가져옴 (specialAlerts 표시를 위해)
        const { data, error } = await supabaseClient.from('holidays').select('date, name, content1, content2, vacation_available');
        if (data && !error) {
          const dates = data.map(d => d.date);
          setHolidaysDbList(dates);
          setHolidaysFullList(data); // 전체 정보 보관
          safeJsonSetItem('sungdong_holidays', dates);
        } else if (error) {
          console.error("holidays fetch error:", error);
        }
      } catch (e) {
        console.error("holidays fetch error", e);
      }
    };
    loadHolidays();
  }, []);

  const isHoliday = useCallback((dateStr) => {
    if (!dateStr || !holidaysDbList || holidaysDbList.length === 0) return false;
    const cleanDate = dateStr.trim();
    const mmdd = cleanDate.length === 10 ? cleanDate.substring(5) : cleanDate;
    return holidaysDbList.some(h => {
      if (!h) return false;
      const cleanH = h.trim();
      return cleanH === cleanDate || cleanH === mmdd;
    });
  }, [holidaysDbList]);

  // ─────────────────────────────────────────────────────────────
  // holidays 테이블에서 현재 날짜(date) 기준 10일 이내 일정을
  // specialAlerts 상태에 반영 (근무기록 입력 화면에 텍스트박스로 표시)
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!date || holidaysFullList.length === 0) {
      setSpecialAlerts([]);
      return;
    }

    // 현재 선택된 날짜를 기준으로 Date 객체 생성 (iOS Safari 호환 수동 파싱)
    const [y, m, d] = date.split('-');
    const todayObj = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));

    const alerts = [];

    holidaysFullList.forEach(h => {
      if (!h.date) return;
      const rawDate = h.date.trim();

      // holidays 테이블의 date 필드: 'YYYY-MM-DD', 'MM-DD', 'M/D' 등 여러 형식 지원
      let holidayObj = null;
      if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
        // YYYY-MM-DD 형식
        const [hy, hm, hd] = rawDate.split('-');
        holidayObj = new Date(parseInt(hy, 10), parseInt(hm, 10) - 1, parseInt(hd, 10));
      } else if (/^\d{1,2}-\d{1,2}$/.test(rawDate)) {
        // MM-DD 형식 → 올해 날짜로 변환
        const [hm, hd] = rawDate.split('-');
        holidayObj = new Date(todayObj.getFullYear(), parseInt(hm, 10) - 1, parseInt(hd, 10));
      } else if (/^\d{1,2}\/\d{1,2}$/.test(rawDate)) {
        // M/D 형식 → 올해 날짜로 변환
        const [hm, hd] = rawDate.split('/');
        holidayObj = new Date(todayObj.getFullYear(), parseInt(hm, 10) - 1, parseInt(hd, 10));
      } else {
        return; // 알 수 없는 형식이면 건너뜀
      }

      // 현재 날짜 기준으로 며칠 뒤인지 계산 (밀리초 → 일수)
      const diffMs = holidayObj.getTime() - todayObj.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      // 0일(오늘) ~ 10일 후 사이의 일정만 표시
      if (diffDays >= 0 && diffDays <= 10) {
        const mm = String(holidayObj.getMonth() + 1);
        const dd = String(holidayObj.getDate());
        const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
        const dayOfWeek = holidayObj.getDay();
        const dayName = dayNames[dayOfWeek];

        const name = h.name || '';
        // name과 content1이 동일하면 content1을 표시하지 않음 (중복 방지)
        const content1 = (h.content1 && h.content1.trim() !== name.trim()) ? ` (${h.content1})` : '';

        const alertMsg = `${mm}/${dd} ${dayName} — ${name}${content1}`;

        alerts.push({ diffDays, msg: alertMsg, dayOfWeek });
      }
    });

    // 날짜 순서대로 정렬
    alerts.sort((a, b) => a.diffDays - b.diffDays);
    // 일정 3일전부터 폰트 색상을 변경하기 위해 msg뿐만 아니라 diffDays도 함께 저장합니다.
    setSpecialAlerts(alerts);
  }, [date, holidaysFullList]);

  useEffect(() => {
    const fetchDbTeachers = async () => {
      try {
        const { data, error } = await supabaseClient.from('teachers').select('*');
        if (!error && data) {
          const formatted = data.map(formatTeacherRow);
          setDbTeachers(formatted);
          setGlobalTeachersList(formatted);
        }
      } catch (e) { }
    };
    fetchDbTeachers();
  }, []);

  useEffect(() => {
    let customShifts = null;
    if (dbTeachers.length > 0 && currentUser) {
      const found = dbTeachers.find(t => t.team === selectedTeam && t.name === currentUser);
      if (found && (found.shift1 || found.shift2 || found.shift3)) {
        customShifts = [found.shift1, found.shift2, found.shift3].filter(Boolean);
      }
    }

    if (customShifts && customShifts.length > 0) {
      setShifts(customShifts);
      return;
    }

    if (!allScheduleData || Object.keys(allScheduleData).length === 0) {
      setShifts(getTeamDefaultShifts(selectedTeam, dbTeachers));
      return;
    }
    const extracted = new Set();
    Object.values(allScheduleData).forEach(day => {
      Object.keys(day).forEach(s => { if (s && s.trim() !== "") extracted.add(s); });
    });
    if (extracted.size > 0) {
      const sorted = Array.from(extracted).sort((a, b) => {
        const getT = (s) => {
          const m = s.match(/(\d+):(\d+)/);
          return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : 0;
        };
        return getT(a) - getT(b);
      });
      setShifts(sorted);
    }
  }, [allScheduleData, selectedTeam, currentUser, dbTeachers]);



  const lastTagClickRef = useRef({ time: 0, index: -1, sIdx: -1, tag: '' });

  const touchStartX = useRef(null);
  const touchStartY = useRef(null);
  const mainTouchStartX = useRef(null);
  const mainTouchStartY = useRef(null);
  const [pullDistance, setPullDistance] = useState(0);

  const isLoginReady = currentUser && currentUser.trim() !== "" && teachers.includes(currentUser) && !isFetchingTeachers && !isFetchingSchedule;

  useEffect(() => {
    document.documentElement.style.overscrollBehaviorY = 'none';
    document.body.style.overscrollBehaviorY = 'none';
    return () => {
      document.documentElement.style.overscrollBehaviorY = 'auto';
      document.body.style.overscrollBehaviorY = 'auto';
    };
  }, [isLoggedIn]);

  useEffect(() => { setSavedItem('sungdong_team', selectedTeam); }, [selectedTeam]);
  useEffect(() => { setSavedItem('sungdong_teacher', currentUser); }, [currentUser]);
  useEffect(() => { setSessionItem('sungdong_is_logged_in', isLoggedIn ? 'true' : ''); }, [isLoggedIn]);

  useEffect(() => {
    if (selectedTeam === "1팀" && currentUser) {
      const clean = currentUser.replace(/\s/g, "");
      if (clean === "천은선" || clean === "서승희" || clean === "천은선서승희") {
        setCurrentUser("");
        removeSavedItem('sungdong_teacher');
      }
    }
  }, [selectedTeam, currentUser]);

  // 1) 새로고침/창 닫기 시 데이터 저장 중 경고
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (isSubmitting) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    if (isSubmitting) {
      window.addEventListener('beforeunload', handleBeforeUnload);
    }

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isSubmitting]);

  // 2) 일지 작성 화면 마운트 시 세션 복원 대응
  useEffect(() => {
    if (isLoggedIn && (!window.history.state || window.history.state.subView !== 'logWrite')) {
      window.history.pushState({ view: 'main', subView: 'logWrite' }, '', window.location.href);
    }
  }, []);

  // 3) 스마트폰 뒤로가기 버튼(popstate) 처리: 일지 작성 중 뒤로가기 누를 시 메인메뉴 화면 복귀
  useEffect(() => {
    const handlePopState = (e) => {
      // 데이터 저장 중 뒤로가기 시도 차단
      if (isSubmittingRef.current) {
        window.history.pushState({ view: 'main', subView: 'logWrite' }, '', window.location.href);
        alert("데이터 저장 중입니다.\n안전한 저장을 위해 잠시만 기다려주세요.");
        return;
      }

      // 일지 작성 화면에서 뒤로가기를 눌러 메인메뉴로 나가려는 경우
      if (isLoggedInRef.current && (!e.state || e.state.subView !== 'logWrite')) {
        // 이미 저장 확인 모달이 열려있는 상태에서 뒤로가기를 누르면 모달만 닫음
        if (showLogoutConfirmRef.current) {
          window.history.pushState({ view: 'main', subView: 'logWrite' }, '', window.location.href);
          setShowLogoutConfirm(false);
          return;
        }

        // 미저장 변경사항이 있으면 확인 모달 띄우고 상태 복원
        if (hasChangesRef.current) {
          window.history.pushState({ view: 'main', subView: 'logWrite' }, '', window.location.href);
          setShowLogoutConfirm(true);
          return;
        }

        // 변경사항이 없으면 메인메뉴 화면으로 복귀
        isLoggedInRef.current = false;
        setIsLoggedIn(false);
        setRecords([]);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  const [logs, setLogs] = useState({
    0: { student: "", status: "", location: "", selectedTags: [[]], memo: "", headcount: "" },
    1: { student: "", status: "", location: "", selectedTags: [[]], memo: "", headcount: "" },
    2: { student: "", status: "", location: "", selectedTags: [[]], memo: "", headcount: "" },
    3: { student: "", status: "", location: "", selectedTags: [[]], memo: "", headcount: "" },
    4: { student: "", status: "", location: "", selectedTags: [[]], memo: "", headcount: "" },
    5: { student: "", status: "", location: "", selectedTags: [[]], memo: "", headcount: "" }
  });
  const [logsDate, setLogsDate] = useState(date);



  const RENDER_TAGS = ['출석', '결석', '종료', '선생님휴가'];

  const fetchTeachersFromSheet = async (team) => {
    setIsFetchingTeachers(true);
    try {
      let fetchedTeachers = [];
      const teacherSet = new Set();

      if (dbTeachers.length > 0) {
        dbTeachers.filter(t => t.team === team && t.is_active !== false).forEach(t => {
          if (team === "1팀") {
            const clean = (t.name || "").replace(/\s/g, "");
            if (clean === "천은선" || clean === "서승희" || clean === "천은선서승희") return;
          }
          teacherSet.add(t.name);
        });
      }

      fetchedTeachers = Array.from(teacherSet).sort((a, b) => {
        const tA = dbTeachers.find(t => t.team === team && t.name === a);
        const tB = dbTeachers.find(t => t.team === team && t.name === b);
        const seqA = tA && tA.seq_num !== '' && tA.seq_num !== null ? parseInt(tA.seq_num, 10) : 999;
        const seqB = tB && tB.seq_num !== '' && tB.seq_num !== null ? parseInt(tB.seq_num, 10) : 999;
        if (seqA !== seqB) return seqA - seqB;
        return getTeacherSortWeight(team, a) - getTeacherSortWeight(team, b);
      });

      if (fetchedTeachers.length === 0) {
        fetchedTeachers = ["이름입력(직접타이핑)"];
      }
      setTeachers(fetchedTeachers);
      safeJsonSetItem(`sungdong_teachers_${team}`, fetchedTeachers);
    } catch (error) {
      console.error("⚠️ 선생님 목록 로딩 에러:", error);
    } finally {
      setIsFetchingTeachers(false);
    }
  };

  useEffect(() => {
    if (!selectedTeam) { setTeachers([]); setCurrentUser(""); return; }
    fetchTeachersFromSheet(selectedTeam);
  }, [selectedTeam, dbTeachers]);

  useEffect(() => {
    if (!isLoggedIn || !selectedTeam || !currentUser) {
      setAllScheduleData({});
      setIsFetchingSchedule(false);
      setIsSyncing(false);
      return;
    }

    let isMounted = true;

    const cacheKey = `sungdong_schedule_${selectedTeam}`;
    const cachedSchedule = getSavedItem(cacheKey, null);
    if (cachedSchedule) {
      try {
        setAllScheduleData(JSON.parse(cachedSchedule));
      } catch (e) { }
    }

    const fetchScheduleAll = async () => {
      if (isMounted) setIsSyncing(true);
      if (isMounted && !cachedSchedule) setIsFetchingSchedule(true);
      try {
        let allRecords = [];
        let start = 0;
        const limit = 1000;
        let hasMore = true;

        while (hasMore) {
          const { data: chunk, error: chunkErr } = await supabaseClient
            .from('daily_logs')
            .select('*')
            .eq('team', selectedTeam)
            .range(start, start + limit - 1)
            .order('log_date', { ascending: false })
            .order('id', { ascending: true });

          if (chunkErr) throw chunkErr;

          if (chunk && chunk.length > 0) {
            allRecords = allRecords.concat(chunk);
            if (chunk.length < limit) hasMore = false;
            else start += limit;
          } else {
            hasMore = false;
          }
        }

        const scheduleData = {};
        if (allRecords.length > 0) {
          allRecords.forEach(row => {
            if (!scheduleData[row.log_date]) scheduleData[row.log_date] = {};
            if (!scheduleData[row.log_date][row.shift]) scheduleData[row.log_date][row.shift] = [];
            scheduleData[row.log_date][row.shift].push({
              teacher: row.teacher || "",
              student: row.student || "",
              location: row.location || "",
              status: row.status || "",
              attendance: row.attendance || "",
              is_20days: row.is_20days
            });
          });
        }
        if (isMounted) {
          setAllScheduleData(scheduleData);
          safeJsonSetItem(cacheKey, scheduleData);
        }
      } catch (error) {
        console.error(error);
      } finally {
        setIsFetchingSchedule(false);
        setIsSyncing(false);
      }
    };
    fetchScheduleAll();

    return () => {
      isMounted = false;
      setIsFetchingSchedule(false);
      setIsSyncing(false);
    };
  }, [isLoggedIn, selectedTeam, currentUser, refreshTrigger]);

  useEffect(() => {
    const todaysData = allScheduleData[date] || {};

    setLogs(prevLogs => {
      const newLogs = { ...prevLogs };
      shifts.forEach((shift, index) => {
        let list = todaysData[shift] || [];
        if (!Array.isArray(list)) list = [{ teacher: currentUser, ...list }];
        // 내 기록 찾기
        const myRecord = list.find(r => (r.teacher || "").trim() === currentUser.trim()) || {};

        let loadedStudent = (myRecord.student === undefined || myRecord.student === null) ? "" : myRecord.student;
        let loadedLocation = (myRecord.location === undefined || myRecord.location === null) ? "" : myRecord.location;
        let statusStr = mergeAttendanceAndStatus(myRecord.attendance, formatStatusIfDate(myRecord.status));
        let isFromSibling = false;

        if (!statusStr.replace(/\u200B/g, '').trim() && loadedStudent.trim()) {
          const cleanMyStudent = loadedStudent.trim();
          const myGroup = getTeacherGroup(selectedTeam, currentUser, dbTeachers);
          const siblingRecord = list.find(r => {
            if (r.teacher === currentUser) return false;
            const myStudents = cleanMyStudent.split(/[/,]/).map(s => s.trim()).filter(Boolean).sort().join('/');
            const theirStudents = (r.student || "").split(/[/,]/).map(s => s.trim()).filter(Boolean).sort().join('/');
            if (theirStudents !== myStudents) return false;
            const siblingGroup = getTeacherGroup(selectedTeam, r.teacher, dbTeachers);
            if (siblingGroup !== myGroup) return false;
            const siblingStatus = mergeAttendanceAndStatus(r.attendance, formatStatusIfDate(r.status));
            if (siblingStatus.includes("선생님휴가")) return false;
            return siblingStatus.replace(/\u200B/g, '').trim() !== "";
          });
          if (siblingRecord) {
            statusStr = mergeAttendanceAndStatus(siblingRecord.attendance, formatStatusIfDate(siblingRecord.status));
            isFromSibling = true;
          }
        }

        const isShowHeadcount = loadedStudent.includes("보조강사") || loadedStudent.includes("경로당") || loadedLocation.includes("경로당");

        let loadedTags = [[]];
        let memoParts = [];

        const rawParts = statusStr.split(',').map(s => s.trim()).filter(Boolean);
        const isKyungrodang = loadedStudent.includes("경로당") || loadedLocation.includes("경로당");

        let tagParts = [];
        let isMemoStarted = false;
        let loadedHeadcount = "";
        let startIndex = 0;

        if (isShowHeadcount && rawParts.length > 0 && /^\d{1,2}$/.test(rawParts[0])) {
          loadedHeadcount = rawParts[0];
          startIndex = 1;
        }

        for (let i = startIndex; i < rawParts.length; i++) {
          const part = rawParts[i];
          if (!isMemoStarted) {
            const subParts = part.split('/').map(p => p.trim());
            const isAllTags = subParts.every(p => {
              if (p === "") return true;
              const spaceParts = p.split(/\s+/);
              return spaceParts.every(sp => PARSEABLE_ATTENDANCE_TAGS.includes(sp));
            });

            if (isAllTags) {
              tagParts.push(part);
            } else {
              isMemoStarted = true;
              memoParts.push(part);
            }
          } else {
            memoParts.push(part);
          }
        }

        if (isShowHeadcount && tagParts.length > 0 && !loadedHeadcount) {
          const lastTag = tagParts[tagParts.length - 1];
          if (/^\d{1,2}$/.test(lastTag)) {
            if (isKyungrodang || tagParts.length > 1) {
              tagParts.pop();
              memoParts.unshift(lastTag);
            }
          }
        }

        if (tagParts.length > 0) {
          const combinedTagStr = tagParts.join(',');
          const studentTagStrs = combinedTagStr.split('/');
          loadedTags = studentTagStrs.map(str =>
            str.split(/[,\s]+/).map(t => normalizeAttendanceTag(t.trim())).filter(t => ATTENDANCE_TAGS.includes(t))
          );
        }
        loadedTags = loadedTags.map(tags => tags.sort((a, b) => ATTENDANCE_TAGS.indexOf(a) - ATTENDANCE_TAGS.indexOf(b)));

        if (isShowHeadcount && memoParts.length > 0 && !loadedHeadcount) {
          if (/^\d{1,2}$/.test(memoParts[0].trim())) {
            loadedHeadcount = memoParts[0].trim();
            memoParts.shift();
          }
        }
        const loadedMemo = memoParts.join(', ').replace(/\u200B/g, '');

        newLogs[index] = {
          student: loadedStudent,
          location: loadedLocation,
          selectedTags: loadedTags,
          memo: loadedMemo,
          isFromSibling
        };
        if (loadedHeadcount) {
          newLogs[index].headcount = loadedHeadcount;
        } else if (isShowHeadcount) {
          newLogs[index].headcount = "";
        }
      });
      return newLogs;
    });

    setLogsDate(date);
    setUndoLogs({});
    setClearConfirmIndex(null);
  }, [date, allScheduleData, selectedTeam, currentUser, dbTeachers, shifts]);


  const getMyOriginalRecord = (d, shiftTime) => {
    const dayData = allScheduleData[d] || {};
    const shiftData = dayData[shiftTime] || [];
    if (Array.isArray(shiftData)) {
      return shiftData.find(r => (r.teacher || "").trim() === currentUser.trim()) || {};
    }
    return shiftData || {};
  };

  const [debouncedStudentsKey, setDebouncedStudentsKey] = useState("");

  useEffect(() => {
    const studentsKey = shifts.map((_, i) => logs[i]?.student || "").join('|');
    const timer = setTimeout(() => {
      setDebouncedStudentsKey(studentsKey);
    }, 800);
    return () => clearTimeout(timer);
  }, [logs, shifts]);

  useEffect(() => {
    if (!selectedTeam || !isLoggedIn) {
      setStudentCounts({});
      return;
    }

    let isMounted = true;
    const excludeKeywords = ["보조강사", "자체학습", "대상자발굴", "도선복지관", "소양교육", "간담회", "수업", "준비", "컴기초", "공휴일", "근로자의날", "근로자의 날", "삼일절", "3.1절", "어린이날", "현충일", "광복절", "개천절", "한글날", "석가탄신일", "부처님오신날", "성탄절", "제헌절", "추석", "설날", "신정", "대체공휴일", "지방선거일", "지방 선거일", "선거일", "안전교육", "직무교육", "왕초보", "왕초보컴퓨터", "왕초보검퓨터", "왕초보컴퓨터반", "왕초보검퓨터반"];

    const calcCounts = async () => {
      try {
        const isTargetTeacher = (t) => t && (t.includes("천은선") || t.includes("서승희"));
        const names = [];
        shifts.forEach((_, index) => {
          const log = logs[index];
          if (!log || !log.student) return;
          const parsedNames = log.student.split(/[/,]/).map(s => s.trim().split('(')[0].trim()).filter(Boolean);
          parsedNames.forEach(name => {
            if (excludeKeywords.some(kw => name.includes(kw))) return;
            if (!names.includes(name)) names.push(name);
          });
        });

        if (names.length === 0) {
          if (isMounted) setStudentCounts({});
          return;
        }

        let allTeamRecords = [];
        const orConditions = names.map(name => `student.ilike.%${name}%`).join(',');

        const { data: histData, error: histError } = await supabaseClient
          .from('daily_logs')
          .select('log_date, student, status, attendance, teacher, shift')
          .neq('student', '')
          .not('student', 'is', null)
          .lte('log_date', date)
          .or(orConditions)
          .order('log_date', { ascending: true });

        if (histError) throw histError;
        if (histData) {
          const getT = (s) => {
            if (!s) return 9999;
            const m = s.match(/(\d+):(\d+)/);
            return m ? parseInt(m[1]) * 60 + (m[2] ? parseInt(m[2]) : 0) : 9999;
          };
          allTeamRecords = histData.map(r => ({
            ...r,
            status: mergeAttendanceAndStatus(r.attendance, r.status)
          })).sort((a, b) => {
            const dateA = new Date(a.log_date).getTime();
            const dateB = new Date(b.log_date).getTime();
            if (dateA !== dateB) return dateA - dateB;
            return getT(a.shift) - getT(b.shift);
          });
        }

        if (!isMounted) return;

        const currentUserGroup = getTeacherGroup(selectedTeam, currentUser, dbTeachers);
        const studentDatesMap = {};
        const studentExtraDatesMap = {};
        const studentOffsetsMap = {};

        const dayStatusMap = {};
        allTeamRecords.forEach(hRow => {
          if (!hRow.student) return;
          const parsedNames = hRow.student.split(/[/,]/).map(s => s.trim().split('(')[0].trim()).filter(Boolean);
          parsedNames.forEach((name, nameIdx) => {
            let personalStatus = hRow.status || "";
            if (personalStatus.includes('/')) {
              const segments = personalStatus.split('/');
              if (segments.length > nameIdx) personalStatus = segments[nameIdx].trim();
            }
            const hasAttendance = hasIndependentKeyword(personalStatus, ["1"]);
            const hasEndOrCancel = hasIndependentKeyword(personalStatus, ["취소"]);
            const isAttended = hasAttendance && !hasEndOrCancel;
            const isAbsentOrCanceled = (personalStatus.includes("결석") && !hasAttendance) || (personalStatus.includes("선생님휴가") && !hasAttendance) || (hasEndOrCancel && !hasAttendance);

            if (!dayStatusMap[name]) dayStatusMap[name] = {};
            const dParts = hRow.log_date.split('-');
            const dateObjTime = new Date(parseInt(dParts[0], 10), parseInt(dParts[1], 10) - 1, parseInt(dParts[2], 10)).getTime();

            if (isAttended) {
              dayStatusMap[name][dateObjTime] = 'attended';
            } else if (isAbsentOrCanceled && dayStatusMap[name][dateObjTime] !== 'attended') {
              dayStatusMap[name][dateObjTime] = 'absent';
            }
          });
        });

        allTeamRecords.forEach(hRow => {
          if (!hRow.student) return;
          const parsedNames = hRow.student.split(/[/,]/).map(s => s.trim().split('(')[0].trim()).filter(Boolean);
          parsedNames.forEach((name, nameIdx) => {
            if (excludeKeywords.some(kw => name.includes(kw))) return;
            if (!names.includes(name)) return;

            let personalStatus = hRow.status || "";
            if (personalStatus.includes('/')) {
              const segments = personalStatus.split('/');
              if (segments.length > nameIdx) personalStatus = segments[nameIdx].trim();
            }
            // 기존의 personalStatus = personalStatus.replace(/취소/g, '종료'); 코드를 삭제하여 
            // "쿠팡 취소"가 "쿠팡 종료"로 강제 변환되는 현상을 방지합니다.
            // 문자열 내에서 독립적으로 쓰인 경우에만 감지하며, 
            // "취소"가 있더라도 "출석(1)"이 함께 있다면 결석 처리하지 않고 회차에 포함시킵니다.
            // ('종료' 버튼 클릭 시에는 회차에서 차감되지 않도록 조건에서 제외함)
            const hasEndOrCancel = hasIndependentKeyword(personalStatus, ["취소"]);
            const hasAttendance = hasIndependentKeyword(personalStatus, ["1"]);
            const isAbsentOrCanceled = (personalStatus.includes("결석") && !hasAttendance) || (personalStatus.includes("선생님휴가") && !hasAttendance) || (hasEndOrCancel && !hasAttendance);
            const textToMatch = (hRow.memo || hRow.status || "");
            const memoMatches = Array.from(textToMatch.matchAll(/(\d+)\s*회차(?![가-힣a-zA-Z0-9])/g));
            const hasExplicitCount = memoMatches.length > 0;

            const dParts = hRow.log_date.split('-');
            const dateObj = new Date(parseInt(dParts[0], 10), parseInt(dParts[1], 10) - 1, parseInt(dParts[2], 10));
            const dayStatus = dayStatusMap[name] && dayStatusMap[name][dateObj.getTime()];
            const isTarget = isTargetTeacher(hRow.teacher);

            // 취업팀 소속 선생님의 경우 결석(결석 키워드)이어도 회차를 증가시킴
            // 단, 선생님휴가 / 취소는 기존과 동일하게 차감
            const isVacationOnly = (personalStatus.includes("선생님휴가") || personalStatus.includes("휴가")) && !hasAttendance;
            const isOnlyAbsent = (personalStatus.includes("결석") && !hasAttendance) && !isVacationOnly && !(hasEndOrCancel && !hasAttendance);
            let isValidDay = false;
            if (isTarget) {
              isValidDay = (dayStatus === 'attended');
            } else if (selectedTeam === '취업팀' && isOnlyAbsent) {
              // 취업팀: 결석이어도 회차 포함
              isValidDay = true;
            } else {
              isValidDay = !isAbsentOrCanceled || dayStatus === 'attended';
            }

            if (!isValidDay && (isOnlyAbsent || isVacationOnly)) {
              if (!(hRow.log_date === date && hRow.teacher === currentUser)) {
                if (!studentExtraDatesMap[name]) studentExtraDatesMap[name] = [];
                const hGroup = getTeacherGroup(selectedTeam, hRow.teacher, dbTeachers);
                const hShift = hRow.shift || "";
                const dup = studentExtraDatesMap[name].some(d => d.date.getTime() === dateObj.getTime() && d.shift === hShift && d.group === hGroup);
                if (!dup) {
                  studentExtraDatesMap[name].push({
                    date: dateObj,
                    shift: hShift,
                    group: hGroup,
                    teacher: hRow.teacher,
                    isAbsent: isOnlyAbsent,
                    isVacation: isVacationOnly,
                    excludeFromCount: true
                  });
                }
              }
            }

            if (hasExplicitCount || isValidDay) {
              const hGroup = getTeacherGroup(selectedTeam, hRow.teacher, dbTeachers);
              if (hRow.log_date === date) {
                if (hRow.teacher === currentUser) return;
              }

              if (!studentDatesMap[name]) studentDatesMap[name] = [];
              if (studentOffsetsMap[name] === undefined) studentOffsetsMap[name] = 0;
              const hShift = hRow.shift || "";

              let isNew = false;
              if (isValidDay) {
                const alreadyHas = studentDatesMap[name].some(d => {
                  if (isTarget) {
                    const isSameTargetBucket = isTargetTeacher(d.teacher);
                    let isSameClassBucket = false;
                    if (selectedTeam === '취업팀') {
                      isSameClassBucket = (d.shift === hShift && d.group === hGroup);
                    } else {
                      isSameClassBucket = (d.group === hGroup);
                    }
                    return d.date.getTime() === dateObj.getTime() && (isSameTargetBucket || isSameClassBucket);
                  } else {
                    if (selectedTeam === '취업팀') {
                      return d.date.getTime() === dateObj.getTime() && d.shift === hShift && d.group === hGroup;
                    } else {
                      return d.date.getTime() === dateObj.getTime() && d.group === hGroup;
                    }
                  }
                });
                if (!alreadyHas) isNew = true;
              }

              let explicitVal = null;
              if (hasExplicitCount) {
                const matchObj = memoMatches.length > nameIdx ? memoMatches[nameIdx] : memoMatches[0];
                explicitVal = parseInt(matchObj[1], 10);
              }

              if (isNew) {
                // 취업팀 결석 여부를 플래그로 저장해 날짜 팝업에서 빨간색으로 표시
                const isAbsentEntry = selectedTeam === '취업팀' && isOnlyAbsent;
                const isEndEntry = personalStatus.split(/[,/]+/).map(t => t.trim()).some(t => t === '종료');
                studentDatesMap[name].push({
                  date: dateObj,
                  shift: hShift,
                  group: hGroup,
                  teacher: hRow.teacher,
                  isAbsent: isAbsentEntry,
                  isEnd: isEndEntry,
                  explicitCount: explicitVal
                });
              } else if (hasExplicitCount) {
                const existing = studentDatesMap[name].find(d => d.date.getTime() === dateObj.getTime() && d.shift === hShift);
                if (existing) existing.explicitCount = explicitVal;
              }
            }
          });
        });

        // 시간대가 빠른 것부터 회차 계산을 위해 정렬
        Object.keys(studentDatesMap).forEach(name => {
          studentDatesMap[name].sort((a, b) => {
            if (a.date.getTime() !== b.date.getTime()) return a.date.getTime() - b.date.getTime();
            const getT = (s) => {
              if (!s) return 9999;
              const m = s.match(/(\d+):(\d+)/) || s.match(/(\d+)\s*시/);
              return m ? parseInt(m[1]) * 60 + (m[2] ? parseInt(m[2]) : 0) : 9999;
            };
            return getT(a.shift) - getT(b.shift);
          });

          let runningOffset = 0;
          studentDatesMap[name].forEach((d, idx) => {
            if (d.explicitCount !== null && d.explicitCount !== undefined) {
              runningOffset = d.explicitCount - (idx + 1);
            }
            d.sessionNum = (idx + 1) + runningOffset;
          });
        });
        const newCounts = {};
        const currentDatesMap = {};
        const currentOffsetsMap = {};
        for (const [k, v] of Object.entries(studentDatesMap)) {
          currentDatesMap[k] = [...v];
        }
        for (const [k, v] of Object.entries(studentOffsetsMap)) {
          currentOffsetsMap[k] = v;
        }

        const todayParts = date.split('-');
        const todayDateObj = new Date(parseInt(todayParts[0], 10), parseInt(todayParts[1], 10) - 1, parseInt(todayParts[2], 10));

        shifts.forEach((shift, index) => {
          const log = logs[index];
          if (!log || !log.student) return;
          const parsedNames = log.student.split(/[/,]/).map(s => s.trim().split('(')[0].trim()).filter(Boolean);
          const countsForSlot = [];
          parsedNames.forEach((name, nameIdx) => {
            if (excludeKeywords.some(kw => name.includes(kw))) return;

            // [수정된 부분 시작]
            // 입력 화면에서 '결석', '선생님휴가' 버튼을 누르는 순간 즉각 회차에 반영되도록 하기 위해
            // DB에서 불러온 기존의 고정된 상태값(log.status) 대신, 
            // 현재 화면에서 사용자가 클릭하여 선택한 태그(selectedTags)와 작성 중인 메모(memo)를 결합해
            // 실시간 출결 상태(fullRealtimeStatus) 문자열을 재구성합니다.
            let currentStatus = "";
            const tagsStrings = [];
            // 현재 입력된 학생들의 이름을 콤마나 슬래시 기준으로 분리하여 배열로 만듭니다.
            const tempStudentNames = (log.student || "").split(/[/,]/).map(s => s.trim()).filter(s => s.length > 0);

            // 학생 수만큼 반복하면서 각 학생별로 선택된 출결 태그(예: '결석', '1' 등)를 가져와 콤마로 연결합니다.
            for (let j = 0; j < Math.max(1, tempStudentNames.length); j++) {
              const tags = log.selectedTags && log.selectedTags[j] ? log.selectedTags[j] : [];
              tagsStrings.push(tags.join(', '));
            }

            // 여러 명일 경우 슬래시(/)로 구분하고, 한 명일 경우 그대로 사용합니다.
            let orderedTagsStr = tagsStrings.length > 1 ? tagsStrings.join('/') : (tagsStrings[0] || "");

            let realtimeStatusStr = [];
            if (orderedTagsStr) realtimeStatusStr.push(orderedTagsStr);
            if (log.memo) realtimeStatusStr.push(log.memo);

            // 최종적으로 구성된 실시간 출결 상태 문자열입니다. (예: "결석 / 1, 메모내용")
            const fullRealtimeStatus = realtimeStatusStr.join(', ');

            // 여러 명의 학생이 있을 경우 슬래시(/)로 나뉘어져 있으므로, 현재 검사 중인 학생(nameIdx)의 상태만 추출합니다.
            if (fullRealtimeStatus.includes('/')) {
              const segments = fullRealtimeStatus.split('/');
              if (segments.length > nameIdx) currentStatus = segments[nameIdx].trim();
            } else {
              currentStatus = fullRealtimeStatus;
            }

            // 위와 동일하게 "취소" 무조건 변환 코드를 삭제하고, 독립 단어로 쓰인 경우만 감지하도록 수정합니다.
            // 또한 "취소"가 있더라도 "출석(1)"이 함께 있다면 결석 처리하지 않고 회차에 포함시킵니다.
            // ('종료' 태그를 누르더라도 회차가 1 차감되지 않도록 "종료" 키워드를 조건에서 제외합니다.)
            const hasCurrentEndOrCancel = hasIndependentKeyword(currentStatus, ["취소"]);
            const hasCurrentAttendance = hasIndependentKeyword(currentStatus, ["1"]);

            // 결석이거나, (선생님휴가이되 출석은 없는 경우)이거나, 출석 없이 취소만 있는 경우 결석(isAbsent = true)으로 판정합니다.
            // 이 판정 결과에 따라 화면의 렌더링 회차가 즉시 1 차감됩니다.
            const isAbsent = (currentStatus.includes("결석") && !hasCurrentAttendance) || (currentStatus.includes("선생님휴가") && !hasCurrentAttendance) || (hasCurrentEndOrCancel && !hasCurrentAttendance);
            // 취업팀의 경우 '결석' 단독 체크(선생님휴가/취소 제외)이면 회차에 포함
            const isOnlyAbsentCurrent = (currentStatus.includes("결석") && !hasCurrentAttendance) && !(currentStatus.includes("선생님휴가") && !hasCurrentAttendance) && !(hasCurrentEndOrCancel && !hasCurrentAttendance);
            const isJobTeamAbsent = selectedTeam === '취업팀' && isOnlyAbsentCurrent;
            const textToMatch = (log.memo || fullRealtimeStatus);
            // [수정된 부분 끝]
            const memoMatches = Array.from(textToMatch.matchAll(/(\d+)\s*회차(?![가-힣a-zA-Z0-9])/g));
            const hasExplicitCount = memoMatches.length > 0;

            if (!currentDatesMap[name]) currentDatesMap[name] = [];
            if (currentOffsetsMap[name] === undefined) currentOffsetsMap[name] = 0;

            let isNew = false;
            let currentExplicitVal = null;
            if (hasExplicitCount) {
              const matchObj = memoMatches.length > nameIdx ? memoMatches[nameIdx] : memoMatches[0];
              currentExplicitVal = parseInt(matchObj[1], 10);
            }

            const todayDateObjTime = todayDateObj.getTime();
            const dayStatusToday = dayStatusMap[name] && dayStatusMap[name][todayDateObjTime];

            if (!isAbsent || hasExplicitCount || isJobTeamAbsent || dayStatusToday === 'attended') {
              const alreadyHas = currentDatesMap[name].some(d => {
                const currentTeacher = log ? log.teacher : currentUser;
                const isTarget = isTargetTeacher(currentTeacher);
                if (isTarget) {
                  const isSameTargetBucket = isTargetTeacher(d.teacher);
                  let isSameClassBucket = false;
                  if (selectedTeam === '취업팀') {
                    isSameClassBucket = (d.shift === shift && d.group === currentUserGroup);
                  } else {
                    isSameClassBucket = (d.group === currentUserGroup);
                  }
                  return d.date.getTime() === todayDateObj.getTime() && (isSameTargetBucket || isSameClassBucket);
                } else {
                  if (selectedTeam === '취업팀') {
                    return d.date.getTime() === todayDateObj.getTime() && d.shift === shift && d.group === currentUserGroup;
                  } else {
                    return d.date.getTime() === todayDateObj.getTime() && d.group === currentUserGroup;
                  }
                }
              });
              if (!alreadyHas) isNew = true;

              if (isNew) {
                const currentTeacher = log ? log.teacher : currentUser;
                const isEndEntryCurrent = currentStatus.split(/[,/]+/).map(t => t.trim()).some(t => t === '종료');
                // 취업팀 결석 여부를 플래그로 저장해 날짜 팝업에서 빨간색으로 표시
                currentDatesMap[name].push({
                  date: todayDateObj,
                  shift: shift,
                  group: currentUserGroup,
                  teacher: currentTeacher,
                  isAbsent: isJobTeamAbsent,
                  isEnd: isEndEntryCurrent,
                  explicitCount: currentExplicitVal
                });
              } else if (hasExplicitCount) {
                const existing = currentDatesMap[name].find(d => d.date.getTime() === todayDateObj.getTime() && d.shift === shift);
                if (existing) existing.explicitCount = currentExplicitVal;
              }
            }

            const getTLocal = (s) => {
              if (!s) return 9999;
              const m = s.match(/(\d+):(\d+)/) || s.match(/(\d+)\s*시/);
              return m ? parseInt(m[1]) * 60 + (m[2] ? parseInt(m[2]) : 0) : 9999;
            };
            const currentShiftT = getTLocal(shift);

            const dates = currentDatesMap[name];
            const validDates = dates.filter(d => {
              if (d.date.getTime() < todayDateObj.getTime()) return true;
              if (d.date.getTime() === todayDateObj.getTime()) {
                if (selectedTeam === '취업팀') {
                  return getTLocal(d.shift) <= currentShiftT;
                } else {
                  return true;
                }
              }
              return false;
            });

            validDates.sort((a, b) => {
              if (a.date.getTime() !== b.date.getTime()) return a.date.getTime() - b.date.getTime();
              return getTLocal(a.shift) - getTLocal(b.shift);
            });

            let runningOffset = 0;
            validDates.forEach((d, idx) => {
              if (d.explicitCount !== null && d.explicitCount !== undefined) {
                runningOffset = d.explicitCount - (idx + 1);
              }
              d.sessionNum = (idx + 1) + runningOffset;
            });

            const lastValidDate = validDates[validDates.length - 1];
            const finalCount = lastValidDate && lastValidDate.sessionNum !== undefined ? lastValidDate.sessionNum : validDates.length;

            const isVacationCurrent = (currentStatus.includes("선생님휴가") || currentStatus.includes("휴가")) && !hasCurrentAttendance;
            const isNonCountedCurrentAbsent = isOnlyAbsentCurrent && !isJobTeamAbsent;
            const extraDates = [...(studentExtraDatesMap[name] || [])];
            if ((isNonCountedCurrentAbsent || isVacationCurrent) && dayStatusToday !== 'attended') {
              const dupToday = extraDates.some(d => d.date.getTime() === todayDateObj.getTime() && d.shift === shift && d.group === currentUserGroup);
              if (!dupToday) {
                extraDates.push({
                  date: todayDateObj,
                  shift: shift,
                  group: currentUserGroup,
                  teacher: log ? log.teacher : currentUser,
                  isAbsent: isNonCountedCurrentAbsent,
                  isVacation: isVacationCurrent,
                  excludeFromCount: true
                });
              }
            }
            const filteredExtraDates = extraDates.filter(d => {
              if (d.date.getTime() < todayDateObj.getTime()) return true;
              if (d.date.getTime() === todayDateObj.getTime()) {
                return selectedTeam === '취업팀' ? getTLocal(d.shift) <= currentShiftT : true;
              }
              return false;
            });
            const combinedDates = [...validDates, ...filteredExtraDates].sort((a, b) => {
              if (a.date.getTime() !== b.date.getTime()) return a.date.getTime() - b.date.getTime();
              return getTLocal(a.shift) - getTLocal(b.shift);
            });

            countsForSlot.push({ name, count: finalCount, dates: combinedDates });
          });
          if (countsForSlot.length > 0) newCounts[index] = countsForSlot;
        });

        if (isMounted) setStudentCounts(newCounts);
      } catch (e) {
        console.error("회차 계산 오류:", e);
      }
    };

    calcCounts();
    return () => { isMounted = false; };
  }, [date, selectedTeam, isLoggedIn, logs, shifts]);

  const buildAttendanceString = (log) => {
    if (!log) return "";
    let tagsStrings = [];
    const studentNames = (log.student || "").split(/[/,]/).map(s => s.trim()).filter(s => s.length > 0);
    const maxRows = Math.max(1, studentNames.length);

    for (let j = 0; j < maxRows; j++) {
      const tags = (log.selectedTags && log.selectedTags[j]) ? log.selectedTags[j] : [];
      const sorted = [...tags].sort((a, b) => ATTENDANCE_TAGS.indexOf(a) - ATTENDANCE_TAGS.indexOf(b));
      tagsStrings.push(sorted.length > 0 ? sorted.join(', ') : '');
    }

    let orderedTagsStr = "";
    if (tagsStrings.some(s => s.length > 0)) {
      orderedTagsStr = maxRows > 1 ? tagsStrings.join('/') : (tagsStrings[0] || "");
    }

    const isKyungrodang = (log.student || "").includes("경로당") || (log.location || "").includes("경로당");
    const isShowHeadcount = (log.student || "").includes("보조강사") || isKyungrodang;

    const result = [];
    if (isShowHeadcount && log.headcount) {
      result.push(log.headcount);
    }
    if (orderedTagsStr) {
      result.push(orderedTagsStr);
    }
    return result.join(', ');
  };

  const buildStatusString = (log) => {
    if (!log) return "";
    const finalStr = (log.memo || "").trim();
    if (finalStr === "" && buildAttendanceString(log) === "") {
      const hasStudentOrLocation = (log.student || "").trim() !== "" || (log.location || "").trim() !== "";
      return hasStudentOrLocation ? "\u200B" : "";
    }
    return finalStr;
  };

  const changedShiftCount = useMemo(() => {
    return (shifts || []).reduce((count, shift, i) => {
      const log = logs[i];
      if (!log) return count;
      const original = getMyOriginalRecord(date, shift);
      const originalStatus = formatStatusIfDate(original.status);
      const currentStatusStr = buildStatusString(log);
      const originalAttendance = (original.attendance || "").trim();
      const currentAttendanceStr = buildAttendanceString(log);

      const studentChanged = (log.student || "").trim() !== (original.student || "").trim();
      const locationChanged = (log.location || "").trim() !== (original.location || "").trim();
      const isEmptyRow = (log.student || "").trim() === "" && (log.location || "").trim() === "" &&
        (original.student || "").trim() === "" && (original.location || "").trim() === "";

      const normCurrent = currentStatusStr === "\u200B" ? "" : currentStatusStr;
      const normOriginal = originalStatus === "\u200B" ? "" : originalStatus;
      const statusChanged = isEmptyRow ? false : (normCurrent !== normOriginal || currentAttendanceStr !== originalAttendance);

      return (studentChanged || locationChanged || statusChanged) ? count + 1 : count;
    }, 0);
  }, [logs, allScheduleData, date, selectedTeam, shifts]);

  const hasChanges = changedShiftCount > 0;

  useEffect(() => {
    hasChangesRef.current = hasChanges;
  }, [hasChanges]);

  const isEmptySchedule = useMemo(() => {
    return Object.values(logs).every(log => !log.student?.trim() && !log.location?.trim());
  }, [logs]);

  const isCurrentUser20DaysFalse = useMemo(() => {
    const todaysData = allScheduleData[date] || {};
    return Object.values(todaysData).some(shiftArr =>
      Array.isArray(shiftArr) && shiftArr.some(r => (r.teacher || "").trim() === (currentUser || "").trim() && r.is_20days === false)
    );
  }, [allScheduleData, date, currentUser]);

  const isMissingHeadcount = useMemo(() => {
    return false;
  }, []);

  const performAutoSave = async (forceIndex = null) => {
    // 입력 유효성 검사 (학생 이름 / 장소 블랭크 검사)
    for (let i = 0; i < shifts.length; i++) {
      const log = logs[i];
      if (!log) continue;
      const studentName = (log.student || "").trim();
      const locationName = (log.location || "").trim();

      // 학생 이름이 블랭크가 아니면서 장소가 블랭크인 경우 (취업팀 제외)
      if (studentName !== "" && locationName === "" && selectedTeam !== "취업팀") {
        setValidationErrorMsg(`${studentName}님의 수업장소를 입력하세요`);
        setValidationErrorIndex(i);
        setValidationErrorType("location_validation");
        setShowValidationError(true);
        setTimeout(() => {
          setShowValidationError(false);
          const el = document.getElementById(`log-card-${i}`);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 2000);
        return false;
      }

      // 장소가 블랭크가 아니면서 학생이름이 블랭크인 경우
      if (locationName !== "" && studentName === "") {
        setValidationErrorMsg(`대상자 이름을 입력하세요`);
        setValidationErrorIndex(i);
        setValidationErrorType("student_validation");
        setShowValidationError(true);
        setTimeout(() => {
          setShowValidationError(false);
          const el = document.getElementById(`log-card-${i}`);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 2000);
        return false;
      }
    }

    const todayStr = getLocalDateString(new Date());
    const isFutureDate = date > todayStr;
    const todaysOriginalData = allScheduleData[date] || {};

    const initialProgress = shifts.map((shiftTime, i) => {
      const log = logs[i];
      const original = getMyOriginalRecord(date, shiftTime);
      const originalStatus = formatStatusIfDate(original.status);
      const currentStatusStr = buildStatusString(log);
      const originalAttendance = (original.attendance || "").trim();
      const currentAttendanceStr = buildAttendanceString(log);

      const studentChanged = (log.student || "").trim() !== (original.student || "").trim();
      const locationChanged = (log.location || "").trim() !== (original.location || "").trim();
      const isEmptyRow = (log.student || "").trim() === "" && (log.location || "").trim() === "" &&
        (original.student || "").trim() === "" && (original.location || "").trim() === "";

      const normCurrent = currentStatusStr === "\u200B" ? "" : currentStatusStr;
      const normOriginal = originalStatus === "\u200B" ? "" : originalStatus;
      const statusChanged = isEmptyRow ? false : (normCurrent !== normOriginal || currentAttendanceStr !== originalAttendance);

      const isChanged = (i === forceIndex) || studentChanged || locationChanged || statusChanged;

      let effectiveLocation = log.location || "";

      const sNames = (log.student || "").split(/[/,]/).map(s => s.trim()).filter(s => s.length > 0);

      return {
        index: i,
        isRepeat: false,
        shift: shiftTime,
        student: log.student || "미입력",
        isDoubleHeight: sNames.length >= 2,
        location: effectiveLocation,
        attendance: mergeAttendanceAndStatus(currentAttendanceStr, normCurrent) || "입력 없음",
        isChanged: isChanged,
        status: isChanged ? '대기 중' : '변경 없음'
      };
    });

    const changedIndices = initialProgress.filter(p => p.isChanged).map(p => p.index);

    if (changedIndices.length === 0) return true;

    for (let i of changedIndices) {
      const log = logs[i];
      if (!log) continue;

      const studentNames = (log.student || "").split(/[/,]/).map(s => s.trim()).filter(s => s.length > 0);
      const memo = (log.memo || "").trim();
      const targetNameForHeadcount = studentNames.find(name => name.includes("보조강사") || name.includes("경로당"));
      const hasAssistant = studentNames.some(name => name.includes("보조강사"));
      const isBalGul = studentNames.some(name => name.includes("대상자발굴"));
      const hasSelfStudy = studentNames.some(name => name.includes("자체학습"));

      const hc = (log.headcount || "").trim();
      const checkedCount = studentNames.filter((_, sIdx) => {
        const tags = (log.selectedTags && log.selectedTags[sIdx]) ? log.selectedTags[sIdx] : [];
        return tags.length > 0;
      }).length;
      const hasCheckedAttendance = (checkedCount > 0) || (targetNameForHeadcount !== undefined);

      const isTeamMeeting = studentNames.some(name => name.includes("팀장간담회"));

      const isKyungrodangLoc = (log.location || "").includes("경로당");
      const isShowHeadcount = (targetNameForHeadcount !== undefined) || isKyungrodangLoc;

      if (!isFutureDate && isShowHeadcount && memo !== "" && hc === "") {
        const hasExcusedAttendance = studentNames.some((_, sIdx) => {
          const tags = (log.selectedTags && log.selectedTags[sIdx]) ? log.selectedTags[sIdx] : [];
          return tags.includes("결석") || (tags.includes("선생님휴가") && !tags.includes("1")) || tags.includes("종료");
        });

        if (!hasExcusedAttendance) {
          setValidationErrorMsg('교육 참석인원을 입력하세요!');
          setValidationErrorIndex(i);
          setValidationErrorType("headcount");
          setShowValidationError(true);
          return false;
        }
      }

      if (!isFutureDate && studentNames.length >= 2 && !hasAssistant && !isBalGul && !hasSelfStudy && !isTeamMeeting) {
        if (checkedCount > 0 && checkedCount < studentNames.length) {
          const displayNames = studentNames.join('/');
          setValidationErrorMsg(`${displayNames} 님의 출결 상태를 모두 체크해 주세요! (한 명만 체크할 수 없습니다.)`);
          setValidationErrorIndex(i);
          setValidationErrorType("attendance");
          setShowValidationError(true);
          return false;
        }
      }

      if (!isFutureDate && studentNames.length > 0 && !hasAssistant && !isBalGul && !hasSelfStudy && memo !== "" && !memo.replace(/\s+/g, '').includes("복지관으로이동") && !isTeamMeeting) {
        if (!hasCheckedAttendance) {
          const displayNames = studentNames.join('/');
          const isKyungrodangEntry = displayNames.includes("경로당");
          const msg = isKyungrodangEntry
            ? `${displayNames} 님 참석인원 또는 출결사항을 확인해 주세요!`
            : `${displayNames} 님의 [출결 버튼]을 체크해 주세요!`;

          setValidationErrorMsg(msg);
          setValidationErrorIndex(i);
          setValidationErrorType("attendance");
          setShowValidationError(true);
          return false;
        }

        const anyUnchecked = studentNames.some((_, sIdx) => {
          const tags = (log.selectedTags && log.selectedTags[sIdx]) ? log.selectedTags[sIdx] : [];
          return tags.length === 0 && !(targetNameForHeadcount !== undefined);
        });
        if (anyUnchecked) {
          const displayNames = studentNames.join('/');
          const isKyungrodangEntry = displayNames.includes("경로당");
          const msg = isKyungrodangEntry
            ? `${displayNames} 님 참석인원 또는 출결사항을 확인해 주세요!`
            : `${displayNames} 님의 [출결 버튼]을 체크해 주세요!`;

          setValidationErrorMsg(msg);
          setValidationErrorIndex(i);
          setValidationErrorType("attendance");
          setShowValidationError(true);
          return false;
        }
      }


    }

    const batchItems = changedIndices.map(i => {
      const shiftTime = shifts[i];
      const log = logs[i];
      const currentStatusStr = buildStatusString(log);
      const currentAttendanceStr = buildAttendanceString(log);

      return {
        index: i,
        shift: shiftTime,
        student: log.student || "",
        location: log.location || "",
        status: currentStatusStr,
        attendance: currentAttendanceStr
      };
    });

    setSaveProgress(initialProgress);
    setIsSaveComplete(false);
    setShowSavePopup(true);
    setIsSubmitting(true);
    console.log("💾 배치 저장 시작 - 선택된 팀:", selectedTeam, "날짜:", date, "항목 수:", batchItems.length);

    let finalValidRecords = [];
    let deletedShiftsList = [];

    try {
      setSaveProgress(prev => prev.map(item => changedIndices.includes(item.index) ? { ...item, status: '저장 중...' } : item));

      const upsertData = [];
      const deleteShifts = [];

      for (let i = 0; i < batchItems.length; i++) {
        const item = batchItems[i];

        const isStudentBlank = !item.student || item.student.trim() === "";

        // 학생 이름이 블랭크일 경우 데이터베이스 레코드를 삭제하지 않고 모든 필드를 초기화하여 업데이트
        if (isStudentBlank) {
          item.student = "";
          item.location = "";
          item.status = "";
          item.attendance = "";
        }

        upsertData.push({
          team: selectedTeam,
          log_date: date,
          teacher: currentUser,
          shift: item.shift,
          student: item.student || "",
          location: item.location || "",
          status: item.status || "",
          attendance: item.attendance || ""
        });
      }

      if (deleteShifts.length > 0) {
        const { error: deleteError } = await supabaseClient
          .from('daily_logs')
          .delete()
          .eq('team', selectedTeam)
          .eq('log_date', date)
          .eq('teacher', currentUser)
          .in('shift', deleteShifts);

        if (deleteError) throw new Error("Supabase 삭제 실패: " + deleteError.message);
        console.log("🗑️ 삭제 완료 - shifts:", deleteShifts);
      }

      if (upsertData.length > 0) {
        const { error } = await supabaseClient
          .from('daily_logs')
          .upsert(upsertData, { onConflict: 'team, log_date, teacher, shift' });

        if (error) throw new Error("Supabase 저장 실패: " + error.message);
      }

      const validRecords = [];

      batchItems.forEach(item => {
        const isDeleted = deleteShifts.includes(item.shift);
        const isStudentBlank = !item.student || item.student.trim() === "";
        let finalUrl = "";

        if (isDeleted || isStudentBlank) {
          setLogs(prev => ({
            ...prev,
            [item.index]: {
              student: "",
              status: "",
              location: "",
              selectedTags: [[]],
              memo: "",
              headcount: ""
            }
          }));
          const backupKey = `log_backup_${selectedTeam}_${currentUser}_${date}_${item.index}`;
          removeSavedItem(backupKey);

          // deleteShifts에 포함된 경우(완전 삭제)에는 이후 로직 생략
          if (isDeleted) return;
        } else {
          const res = upsertData.find(r => r.shift === item.shift);
          finalUrl = res ? res.location : item.location;

          setLogs(prev => ({ ...prev, [item.index]: { ...prev[item.index], location: finalUrl } }));
          const backupKey = `log_backup_${selectedTeam}_${currentUser}_${date}_${item.index}`;
          removeSavedItem(backupKey);
        }

        validRecords.push({
          index: item.index,
          id: Date.now() + parseInt(item.index),
          team: selectedTeam,
          teacher: currentUser,
          date: date,
          shift: item.shift,
          student: item.student,
          location: finalUrl,
          status: item.status,
          attendance: item.attendance,
          submittedAt: new Date().toLocaleTimeString()
        });
      });

      finalValidRecords = validRecords;
      deletedShiftsList = deleteShifts;

      setSaveProgress(prev => prev.map(item => {
        if (!changedIndices.includes(item.index)) return item;
        const shiftTime = shifts[item.index];
        const isDeleted = deleteShifts.includes(shiftTime);
        return {
          ...item,
          status: isDeleted ? '삭제 완료' : '저장 완료'
        };
      }));
    } catch (e) {
      console.error("❌ 배치 저장 실패:", e);
      setErrorMessage("⚠️ 저장 중 오류가 발생했습니다: " + e.message);
      setSaveProgress(prev => prev.map(item => changedIndices.includes(item.index) ? { ...item, status: '저장 실패' } : item));
      setTimeout(() => setErrorMessage(""), 5000);
    }

    if (finalValidRecords.length > 0 || deletedShiftsList.length > 0) {
      setRecords(prev => [...finalValidRecords.reverse(), ...prev]);
      setAllScheduleData(prev => {
        const newData = { ...prev };
        if (!newData[date]) newData[date] = {};

        finalValidRecords.forEach(record => {
          const existingShiftData = newData[date][record.shift] || [];
          let shiftArr = Array.isArray(existingShiftData) ? [...existingShiftData] : [{ teacher: currentUser, ...existingShiftData }];
          const existingIdx = shiftArr.findIndex(r => r.teacher === currentUser);
          const isStudentBlank = !record.student || record.student.trim() === "";

          const newRecord = {
            teacher: currentUser,
            student: isStudentBlank ? "" : (logs[record.index].student || ""),
            location: record.location,
            status: record.status === "\u200B" ? "" : record.status,
            attendance: isStudentBlank ? "" : (record.attendance || ""),
            selectedTags: isStudentBlank ? [[]] : logs[record.index].selectedTags,
            memo: isStudentBlank ? "" : logs[record.index].memo,
            headcount: isStudentBlank ? "" : logs[record.index].headcount
          };
          if (existingIdx !== -1) {
            shiftArr[existingIdx] = { ...shiftArr[existingIdx], ...newRecord };
          } else {
            shiftArr.push(newRecord);
          }
          newData[date][record.shift] = shiftArr;
        });

        deletedShiftsList.forEach(shift => {
          if (newData[date]) {
            delete newData[date][shift];
          }
        });

        if (selectedTeam) {
          const cacheKey = `sungdong_schedule_${selectedTeam}`;
          safeJsonSetItem(cacheKey, newData);
        }

        return newData;
      });
    }

    setIsSubmitting(false);
    setIsSaveComplete(true);
    return true;
  };

  const handleInputBlur = () => {
    setTimeout(() => {
      window.scrollTo({ top: window.scrollY, behavior: 'instant' });
    }, 50);
  };

  const executeLogout = () => {
    isLoggedInRef.current = false;
    setIsLoggedIn(false);
    setRecords([]);
    try {
      if (getRoomPopupMode() !== 'always') {
        window.__sungdong_initial_room_popup_shown = true;
        window.sessionStorage.setItem('sungdong_room_popup_session_done', 'true');
      } else {
        roomPopupDismissedRef.current = null;
      }
    } catch (_) { }
    if (window.history.state && window.history.state.subView === 'logWrite') {
      window.history.back();
    }
  };

  const handleLogout = async () => {
    if (hasChanges) {
      setShowLogoutConfirm(true);
      return;
    }
    executeLogout();
  };

  const handleLogoutConfirmYes = async () => {
    setShowLogoutConfirm(false);
    const saved = await performAutoSave();
    if (!saved) {
      return; // 저장 실패 시 중단
    }
    return; // 저장 성공 시 기존 저장화면(팝업)을 볼 수 있도록 로그아웃 처리를 중단함
  };

  const handleLogoutConfirmNo = () => {
    setShowLogoutConfirm(false);
    executeLogout();
  };
  const handleSubmit = async (e) => { e.preventDefault(); await performAutoSave(); };

  const getTagClass = (index, sIdx, tag) => {
    const isActive = logs[index]?.selectedTags && logs[index].selectedTags[sIdx] && logs[index].selectedTags[sIdx].includes(tag);
    if (!isActive) {
      return 'bg-white text-gray-600 font-bold border-[1.5px] border-gray-200 shadow-sm hover:border-gray-300 hover:bg-gray-50 active:scale-95';
    }
    const baseActiveStyle = 'text-white font-extrabold border-[1.5px] shadow-md active:scale-95';
    if (tag === '결석') return `bg-rose-500 border-rose-500 shadow-rose-500/30 ${baseActiveStyle}`;
    if (tag === '종료') return `bg-orange-400 border-orange-400 shadow-orange-400/30 ${baseActiveStyle}`;
    if (tag === '선생님휴가') return `bg-gray-500 border-gray-500 shadow-gray-500/30 ${baseActiveStyle}`;
    return `bg-blue-600 border-blue-600 shadow-blue-600/30 ${baseActiveStyle}`;
  };

  const handleRepeatSchedule = async () => {
    if (isDataLoading) return;
    const hasSpecialStudentToday = Object.values(logs || {}).some(log => {
      const s = (log?.student || '');
      return s.includes('직무교육') || s.includes('안전교육') || s.includes('간담회');
    });
    if (hasSpecialStudentToday) {
      setErrorMessage("⚠️ 간담회/교육 일정은 복제할 수 없습니다.");
      setTimeout(() => setErrorMessage(""), 3000);
      return;
    }
    const currentDayOfWeek = new Date(date).getDay();
    const targetDates = availableDates.filter(d => {
      if (d <= date || new Date(d).getDay() !== currentDayOfWeek) return false;
      if (isHoliday(d)) return false;
      const targetData = allScheduleData[d] || {};
      const hasFalse20Days = Object.values(targetData).some(shiftArr =>
        Array.isArray(shiftArr) && shiftArr.some(r => r.is_20days === false)
      );
      if (hasFalse20Days) return false;
      if (selectedTeam === '취업팀') return true;
      const hasSpecialEvent = Object.keys(targetData).some(shiftTime => {
        const original = getMyOriginalRecord(d, shiftTime);
        const student = (original?.student || "").trim();
        const location = (original?.location || "").trim();
        const combinedText = student + location;
        return combinedText.includes("공휴일") || combinedText.includes("간담회") || combinedText.includes("소양교육");
      });
      return !hasSpecialEvent;
    });

    if (targetDates.length === 0) {
      setErrorMessage("⚠️ 이후 동일한 요일의 날짜가 없습니다.");
      setTimeout(() => setErrorMessage(""), 3000);
      return;
    }

    let hasOriginalAssistantConflict = false;

    const validTargetDates = targetDates.map(targetDate => {
      let changedTimes = [];
      shifts.forEach((shiftTime, i) => {
        const log = logs[i];
        const original = getMyOriginalRecord(targetDate, shiftTime);
        const isStudentDiff = (log.student || "") !== (original.student || "");
        const isLocationDiff = (log.location || "") !== (original.location || "");

        // --- 보조강사 일정 복제 방지 (마지막 날 이후 빈칸인 곳 복사 방지) ---
        const currentHasAssistant = (log.student || "").includes("보조강사");
        const originalHasAssistant = (original.student || "").includes("보조강사");
        if (currentHasAssistant && !originalHasAssistant) {
          return; // 복제 건너뜀
        }
        // ------------------------------------------------------------------

        if (isStudentDiff || isLocationDiff) {
          if (originalHasAssistant) {
            hasOriginalAssistantConflict = true;
          }
          changedTimes.push(shiftTime);
        }
      });
      if (changedTimes.length > 0) {
        return { date: targetDate, times: changedTimes };
      }
      return null;
    }).filter(Boolean);

    if (validTargetDates.length === 0) {
      setErrorMessage(<span className="text-lg">⚠️ 이미 동일한 일정이 등록되어 있습니다.</span>);
      setTimeout(() => setErrorMessage(""), 3000);
      return;
    }

    if (hasOriginalAssistantConflict) {
      setAssistantConflictData({ mode: 'all', validTargetDates });
      setShowAssistantConflictModal(true);
      return;
    }

    setRepeatMode('all');
    setRepeatTargetDates(validTargetDates);
    setShowRepeatConfirm(true);
  };

  const executeRepeatSchedule = async () => {
    setShowRepeatConfirm(false);
    if (hasChanges) {
      const saved = await performAutoSave();
      if (!saved) return;
    }
    setIsSubmitting(true);
    setShowSavePopup(true);
    setIsSaveComplete(false);

    let allTasks = [];

    repeatTargetDates.forEach((targetObj) => {
      const targetDate = targetObj.date;
      if (isHoliday(targetDate)) {
        console.log(`Skipping repeat replication for holiday target date: ${targetDate}`);
        return;
      }
      shifts.forEach((shiftTime, i) => {
        const log = logs[i];
        const original = getMyOriginalRecord(targetDate, shiftTime);
        const isStudentDiff = (log.student || "") !== (original.student || "");
        const isLocationDiff = (log.location || "") !== (original.location || "");
        if (isStudentDiff || isLocationDiff) {
          allTasks.push({
            id: `${targetDate}_${i}`,
            date: targetDate,
            shift: shiftTime,
            student: log.student || "",
            location: log.location || "",
            statusStr: original.status || "",
            index: i
          });
        }
      });
    });

    if (allTasks.length === 0) {
      setSaveProgress([]);
      setIsSubmitting(false);
      setIsSaveComplete(true);
      setShowSavePopup(false);
      return;
    }

    setSaveProgress(allTasks.map(t => {
      const mm = t.date.substring(5, 7);
      const dd = t.date.substring(8, 10);
      const dayName = getDayName(t.date);
      return {
        id: t.id,
        isRepeat: true,
        dateDisplay: `${mm}/${dd}(${dayName})`,
        timeDisplay: t.shift,
        student: t.student || "미입력",
        status: '대기 중'
      };
    }));

    const validRecords = [];
    const chunkSize = 3;

    for (let idx = 0; idx < allTasks.length; idx += chunkSize) {
      const chunkTasks = allTasks.slice(idx, idx + chunkSize);
      const chunkPromises = chunkTasks.map(async (task, chunkIdx) => {
        if (chunkIdx > 0) await new Promise(res => setTimeout(res, chunkIdx * 150));

        let location = task.location;

        for (let attempt = 1; attempt <= 5; attempt++) {
          try {
            setSaveProgress(prev => prev.map(item => item.id === task.id ? { ...item, status: attempt === 1 ? '저장 중...' : `재시도 중...(${attempt}/5)` } : item));

            const upsertPayload = {
              team: selectedTeam,
              log_date: task.date,
              teacher: currentUser,
              shift: task.shift,
              student: task.student || "",
              location: location || ""
            };

            const { error: upsertError } = await supabaseClient
              .from('daily_logs')
              .upsert(upsertPayload, { onConflict: 'team, log_date, teacher, shift' });

            if (upsertError) throw new Error("Supabase 저장 실패: " + upsertError.message);

            setSaveProgress(prev => prev.map(item => item.id === task.id ? { ...item, status: '저장 완료' } : item));
            task.location = location;
            return task;
          } catch (e) {
            if (attempt === 5) {
              setSaveProgress(prev => prev.map(item => item.id === task.id ? { ...item, status: '저장 실패' } : item));
              return null;
            } else {
              await new Promise(res => setTimeout(res, 1000 + Math.floor(Math.random() * 500)));
            }
          }
        }
        return null;
      });

      const resolvedChunk = await Promise.all(chunkPromises);
      resolvedChunk.forEach(record => { if (record !== null) validRecords.push(record); });
      if (idx + chunkSize < allTasks.length) await new Promise(res => setTimeout(res, 300));
    }

    if (validRecords.length > 0) {
      setLogs(prev => {
        const newLogs = { ...prev };
        validRecords.forEach(record => {
          if (record.date === date) {
            const sIdx = shifts.indexOf(record.shift);
            if (sIdx !== -1) {
              newLogs[sIdx] = { ...newLogs[sIdx], location: record.location };
            }
          }
        });
        return newLogs;
      });

      setAllScheduleData(prev => {
        const newData = { ...prev };
        validRecords.forEach(record => {
          if (!newData[record.date]) newData[record.date] = {};
          const shiftData = newData[record.date][record.shift] || [];
          let shiftArr = Array.isArray(shiftData) ? [...shiftData] : [{ teacher: currentUser, ...shiftData }];

          const existingIdx = shiftArr.findIndex(r => r.teacher === currentUser);
          if (existingIdx !== -1) {
            shiftArr[existingIdx] = {
              ...shiftArr[existingIdx],
              student: record.student,
              location: record.location,
              status: record.statusStr
            };
          } else {
            shiftArr.push({
              teacher: currentUser,
              student: record.student,
              location: record.location,
              status: record.statusStr
            });
          }
          newData[record.date][record.shift] = shiftArr;
        });

        if (selectedTeam) {
          const cacheKey = `sungdong_schedule_${selectedTeam}`;
          safeJsonSetItem(cacheKey, newData);
        }

        return newData;
      });
    }
    setIsSubmitting(false);
    setIsSaveComplete(true);
  };

  const availableDates = useMemo(() => {
    return Object.keys(allScheduleData).sort();
  }, [allScheduleData]);

  const noNewScheduleToRepeat = useMemo(() => {
    if (isFetchingSchedule || isSyncing || isSubmitting) return null;
    const hasSpecialStudentToday = Object.values(logs || {}).some(log => {
      const s = (log?.student || '');
      return s.includes('직무교육') || s.includes('안전교육') || s.includes('간담회');
    });
    if (hasSpecialStudentToday) return "special_student_today";
    const currentData = allScheduleData[date] || {};
    const isCurrentFalse20Days = Object.values(currentData).some(shiftArr =>
      Array.isArray(shiftArr) && shiftArr.some(r => r.is_20days === false)
    );
    if (isCurrentFalse20Days) return "current_is_false_20days";
    const currentDayOfWeek = new Date(date).getDay();
    const targetDates = availableDates.filter(d => {
      if (d <= date || new Date(d).getDay() !== currentDayOfWeek) return false;
      if (isHoliday(d)) return false;
      const targetData = allScheduleData[d] || {};
      const hasFalse20Days = Object.values(targetData).some(shiftArr =>
        Array.isArray(shiftArr) && shiftArr.some(r => r.is_20days === false)
      );
      if (hasFalse20Days) return false;
      if (selectedTeam === '취업팀') return true;
      const hasSpecialEvent = Object.keys(targetData).some(shiftTime => {
        const original = getMyOriginalRecord(d, shiftTime);
        const student = (original?.student || "").trim();
        const location = (original?.location || "").trim();
        const combinedText = student + location;
        return combinedText.includes("공휴일") || combinedText.includes("간담회") || combinedText.includes("소양교육");
      });
      return !hasSpecialEvent;
    });
    if (targetDates.length === 0) return "no_future_dates";

    const hasDifference = targetDates.some(targetDate => {
      return shifts.some((shiftTime, i) => {
        const log = logs[i];
        const original = getMyOriginalRecord(targetDate, shiftTime);
        const isStudentDiff = (log.student || "") !== (original.student || "");
        const isLocationDiff = (log.location || "") !== (original.location || "");

        // --- 보조강사 일정 복제 방지 로직 일치화 ---
        const currentHasAssistant = (log.student || "").includes("보조강사");
        const originalHasAssistant = (original.student || "").includes("보조강사");
        if (currentHasAssistant && !originalHasAssistant) {
          return false; // 복제가 이루어지지 않을 것이므로 차이가 없는 것으로 취급
        }
        // ------------------------------------------

        return isStudentDiff || isLocationDiff;
      });
    });

    return !hasDifference ? "already_identical" : null;
  }, [date, availableDates, allScheduleData, logs, selectedTeam, isFetchingSchedule, isSyncing, isSubmitting, shifts, isHoliday]);

  const shouldRepeatPerShift = useMemo(() => {
    if (isFetchingSchedule || isSyncing || isSubmitting) return {};
    const hasSpecialStudentToday = Object.values(logs || {}).some(log => {
      const s = (log?.student || '');
      return s.includes('직무교육') || s.includes('안전교육') || s.includes('간담회');
    });
    if (hasSpecialStudentToday) return {};
    const currentData = allScheduleData[date] || {};
    const isCurrentFalse20Days = Object.values(currentData).some(shiftArr =>
      Array.isArray(shiftArr) && shiftArr.some(r => r.is_20days === false)
    );
    if (isCurrentFalse20Days) return {};
    const currentDayOfWeek = new Date(date).getDay();
    const targetDates = availableDates.filter(d => {
      if (d <= date || new Date(d).getDay() !== currentDayOfWeek) return false;
      if (isHoliday(d)) return false;
      const targetData = allScheduleData[d] || {};
      const hasFalse20Days = Object.values(targetData).some(shiftArr =>
        Array.isArray(shiftArr) && shiftArr.some(r => r.is_20days === false)
      );
      if (hasFalse20Days) return false;
      if (selectedTeam === '취업팀') return true;
      const hasSpecialEvent = Object.keys(targetData).some(shiftTime => {
        const original = getMyOriginalRecord(d, shiftTime);
        const student = (original?.student || "").trim();
        const location = (original?.location || "").trim();
        const combinedText = student + location;
        return combinedText.includes("공휴일") || combinedText.includes("간담회") || combinedText.includes("소양교육");
      });
      return !hasSpecialEvent;
    });

    const result = {};
    shifts.forEach((shiftTime, i) => {
      const log = logs[i];
      const student = (log?.student || "").trim();
      const location = (log?.location || "").trim();

      if (student.includes("안전교육") || student.includes("직무교육") || student.includes("간담회")) {
        result[i] = false;
        return;
      }

      const hasDiff = targetDates.some(targetDate => {
        const original = getMyOriginalRecord(targetDate, shiftTime);
        const isStudentDiff = student !== (original.student || "").trim();
        const isLocationDiff = location !== (original.location || "").trim();

        // --- 보조강사 일정 복제 방지 로직 일치화 ---
        const currentHasAssistant = student.includes("보조강사");
        const originalHasAssistant = (original.student || "").includes("보조강사");
        if (currentHasAssistant && !originalHasAssistant) {
          return false; // 복제가 이루어지지 않을 것이므로 차이가 없는 것으로 취급
        }
        // ------------------------------------------

        return isStudentDiff || isLocationDiff;
      });

      result[i] = hasDiff;
    });

    return result;
  }, [date, availableDates, allScheduleData, logs, isFetchingSchedule, isSyncing, isSubmitting, shifts, isHoliday]);

  const handleRepeatScheduleForShift = async (index) => {
    if (isDataLoading) return;
    const currentStudent = (logs[index]?.student || '');
    const hasSpecialStudentToday = Object.values(logs || {}).some(log => (log?.student || '').includes('간담회'));
    if (currentStudent.includes('안전교육') || currentStudent.includes('직무교육') || currentStudent.includes('간담회') || hasSpecialStudentToday) {
      setErrorMessage("⚠️ 간담회/교육 일정은 복제할 수 없습니다.");
      setTimeout(() => setErrorMessage(""), 3000);
      return;
    }

    const currentDayOfWeek = new Date(date).getDay();
    const targetDates = availableDates.filter(d => {
      if (d <= date || new Date(d).getDay() !== currentDayOfWeek) return false;
      if (isHoliday(d)) return false;
      const targetData = allScheduleData[d] || {};
      const hasFalse20Days = Object.values(targetData).some(shiftArr =>
        Array.isArray(shiftArr) && shiftArr.some(r => r.is_20days === false)
      );
      if (hasFalse20Days) return false;
      if (selectedTeam === '취업팀') return true;
      const hasSpecialEvent = Object.keys(targetData).some(shiftTime => {
        const original = getMyOriginalRecord(d, shiftTime);
        const student = (original?.student || "").trim();
        const location = (original?.location || "").trim();
        const combinedText = student + location;
        return combinedText.includes("공휴일") || combinedText.includes("간담회") || combinedText.includes("소양교육");
      });
      return !hasSpecialEvent;
    });

    if (targetDates.length === 0) {
      setErrorMessage("⚠️ 이후 동일한 요일의 날짜가 없습니다.");
      setTimeout(() => setErrorMessage(""), 3000);
      return;
    }

    let hasOriginalAssistantConflict = false;

    const validTargetDates = targetDates.filter(targetDate => {
      const currentLog = logs[index];
      const targetOriginal = getMyOriginalRecord(targetDate, shifts[index]);
      const isStudentDiff = (currentLog.student || "").trim() !== (targetOriginal.student || "").trim();
      const isLocationDiff = (currentLog.location || "").trim() !== (targetOriginal.location || "").trim();

      // --- 보조강사 일정 복제 방지 (마지막 날 이후 빈칸인 곳 복사 방지) ---
      const currentHasAssistant = (currentLog.student || "").includes("보조강사");
      const originalHasAssistant = (targetOriginal.student || "").includes("보조강사");
      if (currentHasAssistant && !originalHasAssistant) {
        return false; // 복제 건너뜀
      }
      // ------------------------------------------------------------------

      if (isStudentDiff || isLocationDiff) {
        if (originalHasAssistant) {
          hasOriginalAssistantConflict = true;
        }
      }

      return isStudentDiff || isLocationDiff;
    }).map(d => ({ date: d, times: [shifts[index]] }));

    if (validTargetDates.length === 0) {
      setErrorMessage(<span>⚠️ 이미 동일한 일정이 등록되어 있습니다.</span>);
      setTimeout(() => setErrorMessage(""), 3000);
      return;
    }

    if (hasOriginalAssistantConflict) {
      setAssistantConflictData({ mode: 'shift', validTargetDates, index });
      setShowAssistantConflictModal(true);
      return;
    }

    setRepeatMode('shift');
    setRepeatShiftIndex(index);
    setRepeatTargetDates(validTargetDates);
    setShowRepeatConfirm(true);
  };

  const executeRepeatScheduleForShiftFromModal = async () => {
    setShowRepeatConfirm(false);
    const index = repeatShiftIndex;
    const datesOnly = repeatTargetDates.map(d => d.date);

    const original = getMyOriginalRecord(date, shifts[index]);
    const log = logs[index];
    const originalStatus = formatStatusIfDate(original.status);
    const currentStatusStr = buildStatusString(log);

    const studentChanged = (log.student || "").trim() !== (original.student || "").trim();
    const locationChanged = (log.location || "").trim() !== (original.location || "").trim();
    const statusChanged = currentStatusStr !== originalStatus;

    if (studentChanged || locationChanged || statusChanged) {
      const saved = await performAutoSave();
      if (!saved) return;
    }

    executeRepeatScheduleForShift(index, datesOnly);
  };

  const executeRepeatScheduleForShift = async (index, targetDates) => {
    setIsSubmitting(true);
    setShowSavePopup(true);
    setIsSaveComplete(false);

    let allTasks = [];
    const shiftTime = shifts[index];
    const log = logs[index];

    targetDates.forEach((targetDate) => {
      if (isHoliday(targetDate)) return;
      const original = getMyOriginalRecord(targetDate, shiftTime);
      allTasks.push({
        id: `${targetDate}_${index}`,
        date: targetDate,
        shift: shiftTime,
        student: log.student || "",
        location: log.location || "",
        statusStr: original.status || "",
        index: index
      });
    });

    setSaveProgress(allTasks.map(t => {
      const mm = t.date.substring(5, 7);
      const dd = t.date.substring(8, 10);
      const dayName = getDayName(t.date);
      return {
        id: t.id,
        isRepeat: true,
        dateDisplay: `${mm}/${dd}(${dayName})`,
        timeDisplay: t.shift,
        student: t.student || "미입력",
        status: '대기 중'
      };
    }));

    const validRecords = [];
    const chunkSize = 3;

    for (let idx = 0; idx < allTasks.length; idx += chunkSize) {
      const chunkTasks = allTasks.slice(idx, idx + chunkSize);
      const chunkPromises = chunkTasks.map(async (task, chunkIdx) => {
        if (chunkIdx > 0) await new Promise(res => setTimeout(res, chunkIdx * 150));

        let location = task.location;

        for (let attempt = 1; attempt <= 5; attempt++) {
          try {
            setSaveProgress(prev => prev.map(item => item.id === task.id ? { ...item, status: attempt === 1 ? '저장 중...' : `재시도 중...(${attempt}/5)` } : item));

            const upsertPayload = {
              team: selectedTeam,
              log_date: task.date,
              teacher: currentUser,
              shift: task.shift,
              student: task.student || "",
              location: location || ""
            };

            const { error: upsertError } = await supabaseClient
              .from('daily_logs')
              .upsert(upsertPayload, { onConflict: 'team, log_date, teacher, shift' });

            if (upsertError) throw new Error("Supabase 저장 실패: " + upsertError.message);

            setSaveProgress(prev => prev.map(item => item.id === task.id ? { ...item, status: '저장 완료' } : item));
            return task;
          } catch (e) {
            if (attempt === 5) {
              setSaveProgress(prev => prev.map(item => item.id === task.id ? { ...item, status: '저장 실패' } : item));
              return null;
            } else {
              await new Promise(res => setTimeout(res, 1000 + Math.floor(Math.random() * 500)));
            }
          }
        }
        return null;
      });

      const resolvedChunk = await Promise.all(chunkPromises);
      resolvedChunk.forEach(record => { if (record !== null) validRecords.push(record); });
      if (idx + chunkSize < allTasks.length) await new Promise(res => setTimeout(res, 300));
    }

    if (validRecords.length > 0) {
      setAllScheduleData(prev => {
        const newData = { ...prev };
        validRecords.forEach(record => {
          if (!newData[record.date]) newData[record.date] = {};
          const shiftData = newData[record.date][record.shift] || [];
          let shiftArr = Array.isArray(shiftData) ? [...shiftData] : [{ teacher: currentUser, ...shiftData }];

          const existingIdx = shiftArr.findIndex(r => r.teacher === currentUser);
          if (existingIdx !== -1) {
            shiftArr[existingIdx] = {
              ...shiftArr[existingIdx],
              student: record.student,
              location: record.location,
              status: record.statusStr
            };
          } else {
            shiftArr.push({
              teacher: currentUser,
              student: record.student,
              location: record.location,
              status: record.statusStr
            });
          }
          newData[record.date][record.shift] = shiftArr;
        });

        if (selectedTeam) {
          const cacheKey = `sungdong_schedule_${selectedTeam}`;
          safeJsonSetItem(cacheKey, newData);
        }

        return newData;
      });
    }
    setIsSubmitting(false);
    setIsSaveComplete(true);
  };

  const minDate = availableDates.length > 0 ? availableDates[0] : "";
  const maxDate = availableDates.length > 0 ? availableDates[availableDates.length - 1] : "";

  useEffect(() => {
    if (availableDates.length === 0) return;
    if (isFetchingSchedule || isSyncing) return;

    const todayStr = getInitialWeekday();
    if (date === todayStr) return;

    if (!availableDates.includes(date)) {
      const futureDates = availableDates.filter(d => d > date);
      if (futureDates.length > 0) setDate(futureDates[0]);
      else {
        const pastDates = availableDates.filter(d => d < date);
        if (pastDates.length > 0) setDate(pastDates[pastDates.length - 1]);
      }
    }
  }, [availableDates, date, isFetchingSchedule, isSyncing]);

  const handlePrevDay = async () => {
    if (isDataLoading) return;
    if (!(await performAutoSave())) return;
    const pastDates = availableDates.filter(d => d < date);
    if (pastDates.length > 0) setDate(pastDates[pastDates.length - 1]);
    else {
      setErrorMessage("⚠️ 이전 근무 기록이 없습니다.");
      setTimeout(() => setErrorMessage(""), 2000);
    }
  };

  const handleNextDay = async () => {
    if (isDataLoading) return;
    if (!(await performAutoSave())) return;
    const futureDates = availableDates.filter(d => d > date);
    if (futureDates.length > 0) setDate(futureDates[0]);
    else {
      setErrorMessage("⚠️ 이후 근무 기록이 없습니다.");
      setTimeout(() => setErrorMessage(""), 2000);
    }
  };

  const handleTodayClick = async () => {
    if (isDataLoading) return;
    if (!(await performAutoSave())) return;
    const todayStr = getInitialWeekday();
    setDate(todayStr);
  };

  const handleDateChange = async (e) => {
    const s = e.target.value;
    if (!s || isDataLoading) return;
    if (!(await performAutoSave())) return;

    if (availableDates.length > 0) {
      if (s < minDate || s > maxDate || !availableDates.includes(s)) {
        let targetDate = s;
        if (s < minDate) targetDate = minDate;
        else if (s > maxDate) targetDate = maxDate;

        if (!availableDates.includes(targetDate)) {
          const futureDates = availableDates.filter(d => d > targetDate);
          if (futureDates.length > 0) targetDate = futureDates[0];
          else {
            const pastDates = availableDates.filter(d => d < targetDate);
            if (pastDates.length > 0) targetDate = pastDates[pastDates.length - 1];
          }
        }

        setErrorMessage(`⚠️ 해당 날짜는 시트에 정의되지 않았습니다. (${attachRoEuro(targetDate)} 이동합니다)`);
        setTimeout(() => setErrorMessage(""), 3000);
        setDate(targetDate);
        return;
      }
    }

    const d = new Date(s);
    if (d.getDay() === 0 || d.getDay() === 6) { setErrorMessage("⚠️ 주말(토, 일요일)은 선택할 수 없습니다."); setTimeout(() => setErrorMessage(""), 3000); return; }
    setErrorMessage(""); setDate(s);
  };


  const snapshotCardForUndo = (index) => {
    const currentCard = logs[index];
    if (!currentCard) return;
    setUndoLogs(prev => (
      prev[index]
        ? prev
        : { ...prev, [index]: JSON.parse(JSON.stringify(currentCard)) }
    ));
  };

  const handleConfirmClearCard = () => {
    if (clearConfirmIndex === null) return;
    const idx = clearConfirmIndex;
    const currentCard = logs[idx] || { student: "", location: "", selectedTags: [[]], memo: "" };
    setUndoLogs(prev => ({ ...prev, [idx]: JSON.parse(JSON.stringify(currentCard)) }));
    setLogs(prev => ({
      ...prev,
      [idx]: {
        ...prev[idx],
        student: "",
        location: "",
        selectedTags: [[]],
        memo: "",
        ...(prev[idx]?.headcount !== undefined ? { headcount: "" } : {})
      }
    }));
    const backupKey = `log_backup_${selectedTeam}_${currentUser}_${date}_${idx}`;
    removeSavedItem(backupKey);
    if (validationErrorIndex === idx) setValidationErrorIndex(null);
    setClearConfirmIndex(null);
  };

  const handleUndoCard = (index) => {
    const savedSnapshot = undoLogs[index];
    if (!savedSnapshot) return;
    setLogs(prev => ({ ...prev, [index]: JSON.parse(JSON.stringify(savedSnapshot)) }));
    const backupKey = `log_backup_${selectedTeam}_${currentUser}_${date}_${index}`;
    if (savedSnapshot.memo && savedSnapshot.memo.trim() !== "") {
      setSavedItem(backupKey, savedSnapshot.memo);
    } else {
      removeSavedItem(backupKey);
    }
    setUndoLogs(prev => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
    if (validationErrorIndex === index) setValidationErrorIndex(null);
  };

  const handleLogChange = (index, field, value) => {
    snapshotCardForUndo(index);
    setLogs(prev => ({
      ...prev,
      [index]: {
        ...prev[index],
        [field]: value,
        ...(field === 'memo' || field === 'headcount' ? { isFromSibling: false } : {})
      }
    }));

    if (validationErrorIndex === index) setValidationErrorIndex(null);

    if (field === 'memo') {
      const backupKey = `log_backup_${selectedTeam}_${currentUser}_${date}_${index}`;
      if (value && value.trim() !== "") {
        setSavedItem(backupKey, value);
      } else {
        removeSavedItem(backupKey);
      }
    }
  };

  const syncSiblingStatus = (index, newStudentName) => {
    const cleanMyStudent = newStudentName.trim();
    if (!cleanMyStudent) return;

    setLogs(prev => {
      const currentLog = prev[index] || {};
      const currentTags = currentLog.selectedTags || [[]];
      const currentMemo = currentLog.memo || "";
      const hasAnyTag = currentTags.some(tags => tags && tags.length > 0);
      const hasMemo = currentMemo.trim() !== "";

      if (hasAnyTag || hasMemo) return prev;

      const shift = shifts[index];
      const todaysData = allScheduleData[date] || {};
      const rawList = todaysData[shift] || [];
      const list = Array.isArray(rawList) ? rawList : [{ teacher: currentUser, ...rawList }];
      const myGroup = getTeacherGroup(selectedTeam, currentUser, dbTeachers);

      const siblingRecord = list.find(r => {
        if (r.teacher === currentUser) return false;
        const myStudents = cleanMyStudent.split(/[/,]/).map(s => s.trim()).filter(Boolean).sort().join('/');
        const theirStudents = (r.student || "").split(/[/,]/).map(s => s.trim()).filter(Boolean).sort().join('/');
        if (theirStudents !== myStudents) return false;
        const siblingGroup = getTeacherGroup(selectedTeam, r.teacher, dbTeachers);
        if (siblingGroup !== myGroup) return false;
        const siblingStatus = mergeAttendanceAndStatus(r.attendance, formatStatusIfDate(r.status)) || "";
        if (siblingStatus.includes("선생님휴가")) return false;
        return siblingStatus.replace(/\u200B/g, '').trim() !== "";
      });

      if (siblingRecord) {
        const statusStr = mergeAttendanceAndStatus(siblingRecord.attendance, formatStatusIfDate(siblingRecord.status)) || "";
        const { loadedTags, loadedMemo, loadedHeadcount } = parseStatusString(statusStr, cleanMyStudent);

        const newLogs = { ...prev };
        newLogs[index] = {
          ...currentLog,
          selectedTags: loadedTags,
          memo: loadedMemo,
          isFromSibling: true
        };
        if (loadedHeadcount) {
          newLogs[index].headcount = loadedHeadcount;
        }

        if (loadedMemo.trim() !== "") {
          const backupKey = `log_backup_${selectedTeam}_${currentUser}_${date}_${index}`;
          setSavedItem(backupKey, loadedMemo);
        }

        return newLogs;
      }
      return prev;
    });
  };

  const toggleTag = (index, sIdx, tag) => {
    const now = Date.now();
    const lastClick = lastTagClickRef.current;
    if (lastClick.index === index && lastClick.sIdx === sIdx && lastClick.tag === tag && now - lastClick.time < 400) return;

    lastTagClickRef.current = { time: now, index, sIdx, tag };
    snapshotCardForUndo(index);

    setLogs(prev => {
      const newLogs = { ...prev };
      const log = { ...newLogs[index], isFromSibling: false };
      const studentNames = (log.student || "").split(/[/,]/).map(s => s.trim()).filter(s => s.length > 0);
      const maxRows = Math.max(1, studentNames.length);
      let currentTagsArray = [...(log.selectedTags || [])];
      while (currentTagsArray.length < maxRows) currentTagsArray.push([]);

      const exclusiveTags = ['출석', '결석'];

      if (tag === '선생님휴가') {
        const isAnySelected = currentTagsArray.some(tags => tags.includes('선생님휴가'));
        if (isAnySelected) {
          currentTagsArray = currentTagsArray.map(tags => tags.filter(t => t !== '선생님휴가'));
        } else {
          currentTagsArray = currentTagsArray.map(tags => {
            let newTags = [...tags];
            if (!newTags.includes('선생님휴가')) newTags.push('선생님휴가');
            return newTags;
          });
        }
      } else {
        let newTags = [...(currentTagsArray[sIdx] || [])];
        if (newTags.includes(tag)) {
          newTags = newTags.filter(t => t !== tag);
        } else {
          if (exclusiveTags.includes(tag)) newTags = newTags.filter(t => !exclusiveTags.includes(t));
          newTags.push(tag);
        }
        currentTagsArray[sIdx] = newTags;
      }

      log.selectedTags = currentTagsArray;
      newLogs[index] = log;
      return newLogs;
    });
  };

  const handleLogin = (e) => {
    if (e) e.preventDefault();
    if (!isLoginReady) return;

    if (currentUser) {
      if (getRoomPopupMode() !== 'always') {
        try {
          window.__sungdong_initial_room_popup_shown = true;
          window.sessionStorage.setItem('sungdong_room_popup_session_done', 'true');
        } catch (_) { }
      }
      const todayStr = getInitialWeekday();
      setDate(todayStr);
      isLoggedInRef.current = true;
      setIsLoggedIn(true);
      window.history.pushState({ view: 'main', subView: 'logWrite' }, '', window.location.href);
      setRefreshTrigger(prev => prev + 1);
    }
  };

  const handleMainTouchStart = (e) => {
    const scrollTop = mainMenuScrollRef.current?.scrollTop ?? window.scrollY ?? 0;
    if (scrollTop > 2) {
      mainTouchStartX.current = null;
      mainTouchStartY.current = null;
      setPullDistance(0);
      return;
    }
    mainTouchStartX.current = e.touches[0].clientX;
    mainTouchStartY.current = e.touches[0].clientY;
    setPullDistance(0);
  };

  const handleMainTouchMove = (e) => {
    if (mainTouchStartX.current === null || mainTouchStartY.current === null) return;
    const touchEndX = e.touches[0].clientX;
    const touchEndY = e.touches[0].clientY;
    const deltaX = touchEndX - mainTouchStartX.current;
    const deltaY = touchEndY - mainTouchStartY.current;

    if (deltaY > 40 && deltaY > Math.abs(deltaX) * 2.5) setPullDistance(Math.min(deltaY, 500));
    else setPullDistance(0);
  };

  const handleMainTouchEnd = (e) => {
    if (mainTouchStartX.current === null || mainTouchStartY.current === null) return;
    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;
    const deltaX = touchEndX - mainTouchStartX.current;
    const deltaY = touchEndY - mainTouchStartY.current;

    if (deltaY > 420 && deltaY > Math.abs(deltaX) * 2.5) window.location.reload();
    else setPullDistance(0);
    mainTouchStartX.current = null;
    mainTouchStartY.current = null;
  };

  const mainMenuScrollRef = useRef(null);

  const handleMainScroll = (e) => {
    try {
      window.sessionStorage.setItem('sungdong_main_menu_scroll', String(e.currentTarget.scrollTop));
    } catch (err) { }
  };

  useLayoutEffect(() => {
    if (!isLoggedIn && mainMenuScrollRef.current) {
      try {
        const savedScroll = parseInt(window.sessionStorage.getItem('sungdong_main_menu_scroll') || '0', 10);
        if (savedScroll > 0) {
          mainMenuScrollRef.current.scrollTop = savedScroll;
          requestAnimationFrame(() => {
            if (mainMenuScrollRef.current && mainMenuScrollRef.current.scrollTop !== savedScroll) {
              mainMenuScrollRef.current.scrollTop = savedScroll;
            }
          });
        }
      } catch (err) { }
    }
  }, [isLoggedIn]);

  if (!isLoggedIn) {
    return (
      <div
        ref={mainMenuScrollRef}
        onScroll={handleMainScroll}
        className="fixed inset-0 overflow-y-auto overflow-x-hidden bg-transparent flex flex-col items-center sm:py-10"
        onTouchStart={handleMainTouchStart}
        onTouchMove={handleMainTouchMove}
        onTouchEnd={handleMainTouchEnd}
      >
        <div
          className="absolute left-0 right-0 flex items-center justify-center pointer-events-none z-50 pt-safe-4"
          style={{
            transform: `translateY(${pullDistance > 40 ? (pullDistance * 0.35) : -50}px)`,
            opacity: pullDistance > 40 ? Math.min((pullDistance - 40) / 380, 1) : 0,
            transition: pullDistance === 0 ? 'all 0.3s ease-out' : 'none'
          }}
        >
          <div className="flex items-center justify-center bg-white shadow-lg border border-sky-200 p-3 rounded-full">
            <RefreshCw className={`w-8 h-8 ${pullDistance > 420 ? 'text-blue-600 animate-spin' : 'text-gray-400'}`} />
          </div>
        </div>

        <div
          className="main-menu-surface relative flex flex-col flex-1 sm:flex-none w-full max-w-md sm:max-w-[600px] md:max-w-[680px] lg:max-w-[1020px] sm:backdrop-blur-xl px-2.5 pb-4 pt-safe-4 sm:px-5 sm:pb-6 sm:pt-safe-5 sm:rounded-[28px] sm:shadow-xl sm:ring-1 sm:ring-gray-900/5 sm:min-h-[600px] shrink-0 sm:my-auto animate-fadeIn"
          style={{
            transform: `translateY(${pullDistance * 0.1}px)`,
            transition: pullDistance === 0 ? 'transform 0.3s ease-out' : 'none'
          }}
        >
          <button
            type="button"
            onClick={openSettingsModal}
            className="safe-top-btn absolute right-2.5 sm:right-5 z-20 p-2 rounded-full bg-white/90 hover:bg-white text-slate-600 ring-1 ring-slate-200/90 shadow-sm active:scale-95 transition-all touch-manipulation"
            aria-label="설정"
            title="앱 설정"
          >
            <Settings className="w-5 h-5 sm:w-[22px] sm:h-[22px]" />
          </button>

          <div className="text-center mb-3.5 sm:mb-5 shrink-0 mt-2 sm:mt-1 px-9 sm:px-12">
            <div className="flex items-center justify-center gap-2 sm:gap-3 mb-1 sm:mb-1.5">
              <img
                src="/Logo_of_Seoul.jpg"
                alt="서울시 로고"
                className="h-[30px] min-[390px]:h-[33px] sm:h-[42px] md:h-[46px] object-contain mix-blend-multiply shrink-0 relative -top-[1px] sm:-top-[2px]"
                onError={(e) => e.target.style.display = 'none'}
              />
              <h1 className="text-[23px] min-[390px]:text-[26px] sm:text-[38px] md:text-[42px] leading-[1.1] font-extrabold tracking-[-0.035em] bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-600 bg-clip-text text-transparent whitespace-nowrap">
                성동노인종합복지관
              </h1>
            </div>
            <h2 className="inline-flex items-center justify-center gap-1.5 sm:gap-2 px-1 py-0.5 text-[clamp(13px,3.8vw,16px)] sm:text-[18px] md:text-[19px] font-bold text-slate-700 whitespace-nowrap tracking-tight">
              <span className="inline-flex items-center gap-1 sm:gap-1.5">
                <span className="text-blue-700 font-extrabold">2027</span>
                <span>디지털교육 서포터즈</span>
                <span className="text-slate-600 font-bold">·</span>
                <span className="text-blue-700 font-extrabold">업무일지</span>
              </span>
            </h2>
          </div>

          <div className="flex flex-col gap-3 sm:gap-4 shrink-0 w-full">
            <style>{`
              @keyframes shineText {
                0% { background-position: 100% 0; }
                100% { background-position: 0% 0; }
              }
              .shine-text-normal {
                background: linear-gradient(120deg, #4338ca 40%, #a5b4fc 50%, #4338ca 60%);
                background-size: 300% 100%;
                color: transparent !important;
                -webkit-background-clip: text;
                background-clip: text;
                animation: shineText 2.5s linear infinite;
                display: inline;
              }
              .shine-text-top {
                background: linear-gradient(120deg, #7f1d1d 40%, #ffaaaa 50%, #7f1d1d 60%);
                background-size: 300% 100%;
                color: transparent !important;
                -webkit-background-clip: text;
                background-clip: text;
                animation: shineText 2.5s linear infinite;
                display: inline;
              }
              @keyframes gentleTwinkle {
                0%, 100% {
                  transform: scale(1) rotate(0deg);
                  filter: drop-shadow(0 2px 7px rgba(244, 63, 94, 0.35));
                }
                50% {
                  transform: scale(1.08) rotate(3deg);
                  filter: drop-shadow(0 4px 12px rgba(99, 102, 241, 0.45));
                }
              }
              .sparkle-twinkle {
                animation: gentleTwinkle 3s ease-in-out infinite;
                transform-origin: center;
              }
            `}</style>
            {/* 오늘 날짜 + 날씨 */}
            <div className="flex items-center justify-between gap-2 px-1 -mb-1">
              <span className="text-[15px] sm:text-[17px] font-bold text-gray-700 tracking-tight whitespace-nowrap">
                {new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })}
              </span>
              {!weatherData ? (
                <span className="text-[14px] sm:text-[15px] text-gray-600 font-medium">날씨 불러오는 중…</span>
              ) : weatherData.error ? (
                <span className="text-[14px] sm:text-[15px] text-gray-600 font-medium truncate">날씨 정보 준비 중</span>
              ) : (
                <button
                  type="button"
                  className="flex items-center gap-1.5 hover:opacity-80 active:scale-95 transition-all bg-white px-2.5 py-1 rounded-full ring-1 ring-gray-200 shadow-sm"
                  onClick={() => window.open('https://weather.naver.com', '_blank')}
                  title="네이버 날씨로 이동"
                >
                  <span className={`text-[14px] sm:text-[15px] font-bold tracking-tight whitespace-nowrap ${weatherData.isRain ? 'text-blue-600' : 'text-gray-600'}`}>
                    {weatherData.isTomorrow ? '내일 ' : ''}{weatherData.weatherDesc}
                  </span>
                  <span className="text-gray-300 text-[12px]">|</span>
                  <span className="text-[14px] sm:text-[15px] font-bold text-gray-600 whitespace-nowrap">
                    {weatherData.minTemp}° / <span className="text-rose-500">{weatherData.maxTemp}°</span>
                  </span>
                </button>
              )}
            </div>

            {/* 공지사항 */}
            <div className="animate-fadeIn w-full">
              <div className="bg-white border border-slate-300 rounded-[1.25rem] px-3.5 sm:px-5 py-3.5 sm:py-4 shadow-[0_2px_8px_-2px_rgba(15,23,42,0.08),0_1px_3px_0_rgba(15,23,42,0.04)] overflow-hidden text-left touch-pan-y touch-pinch-zoom">
                <button
                  type="button"
                  className="flex items-center gap-2 sm:gap-2.5 w-full text-left group"
                  onClick={() => onNavigateToNoticeManagement()}
                >
                  <span className="bg-rose-500 p-1.5 rounded-lg shrink-0 shadow-sm shadow-rose-500/30 text-white">
                    <IconMegaphone className="w-4 h-4 sm:w-5 sm:h-5" />
                  </span>
                  <span className="font-extrabold text-[17.5px] sm:text-[20px] leading-tight text-slate-900 tracking-tight">공지사항</span>
                  <span className="ml-auto flex items-center gap-0.5 text-[14px] sm:text-[15px] font-bold text-slate-500 group-hover:text-blue-600 transition-colors whitespace-nowrap">
                    전체 보기 <IconChevronRight className="w-4 h-4" />
                  </span>
                </button>
                {todayNotices.length > 0 ? (
                  <div
                    className="space-y-1.5 sm:space-y-2 w-full min-w-0 mt-2.5 max-h-[132px] sm:max-h-[150px] overflow-y-auto overscroll-contain touch-pan-y touch-pinch-zoom pr-1"
                    onTouchStart={(e) => e.stopPropagation()}
                    onTouchMove={(e) => e.stopPropagation()}
                    onTouchEnd={(e) => e.stopPropagation()}
                  >
                    {todayNotices.map((notice, idx) => {
                      const todayStr = getLocalDateString(new Date());
                      const startStr = notice.start_date ? notice.start_date.substring(0, 10) : '';
                      const isToday = startStr === todayStr;
                      const diffDays = startStr ? Math.floor((new Date(todayStr) - new Date(startStr)) / (1000 * 60 * 60 * 24)) : 999;
                      const isNewNotice = diffDays >= 0 && diffDays <= 2;
                      const textClass = notice.is_top ? 'text-rose-800' : 'text-slate-800';
                      const rawTitle = notice.title || '';
                      const datePrefixMatch = rawTitle.match(/^(\d{1,2}\/\d{1,2}(?:\([^)]+\))?(?:\s*~\s*\d{1,2}\/\d{1,2}(?:\([^)]+\))?)?)(.*)$/);
                      return (
                        <p
                          key={idx}
                          className={`${isToday || notice.is_top ? 'font-bold' : 'font-medium'} text-[15px] min-[380px]:text-[16px] sm:text-[17px] leading-snug tracking-tight line-clamp-2 break-keep w-full block cursor-pointer hover:underline hover:opacity-80 active:scale-[0.99] transition-all`}
                          onClick={async (e) => {
                            e.stopPropagation();
                            const { data } = await supabaseClient.from('notices').select('*').eq('id', notice.id).single();
                            onNavigateToNoticeManagement(data || notice);
                          }}
                        >
                          <span className={textClass}>
                            {notice.is_top ? '📌 ' : '· '}
                            {datePrefixMatch ? (
                              <>
                                <strong className="font-extrabold text-slate-950">{datePrefixMatch[1]}</strong>
                                {datePrefixMatch[2]}
                              </>
                            ) : rawTitle}
                          </span>
                          {isNewNotice && <span className="inline-block align-middle ml-1.5 px-1.5 py-px rounded-md bg-rose-500 text-white text-[11px] sm:text-[12px] font-bold tracking-normal">NEW</span>}
                        </p>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-2 text-[14.5px] sm:text-[16px] text-slate-500 font-semibold">오늘 표시할 공지가 없습니다.</p>
                )}
              </div>
            </div>

            {/* 팀/선생님 선택 및 일지 작성하기 박스 */}
            <div className="bg-white border border-slate-300 rounded-[1.25rem] sm:rounded-[1.5rem] p-3.5 sm:p-5 shadow-[0_4px_16px_-4px_rgba(15,23,42,0.08),0_2px_6px_-1px_rgba(0,0,0,0.04)] flex flex-col gap-3 sm:gap-3.5 w-full">
              {selectedTeam && currentUser && !isEditingProfile ? (
                <div className="flex items-center justify-between gap-2.5 px-3.5 py-3 rounded-2xl bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-300 shadow-xs">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="px-3 py-1 rounded-xl bg-blue-600 text-white text-[14px] sm:text-[15px] font-black shadow-xs shrink-0">
                      {selectedTeam}
                    </span>
                    <div className="flex items-baseline gap-1 min-w-0 truncate">
                      <span className="text-[20px] sm:text-[23px] font-black text-blue-950 tracking-tight truncate">
                        {currentUser.replace(/\n/g, ' ')}
                      </span>
                      <span className="text-[15px] sm:text-[17px] font-bold text-slate-700 shrink-0">
                        선생님
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsEditingProfile(true)}
                    className="px-3 py-1.5 rounded-xl border border-blue-200 bg-white hover:bg-blue-50 text-blue-700 text-[13.5px] font-extrabold shrink-0 active:scale-95 transition shadow-2xs touch-manipulation"
                  >
                    변경
                  </button>
                </div>
              ) : (
                <div className={`grid ${selectedTeam ? 'grid-cols-2' : 'grid-cols-1'} gap-2.5 sm:gap-3.5 w-full`}>
                  <div className="w-full min-w-0">
                    <label className="flex items-center gap-1.5 sm:gap-2 text-slate-800 font-extrabold mb-1.5 sm:mb-2 text-[15.5px] sm:text-xl tracking-tight whitespace-nowrap"><StepBadge n={1} done={!!selectedTeam} />팀 선택</label>
                    <select className={`w-full select-refined h-[50px] sm:h-[58px] md:h-[62px] px-3 sm:px-4 border-2 rounded-2xl text-[17px] sm:text-2xl tracking-tight ${selectedTeam ? 'bg-slate-50 border-slate-400 text-slate-900 font-extrabold' : 'bg-white border-slate-300 text-slate-600 font-bold'} outline-none shadow-sm transition-colors focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15 cursor-pointer`} value={selectedTeam} onChange={(e) => {
                      setSelectedTeam(e.target.value);
                      setCurrentUser("");
                      setIsEditingProfile(true);
                    }}>
                      <option value="">팀을 선택하세요</option>
                      {teamList.map(team => <option key={team} value={team}>{team}</option>)}
                    </select>
                  </div>
                  {selectedTeam && (
                    <div className="w-full min-w-0">
                      <label className="text-slate-800 font-extrabold mb-1.5 sm:mb-2 text-[15.5px] sm:text-xl tracking-tight flex justify-between items-end gap-1">
                        <span className="flex items-center gap-1.5 sm:gap-2 whitespace-nowrap"><StepBadge n={2} done={!!currentUser} />선생님 선택</span>
                        {isFetchingTeachers && <span className="text-[12px] sm:text-base text-slate-600 font-bold flex items-center mb-0.5 animate-pulse whitespace-nowrap"><Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-0.5 sm:mr-1 animate-spin" />불러오는 중</span>}
                      </label>
                      <select className={`w-full select-refined h-[50px] sm:h-[58px] md:h-[62px] px-3 sm:px-4 border-2 rounded-2xl text-[17px] sm:text-2xl tracking-tight ${currentUser ? 'bg-slate-50 border-slate-400 text-slate-900 font-extrabold' : 'bg-white border-slate-300 text-slate-600 font-bold'} outline-none shadow-sm transition-colors focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15 cursor-pointer disabled:opacity-60`} value={currentUser} onChange={(e) => {
                        setCurrentUser(e.target.value);
                        if (e.target.value) setIsEditingProfile(false);
                      }} disabled={isFetchingTeachers}>
                        <option value="">선생님 선택</option>
                        {teachers.map(name => <option key={name} value={name}>{name.replace(/\n/g, ' ')}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              )}

              {selectedTeam && currentUser && todaySummary && todaySummary.total > 0 && (
                <div className="flex flex-col gap-2 px-3.5 py-3 rounded-xl bg-blue-50/70 border border-blue-200/80 text-left">
                  <div className="flex items-center justify-between gap-2 text-[17px] sm:text-[18px] font-extrabold">
                    <span className="text-slate-800">
                      오늘 내 수업 <span className="text-blue-700">{todaySummary.total}건</span>
                    </span>
                    {todaySummary.pending > 0 ? (
                      <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300 text-[14.5px] sm:text-[15.5px] font-extrabold">
                        미입력 {todaySummary.pending}건
                      </span>
                    ) : (
                      <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 text-[14.5px] sm:text-[15.5px] font-extrabold">
                        모두 입력 완료
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {todaySummary.items.map((item, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={handleLogin}
                        disabled={!isLoginReady}
                        className={`w-full px-3 py-1.5 rounded-lg text-[15.5px] sm:text-[16.5px] font-bold border transition active:scale-[0.99] text-left flex items-center justify-between gap-2 ${item.isPending
                          ? 'bg-white border-amber-300 text-amber-900'
                          : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                          }`}
                        title={`${item.shift.split('~')[0]} ${item.student}`}
                      >
                        <span className="truncate">{item.shift.split('~')[0]} {item.student}</span>
                        <span className={`text-[12.5px] sm:text-[13px] font-extrabold shrink-0 ${item.isPending ? 'text-amber-600' : 'text-emerald-600'}`}>
                          {item.isPending ? '미입력' : '완료'}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

                            <div className="pt-0.5 sm:pt-1 flex">
                              {!isLoginReady ? (
                                <div className="flex-1 flex items-center justify-center w-full rounded-2xl text-[clamp(17px,4.6vw,21px)] tracking-tight font-extrabold text-slate-400 bg-slate-200/90 border border-slate-300 cursor-not-allowed select-none min-h-[58px] sm:min-h-[64px]">
                                  {isFetchingSchedule ? <><Clock className="w-6 h-6 sm:w-8 sm:h-8 lg:w-7 lg:h-7 mr-2 animate-spin text-blue-600" /> 데이터 확인 중...</> : <><EditIcon className="w-6 h-6 sm:w-8 sm:h-8 lg:w-7 lg:h-7 mr-2" /> 일지 작성하기</>}
                                </div>
                              ) : (
                                <button onClick={handleLogin} className="flex-1 flex items-center justify-center w-full rounded-2xl text-[clamp(18px,4.8vw,22px)] tracking-tight font-extrabold text-white bg-gradient-to-r from-blue-600 to-indigo-600 ring-1 ring-inset ring-blue-700/20 hover:from-blue-700 hover:to-indigo-700 active:scale-[0.98] transition-all shadow-lg shadow-blue-600/30 touch-manipulation min-h-[58px] sm:min-h-[64px]">
                                  <EditIcon className="w-6 h-6 sm:w-8 sm:h-8 lg:w-7 lg:h-7 mr-2" /> 일지 작성하기
                                </button>
                              )}
                            </div>
                          </div>
          </div>

                      <div className="menu-backdrop flex-1 flex flex-col min-h-[180px] mt-5 sm:mt-6">
                        <MenuGroup title="일정">
                          <MenuRow
                            disabled={!selectedTeam || !currentUser}
                            onClick={() => {
                              if (!selectedTeam || !currentUser) {
                                setErrorMessage("팀과 선생님을 먼저 선택해주세요.");
                                setTimeout(() => setErrorMessage(""), 3000);
                                return;
                              }
                              onNavigateToMyWeeklySchedule();
                            }}
                            icon={<CalendarIcon />}
                            chipColor="chip-blue"
                            label="나의 주간 일정"
                            desc={(!selectedTeam || !currentUser) ? (errorMessage || "팀과 선생님을 먼저 선택하세요") : "이번 주 내 수업 일정"}
                          />
                          <MenuRow
                            onClick={() => { window.sessionStorage.removeItem('sungdong_daily_schedule_date'); onNavigateToDailySchedule(selectedTeam || '1팀'); }}
                            icon={<CalendarClockIcon />}
                            chipColor="chip-emerald"
                            label="팀별 오늘 일정"
                            desc="팀별 오늘 수업과 출결"
                          />
                          <MenuRow
                            onClick={() => { window.sessionStorage.removeItem('sungdong_daily_schedule_date'); onNavigateToTeamSchedule(selectedTeam || '1팀'); }}
                            icon={<CalendarDaysIcon />}
                            chipColor="chip-indigo"
                            label="전체 일정 보기"
                            desc="월별 전체 일정 · 엑셀 다운로드"
                          />
                        </MenuGroup>

                        <MenuGroup title="대상자">
                          <MenuRow
                            onClick={onNavigateToStudentSearch}
                            icon={<IconSearchUser />}
                            chipColor="chip-amber"
                            label="대상자 검색"
                            desc="이름·초성으로 수업 기록 찾기"
                          />
                          <MenuRow
                            disabled={!selectedTeam || !currentUser}
                            onClick={() => {
                              if (!selectedTeam || !currentUser) {
                                setErrorMessage("팀과 선생님을 먼저 선택해주세요.");
                                setTimeout(() => setErrorMessage(""), 3000);
                                return;
                              }
                              onNavigateToStudentFormsAdmin({
                                team: selectedTeam,
                                teacher: currentUser,
                                isAdminMode: false
                              });
                            }}
                            icon={<IconDocumentCheck />}
                            chipColor="chip-blue"
                            label="참여자 서류 관리"
                            desc={(!selectedTeam || !currentUser) ? (errorMessage || "팀과 선생님을 먼저 선택하세요") : "학생별 서류 작성 현황 파악"}
                          />
                          <MenuRow
                            onClick={onNavigateToClassApplicants}
                            icon={<IconPeople />}
                            chipColor="chip-teal"
                            label="수업 희망자 관리"
                            desc="신규 수업 신청 · 조 배정 현황"
                          />
                        </MenuGroup>

                        <section className="menu-group">
                          <h3 className="menu-group-title">교육실 현황</h3>
                          <div className="menu-tiles">
                            <MenuTile
                              onClick={() => { handleLogout(); onNavigateToClassroom(); }}
                              icon={<IconClassroom />}
                              chipColor="chip-sky"
                              label="평생교육실2"
                            />
                            <MenuTile
                              onClick={() => { handleLogout(); onNavigateToNangmanStudio(); }}
                              icon={<IconStudio />}
                              chipColor="chip-pink"
                              label="낭만스튜디오"
                            />
                          </div>
                        </section>

                        <MenuGroup title="서포터즈 도구">
                          <MenuRow
                            onClick={() => { handleLogout(); onNavigateToNameCard(); }}
                            icon={<IconNameCard />}
                            chipColor="chip-indigo"
                            label="명함 만들기"
                            desc="디지털교육서포터즈 명함 제작"
                          />
                        </MenuGroup>

                        {hasAdminPassword && (
                          <MenuGroup title="관리자 메뉴">
                            <MenuRow
                              variant="admin"
                              chipColor="chip-emerald"
                              onClick={() => { handleLogout(); onNavigateToStudentFormsAdmin({ isAdminMode: true }); }}
                              icon={<IconDocumentCheck />}
                              label={
                                <>
                                  참여자 서류 관리ㆍ인쇄<br />
                                </>
                              }
                            />
                            <MenuRow
                              variant="admin"
                              chipColor="chip-blue"
                              onClick={() => { handleLogout(); onNavigateToTeacherManagement(); }}
                              icon={<IconPeople />}
                              label="선생님 명단 관리"
                            />
                            <MenuRow
                              variant="admin"
                              chipColor="chip-rose"
                              onClick={() => { handleLogout(); onNavigateToHolidayManagement(); }}
                              icon={<IconCalendarStar />}
                              label="공휴일ㆍ휴무일 관리"
                            />
                            <MenuRow
                              variant="admin"
                              chipColor="chip-purple"
                              onClick={() => { handleLogout(); onNavigateToAutoSchedule(); }}
                              icon={<IconTimetable />}
                              label="시간표 작성"
                            />
                          </MenuGroup>
                        )}

                        <div className="mt-4 sm:mt-5 text-center text-[12px] text-gray-600 font-semibold tracking-wider select-none" aria-hidden="true">
                          v261117-rebuild
                        </div>
                      </div>
                    </div>

                    {/* 시간·팀 조건별 교육실 사용현황 자동 안내 팝업 */}
                    {roomStatusPopup && (
                      <div
                        className="fixed inset-0 bg-slate-900/50 backdrop-blur-[3px] flex items-center justify-center z-[70] p-3 sm:p-4"
                        onClick={() => closeRoomStatusPopup(false)}
                      >
                        <div
                          className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[86vh] animate-fadeIn border border-slate-200"
                          onClick={e => e.stopPropagation()}
                        >
                          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-4 py-3.5 flex items-center justify-between shrink-0">
                            <div>
                              <div className="flex items-center gap-2">
                                <h3 className="font-extrabold text-[17px] sm:text-[19px] tracking-tight">오늘의 교육실 사용현황</h3>
                                <span className="px-2 py-0.5 rounded-full bg-white/20 text-[12px] font-bold whitespace-nowrap">{roomStatusPopup.teamLabel}</span>
                              </div>
                              <p className="text-blue-100 text-[13px] sm:text-[14px] font-semibold mt-0.5">{roomStatusPopup.dateLabel}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => closeRoomStatusPopup(false)}
                              className="p-1 rounded-lg text-white/90 hover:bg-white/20 active:scale-90 transition"
                              aria-label="닫기"
                            >
                              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                          </div>

                          <div className="p-4 overflow-y-auto space-y-4">
                            {roomStatusPopup.holidayName && (
                              <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl px-3.5 py-2.5 text-[14px] font-bold text-center">
                                오늘은 <span className="font-extrabold">{roomStatusPopup.holidayName}</span>입니다.
                              </div>
                            )}

                            {roomStatusPopup.showClassroom && (
                              <div className="border border-slate-200 rounded-xl p-3 bg-slate-50/70 space-y-2.5">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <span className="p-1.5 rounded-lg bg-sky-100 text-sky-800 border border-sky-200">
                                      <IconClassroom className="w-4 h-4" />
                                    </span>
                                    <h4 className="font-extrabold text-[15.5px] sm:text-[16.5px] text-slate-900 flex items-center gap-1.5">
                                      <span>평생교육실2 (지하1층)</span>
                                      <span className="text-[11.5px] font-bold text-sky-700 bg-sky-100 px-1.5 py-0.5 rounded">
                                        {roomStatusPopup.isMorning ? '오전' : '오후'}
                                      </span>
                                    </h4>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => { closeRoomStatusPopup(); handleLogout(); onNavigateToClassroom(); }}
                                    className="text-[12.5px] font-bold text-blue-600 hover:underline whitespace-nowrap"
                                  >
                                    주간 보기 &rarr;
                                  </button>
                                </div>
                                <div className="flex flex-col gap-1.5 sm:gap-2">
                                  {roomStatusPopup.classroomSlots.map(item => (
                                    <div
                                      key={item.slot}
                                      className={`rounded-xl border px-3 py-2 sm:px-3.5 sm:py-2.5 flex items-center justify-between gap-2 shadow-sm ${item.isAvailable ? 'bg-emerald-50 border-emerald-300 text-emerald-950' : 'bg-rose-50 border-rose-200 text-rose-950'}`}
                                    >
                                      <span className="text-[13.5px] sm:text-[14px] font-bold tabular-nums whitespace-nowrap">{item.slot}</span>
                                      <span className={`text-[12px] sm:text-[12.5px] font-extrabold px-2 py-0.5 rounded whitespace-nowrap ${item.isAvailable ? 'bg-emerald-200 text-emerald-950' : 'bg-rose-200 text-rose-950'}`}>
                                        {item.label}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                                {roomStatusPopup.classroomMemo && (
                                  <div className="bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-[12.5px] text-slate-700 font-medium whitespace-pre-wrap">
                                    📢 {roomStatusPopup.classroomMemo}
                                  </div>
                                )}
                              </div>
                            )}

                            {roomStatusPopup.showNangman && (
                              <div className="border border-slate-200 rounded-xl p-3 bg-slate-50/70 space-y-2.5">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <span className="p-1.5 rounded-lg bg-pink-100 text-pink-800 border border-pink-200">
                                      <IconStudio className="w-4 h-4" />
                                    </span>
                                    <h4 className="font-extrabold text-[15.5px] sm:text-[16.5px] text-slate-900 flex items-center gap-1.5">
                                      <span>낭만스튜디오</span>
                                    </h4>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => { closeRoomStatusPopup(); handleLogout(); onNavigateToNangmanStudio(); }}
                                    className="text-[12.5px] font-bold text-blue-600 hover:underline whitespace-nowrap"
                                  >
                                    주간 보기 &rarr;
                                  </button>
                                </div>
                                <div className={`grid ${roomStatusPopup.nangmanSlots.length === 1 ? 'grid-cols-1' : 'grid-cols-2'} gap-2`}>
                                  {roomStatusPopup.nangmanSlots.map(item => {
                                    const toneClass = item.tone === 'emerald'
                                      ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                                      : item.tone === 'indigo'
                                        ? 'bg-indigo-50 border-indigo-300 text-indigo-900'
                                        : item.tone === 'slate'
                                          ? 'bg-slate-100 border-slate-300 text-slate-700'
                                          : 'bg-rose-50 border-rose-200 text-rose-800';
                                    return (
                                      <div
                                        key={item.slot}
                                        className={`rounded-lg border px-2.5 py-2 flex items-center justify-between gap-1.5 ${toneClass}`}
                                      >
                                        <span className="text-[13.5px] font-extrabold whitespace-nowrap">{item.slot}</span>
                                        <span className="text-[13px] font-bold whitespace-nowrap truncate">{item.label}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                                {roomStatusPopup.nangmanMemo && (
                                  <div className="bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-[12.5px] text-slate-700 font-medium whitespace-pre-wrap">
                                    📢 {roomStatusPopup.nangmanMemo}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>

                          <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => closeRoomStatusPopup(true)}
                              className="px-3.5 py-2 rounded-xl text-[13px] sm:text-[14px] font-bold text-slate-600 hover:text-slate-800 hover:bg-slate-200/70 transition cursor-pointer whitespace-nowrap active:scale-95"
                            >
                              오늘 다시 보지 않기
                            </button>
                            <button
                              type="button"
                              onClick={() => closeRoomStatusPopup(false)}
                              className="px-6 py-2.5 rounded-xl text-[14px] sm:text-[15px] font-extrabold bg-blue-600 hover:bg-blue-700 text-white shadow-sm active:scale-95 transition cursor-pointer text-center"
                            >
                              확인
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* 앱 설정 모달 */}
                    {showSettingsModal && (
                      <div
                        className="fixed inset-0 bg-slate-900/55 backdrop-blur-[3px] flex items-center justify-center z-[80] p-3 sm:p-4"
                        onClick={closeSettingsModal}
                      >
                        <div
                          className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[88vh] animate-fadeIn border border-slate-200"
                          onClick={e => e.stopPropagation()}
                        >
                          <div className="bg-gradient-to-r from-slate-700 to-slate-800 text-white px-4 py-3.5 flex items-center justify-between shrink-0">
                            <div className="flex items-center gap-2">
                              <Settings className="w-5 h-5 text-blue-300" />
                              <h3 className="font-extrabold text-[17px] sm:text-[18px] tracking-tight">앱 설정</h3>
                            </div>
                            <button
                              type="button"
                              onClick={closeSettingsModal}
                              className="p-1 rounded-lg text-white/90 hover:bg-white/20 active:scale-90 transition"
                              aria-label="설정 닫기"
                            >
                              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                          </div>

                          <div className="p-4 sm:p-5 overflow-y-auto space-y-5 text-left">
                            {/* 1. 전체 화면 회색 배경 농도 조절 */}
                            <div>
                              <div className="flex items-center justify-between gap-2 mb-2">
                                <label htmlFor="bg-gray-slider" className="text-[14.5px] sm:text-[15.5px] font-extrabold text-slate-900">
                                  1. 화면 배경 회색 농도
                                </label>
                                <div className="flex items-center gap-1.5">
                                  <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-800 text-[13px] font-extrabold tabular-nums">
                                    {bgGrayLevel}%
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleChangeBgGrayLevel(DEFAULT_BG_GRAY_LEVEL)}
                                    disabled={bgGrayLevel === DEFAULT_BG_GRAY_LEVEL}
                                    className="px-2 py-0.5 rounded-md text-[12px] font-bold border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
                                  >
                                    기본값
                                  </button>
                                </div>
                              </div>
                              <input
                                id="bg-gray-slider"
                                type="range"
                                min={0}
                                max={100}
                                step={1}
                                value={bgGrayLevel}
                                onChange={(e) => handleChangeBgGrayLevel(Number(e.target.value))}
                                className="w-full h-2.5 bg-slate-200 rounded-lg accent-blue-600 cursor-pointer"
                              />
                              <div className="grid grid-cols-4 gap-1.5 mt-2.5">
                                {[
                                  { value: 0, label: '0% 밝게' },
                                  { value: 20, label: '20% 기본' },
                                  { value: 50, label: '50% 중간' },
                                  { value: 85, label: '85% 진하게' }
                                ].map(preset => (
                                  <button
                                    key={preset.value}
                                    type="button"
                                    onClick={() => handleChangeBgGrayLevel(preset.value)}
                                    className={`py-1.5 px-1 rounded-lg border text-[12px] font-bold transition cursor-pointer whitespace-nowrap ${bgGrayLevel === preset.value
                                      ? 'border-blue-600 bg-blue-50 text-blue-700'
                                      : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                                      }`}
                                  >
                                    {preset.label}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* 2. 평생교육실2 · 낭만스튜디오 팝업 표시 방식 */}
                            <div className="pt-4 border-t border-slate-200">
                              <div className="mb-2">
                                <span className="block text-[14.5px] sm:text-[15.5px] font-extrabold text-slate-900">
                                  2. 교육실 현황 팝업 표시
                                </span>
                                <span className="block text-[12.5px] text-slate-500 font-medium mt-0.5">
                                  평생교육실2 · 낭만스튜디오 사용현황 자동 팝업
                                </span>
                              </div>
                              <div className="space-y-2">
                                <button
                                  type="button"
                                  onClick={() => handleChangeRoomPopupMode('once')}
                                  className={`w-full text-left p-3 rounded-xl border-2 flex items-start gap-2.5 transition cursor-pointer active:scale-[0.99] ${roomPopupMode === 'once'
                                    ? 'border-blue-600 bg-blue-50/70'
                                    : 'border-slate-200 bg-white hover:bg-slate-50'
                                    }`}
                                >
                                  <span className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${roomPopupMode === 'once' ? 'border-blue-600' : 'border-slate-400'
                                    }`}>
                                    {roomPopupMode === 'once' && <span className="w-2 h-2 rounded-full bg-blue-600" />}
                                  </span>
                                  <div className="min-w-0">
                                    <div className="text-[14px] sm:text-[14.5px] font-extrabold text-slate-900">
                                      앱 처음 실행 시 한 번만 표시
                                    </div>
                                    <div className="text-[12.5px] text-slate-600 font-medium mt-0.5">
                                      앱 실행 후 처음 메인 화면에서 1회만 팝업을 띄웁니다.
                                    </div>
                                  </div>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleChangeRoomPopupMode('always')}
                                  className={`w-full text-left p-3 rounded-xl border-2 flex items-start gap-2.5 transition cursor-pointer active:scale-[0.99] ${roomPopupMode === 'always'
                                    ? 'border-blue-600 bg-blue-50/70'
                                    : 'border-slate-200 bg-white hover:bg-slate-50'
                                    }`}
                                >
                                  <span className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${roomPopupMode === 'always' ? 'border-blue-600' : 'border-slate-400'
                                    }`}>
                                    {roomPopupMode === 'always' && <span className="w-2 h-2 rounded-full bg-blue-600" />}
                                  </span>
                                  <div className="min-w-0">
                                    <div className="text-[14px] sm:text-[14.5px] font-extrabold text-slate-900">
                                      항시 표시
                                    </div>
                                    <div className="text-[12.5px] text-slate-600 font-medium mt-0.5">
                                      메인 화면으로 돌아올 때마다 조건에 맞으면 다시 팝업을 띄웁니다.
                                    </div>
                                  </div>
                                </button>
                              </div>
                            </div>

                            {/* 3. 전체 글자 크기 설정 */}
                            <div className="pt-4 border-t border-slate-200">
                              <div className="mb-2">
                                <span className="block text-[14.5px] sm:text-[15.5px] font-extrabold text-slate-900">
                                  3. 전체 글자 크기
                                </span>
                                <span className="block text-[12.5px] text-slate-500 font-medium mt-0.5">
                                  화면의 전반적인 글자 크기를 조절합니다.
                                </span>
                              </div>
                              <div className="grid grid-cols-3 gap-2">
                                {[
                                  { value: 'normal', label: '보통' },
                                  { value: 'large', label: '크게' },
                                  { value: 'xlarge', label: '아주 크게' }
                                ].map(opt => (
                                  <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => setFontScale(saveFontScale(opt.value))}
                                    className={`py-2 px-2 rounded-xl border-2 text-[13.5px] font-extrabold transition cursor-pointer ${fontScale === opt.value
                                      ? 'border-blue-600 bg-blue-50 text-blue-700'
                                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                                      }`}
                                  >
                                    {opt.label}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* 4. 관리자 비밀번호 저장 */}
                            <div className="pt-4 border-t border-slate-200">
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <span className="text-[14.5px] sm:text-[15.5px] font-extrabold text-slate-900">
                                  4. 관리자 비밀번호
                                </span>
                                <span className={`px-2 py-0.5 rounded-full text-[11.5px] font-extrabold whitespace-nowrap ${hasAdminPassword
                                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                  : 'bg-slate-100 text-slate-600 border border-slate-200'
                                  }`}>
                                  {hasAdminPassword ? '저장됨 · 관리자 활성' : '미저장'}
                                </span>
                              </div>
                              <p className="text-[12.5px] text-slate-500 font-medium mb-2.5 leading-snug">
                                비밀번호를 저장하면 메인화면에 관리자 메뉴가 표시되고, 공지사항·교육실 담당자 기능도 재입력 없이 바로 사용할 수 있습니다.
                              </p>
                              {!hasAdminPassword ? (
                                <div className="flex items-center gap-2">
                                  <input
                                    type="password"
                                    value={adminPwdInput}
                                    onChange={(e) => {
                                      setAdminPwdInput(e.target.value);
                                      if (adminPwdError) setAdminPwdError('');
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        handleSaveAdminPassword();
                                      }
                                    }}
                                    placeholder="관리자 비밀번호 입력"
                                    autoComplete="off"
                                    className="flex-1 min-w-0 px-3 py-2.5 border-2 border-slate-200 rounded-xl text-[14px] font-bold text-slate-900 outline-none focus:border-blue-500 bg-white"
                                  />
                                  <button
                                    type="button"
                                    onClick={handleSaveAdminPassword}
                                    className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[13.5px] sm:text-[14px] font-extrabold shadow-sm active:scale-95 transition shrink-0 cursor-pointer"
                                  >
                                    저장
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-emerald-50/70 border border-emerald-200">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="text-[14px] font-black tracking-widest text-emerald-700 shrink-0">••••</span>
                                    <span className="text-[13px] font-bold text-emerald-800 truncate">관리자 비밀번호가 저장되어 있습니다.</span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={handleClearAdminPassword}
                                    className="px-3 py-1.5 rounded-lg bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 text-[12.5px] font-extrabold active:scale-95 transition shrink-0 cursor-pointer"
                                  >
                                    삭제
                                  </button>
                                </div>
                              )}
                              {adminPwdError && (
                                <p className="mt-2 text-[12.5px] font-bold text-rose-600">{adminPwdError}</p>
                              )}
                              {adminPwdNotice && !adminPwdError && (
                                <p className="mt-2 text-[12.5px] font-bold text-emerald-600">{adminPwdNotice}</p>
                              )}
                            </div>
                          </div>

                          <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex justify-end shrink-0">
                            <button
                              type="button"
                              onClick={closeSettingsModal}
                              className="px-6 py-2.5 rounded-xl text-[14px] sm:text-[15px] font-extrabold bg-blue-600 hover:bg-blue-700 text-white shadow-sm active:scale-95 transition cursor-pointer"
                            >
                              확인
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  );
  }

                  const [cy, cm, cd] = date.split('-');
                  const selectedDateObj = new Date(parseInt(cy, 10), parseInt(cm, 10) - 1, parseInt(cd, 10));
  const currentSelectedHoliday = holidaysFullList.find(h => {
    if (!h || !h.date) return false;
                  const rawDate = h.date.trim();
                  let holidayObj = null;
                  if (/^\d{4}-\d{1, 2}-\d{1, 2}$/.test(rawDate)) {
      const [hy, hm, hd] = rawDate.split('-');
                  holidayObj = new Date(parseInt(hy, 10), parseInt(hm, 10) - 1, parseInt(hd, 10));
    } else if (/^\d{4}\/\d{1, 2}\/\d{1, 2}$/.test(rawDate)) {
      const [hy, hm, hd] = rawDate.split('/');
                  holidayObj = new Date(parseInt(hy, 10), parseInt(hm, 10) - 1, parseInt(hd, 10));
    } else if (/^\d{1, 2}-\d{1, 2}$/.test(rawDate)) {
      const [hm, hd] = rawDate.split('-');
                  holidayObj = new Date(selectedDateObj.getFullYear(), parseInt(hm, 10) - 1, parseInt(hd, 10));
    } else if (/^\d{1, 2}\/\d{1, 2}$/.test(rawDate)) {
      const [hm, hd] = rawDate.split('/');
                  holidayObj = new Date(selectedDateObj.getFullYear(), parseInt(hm, 10) - 1, parseInt(hd, 10));
    }
                  if (!holidayObj) return false;
                  return holidayObj.getTime() === selectedDateObj.getTime();
  }) || (() => {
    const targetData = allScheduleData[date] || { };
    const myItems = Object.keys(targetData).map(shiftTime => getMyOriginalRecord(date, shiftTime)).filter(s => (s?.student || "").trim() !== "");
    if (myItems.length > 0 && myItems.every(s => {
      const student = (s?.student || "").trim();
                  const location = (s?.location || "").trim();
                  if (student.includes("팀장간담회")) return false;
                  const text = student + " " + location;
                  return /간담회|소양교육|공휴일/.test(text);
    })) {
      const first = myItems[0];
                  return {
                    name: first.student || '간담회',
                  content1: first.location || '소양교육',
                  content2: first.status || '',
                  vacation_available: false
      };
    }
                  return null;
  })();

                  return (
                  <div className="min-h-[100dvh] app-surface font-sans pb-6">
                    <div className="shrink-0 app-header text-white z-20 relative">
                      <div className="max-w-5xl lg:max-w-[1536px] mx-auto px-2.5 sm:px-5 pb-4 pt-safe-4 flex justify-between items-center gap-3">
                        <div className="flex items-center min-w-0">
                          <div className="flex flex-col min-w-0">
                            <div className="flex items-center mb-1">
                              <img src="/Logo_of_Seoul.jpg" alt="서울시 로고" className="h-7 hdr-logo object-contain mr-2 shrink-0" onError={(e) => e.target.style.display = 'none'} />
                              <h1 className="font-black text-xl leading-tight">성동노인종합복지관</h1>
                            </div>
                            <p className="text-lg font-semibold text-yellow-300">디지털교육 서포터즈</p>
                            <p className="text-base opacity-95 flex items-center mt-1 font-bold">
                              <User className="w-4 h-4 mr-1 shrink-0" /> [{selectedTeam}] {currentUser.replace(/\n/g, ' ')} 선생님
                            </p>
                          </div>
                        </div>

                        <button
                          onClick={(e) => {
                            if (isSubmitting) {
                              e.preventDefault();
                              alert("데이터 저장 중입니다. 잠시만 기다려주세요.");
                              return;
                            }
                            handleLogout();
                          }}
                          className={`text-xs flex flex-col items-center font-bold p-2 rounded-lg shadow-md transition-all touch-manipulation shrink-0 ${isSubmitting ? 'hdr-btn opacity-50 cursor-not-allowed' : 'hdr-btn'}`}
                        >
                          <Home className="w-5 h-5 mb-1" /> 처음으로
                        </button>
                      </div>
                    </div>

                    <main
                      className="w-full max-w-5xl lg:max-w-[1536px] mx-auto flex flex-col px-2.5 sm:px-5 pt-2 mt-1 pb-36"
                    >
                      <section className="flex flex-col h-auto">
                        <div className="contents">
                          <h2 className="text-[19px] sm:text-xl font-bold text-gray-800 pt-2 pb-1 px-1 flex items-center justify-between tracking-tight">
                            <span className="flex items-center"><MainCalendarIcon className="w-5 h-5 mr-2 text-blue-600" /> 근무기록 입력</span>

                            <div className="flex items-center gap-1.5">
                              {(isDataLoading) ? (
                                <span className="text-sm sm:text-lg text-red-600 font-bold flex items-center animate-pulse tracking-tight">
                                  <Clock className="w-4 h-4 sm:w-5 sm:h-5 mr-1 animate-spin" />
                                  <span className="hidden sm:inline">{isSubmitting ? '자동 저장 중...' : isSyncing ? '최신 데이터 확인 중...' : '데이터 로딩 중...'}</span>
                                  <span className="inline sm:hidden">{isSubmitting ? '저장중...' : '로딩중...'}</span>
                                </span>
                              ) : (
                                <>
                                  {Object.values(logs || {}).some(log => {
                                    const stu = (log?.student || '').trim();
                                    const loc = (log?.location || '').trim();
                                    return Boolean(stu && loc && loc !== '복지관' && loc !== '공휴일' && loc !== '휴무일');
                                  }) && (
                                      <button
                                        type="button"
                                        onClick={() => showAlert('출퇴근 기능은 추후 구현될 예정입니다.')}
                                        title="외부기관 출퇴근 (추후 구현 예정)"
                                        className="bg-slate-100 hover:bg-slate-200 text-slate-800 ring-1 ring-inset ring-slate-300 text-[14px] sm:text-[15px] px-3 sm:px-3.5 py-1.5 sm:py-2 rounded-xl font-bold flex items-center gap-1.5 whitespace-nowrap transition-all cursor-pointer active:scale-95 shadow-sm touch-manipulation"
                                        aria-label="출퇴근"
                                      >
                                        <svg className="w-4 h-4 sm:w-5 sm:h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                          <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
                                          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                                          <path d="m9 14 2 2 4-4" />
                                        </svg>
                                        <span>출퇴근</span>
                                      </button>
                                    )}
                                  {logsDate === date && date >= getLocalDateString(new Date()) && !noNewScheduleToRepeat && (!currentSelectedHoliday || currentSelectedHoliday.vacation_available) && !Object.values(logs || {}).some(log => (log?.student || '').includes('직무교육') || (log?.student || '').includes('안전교육') || (log?.student || '').includes('간담회')) && (
                                    <button
                                      type="button"
                                      onClick={handleRepeatSchedule}
                                      className="text-[15px] sm:text-[16px] px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl font-bold flex items-center whitespace-nowrap transition-all bg-orange-50 hover:bg-orange-100 text-orange-700 ring-1 ring-inset ring-orange-200 active:scale-95 touch-manipulation"
                                      title="현재의 학생이름과 장소를 이후의 동일 요일들에 복제합니다."
                                    >
                                      <RefreshCw className="w-4 h-4 sm:w-5 sm:h-5 mr-1.5" /> 일정 복제
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          </h2>
                          <div className="contents">
                            <div className="sticky top-0 z-30 -mx-2.5 sm:-mx-5 px-2.5 sm:px-5 py-2 app-surface">
                              <div className="flex items-center gap-1.5 sm:gap-2 w-full">
                                <button type="button" onClick={handlePrevDay} disabled={isDataLoading} aria-label="이전 날" className="w-11 sm:w-12 h-11 sm:h-12 flex items-center justify-center rounded-xl bg-white ring-1 ring-gray-200 shadow-sm hover:bg-gray-50 active:bg-gray-100 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation text-gray-600 shrink-0 transition-all">
                                  <svg className="w-6 h-6 sm:w-7 sm:h-7" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6 1.41-1.41z" /></svg>
                                </button>

                                <div className={`flex-1 h-11 sm:h-12 relative flex items-center justify-center ring-1 ring-blue-200 bg-white rounded-xl text-center shadow-sm overflow-hidden transition-all hover:ring-blue-300`}>
                                  <input
                                    type="date"
                                    value={date}
                                    onChange={handleDateChange}
                                    disabled={isDataLoading}
                                    onClick={(e) => {
                                      try {
                                        if (!isDataLoading && e.target.showPicker) e.target.showPicker();
                                      } catch (err) { }
                                    }}
                                    min={minDate || undefined}
                                    max={maxDate || undefined}
                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 disabled:cursor-not-allowed"
                                    title="달력 열기"
                                  />
                                  <div className={`flex items-center justify-center pointer-events-none relative z-0 ${isDataLoading ? 'opacity-50' : ''} -translate-y-[1px] whitespace-nowrap px-1`}>
                                    <span className={`font-extrabold text-[#1e3a8a] text-[15px] min-[360px]:text-[17px] sm:text-[20px] tracking-tighter whitespace-nowrap`}>{parseInt(date.substring(5, 7), 10)}/{parseInt(date.substring(8, 10), 10)}</span>
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1e3a8a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mx-1 sm:mx-1.5 w-4 h-4 sm:w-5 sm:h-5 shrink-0">
                                      <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
                                      <line x1="16" x2="16" y1="2" y2="6" />
                                      <line x1="8" x2="8" y1="2" y2="6" />
                                      <line x1="3" x2="21" y1="10" y2="10" />
                                    </svg>
                                    <span className={`font-extrabold text-[#1e3a8a] text-[15px] min-[360px]:text-[17px] sm:text-[20px] tracking-tighter whitespace-nowrap shrink-0`}>({getDayName(date)})</span>
                                  </div>
                                </div>

                                <button type="button" onClick={handleTodayClick} disabled={isDataLoading} className="text-[14px] sm:text-[15px] px-3 sm:px-4 h-11 sm:h-12 rounded-xl font-bold flex items-center justify-center bg-blue-600 hover:bg-blue-700 text-white shadow-sm shadow-blue-600/30 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation whitespace-nowrap shrink-0 transition-all">오늘</button>
                                <button type="button" onClick={handleNextDay} disabled={isDataLoading} aria-label="다음 날" className="w-11 sm:w-12 h-11 sm:h-12 flex items-center justify-center rounded-xl bg-white ring-1 ring-gray-200 shadow-sm hover:bg-gray-50 active:bg-gray-100 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation text-gray-600 shrink-0 transition-all">
                                  <svg className="w-6 h-6 sm:w-7 sm:h-7" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" /></svg>
                                </button>
                              </div>
                            </div>
                            {errorMessage && <div className="text-red-600 font-bold text-base text-center pb-2">{errorMessage}</div>}


                            {isMissingHeadcount && !isDataLoading && (
                              <div className="mt-2 animate-fadeIn">
                                <div className="bg-rose-50 ring-1 ring-rose-200 rounded-2xl p-3 sm:p-4 text-rose-800 shadow-sm flex items-center justify-center">
                                  <svg className="w-5 h-5 sm:w-6 sm:h-6 text-red-600 mr-2 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                  </svg>
                                  <p className="font-extrabold text-[15px] sm:text-[18px] text-red-700">
                                    교육 참석인원을 입력하세요.
                                  </p>
                                </div>
                              </div>
                            )}

                            {specialAlerts.length > 0 && (
                              <div className="mt-2 animate-fadeIn">
                                <div className="bg-white ring-1 ring-amber-200 rounded-2xl px-3 sm:px-4 py-3 sm:py-3.5 text-gray-800 shadow-sm overflow-hidden relative">
                                  <span className="absolute left-0 top-0 bottom-0 w-1 bg-amber-400" aria-hidden="true" />
                                  <div className="flex items-start gap-2.5 sm:gap-3 w-full">
                                    <div className="bg-amber-100 text-amber-600 p-1.5 rounded-lg shrink-0">
                                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <rect x="3" y="4.5" width="18" height="16.5" rx="2" strokeWidth="2.2" /><path strokeLinecap="round" strokeWidth="2.2" d="M8 2.5v4M16 2.5v4M3 9.5h18" />
                                      </svg>
                                    </div>
                                    <div className="flex flex-col gap-0.5 sm:gap-1 w-full min-w-0">
                                      <h4 className="font-bold text-[16px] min-[360px]:text-[17px] sm:text-[19px] leading-tight text-gray-900 tracking-tight">
                                        주요 일정 안내
                                      </h4>
                                      <div className="space-y-1 sm:space-y-1.5 mt-0.5 sm:mt-1">
                                        {specialAlerts.map((alert, idx) => {
                                          // 3일 이내인 일정인지 확인합니다
                                          const isClose = alert.diffDays <= 3;
                                          // 오늘과 같은 요일인지 확인합니다
                                          const isSameDayOfWeek = alert.dayOfWeek === new Date().getDay();

                                          const textClass = (isSameDayOfWeek || isClose) ? 'text-rose-600' : 'text-blue-700';

                                          return (
                                            <p key={idx} className={`font-bold text-[13.5px] min-[360px]:text-[14.5px] min-[380px]:text-[15.5px] sm:text-[18px] leading-tight tracking-tighter whitespace-nowrap overflow-x-auto pb-0.5 scrollbar-hide w-full block ${textClass}`}>
                                              <span>
                                                • {alert.msg}
                                              </span>
                                            </p>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}

                            {!isDataLoading && isCurrentUser20DaysFalse && (
                              <div className="mt-2 animate-fadeIn">
                                <div className="bg-sky-50 ring-1 ring-sky-200 rounded-2xl p-3.5 sm:p-4 text-sky-900 shadow-sm">
                                  <div className="flex items-start gap-3">
                                    <div className="bg-sky-100 p-1.5 rounded-lg shrink-0">
                                      <svg className="w-5 h-5 text-sky-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                      </svg>
                                    </div>
                                    <p className="font-semibold text-[15px] sm:text-[17px] leading-snug break-keep text-sky-900">
                                      대체근무인 경우, 대상자 이름과 장소를 입력하고 화면 하단의 <span className="text-blue-700 font-extrabold">'데이터베이스에 저장하기'</span> 버튼을 누르면 수업을 추가할 수 있습니다.
                                    </p>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="pb-5 pt-3">
                          <form onSubmit={handleSubmit} className="space-y-6">
                            {(() => {
                              const holidayBanner = currentSelectedHoliday ? (
                                <div className={`bg-gradient-to-b from-rose-50 to-white ring-1 ring-rose-200 rounded-2xl text-center shadow-md animate-fadeIn ${currentSelectedHoliday.vacation_available ? 'p-4 sm:p-5 mb-6' : 'p-6 sm:p-8 my-4'}`}>
                                  <div className={`flex justify-center ${currentSelectedHoliday.vacation_available ? 'mb-2 sm:mb-4' : 'mb-4'}`}>
                                    <div className={`bg-red-100 rounded-full ${currentSelectedHoliday.vacation_available ? 'p-2 sm:p-3' : 'p-3'}`}>
                                      <span className={`${currentSelectedHoliday.vacation_available ? 'text-3xl sm:text-5xl' : 'text-4xl sm:text-5xl'}`}>
                                        {(() => {
                                          const text = `${currentSelectedHoliday.name || ''} ${currentSelectedHoliday.content1 || ''} ${currentSelectedHoliday.content2 || ''}`;
                                          if (/설날|추석|명절|한가위|설 연휴/.test(text)) return '🌕';
                                          if (/광복절|삼일절|3\.1절|개천절|제헌절|한글날/.test(text)) return <img src="/korea_flag.png" alt="태극기" className="h-[1em] w-auto inline-block align-middle drop-shadow-sm rounded-[2px]" />;
                                          if (/어린이날/.test(text)) return '🎈';
                                          if (/부처님|석가탄신일|초파일/.test(text)) return '🪷';
                                          if (/성탄절|크리스마스/.test(text)) return '🎄';
                                          if (/선거|투표/.test(text)) return '🗳️';
                                          if (/현충일/.test(text)) return '🕯️';
                                          if (/근로자의|노동절/.test(text)) return '💪';
                                          if (/간담회|회의/.test(text)) return '☕';
                                          if (/교육|워크숍/.test(text)) return '💡';
                                          if (/대체공휴일|임시공휴일|휴일|휴무/.test(text)) return '🏖️';
                                          return '💡';
                                        })()}
                                      </span>
                                    </div>
                                  </div>
                                  <h3 className={`${currentSelectedHoliday.vacation_available ? 'text-xl sm:text-3xl' : 'text-2xl sm:text-3xl'} font-black text-red-700 tracking-tight ${currentSelectedHoliday.vacation_available ? 'mb-2 sm:mb-3' : 'mb-3'}`}>
                                    {currentSelectedHoliday.name}
                                  </h3>
                                  {currentSelectedHoliday.content1 && (
                                    <p className={`${currentSelectedHoliday.vacation_available ? 'text-base sm:text-xl mb-1 sm:mb-2' : 'text-lg sm:text-xl mb-2'} font-bold text-red-600 whitespace-pre-wrap`}>
                                      {currentSelectedHoliday.content1}
                                    </p>
                                  )}
                                  {currentSelectedHoliday.content2 && (
                                    <p className={`font-medium text-red-500 bg-white/50 inline-block rounded-xl border border-red-100 whitespace-pre-wrap break-keep leading-snug ${currentSelectedHoliday.vacation_available ? 'text-[14px] sm:text-lg px-3 py-1.5 sm:px-4 sm:py-2 mt-1 sm:mt-2' : 'text-[15px] sm:text-lg px-4 py-2 mt-2'}`}>
                                      {currentSelectedHoliday.content2}
                                    </p>
                                  )}
                                  {currentSelectedHoliday.vacation_available && (
                                    <div className="mt-4 flex justify-center w-full">
                                      <button
                                        type="button"
                                        onClick={() => setShowDetailedSchedule(!showDetailedSchedule)}
                                        className="bg-white ring-1 ring-rose-300 text-rose-700 font-bold px-4 py-2 rounded-xl shadow-sm active:scale-95 transition-all text-[15px] sm:text-lg hover:bg-rose-50"
                                      >
                                        {showDetailedSchedule ? '상세 일정 감추기' : '상세 일정 보기'}
                                      </button>
                                    </div>
                                  )}
                                </div>
                              ) : null;

                              if (currentSelectedHoliday && !currentSelectedHoliday.vacation_available) {
                                return holidayBanner;
                              }

                              return (
                                <>
                                  {holidayBanner}
                                  {(!currentSelectedHoliday || !currentSelectedHoliday.vacation_available || showDetailedSchedule) && (
                                    <>
                                      <div className="space-y-4 sm:space-y-5">
                                        {shifts.map((shift, index) => {
                                          const isInfoMissing = logs[index] ? (!logs[index].student || !logs[index].student.trim() || (selectedTeam !== '취업팀' && (!logs[index].location || !logs[index].location.trim()))) : true;
                                          const locLen = logs[index] && logs[index].location ? logs[index].location.length : 0;

                                          const locTextSize = locLen >= 9 ? "text-[15px] sm:text-[15px] md:text-[16px] landscape:text-[17px] md:landscape:text-[18px]" : locLen >= 8 ? "text-[16px] sm:text-[16px] md:text-[18px] landscape:text-[18px] md:landscape:text-[20px]" : locLen >= 7 ? "text-[17px] sm:text-[17px] md:text-[20px] landscape:text-[20px] md:landscape:text-[22px]" : locLen >= 6 ? "text-[18px] sm:text-[19px] md:text-[22px] landscape:text-[22px] md:landscape:text-[24px]" : "text-[18px] min-[360px]:text-[20px] sm:text-xl md:text-2xl landscape:text-[22px] md:landscape:text-[26px]";

                                          const counts = studentCounts[index];
                                          const studentNames = logs[index] ? (logs[index].student || "").split(/[/,]/).map(s => s.trim()).filter(s => s.length > 0) : [];
                                          const displayRowsCount = Math.max(1, studentNames.length);
                                          const isMultipleStudents = studentNames.length >= 2;

                                          const combinedText = logs[index] ? ((logs[index].student || "") + " " + (logs[index].location || "")) : "";
                                          const isKyungrodang = combinedText.includes("경로당");
                                          const isShowHeadcount = logs[index] ? ((logs[index].student || "").includes("보조강사") || isKyungrodang) : false;
                                          const isSpecialDay = logs[index] ? ((logs[index].student || "").includes("공휴일") || (logs[index].location || "").includes("공휴일") || (logs[index].student || "").includes("간담회") || (logs[index].location || "").includes("간담회")) : false;
                                          const cardColorClass = isSpecialDay ? 'bg-rose-50 border-rose-300 log-accent-rose' : isKyungrodang ? 'bg-orange-50 border-orange-300 log-accent-orange' : isMultipleStudents ? 'bg-emerald-50 border-emerald-300 log-accent-emerald' : 'bg-white border-blue-300 log-accent-blue';

                                          const isFutureOrToday = date >= getLocalDateString(new Date());
                                          const hasAttendance = logs[index].selectedTags && logs[index].selectedTags.some(tArray => tArray && tArray.length > 0);

                                          const allSelectedTags = (logs[index]?.selectedTags || []).flat().filter(Boolean);
                                          const hasPresentTag = allSelectedTags.includes("출석") || allSelectedTags.includes("1");
                                          const hasAbsenceTag = allSelectedTags.includes("결석");
                                          const hasRedTag = allSelectedTags.includes("종료") || allSelectedTags.includes("취소");
                                          const hasGrayTag = allSelectedTags.includes("선생님휴가");
                                          let memoTextColorClass = "text-gray-900";
                                          if (hasAbsenceTag) {
                                            memoTextColorClass = "text-red-600";
                                          } else if ((hasRedTag || hasGrayTag) && !hasPresentTag) {
                                            memoTextColorClass = "text-gray-500";
                                          }

                                          const hasCardContent = Boolean(
                                            logs[index]?.student?.trim() ||
                                            logs[index]?.location?.trim() ||
                                            logs[index]?.memo?.trim() ||
                                            logs[index]?.headcount?.trim() ||
                                            logs[index]?.selectedTags?.some(t => t?.length > 0)
                                          );
                                          const canUndoCard = Boolean(
                                            undoLogs[index] && JSON.stringify(undoLogs[index]) !== JSON.stringify(logs[index])
                                          );
                                          const resetOrUndoButton = (!hasCardContent && canUndoCard) ? (
                                            <button
                                              type="button"
                                              onClick={() => handleUndoCard(index)}
                                              disabled={isDataLoading}
                                              title="방금 초기화한 내용을 이전 상태로 되돌리기"
                                              className="bg-amber-50 hover:bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-300 h-[32px] sm:h-[36px] px-2.5 sm:px-3 rounded-lg text-[12px] sm:text-[13px] md:text-[14px] tracking-tight whitespace-nowrap shrink-0 transition-all cursor-pointer active:scale-95 font-bold shadow-sm flex items-center justify-center"
                                            >
                                              <span>되돌리기</span>
                                            </button>
                                          ) : hasCardContent ? (
                                            <button
                                              type="button"
                                              onClick={() => setClearConfirmIndex(index)}
                                              disabled={isDataLoading}
                                              title="이 시간대 수업 내용(이름·장소·출결·메모) 모두 비우기"
                                              className="bg-rose-50 hover:bg-rose-100 text-rose-700 ring-1 ring-inset ring-rose-200 h-[32px] sm:h-[36px] px-2.5 sm:px-3 rounded-lg text-[12px] sm:text-[13px] md:text-[14px] tracking-tight whitespace-nowrap shrink-0 transition-all cursor-pointer active:scale-95 font-bold shadow-sm flex items-center justify-center"
                                            >
                                              <span>초기화</span>
                                            </button>
                                          ) : null;

                                          return (
                                            <div key={index} id={`log-card-${index}`} className={`log-card p-4 sm:p-5 md:p-6 border-[1.5px] rounded-2xl ${cardColorClass}`}>
                                              <div className={`flex justify-between items-center w-full min-h-[32px] sm:min-h-[36px] mb-3 transition-opacity flex-nowrap gap-2 ${(isDataLoading) ? 'opacity-50' : ''}`}>
                                                <div className="flex items-center text-gray-900 font-extrabold text-base sm:text-lg tracking-tight flex-nowrap min-w-0">
                                                  <span className="shrink-0 whitespace-nowrap">
                                                    {(() => {
                                                      const d = new Date(date);
                                                      const day = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
                                                      let displayShift = shift;
                                                      if (selectedTeam === '취업팀' && day === '금') {
                                                        const mapping = { "13:00~14:00": "9:30~10:30", "14:00~15:00": "10:30~11:30", "15:00~16:00": "11:30~12:30" };
                                                        displayShift = mapping[shift] || shift;
                                                      }
                                                      if (!displayShift) return displayShift;
                                                      const startTime = displayShift.split('~')[0].trim();
                                                      return /^\d:\d{2}$/.test(startTime) ? `0${startTime}` : startTime;
                                                    })()}
                                                  </span>

                                                  {counts && counts.length > 0 && (!currentSelectedHoliday || currentSelectedHoliday.vacation_available) && !logs[index].student?.includes("간담회") && !logs[index].student?.includes("안전교육") && !logs[index].student?.includes("직무교육") ? (
                                                    <div className="flex items-center ml-1.5 sm:ml-2.5 gap-1 sm:gap-1.5 flex-nowrap shrink-0 overflow-x-auto scrollbar-none">
                                                      {counts.map((c, cIdx) => {
                                                        let sessionColorClass = "bg-slate-50 hover:bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200 font-bold";
                                                        if (c.count >= 15) {
                                                          sessionColorClass = "bg-orange-50 hover:bg-orange-100 text-orange-700 ring-1 ring-inset ring-orange-300 font-extrabold";
                                                        } else if (c.count >= 10) {
                                                          sessionColorClass = "bg-purple-50 hover:bg-purple-100 text-purple-700 ring-1 ring-inset ring-purple-300 font-extrabold";
                                                        } else if (c.count >= 7) {
                                                          sessionColorClass = "bg-purple-50 hover:bg-purple-100 text-purple-600 ring-1 ring-inset ring-purple-200 font-bold";
                                                        }

                                                        return (
                                                          <div key={cIdx} className="flex items-center gap-1.5 shrink-0 flex-nowrap">
                                                            <button
                                                              type="button"
                                                              onClick={() => setSelectedStudentDates(c)}
                                                              title={`${c.student ? `${c.student} 님의 ` : ''}수업 진행 날짜 목록 열기`}
                                                              className={`${sessionColorClass} h-[32px] sm:h-[36px] px-2.5 py-1 sm:px-3 sm:py-1 rounded-lg text-[12px] sm:text-[13px] md:text-[14px] tracking-tight whitespace-nowrap transition-all cursor-pointer active:scale-95 flex items-center justify-center shadow-sm shrink-0`}
                                                            >
                                                              <span>{c.count}회차</span>
                                                            </button>
                                                            <button
                                                              type="button"
                                                              onClick={() => setSelectedStudentHistory({ ...c, shiftIndex: index })}
                                                              title={`${c.student ? `${c.student} 님의 ` : ''}이전 교육 기록 보기`}
                                                              className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 ring-1 ring-inset ring-emerald-200 h-[32px] sm:h-[36px] px-2.5 py-1 sm:px-3 sm:py-1 rounded-lg text-[12px] sm:text-[13px] md:text-[14px] tracking-tight whitespace-nowrap transition-all cursor-pointer active:scale-95 font-bold flex items-center justify-center shadow-sm shrink-0"
                                                            >
                                                              <span>이전교육</span>
                                                            </button>
                                                          </div>
                                                        );
                                                      })}
                                                    </div>
                                                  ) : null}
                                                </div>

                                                <div className="ml-auto flex items-center gap-1.5 shrink-0">
                                                  {shouldRepeatPerShift[index] && !noNewScheduleToRepeat && logsDate === date && isFutureOrToday && (!currentSelectedHoliday || currentSelectedHoliday.vacation_available) && !logs[index].student?.includes("안전교육") && !logs[index].student?.includes("직무교육") && !logs[index].student?.includes("간담회") && (
                                                    <button
                                                      type="button"
                                                      onClick={() => handleRepeatScheduleForShift(index)}
                                                      className="bg-orange-50 hover:bg-orange-100 text-orange-700 ring-1 ring-inset ring-orange-200 h-[32px] sm:h-[36px] px-2.5 py-1 sm:px-3 sm:py-1 rounded-lg text-[12px] sm:text-[13px] md:text-[14px] tracking-tight whitespace-nowrap shrink-0 transition-colors cursor-pointer active:scale-95 font-bold shadow-sm flex items-center justify-center"
                                                    >
                                                      복제
                                                    </button>
                                                  )}
                                                  {resetOrUndoButton}
                                                </div>
                                              </div>

                                              <div className="space-y-2 sm:space-y-2.5">
                                                {(() => {

                                                  if (studentNames.length > 1) {
                                                    const validStudents = studentNames.filter(s => s.trim() && !s.trim().includes("보조강사") && !s.trim().includes("도선복지관"));
                                                    if (validStudents.length === 0) {
                                                      return resetOrUndoButton ? (
                                                        <div className="flex items-center gap-1.5 w-full">{resetOrUndoButton}</div>
                                                      ) : null;
                                                    }
                                                    return (
                                                      <div className="flex items-center gap-1.5 flex-wrap w-full">
                                                        {validStudents.map((sName, sIdx) => {
                                                          const clean = sName.trim();
                                                          const isAppSubmitted = checkFormSubmitted(submittedForms.apps, clean);
                                                          const isPreSubmitted = checkFormSubmitted(submittedForms.preSurveys, clean);
                                                          const isPostSubmitted = checkFormSubmitted(submittedForms.postSurveys, clean);

                                                          return (
                                                            <React.Fragment key={sIdx}>
                                                              <button
                                                                type="button"
                                                                onClick={() => {
                                                                  const url = `/application_form.html${clean ? `?name=${encodeURIComponent(clean)}` : ''}`;
                                                                  window.open(url, '_blank');
                                                                }}
                                                                title={`${sName} 님의 2027년 프로그램 참여 신청서 열기${isAppSubmitted ? ' (작성완료)' : ''}`}
                                                                className={`${isAppSubmitted
                                                                  ? 'bg-blue-600 hover:bg-blue-700 text-white ring-1 ring-inset ring-blue-700'
                                                                  : 'bg-blue-50 hover:bg-blue-100 text-blue-700 ring-1 ring-inset ring-blue-200'
                                                                  } h-[32px] sm:h-[36px] px-2.5 sm:px-3 rounded-lg text-[12px] sm:text-[13px] md:text-[14px] tracking-tight whitespace-nowrap transition-all cursor-pointer active:scale-95 font-bold flex items-center justify-center shadow-sm`}
                                                              >
                                                                <span>신청서 ({sName})</span>
                                                              </button>
                                                              <button
                                                                type="button"
                                                                onClick={() => {
                                                                  const surveyor = currentUser || "";
                                                                  const url = `/survey_form.html?type=pre${clean ? `&name=${encodeURIComponent(clean)}` : ''}${surveyor ? `&surveyor=${encodeURIComponent(surveyor)}` : ''}`;
                                                                  window.open(url, '_blank');
                                                                }}
                                                                title={`${sName} 님의 2027년 1:1 디지털 교육 사전설문지 열기${isPreSubmitted ? ' (작성완료)' : ''}`}
                                                                className={`${isPreSubmitted
                                                                  ? 'bg-indigo-600 hover:bg-indigo-700 text-white ring-1 ring-inset ring-indigo-700'
                                                                  : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 ring-1 ring-inset ring-indigo-200'
                                                                  } h-[32px] sm:h-[36px] px-2.5 sm:px-3 rounded-lg text-[12px] sm:text-[13px] md:text-[14px] tracking-tight whitespace-nowrap transition-all cursor-pointer active:scale-95 font-bold flex items-center justify-center shadow-sm`}
                                                              >
                                                                <span>사전설문지 ({sName})</span>
                                                              </button>
                                                              <button
                                                                type="button"
                                                                onClick={() => {
                                                                  const surveyor = currentUser || "";
                                                                  const url = `/survey_form.html?type=post${clean ? `&name=${encodeURIComponent(clean)}` : ''}${surveyor ? `&surveyor=${encodeURIComponent(surveyor)}` : ''}`;
                                                                  window.open(url, '_blank');
                                                                }}
                                                                title={`${sName} 님의 2027년 1:1 디지털 교육 사후설문지 열기${isPostSubmitted ? ' (작성완료)' : ''}`}
                                                                className={`${isPostSubmitted
                                                                  ? 'bg-purple-700 hover:bg-purple-800 text-white ring-1 ring-inset ring-purple-800'
                                                                  : 'bg-purple-50 hover:bg-purple-100 text-purple-700 ring-1 ring-inset ring-purple-200'
                                                                  } h-[32px] sm:h-[36px] px-2.5 sm:px-3 rounded-lg text-[12px] sm:text-[13px] md:text-[14px] tracking-tight whitespace-nowrap transition-all cursor-pointer active:scale-95 font-bold flex items-center justify-center shadow-sm`}
                                                              >
                                                                <span>사후설문지 ({sName})</span>
                                                              </button>
                                                            </React.Fragment>
                                                          );
                                                        })}
                                                      </div>
                                                    );
                                                  }

                                                  const singleStudent = (studentNames[0] || logs[index]?.student || "").trim();
                                                  if (!singleStudent || singleStudent.includes("보조강사") || singleStudent.includes("도선복지관")) {
                                                    return null;
                                                  }

                                                  const isAppSubmitted = checkFormSubmitted(submittedForms.apps, singleStudent);
                                                  const isPreSubmitted = checkFormSubmitted(submittedForms.preSurveys, singleStudent);
                                                  const isPostSubmitted = checkFormSubmitted(submittedForms.postSurveys, singleStudent);
                                                  const maxStudentCount = (counts || []).reduce((mx, c) => Math.max(mx, c.count || 0), 0);
                                                  const needPostSurvey = !isPostSubmitted && (allSelectedTags.includes('종료') || maxStudentCount >= 15);
                                                  const locVal = (logs[index]?.location || "").trim();
                                                  const isExternalLocation = Boolean(locVal && locVal !== "복지관" && locVal !== "공휴일" && locVal !== "휴무일");
                                                  const photoDateKey = `${normalizeStudentPhotoKey(singleStudent)}__${date}`;
                                                  const hasPhotoForSession = Boolean(studentPhotoDateCounts[photoDateKey]);

                                                  return (
                                                    <div className="flex items-center justify-between gap-1.5 flex-wrap w-full">
                                                      {isExternalLocation && (
                                                        <div className="flex items-center gap-1.5 shrink-0">
                                                          <button
                                                            type="button"
                                                            onClick={() => setPhotoModalTarget({
                                                              studentName: singleStudent,
                                                              date,
                                                              shift: shifts[index] || '',
                                                              teacher: currentUser || '',
                                                              location: locVal
                                                            })}
                                                            title={hasPhotoForSession ? `${singleStudent} 님 수업 사진 촬영 완료 (클릭하여 보기/삭제)` : `${singleStudent} 님 수업 모습 촬영하기`}
                                                            className={`${hasPhotoForSession
                                                              ? 'bg-blue-600 hover:bg-blue-700 text-white ring-1 ring-inset ring-blue-700'
                                                              : 'bg-gray-200 hover:bg-gray-300 text-gray-700 ring-1 ring-inset ring-gray-300'
                                                              } h-[32px] sm:h-[36px] px-2.5 sm:px-3 rounded-lg transition-all cursor-pointer active:scale-95 flex items-center justify-center shadow-sm`}
                                                            aria-label="수업 사진 촬영"
                                                          >
                                                            <svg className="w-4 h-4 sm:w-[18px] sm:h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                                              <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
                                                              <circle cx="12" cy="13" r="3" />
                                                            </svg>
                                                          </button>
                                                        </div>
                                                      )}
                                                      <div className="ml-auto flex items-center gap-1.5 flex-wrap">
                                                        <button
                                                          type="button"
                                                          onClick={() => {
                                                            const url = `/application_form.html${singleStudent ? `?name=${encodeURIComponent(singleStudent)}` : ''}`;
                                                            window.open(url, '_blank');
                                                          }}
                                                          title={`2027년 프로그램 참여 신청서 열기${isAppSubmitted ? ' (작성완료)' : ' (미작성)'}`}
                                                          className={`${isAppSubmitted
                                                            ? 'bg-blue-600 hover:bg-blue-700 text-white ring-1 ring-inset ring-blue-700'
                                                            : 'bg-blue-50 hover:bg-blue-100 text-blue-700 ring-1 ring-inset ring-blue-200'
                                                            } h-[32px] sm:h-[36px] px-2.5 sm:px-3 rounded-lg text-[12px] sm:text-[13px] md:text-[14px] tracking-tight whitespace-nowrap transition-all cursor-pointer active:scale-95 font-bold flex items-center justify-center shadow-sm`}
                                                        >
                                                          <span>신청서</span>
                                                          {!isAppSubmitted && <span className="ml-1 w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" aria-hidden="true" />}
                                                        </button>
                                                        <button
                                                          type="button"
                                                          onClick={() => {
                                                            const surveyor = currentUser || "";
                                                            const url = `/survey_form.html?type=pre${singleStudent ? `&name=${encodeURIComponent(singleStudent)}` : ''}${surveyor ? `&surveyor=${encodeURIComponent(surveyor)}` : ''}`;
                                                            window.open(url, '_blank');
                                                          }}
                                                          title={`2027년 1:1 디지털 교육 사전설문지 열기${isPreSubmitted ? ' (작성완료)' : ' (미작성)'}`}
                                                          className={`${isPreSubmitted
                                                            ? 'bg-indigo-600 hover:bg-indigo-700 text-white ring-1 ring-inset ring-indigo-700'
                                                            : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 ring-1 ring-inset ring-indigo-200'
                                                            } h-[32px] sm:h-[36px] px-2.5 sm:px-3 rounded-lg text-[12px] sm:text-[13px] md:text-[14px] tracking-tight whitespace-nowrap transition-all cursor-pointer active:scale-95 font-bold flex items-center justify-center shadow-sm`}
                                                        >
                                                          <span>사전설문지</span>
                                                          {!isPreSubmitted && <span className="ml-1 w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" aria-hidden="true" />}
                                                        </button>
                                                        <button
                                                          type="button"
                                                          onClick={() => {
                                                            const surveyor = currentUser || "";
                                                            const url = `/survey_form.html?type=post${singleStudent ? `&name=${encodeURIComponent(singleStudent)}` : ''}${surveyor ? `&surveyor=${encodeURIComponent(surveyor)}` : ''}`;
                                                            window.open(url, '_blank');
                                                          }}
                                                          title={`2027년 1:1 디지털 교육 사후설문지 열기${isPostSubmitted ? ' (작성완료)' : needPostSurvey ? ' (작성 필요)' : ''}`}
                                                          className={`${isPostSubmitted
                                                            ? 'bg-purple-700 hover:bg-purple-800 text-white ring-1 ring-inset ring-purple-800'
                                                            : 'bg-purple-50 hover:bg-purple-100 text-purple-700 ring-1 ring-inset ring-purple-200'
                                                            } h-[32px] sm:h-[36px] px-2.5 sm:px-3 rounded-lg text-[12px] sm:text-[13px] md:text-[14px] tracking-tight whitespace-nowrap transition-all cursor-pointer active:scale-95 font-bold flex items-center justify-center shadow-sm`}
                                                        >
                                                          <span>사후설문지</span>
                                                          {needPostSurvey && <span className="ml-1 w-2 h-2 rounded-full bg-rose-500 animate-pulse shrink-0" aria-hidden="true" />}
                                                        </button>
                                                      </div>
                                                    </div>
                                                  );
                                                })()}

                                                <div className="flex gap-1.5 sm:gap-3 lg:gap-4 items-stretch">
                                                  <input
                                                    type="text"
                                                    placeholder="대상자 이름"
                                                    value={logs[index].student}
                                                    onChange={(e) => {
                                                      const newVal = e.target.value;
                                                      const prevStudent = logs[index]?.student || "";
                                                      const prevLocation = logs[index]?.location || "";
                                                      handleLogChange(index, 'student', newVal);
                                                      // 학생이름과 장소가 모두 블랭크인 상태에서 학생이름을 새로 입력할 때 장소를 '복지관'으로 자동 입력
                                                      if (!prevStudent.trim() && !prevLocation.trim() && newVal.trim()) {
                                                        handleLogChange(index, 'location', '복지관');
                                                      }
                                                      // 다른 선생님의 기록에서 출결/메모 동기화
                                                      if (newVal.trim() !== "") {
                                                        syncSiblingStatus(index, newVal);
                                                      }
                                                    }}
                                                    onBlur={handleInputBlur}
                                                    onTouchStart={(e) => startStudentLongPress(e, index)}
                                                    onTouchMove={handleStudentLongPressMove}
                                                    onTouchEnd={cancelStudentLongPress}
                                                    onTouchCancel={cancelStudentLongPress}
                                                    onMouseDown={(e) => startStudentLongPress(e, index)}
                                                    onMouseUp={cancelStudentLongPress}
                                                    onMouseLeave={cancelStudentLongPress}
                                                    title="길게 누르면 학생 사진 촬영 및 조회/삭제"
                                                    disabled={isDataLoading}
                                                    className={`flex-[1.5] min-w-0 h-12 sm:h-[52px] md:h-14 px-3 md:px-4 border-[1.5px] rounded-xl outline-none font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-all text-[18px] min-[360px]:text-[20px] sm:text-xl md:text-2xl landscape:text-[22px] md:landscape:text-[26px] leading-tight tracking-tight caret-blue-600 focus:ring-4 focus:ring-blue-500/15 ${!logs[index].student ? 'bg-gray-50 text-gray-800 placeholder-gray-400 border-dashed border-gray-300 focus:border-blue-400' : (logs[index].location === '공휴일' || logs[index].location === '휴무일' ? 'bg-rose-100 text-rose-800 placeholder-rose-300 border-rose-200 focus:border-rose-400' : (logs[index].student || '').includes('보조강사') ? 'bg-amber-200 text-amber-950 placeholder-gray-500 border-amber-300 focus:border-amber-500' : 'bg-blue-50 text-blue-900 placeholder-blue-300 border-blue-200 focus:border-blue-500')}`}
                                                  />
                                                  <input
                                                    type="text"
                                                    placeholder="장소"
                                                    value={logs[index].location}
                                                    onChange={(e) => handleLogChange(index, 'location', e.target.value)}
                                                    onBlur={handleInputBlur}
                                                    disabled={isDataLoading}
                                                    className={`flex-1 min-w-0 h-12 sm:h-[52px] md:h-14 px-3 md:px-4 border-[1.5px] rounded-xl outline-none font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-all ${locTextSize} leading-tight tracking-tight caret-blue-600 focus:ring-4 focus:ring-blue-500/15 ${!logs[index].location ? 'bg-gray-50 text-gray-800 placeholder-gray-400 border-dashed border-gray-300 focus:border-blue-400' : (logs[index].location === '공휴일' || logs[index].location === '휴무일' ? 'bg-rose-100 text-rose-800 placeholder-rose-300 border-rose-200 focus:border-rose-400' : 'bg-blue-50 text-blue-900 placeholder-blue-300 border-blue-200 focus:border-blue-500')}`}
                                                  />
                                                </div>




                                                <div className="space-y-1.5 !mt-3">
                                                  {Array.from({ length: displayRowsCount }).map((_, sIdx) => {
                                                    return (
                                                      <div key={sIdx} className={`flex flex-col w-full ${sIdx > 0 ? 'mt-2 pt-2 border-t border-dashed border-gray-200' : ''}`}>
                                                        <div className={`flex w-full justify-between gap-0.5 min-[350px]:gap-1 min-[380px]:gap-1.5 sm:gap-2 md:gap-3 ${sIdx === displayRowsCount - 1 ? 'pb-0' : 'pb-1'}`}>
                                                          {RENDER_TAGS.map(tag => {
                                                            const fontSizeClass = 'text-[13px] min-[340px]:text-[14px] min-[360px]:text-[15px] min-[380px]:text-[17px] sm:text-[18px] md:text-[20px] lg:text-[21px]';

                                                            const isKyungrodangIncluded = combinedText.includes("경로당") || combinedText.includes("도선복지관");
                                                            const currentStudentName = studentNames[sIdx] || "";
                                                            const hasRealName = currentStudentName.length > 0 && !currentStudentName.includes("경로당") && !currentStudentName.includes("복지관");
                                                            const isBlurTarget = isShowHeadcount && (isKyungrodangIncluded ? (!hasRealName && tag === '출석') : ['출석', '결석', '종료'].includes(tag));

                                                            const isTagSelected = Boolean(logs[index]?.selectedTags?.[sIdx]?.includes(tag));
                                                            const isSiblingTagSparkle = Boolean(logs[index]?.isFromSibling && !isBlurTarget && isTagSelected);

                                                            return (
                                                              <button
                                                                key={tag}
                                                                type="button"
                                                                onClick={() => toggleTag(index, sIdx, tag)}
                                                                disabled={isDataLoading || isInfoMissing || isBlurTarget}
                                                                className={
                                                                  "flex-1 flex flex-col items-center justify-center px-0 sm:px-2 min-h-[40px] sm:min-h-[44px] rounded-xl " +
                                                                  fontSizeClass +
                                                                  " leading-[1.15] tracking-tighter sm:tracking-normal transition-all touch-manipulation break-keep whitespace-nowrap " +
                                                                  (isBlurTarget
                                                                    ? "bg-gray-100 text-gray-400 border-[1.5px] border-gray-200 blur-[1px] opacity-90 cursor-not-allowed"
                                                                    : "disabled:opacity-50 disabled:cursor-not-allowed " + getTagClass(index, sIdx, tag)) +
                                                                  (isSiblingTagSparkle ? " animate-sibling-sparkle" : "")
                                                                }
                                                              >
                                                                {tag}
                                                              </button>
                                                            );
                                                          })}
                                                        </div>
                                                      </div>
                                                    );
                                                  })}
                                                </div>

                                                <div className="flex gap-1.5 w-full !mt-[10px] items-stretch">
                                                  {isShowHeadcount && (() => {
                                                    const isHeadcountEmpty = !(logs[index]?.headcount || "").trim();
                                                    const hasMemo = (logs[index]?.memo || "").trim() !== "";
                                                    const hasExcusedAttendance = studentNames.some((_, sIdx) => {
                                                      const tags = (logs[index]?.selectedTags && logs[index].selectedTags[sIdx]) ? logs[index].selectedTags[sIdx] : [];
                                                      return tags.includes("결석") || (tags.includes("선생님휴가") && !tags.includes("1")) || tags.includes("종료");
                                                    });
                                                    const isSparkling = (validationErrorIndex === index) || (hasMemo && isHeadcountEmpty && !hasExcusedAttendance);

                                                    return (
                                                      <input
                                                        type="text"
                                                        inputMode="numeric"
                                                        maxLength="2"
                                                        placeholder="인원"
                                                        value={logs[index]?.headcount || ""}
                                                        onChange={(e) => {
                                                          const val = e.target.value.replace(/[^0-9]/g, '');
                                                          handleLogChange(index, 'headcount', val);
                                                        }}
                                                        onBlur={handleInputBlur}
                                                        disabled={isDataLoading || isInfoMissing}
                                                        className={`w-12 md:w-14 px-0.5 text-center border-[1.5px] border-sky-400 rounded-xl outline-none font-bold text-sky-950 placeholder-sky-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-[18px] md:text-[22px] leading-tight shrink-0 caret-blue-600 focus:ring-4 focus:ring-sky-500/15 ${isSparkling ? 'animate-sparkle border-red-500 shadow-md' : 'bg-sky-50'}`}
                                                      />
                                                    );
                                                  })()}
                                                  <div className="relative flex-1 min-w-0 flex flex-col group">
                                                    <div
                                                      className={`absolute inset-0 py-2 sm:py-2.5 md:py-3 px-3 md:px-4 border-[1.5px] ${logs[index]?.isFromSibling && (logs[index]?.memo || "").trim() ? 'border-amber-400 animate-sibling-sparkle' : 'border-gray-200'} rounded-xl bg-gray-50 font-semibold ${memoTextColorClass} transition-all group-focus-within:bg-white group-focus-within:border-blue-400 group-focus-within:ring-4 group-focus-within:ring-blue-500/15 text-[18px] md:text-[22px] leading-tight whitespace-pre-wrap overflow-y-auto break-words z-0 pointer-events-none ${(isDataLoading || isInfoMissing) ? 'opacity-50' : ''}`}
                                                      aria-hidden="true"
                                                    >
                                                      {!logs[index]?.memo ? (
                                                        <span className="text-gray-400 font-medium">메모</span>
                                                      ) : (
                                                        logs[index].memo.split(/(\d+회차)/g).map((part, i) =>
                                                          /^\d+회차$/.test(part) ? <span key={i} className="text-[#3366ff]">{part}</span> : part
                                                        )
                                                      )}
                                                      {logs[index]?.memo?.endsWith('\n') && <br />}
                                                    </div>
                                                    <textarea
                                                      rows="3"
                                                      value={logs[index]?.memo || ""}
                                                      onChange={(e) => handleLogChange(index, 'memo', e.target.value)}
                                                      onFocus={() => setFocusedMemoIndex(index)}
                                                      onBlur={() => {
                                                        handleInputBlur();
                                                        setTimeout(() => {
                                                          setFocusedMemoIndex((prev) => (prev === index ? null : prev));
                                                        }, 150);
                                                      }}
                                                      onScroll={(e) => {
                                                        if (e.target.previousSibling) {
                                                          e.target.previousSibling.scrollTop = e.target.scrollTop;
                                                        }
                                                      }}
                                                      disabled={isDataLoading || isInfoMissing}
                                                      className={`block flex-1 w-full py-2 sm:py-2.5 md:py-3 px-3 md:px-4 border-[1.5px] border-transparent rounded-xl bg-transparent outline-none font-semibold text-transparent placeholder-transparent shadow-none disabled:cursor-not-allowed transition-all text-[18px] md:text-[22px] leading-tight resize-none caret-black z-10 relative m-0`}
                                                      spellCheck="false"
                                                    />
                                                  </div>
                                                </div>
                                                {focusedMemoIndex === index && !isSpecialDay && (logs[index]?.student || "").trim() && !((logs[index]?.selectedTags || []).flat().includes('선생님휴가')) && (
                                                  <div className="flex items-center flex-wrap gap-1.5 pt-1.5">
                                                    {['전화', '문자', '카카오톡', '사진/갤러리', '지도', '제미나이', '챗GPT', '유튜브', '보이스피싱 예방', '키오스크'].map((chip) => {
                                                      const curMemo = (logs[index]?.memo || "").trim();
                                                      const isSelected = curMemo.split(/[,\n]+/).map(s => s.trim()).includes(chip);
                                                      return (
                                                        <button
                                                          key={chip}
                                                          type="button"
                                                          disabled={isDataLoading || isInfoMissing}
                                                          onMouseDown={(e) => e.preventDefault()}
                                                          onClick={() => {
                                                            if (isSelected) {
                                                              const next = curMemo
                                                                .split(',')
                                                                .map(s => s.trim())
                                                                .filter(s => s && s !== chip)
                                                                .join(', ');
                                                              handleLogChange(index, 'memo', next);
                                                            } else {
                                                              const next = curMemo ? `${curMemo}, ${chip}` : chip;
                                                              handleLogChange(index, 'memo', next);
                                                            }
                                                          }}
                                                          className={`px-2.5 py-1 rounded-full border text-[12.5px] sm:text-[13px] font-bold whitespace-nowrap shrink-0 active:scale-95 transition disabled:opacity-40 shadow-2xs ${isSelected
                                                            ? 'bg-blue-600 text-white border-blue-600'
                                                            : 'bg-white hover:bg-blue-50 text-slate-700 hover:text-blue-700 border-slate-300 hover:border-blue-400'
                                                            }`}
                                                        >
                                                          {isSelected ? `✓ ${chip}` : `+ ${chip}`}
                                                        </button>
                                                      );
                                                    })}
                                                  </div>
                                                )}
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                      <div className="save-bar sticky bottom-[62px] z-20 -mx-4 sm:-mx-6 md:-mx-8 px-4 sm:px-6 md:px-8 pt-6 mt-2 mb-2">
                                        <button
                                          type="submit"
                                          disabled={isDataLoading || !hasChanges}
                                          onMouseDown={(e) => e.preventDefault()}
                                          className={`w-full h-14 md:h-16 font-bold rounded-2xl text-[21px] md:text-[26px] tracking-tight transition-all duration-150 active:scale-[0.98] flex items-center justify-center touch-manipulation ${(isDataLoading || !hasChanges) ? 'bg-gray-200 text-gray-400 ring-1 ring-inset ring-gray-300/60 cursor-not-allowed' : 'text-white bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 ring-1 ring-inset ring-blue-700/20 shadow-lg shadow-blue-600/30'}`}
                                        >
                                          {isSubmitting ? <><Clock className="w-6 h-6 mr-2 animate-spin" />저장 중...</> : <><SaveIcon className="w-6 h-6 mr-2" />{isDataLoading ? '데이터 불러오는 중...' : hasChanges ? `데이터베이스에 저장 (${changedShiftCount}건 변경)` : '저장할 변경 사항 없음'}</>}
                                        </button>
                                      </div>
                                    </>
                                  )}
                                </>
                              );
                            })()}
                          </form>
                        </div>
                      </section>
                    </main>

                    {showValidationError && (
                      <div className="fixed inset-0 bg-slate-900/45 backdrop-blur-[3px] flex items-center justify-center z-[70] px-4 animate-fadeIn">
                        <div className="bg-white rounded-2xl shadow-2xl flex flex-col max-w-sm w-full overflow-hidden">
                          <div className="bg-red-500 py-4 px-6 text-center flex items-center justify-center gap-2">
                            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                            <h3 className="text-xl font-bold text-white tracking-wide">입력 확인</h3>
                          </div>
                          <div className="p-6">
                            <p className="text-gray-800 font-bold text-[17px] sm:text-[19px] mb-6 text-center leading-relaxed whitespace-pre-line">
                              {validationErrorMsg}
                            </p>
                            <button
                              onClick={() => {
                                setShowValidationError(false);
                                if (validationErrorIndex !== null) {
                                  setTimeout(() => {
                                    const el = document.getElementById(`log-card-${validationErrorIndex}`);
                                    if (el) {
                                      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                    }
                                  }, 100);
                                }
                              }}
                              className="w-full py-3 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded-xl font-bold text-[18px] shadow-sm active:scale-95 touch-manipulation transition-colors"
                            >
                              확인
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {showSavePopup && (
                      <div className="fixed inset-0 bg-slate-900/45 backdrop-blur-[3px] flex items-center justify-center z-50 px-4">
                        <div className="bg-white rounded-2xl shadow-2xl flex flex-col max-w-sm w-full animate-fadeIn overflow-hidden">
                          <div className="bg-blue-600 py-4 px-6 text-center">
                            <h3 className="text-2xl font-bold text-white tracking-wide">
                              {isSaveComplete ? "데이터 저장 완료" : "데이터베이스에 저장 중..."}
                            </h3>
                          </div>
                          <div className="p-6">
                            <div className="flex flex-col gap-4 mb-6 max-h-[50vh] overflow-y-auto pr-2">
                              {saveProgress.map((prog, idx) => {
                                if (prog.isRepeat) {
                                  return (
                                    <div key={idx} className="flex justify-between items-center w-full pb-4 border-b border-dashed border-gray-200 last:border-0 last:pb-0">
                                      <div className="flex flex-col gap-1.5 flex-1 pr-2">
                                        <span className="text-blue-800 font-extrabold text-[19px] tracking-tight">
                                          <span className="text-gray-500 mr-1.5 font-bold text-[19px]">{prog.dateDisplay}</span>
                                          {prog.student}
                                        </span>
                                        <span className="text-indigo-600 font-bold text-lg leading-relaxed">
                                          {prog.timeDisplay}
                                        </span>
                                      </div>
                                      <span className={`text-base w-[100px] text-center font-bold py-1.5 rounded-md whitespace-nowrap shrink-0 border shadow-sm ${prog.status === '저장 완료' ? 'bg-green-600 border-green-700 text-white' : prog.status === '저장 실패' ? 'bg-red-50 border-red-200 text-red-700' : prog.status === '변경 없음' ? 'bg-gray-50 border-gray-200 text-gray-500' : 'bg-orange-50 border-orange-200 text-orange-700 animate-pulse'}`}>
                                        {prog.status}
                                      </span>
                                    </div>
                                  );
                                }

                                const att = prog.attendance || "";
                                let attColor = "text-gray-700";

                                // 출결 텍스트 색상을 설정할 때도, "쿠팡 취소" 등의 문구에 반응하지 않고 
                                // 콤마나 슬래시로 명확히 분리된 상태일 때만 빨간색 등으로 표시되게 합니다.
                                const isPresent = hasIndependentKeyword(att, ["출석", "1"]);
                                const isAbsent = hasIndependentKeyword(att, ["결석"]);
                                const isEndOrCancel = hasIndependentKeyword(att, ["종료", "취소"]);
                                const isVacation = hasIndependentKeyword(att, ["선생님휴가"]);

                                if (isPresent) {
                                  attColor = "text-gray-900";
                                } else if (isAbsent) {
                                  attColor = "text-red-600 font-bold";
                                } else if (isEndOrCancel || isVacation) {
                                  attColor = "text-gray-500 font-bold";
                                }

                                return (
                                  <div key={idx} className="flex justify-between items-center w-full pb-4 border-b border-dashed border-gray-200 last:border-0 last:pb-0">
                                    <div className="flex flex-col gap-1.5 flex-1 pr-2">
                                      <span className="text-blue-800 font-extrabold text-[19px] tracking-tight">
                                        {prog.student}
                                      </span>
                                      <span className={`text-lg font-bold break-all leading-relaxed ${attColor}`}>
                                        {prog.attendance}
                                      </span>

                                    </div>
                                    <span className={`text-base w-[100px] text-center font-bold py-1.5 rounded-md whitespace-nowrap shrink-0 border shadow-sm ${prog.status === '저장 완료' ? 'bg-green-600 border-green-700 text-white' : prog.status === '저장 실패' ? 'bg-red-50 border-red-200 text-red-700' : prog.status === '변경 없음' ? 'bg-gray-50 border-gray-200 text-gray-500' : 'bg-orange-50 border-orange-200 text-orange-700 animate-pulse'}`}>
                                      {prog.status}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                            <button
                              onClick={() => setShowSavePopup(false)}
                              disabled={!isSaveComplete}
                              className={`w-full py-3 rounded-xl font-bold text-xl shadow-md transition-colors touch-manipulation ${isSaveComplete ? 'bg-blue-600 text-white hover:bg-blue-700 active:scale-95' : 'bg-gray-300 text-gray-500 cursor-not-allowed'}`}
                            >
                              {isSaveComplete ? "확인" : "잠시만 기다려주세요..."}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {showAssistantConflictModal && (
                      <div className="fixed inset-0 bg-slate-900/45 backdrop-blur-[3px] flex items-center justify-center z-[55] px-4">
                        <div className="bg-white rounded-2xl shadow-2xl flex flex-col max-w-sm w-full animate-fadeIn overflow-hidden">
                          <div className="bg-blue-500 py-4 px-6 text-center">
                            <h3 className="text-xl font-bold text-white tracking-wide">보조강사 일정 덮어쓰기 주의</h3>
                          </div>
                          <div className="p-6">
                            <p className="text-gray-800 font-bold text-[18px] sm:text-[20px] mb-6 text-center leading-relaxed">
                              현재 일정을 복제할 미래 날짜에<br />
                              <span className="bg-amber-200 text-black px-1.5 py-0.5 rounded mx-1 whitespace-nowrap">보조강사</span><br />
                              일정이 있습니다. 복제하시겠습니까?
                            </p>
                            <div className="flex gap-3">
                              <button
                                onClick={handleAssistantConflictProceed}
                                className="flex-1 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-xl font-bold text-[18px] sm:text-[20px] shadow-md active:scale-95 touch-manipulation transition-colors"
                              >
                                예
                              </button>
                              <button
                                onClick={() => setShowAssistantConflictModal(false)}
                                className="flex-1 py-3 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-xl font-bold text-[18px] sm:text-[20px] shadow-sm active:scale-95 touch-manipulation transition-colors"
                              >
                                아니오
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {clearConfirmIndex !== null && (
                      <div className="fixed inset-0 bg-slate-900/45 backdrop-blur-[3px] flex items-center justify-center z-50 px-4" onClick={() => setClearConfirmIndex(null)}>
                        <div className="bg-white rounded-2xl shadow-2xl flex flex-col max-w-sm w-full animate-fadeIn overflow-hidden" onClick={e => e.stopPropagation()}>
                          <div className="bg-rose-600 py-4 px-6 text-center">
                            <h3 className="text-xl font-bold text-white tracking-wide">수업 내용 초기화</h3>
                          </div>
                          <div className="p-6">
                            <p className="text-gray-800 font-bold text-[17px] sm:text-[19px] mb-2 text-center leading-relaxed">
                              <span className="text-rose-600">
                                {shifts[clearConfirmIndex] ? shifts[clearConfirmIndex].split('~')[0].trim() : ''}
                              </span>{' '}
                              시간대의<br />
                              대상자 이름, 장소, 출결, 메모를<br />
                              모두 비울까요?
                            </p>
                            <p className="text-slate-500 text-sm font-medium mb-6 text-center">
                              (초기화 후에도 &apos;되돌리기&apos; 버튼으로 복구할 수 있습니다.)
                            </p>
                            <div className="flex gap-3">
                              <button
                                type="button"
                                onClick={() => setClearConfirmIndex(null)}
                                className="flex-1 py-3 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-xl font-bold text-[17px] sm:text-[18px] shadow-sm active:scale-95 touch-manipulation transition-colors cursor-pointer"
                              >
                                취소
                              </button>
                              <button
                                type="button"
                                onClick={handleConfirmClearCard}
                                className="flex-1 py-3 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold text-[17px] sm:text-[18px] shadow-md active:scale-95 touch-manipulation transition-colors cursor-pointer"
                              >
                                초기화
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {showRepeatConfirm && (
                      <div className="fixed inset-0 bg-slate-900/45 backdrop-blur-[3px] flex items-center justify-center z-50 px-4">
                        <div className="bg-white rounded-2xl shadow-2xl flex flex-col max-w-sm w-full animate-fadeIn overflow-hidden">
                          <div className="bg-indigo-600 py-4 px-6 text-center">
                            <h3 className="text-xl font-bold text-white tracking-wide">확인해 주세요!</h3>
                          </div>
                          <div className="p-6">
                            <p className="text-gray-800 font-bold text-[18px] sm:text-[20px] mb-3 text-center leading-relaxed">
                              아래 <span className="text-indigo-600 text-[18px] sm:text-[20px]">{repeatTargetDates.length}</span>일 동안의 스케줄에<br />
                              {repeatMode === 'shift' && <span className="text-blue-600">해당 시간대({shifts[repeatShiftIndex] ? shifts[repeatShiftIndex].split('~')[0].trim() : ''})의<br /></span>}
                              [학생이름]과 [장소]를<br />정말 복제할까요?
                            </p>
                            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4 max-h-[25vh] overflow-y-auto">
                              {repeatTargetDates.map(obj => (
                                <div key={obj.date} className="text-[16px] sm:text-[18px] font-bold text-blue-600 text-center py-2 border-b last:border-0 border-gray-200">
                                  <div className="text-indigo-800">- {obj.date} ({getDayName(obj.date)})</div>
                                  <div className="text-sm text-gray-500 font-normal mt-1">{obj.times.map(t => t.split('~')[0].trim()).join(', ')}</div>
                                </div>
                              ))}
                            </div>
                            <p className="text-red-600 text-[18px] sm:text-[20px] font-bold mb-6 text-center leading-tight">
                              ※ 주의: 기존의 출결기록과 메모는<br /> 모두 지워집니다.
                            </p>
                            <div className="flex gap-3">
                              <button
                                onClick={() => setShowRepeatConfirm(false)}
                                className="flex-1 py-3 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-xl font-bold text-[18px] sm:text-[20px] shadow-sm active:scale-95 touch-manipulation transition-colors"
                              >
                                취소
                              </button>
                              <button
                                onClick={repeatMode === 'shift' ? executeRepeatScheduleForShiftFromModal : executeRepeatSchedule}
                                className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-[18px] sm:text-[20px] shadow-md active:scale-95 touch-manipulation transition-colors"
                              >
                                일정 복제 시작
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {selectedStudentHistory && (() => {
                      const history = [];
                      const realToday = new Date();
                      const realTodayStr = `${realToday.getFullYear()}-${String(realToday.getMonth() + 1).padStart(2, '0')}-${String(realToday.getDate()).padStart(2, '0')}`;

                      // dateStr -> shiftTime -> records 형태로 그룹핑
                      const groupedByDateAndShift = {};
                      studentHistoryLogs.forEach(row => {
                        const dateStr = row.log_date;
                        if (dateStr > realTodayStr) return;

                        const shiftTime = row.shift || "";
                        if (!groupedByDateAndShift[dateStr]) {
                          groupedByDateAndShift[dateStr] = {};
                        }
                        if (!groupedByDateAndShift[dateStr][shiftTime]) {
                          groupedByDateAndShift[dateStr][shiftTime] = [];
                        }
                        groupedByDateAndShift[dateStr][shiftTime].push(row);
                      });

                      Object.keys(groupedByDateAndShift).forEach(dateStr => {
                        const dayData = groupedByDateAndShift[dateStr];
                        Object.keys(dayData).forEach(shiftTime => {
                          const records = dayData[shiftTime] || [];

                          if (records.length > 0) {
                            const teacherNames = Array.from(new Set(records.map(r => r.teacher).filter(Boolean))).join(', ');

                            const memoGroups = {};
                            records.forEach(r => {
                              let statusStr = formatStatusIfDate(r.status) || "";
                              let memo = statusStr.replace(/\u200B/g, '').trim();
                              memo = memo.replace(/\r\n/g, '\n').split('\n').map(l => l.trimEnd()).join('\n').trim();

                              if (memo === "1" || memo === "출석") memo = "출석 (메모 없음)";
                              else if (!memo) memo = "내용 없음";

                              if (!memoGroups[memo]) memoGroups[memo] = [];
                              if (r.teacher) memoGroups[memo].push(r.teacher);
                            });


                            const uniqueMemos = Object.keys(memoGroups);
                            let mergedMemo = "";
                            const isAbsent = (() => {
                              let hasInd = false;
                              uniqueMemos.forEach(memo => {
                                memo.split(/(결석)/g).forEach((subPart, j, arr) => {
                                  if (subPart === '결석') {
                                    const prevChar = arr[j - 1]?.slice(-1) || '';
                                    const nextChar = arr[j + 1]?.[0] || '';
                                    if (!/[가-힣a-zA-Z0-9]/.test(prevChar) && !/[가-힣a-zA-Z0-9]/.test(nextChar)) hasInd = true;
                                  }
                                });
                              });
                              return hasInd;
                            })();

                            if (isAbsent) {
                              mergedMemo = uniqueMemos.find(memo => {
                                let found = false;
                                memo.split(/(결석)/g).forEach((subPart, j, arr) => {
                                  if (subPart === '결석') {
                                    const prevChar = arr[j - 1]?.slice(-1) || '';
                                    const nextChar = arr[j + 1]?.[0] || '';
                                    if (!/[가-힣a-zA-Z0-9]/.test(prevChar) && !/[가-힣a-zA-Z0-9]/.test(nextChar)) found = true;
                                  }
                                });
                                return found;
                              });
                            } else if (uniqueMemos.length === 1) {
                              mergedMemo = uniqueMemos[0];
                            } else {
                              mergedMemo = uniqueMemos.map(memo => {
                                const tNames = Array.from(new Set(memoGroups[memo])).join(', ');
                                return `[${tNames}] ${memo}`;
                              }).join('\n');
                            }

                            history.push({
                              date: dateStr,
                              dayOfWeek: getDayName(dateStr),
                              shift: shiftTime,
                              memo: mergedMemo,
                              teacher: teacherNames
                            });
                          }
                        });
                      });

                      history.sort((a, b) => {
                        if (b.date !== a.date) return b.date.localeCompare(a.date);
                        const getT = (s) => {
                          const match = s.match(/(\d+):(\d+)/);
                          return match ? parseInt(match[1]) * 60 + parseInt(match[2]) : 0;
                        };
                        return getT(a.shift) - getT(b.shift);
                      });

                      return (
                        <div className="fixed inset-0 bg-slate-900/45 backdrop-blur-[3px] flex items-center justify-center z-[60] px-2 sm:px-4" onClick={() => setSelectedStudentHistory(null)}>
                          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl overflow-hidden flex flex-col max-h-[80vh] animate-fadeIn" onClick={e => e.stopPropagation()}>
                            <div className="bg-green-600 text-white py-3 px-4 flex justify-between items-center shrink-0">
                              <h3 className="font-bold text-[18px] sm:text-[20px]">{selectedStudentHistory.name}님의 이전 교육 기록</h3>
                              <button onClick={() => setSelectedStudentHistory(null)} className="text-white hover:text-gray-200 active:scale-90 transition-transform">
                                <svg className="w-6 h-6 sm:w-7 sm:h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                              </button>
                            </div>
                            <div className="p-3 sm:p-4 overflow-y-auto space-y-3">
                              {isFetchingHistory ? (
                                <div className="text-center text-gray-500 py-8 font-bold text-[16px] sm:text-[18px] flex flex-col items-center justify-center gap-2">
                                  <svg className="animate-spin h-8 w-8 text-green-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                  </svg>
                                  <span>기록을 불러오는 중입니다...</span>
                                </div>
                              ) : (
                                <>
                                  {history.map((h, idx) => {
                                    let cleanMemo = h.memo;

                                    let isAbsent = false;
                                    cleanMemo.split(/(결석)/g).forEach((subPart, j, arr) => {
                                      if (subPart === '결석') {
                                        const prevChar = arr[j - 1]?.slice(-1) || '';
                                        const nextChar = arr[j + 1]?.[0] || '';
                                        if (!/[가-힣a-zA-Z0-9]/.test(prevChar) && !/[가-힣a-zA-Z0-9]/.test(nextChar)) isAbsent = true;
                                      }
                                    });
                                    const textColorClass = isAbsent ? "text-red-600" : "text-gray-800";

                                    return (
                                      <div key={idx} className="bg-gray-50 border border-gray-200 rounded-lg p-3 shadow-sm">
                                        <div className="flex items-center justify-between gap-2 mb-1">
                                          <div className="text-sm font-bold text-gray-500">
                                            {h.date} ({h.dayOfWeek}) <span className="text-gray-400 ml-1">{h.shift ? h.shift.split('~')[0].trim() : ''}</span>
                                            {h.teacher && <span className="text-indigo-600 ml-2 font-extrabold tracking-tight">[{h.teacher}]</span>}
                                          </div>
                                          {selectedStudentHistory.shiftIndex !== undefined && cleanMemo && cleanMemo !== "내용 없음" && cleanMemo !== "출석 (메모 없음)" && !isAbsent && (
                                            <button
                                              type="button"
                                              onClick={() => {
                                                const sIdx = selectedStudentHistory.shiftIndex;
                                                const cur = (logs[sIdx]?.memo || "").trim();
                                                const next = cur ? `${cur}\n${cleanMemo}` : cleanMemo;
                                                handleLogChange(sIdx, 'memo', next);
                                                setSelectedStudentHistory(null);
                                              }}
                                              className="px-2 py-0.5 rounded-md bg-emerald-100 hover:bg-emerald-200 text-emerald-800 border border-emerald-300 text-[12px] font-extrabold whitespace-nowrap active:scale-95 transition"
                                            >
                                              메모에 이어쓰기
                                            </button>
                                          )}
                                        </div>
                                        <div className={`text-base sm:text-lg font-bold ${textColorClass} break-words whitespace-pre-wrap`}>{cleanMemo}</div>
                                      </div>
                                    );
                                  })}
                                  {history.length === 0 && (
                                    <div className="text-center text-gray-500 py-4 font-bold text-[16px] sm:text-[18px]">이전 교육 기록이 없습니다.</div>
                                  )}
                                </>
                              )}
                            </div>
                            <div className="p-3 bg-gray-50 border-t flex justify-end shrink-0">
                              <button onClick={() => setSelectedStudentHistory(null)} className="px-4 py-2 bg-gray-200 text-gray-800 font-bold rounded-lg hover:bg-gray-300 transition-colors active:scale-95 shadow-sm">닫기</button>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {selectedStudentDates && (
                      <div className="fixed inset-0 bg-slate-900/45 backdrop-blur-[3px] flex items-center justify-center z-[60] px-2 sm:px-4" onClick={() => setSelectedStudentDates(null)}>
                        <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl overflow-hidden flex flex-col max-h-[80vh] animate-fadeIn" onClick={e => e.stopPropagation()}>
                          <div className="bg-purple-600 text-white py-3 px-4 flex justify-between items-center shrink-0">
                            <h3 className="font-bold text-[18px] sm:text-[20px]">{selectedStudentDates.name}님의 출석 일자 <span className="text-purple-200 text-[15px] sm:text-[16px]">({selectedStudentDates.count}회)</span></h3>
                            <button onClick={() => setSelectedStudentDates(null)} className="text-white hover:text-gray-200 active:scale-90 transition-transform">
                              <svg className="w-6 h-6 sm:w-7 sm:h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                            </button>
                          </div>
                          <div className="p-3 sm:p-4 overflow-y-auto">
                            <div className="grid grid-cols-4 gap-2 sm:gap-3">
                              {selectedStudentDates.dates.map((d, idx) => {
                                const today = new Date();
                                const isToday = d.date.getFullYear() === today.getFullYear() && d.date.getMonth() === today.getMonth() && d.date.getDate() === today.getDate();
                                const isAbsentDay = !!d.isAbsent;
                                const isVacationDay = !!d.isVacation;
                                const isEndDay = !!d.isEnd;
                                let cellClass = '';
                                if (isEndDay || isVacationDay) {
                                  cellClass = 'bg-gray-100 border-gray-300 shadow-sm text-gray-700';
                                } else if (isAbsentDay) {
                                  cellClass = 'bg-orange-50 border-orange-200 shadow-sm text-orange-900';
                                } else if (isToday) {
                                  cellClass = 'bg-purple-300 border-purple-500 shadow-md text-purple-950';
                                } else {
                                  cellClass = 'bg-purple-50 border-purple-200 shadow-sm text-purple-900';
                                }
                                return (
                                  <div key={idx} className={`${cellClass} border rounded-lg py-2 sm:py-2.5 px-0.5 sm:px-1 text-center text-[13.5px] min-[360px]:text-[15.5px] sm:text-[18px] font-bold flex justify-center items-center whitespace-nowrap tracking-tighter sm:tracking-normal relative`}>
                                    <span className="absolute top-0.5 left-1 text-[11px] sm:text-[13px] font-normal leading-none opacity-90 flex items-center gap-0.5">
                                      {d.excludeFromCount ? (
                                        <span>{isVacationDay ? '휴가' : '결석'}</span>
                                      ) : (
                                        <>
                                          {d.sessionNum !== undefined ? d.sessionNum : (idx + 1)}
                                          {(isAbsentDay || isEndDay) && (
                                            <span className="text-[9px] sm:text-[10px] font-normal opacity-90 ml-0.5">
                                              {isEndDay ? '종료' : '결석'}
                                            </span>
                                          )}
                                        </>
                                      )}
                                    </span>
                                    {d.date.getMonth() + 1}/{d.date.getDate()} ({['일', '월', '화', '수', '목', '금', '토'][d.date.getDay()]})
                                  </div>
                                );
                              })}
                            </div>
                            {selectedStudentDates.dates.length === 0 && (
                              <div className="text-center text-gray-500 py-4 font-bold text-[16px] sm:text-[18px]">출석 기록이 없습니다.</div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {showLogoutConfirm && (
                      <div className="fixed inset-0 bg-slate-900/45 backdrop-blur-[3px] flex items-center justify-center z-[70] px-4">
                        <div className="bg-white rounded-2xl shadow-2xl flex flex-col max-w-sm w-full animate-fadeIn overflow-hidden">
                          <div className="bg-blue-600 py-4 px-6 text-center">
                            <h3 className="text-xl font-bold text-white tracking-wide">저장 확인</h3>
                          </div>
                          <div className="p-6">
                            <p className="text-gray-800 font-bold text-[18px] sm:text-[20px] mb-6 text-center leading-relaxed break-keep">
                              변경된 근무일지가 저장되지 않았습니다.<br />저장하시겠습니까?
                            </p>
                            <div className="flex gap-3">
                              <button
                                onClick={handleLogoutConfirmYes}
                                className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-[18px] sm:text-[20px] shadow-md active:scale-95 touch-manipulation transition-colors"
                              >
                                예
                              </button>
                              <button
                                onClick={handleLogoutConfirmNo}
                                className="flex-1 py-3 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-xl font-bold text-[18px] sm:text-[20px] shadow-sm active:scale-95 touch-manipulation transition-colors"
                              >
                                아니오
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {photoModalTarget && (
                      <StudentPhotoModal
                        target={photoModalTarget}
                        onClose={() => setPhotoModalTarget(null)}
                        onPhotosChanged={(name, count) => {
                          const key = normalizeStudentPhotoKey(name);
                          setStudentPhotoCounts((prev) => ({ ...prev, [key]: count }));
                          fetchPhotoSummaryByStudent()
                            .then(({ counts, dateCounts }) => {
                              setStudentPhotoCounts(counts);
                              setStudentPhotoDateCounts(dateCounts);
                            })
                            .catch(() => { });
                        }}
                      />
                    )}

                    <QuickNavBar
                      currentView="main"
                      onSelectView={async (targetView) => {
                        if (targetView === 'main') return;
                        if (hasChangesRef.current) {
                          const ok = await showConfirm('저장하지 않은 변경 사항이 있습니다. 저장하지 않고 이동할까요?');
                          if (!ok) return;
                        }
                        if (targetView === 'myWeeklySchedule') {
                          onNavigateToMyWeeklySchedule();
                        } else if (targetView === 'dailySchedule') {
                          window.sessionStorage.removeItem('sungdong_daily_schedule_date');
                          onNavigateToDailySchedule(selectedTeam || '1팀');
                        } else if (targetView === 'studentSearch') {
                          onNavigateToStudentSearch();
                        }
                      }}
                    />
                  </div>
                  );
}
