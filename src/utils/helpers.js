import { supabaseClient } from './supabase';

// 삭제 가능한 캐시 키 목록 및 접두사 (용량 초과 시 자동 정리 대상)
const PURGEABLE_PREFIXES = [
  'sungdong_schedule_',
  'sungdong_weather_',
  'sungdong_teachers_',
  'log_backup_',
  'classroom_',
  'nangman_'
];

const PURGEABLE_KEYS = [
  'sungdong_today_notices',
  'sungdong_holidays',
  'sungdong_recent_searches',
  'sungdong_teacher_list',
  'classroom_schedule_backup',
  'classroom_memo_backup',
  'nangman_schedule_backup',
  'nangman_memo_backup'
];

// 메모리 폴백 스토리지 (localStorage, sessionStorage 모두 가득 찼거나 비활성화된 경우)
const memoryStorage = new Map();

/**
 * 용량 부족 시 불필요한 대용량 캐시들을 즉시 정리
 */
export const clearExpendableStorage = () => {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const keysToRemove = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k) continue;
      // 필수 로그인/설정 키 제외하고 캐시 데이터 정리
      if (
        k === 'sungdong_team' ||
        k === 'sungdong_teacher' ||
        k === 'sungdong_admin_logged_in' ||
        k === 'sungdong_admin_password' ||
        k === 'sungdong_bg_gray_level' ||
        k === 'sungdong_room_popup_mode'
      ) {
        continue;
      }
      if (PURGEABLE_KEYS.includes(k) || PURGEABLE_PREFIXES.some(prefix => k.startsWith(prefix))) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach(k => {
      try { window.localStorage.removeItem(k); } catch (e) {}
    });
  } catch (e) {
    console.warn("Storage cleanup error:", e);
  }
};

/**
 * 이전 일정 캐시 중 현재 유지할 키(keepKey)를 제외한 나머지 오래된 일정 캐시 정리
 */
export const pruneOldScheduleCaches = (keepKey = null) => {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const scheduleKeys = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith('sungdong_schedule_') && k !== keepKey) {
        scheduleKeys.push(k);
      }
    }
    scheduleKeys.forEach(k => {
      try { window.localStorage.removeItem(k); } catch (e) {}
    });
  } catch (e) {}
};

/**
 * 오래된 업무일지 메모 백업 키 자동 정리
 */
export const pruneOldLogBackups = () => {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const today = new Date().toISOString().slice(0, 10);
    const keysToRemove = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith('log_backup_') && !k.includes(today)) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach(k => {
      try { window.localStorage.removeItem(k); } catch (e) {}
    });
  } catch (e) {}
};

// 앱 시작 시 오래된 대용량 캐시 및 이전 메모 백업 1회 정리
if (typeof window !== 'undefined' && window.localStorage) {
  try {
    pruneOldScheduleCaches();
    pruneOldLogBackups();
  } catch (e) {}
}

/**
 * 안전한 로컬/세션/메모리 스토리지 읽기
 */
export const getSavedItem = (key, defaultValue) => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const item = window.localStorage.getItem(key);
      if (item !== null && item !== undefined) return item;
    }
  } catch (error) {}
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      const sessionItem = window.sessionStorage.getItem(key);
      if (sessionItem !== null && sessionItem !== undefined) return sessionItem;
    }
  } catch (error) {}
  if (memoryStorage.has(key)) {
    return memoryStorage.get(key);
  }
  return defaultValue;
};

/**
 * 안전한 로컬/세션/메모리 스토리지 저장 (QuotaExceededError 100% 방지 및 다단계 폴백)
 */
export const setSavedItem = (key, value) => {
  try {
    if (value !== undefined && value !== null && value !== '') {
      memoryStorage.set(key, String(value));
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(key, String(value));
          return;
        }
      } catch (err) {
        console.warn(`localStorage 용량 부족 ('${key}' 저장 중). 임시 캐시 정리 후 재시도합니다.`);
        clearExpendableStorage();
        try {
          if (typeof window !== 'undefined' && window.localStorage) {
            window.localStorage.setItem(key, String(value));
            return;
          }
        } catch (retryErr) {
          console.warn(`localStorage 재시도 실패. sessionStorage로 임시 저장합니다.`);
          try {
            if (typeof window !== 'undefined' && window.sessionStorage) {
              window.sessionStorage.setItem(key, String(value));
              return;
            }
          } catch (sErr) {
            console.warn(`sessionStorage 저장 실패. 메모리에만 유지합니다.`);
          }
        }
      }
    } else {
      memoryStorage.delete(key);
      try { if (typeof window !== 'undefined' && window.localStorage) window.localStorage.removeItem(key); } catch (e) {}
      try { if (typeof window !== 'undefined' && window.sessionStorage) window.sessionStorage.removeItem(key); } catch (e) {}
    }
  } catch (error) {
    console.warn("setSavedItem error:", error);
  }
};

/**
 * 안전한 항목 삭제
 */
export const removeSavedItem = (key) => {
  try { memoryStorage.delete(key); } catch (e) {}
  try { if (typeof window !== 'undefined' && window.localStorage) window.localStorage.removeItem(key); } catch (e) {}
  try { if (typeof window !== 'undefined' && window.sessionStorage) window.sessionStorage.removeItem(key); } catch (e) {}
};

/**
 * 대용량 JSON 객체 캐싱 전용 안전 저장 함수
 */
export const safeJsonSetItem = (key, data) => {
  try {
    if (key.startsWith('sungdong_schedule_')) {
      pruneOldScheduleCaches(key);
    }
    const jsonStr = JSON.stringify(data);
    memoryStorage.set(key, jsonStr);
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(key, jsonStr);
      }
    } catch (e) {
      console.warn(`safeJsonSetItem: 용량 초과로 '${key}' 캐싱 정리 시도`);
      clearExpendableStorage();
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(key, jsonStr);
        }
      } catch (retryErr) {
        console.warn(`safeJsonSetItem: 용량 한계로 '${key}' 로컬 캐싱 생략 (메모리 유지).`);
      }
    }
  } catch (e) {
    console.warn(`safeJsonSetItem 직렬화 오류 ('${key}'):`, e);
  }
};

export const getSessionItem = (key, defaultValue) => {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      const item = window.sessionStorage.getItem(key);
      return item !== null && item !== undefined ? item : defaultValue;
    }
  } catch (error) { return defaultValue; }
  return defaultValue;
};

export const setSessionItem = (key, value) => {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      if (value !== undefined && value !== null && value !== '') window.sessionStorage.setItem(key, String(value));
      else window.sessionStorage.removeItem(key);
    }
  } catch (error) { }
};

// 날짜 관련 헬퍼
export const getLocalDateString = (d) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const getInitialWeekday = () => {
  const d = new Date();
  if (d.getDay() === 6) d.setDate(d.getDate() + 2);
  else if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return getLocalDateString(d);
};

export const getDayName = (dateStr) => {
  if (!dateStr) return '';
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  return days[new Date(dateStr).getDay()];
};

export const formatStatusIfDate = (val) => {
  if (val === undefined || val === null) return '';
  const strVal = String(val);
  const isIso = /^\d{4}-\d{2}-\d{2}T/.test(strVal);
  const isGmt = /[a-zA-Z]{3} [a-zA-Z]{3} \d{1,2} \d{4}/.test(strVal);
  if (isIso || isGmt) {
    const d = new Date(strVal);
    if (!isNaN(d.getTime())) {
      return `${d.getMonth() + 1}/${d.getDate()}`;
    }
  }
  return strVal.replace(/취소/g, '종료');
};

// 이미지 처리 헬퍼
export const getDirectImageUrl = (url) => {
  if (!url) return '';
  let finalUrl = url.trim();
  if (finalUrl.startsWith('//')) finalUrl = 'https:' + finalUrl;
  if (finalUrl.startsWith('data:')) return finalUrl;

  if (finalUrl.toUpperCase().startsWith('=IMAGE(')) {
    const formulaMatch = finalUrl.match(/IMAGE\s*\(\s*["']?\s*([^"'\s,)]+)/i);
    if (formulaMatch && formulaMatch[1]) finalUrl = formulaMatch[1].replace(/["']/g, '');
  }

  let fileId = null;
  if (finalUrl.includes('drive.google.com/file/d/')) {
    const match = finalUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) fileId = match[1];
  } else if (finalUrl.includes('drive.google.com/uc')) {
    const match = finalUrl.match(/id=([a-zA-Z0-9_-]+)/);
    if (match && match[1]) fileId = match[1];
  } else if (finalUrl.includes('drive.google.com/open?id=')) {
    const match = finalUrl.match(/id=([a-zA-Z0-9_-]+)/);
    if (match && match[1]) fileId = match[1];
  }

  if (fileId) {
    return `https://lh3.googleusercontent.com/d/${fileId}=w1000`;
  }
  return finalUrl;
};

// 선생님 정보 관리 헬퍼
let globalTeachersList = [];

export const formatTeacherRow = (t) => ({
  id: t.id,
  team: t.team,
  group: t.group_name || '',
  group_name: t.group_name || '',
  seq_num: t.seq_num ?? null,
  name: t.name,
  shift1: t.shift1 || '',
  shift2: t.shift2 || '',
  shift3: t.shift3 || '',
  is_active: t.is_active !== false,
  hire_date: t.hire_date || null,
  resign_date: t.resign_date || null
});

export const setGlobalTeachersList = (list) => {
  globalTeachersList = Array.isArray(list) ? list : [];
  safeJsonSetItem('sungdong_teacher_list', globalTeachersList);
};

export const getGlobalTeachersList = () => {
  if (globalTeachersList && globalTeachersList.length > 0) return globalTeachersList;
  try {
    const stored = getSavedItem('sungdong_teacher_list', null);
    if (stored) {
      const parsed = JSON.parse(stored);
      globalTeachersList = Array.isArray(parsed) ? parsed : [];
      return globalTeachersList;
    }
  } catch (e) { }
  globalTeachersList = [];
  return globalTeachersList;
};

export const normalizeTeacherName = (name) => (name || '').trim().replace(/[\s\n\r]/g, '');

export const findTeacherRecord = (team, teacherName, teacherList = null) => {
  let list = teacherList || getGlobalTeachersList();
  if (!Array.isArray(list)) list = [];
  const clean = normalizeTeacherName(teacherName);
  return list.find(t => t.team === team && normalizeTeacherName(t.name) === clean) || null;
};

export const getTeacherGroup = (team, teacherName, teacherList = null) => {
  const rec = findTeacherRecord(team, teacherName, teacherList);
  return rec ? (rec.group || rec.group_name || '기타') : '기타';
};

export const isOfficialTeamTeacher = (team, teacherName, teacherList = null) => {
  return !!findTeacherRecord(team, teacherName, teacherList);
};

export const getTeacherShifts = (team, teacherName, teacherList = null) => {
  const rec = findTeacherRecord(team, teacherName, teacherList);
  if (!rec) return [];
  return [rec.shift1, rec.shift2, rec.shift3].filter(Boolean);
};

export const getTeacherDefaultShift = (team, teacherName, groupName = null, teacherList = null) => {
  const rec = findTeacherRecord(team, teacherName, teacherList);
  if (rec && rec.shift1) return rec.shift1;
  const group = groupName || getTeacherGroup(team, teacherName, teacherList);
  if (group === '오후' || team === '3팀') return '13:00~14:00';
  return '9:30~10:30';
};

export const getTeamTeacherNames = (team, teacherList = null) => {
  return (teacherList || getGlobalTeachersList())
    .filter(t => t.team === team && t.is_active !== false)
    .sort((a, b) => getTeacherSortWeight(team, a.name, teacherList) - getTeacherSortWeight(team, b.name, teacherList))
    .map(t => t.name);
};

export const getTeamDefaultShifts = (team, teacherList = null) => {
  const list = (teacherList || getGlobalTeachersList()).filter(t => t.team === team);
  const rec = list.find(t => t.shift1) || list[0];
  if (rec) {
    const shifts = [rec.shift1, rec.shift2, rec.shift3].filter(Boolean);
    if (shifts.length > 0) return shifts;
  }
  if (team === '3팀') return ['13:00~14:00', '14:00~15:00', '15:00~16:00'];
  return ['9:30~10:30', '10:30~11:30', '11:30~12:30'];
};

export const fetchAllTeachersFromDb = async () => {
  try {
    const { data, error } = await supabaseClient
      .from('teachers')
      .select('*')
      .order('team')
      .order('group_name')
      .order('seq_num')
      .order('name');
    if (!error && data) {
      const formatted = data.map(formatTeacherRow);
      setGlobalTeachersList(formatted);
      return formatted;
    }
  } catch (e) {
    console.error('선생님 DB 로딩 에러:', e);
  }
  return getGlobalTeachersList();
};

export function getTeacherSortWeight(team, teacher, teacherList = null) {
  const rec = findTeacherRecord(team, teacher, teacherList);
  if (rec && rec.seq_num !== '' && rec.seq_num !== null && rec.seq_num !== undefined) {
    const seq = parseInt(rec.seq_num, 10);
    if (!isNaN(seq)) return seq;
  }
  const list = (teacherList || getGlobalTeachersList()).filter(t => t.team === team);
  const cleanTeacher = normalizeTeacherName(teacher);
  const idx = list.findIndex(t => normalizeTeacherName(t.name) === cleanTeacher);
  return idx !== -1 ? idx : 999;
}

export function getGroupWeight(group) {
  if (!group) return 99;
  if (group === '오전') return 1;
  if (group === '오후') return 2;
  const match = group.match(/(\d+)조/);
  if (match) return parseInt(match[1]);
  return 99;
}

export function getShiftWeight(shift) {
  if (!shift) return 9999;
  const match = shift.match(/(\d+):(\d+)/);
  if (match) {
    return parseInt(match[1]) * 60 + parseInt(match[2]);
  }
  return 9999;
}

export const teamList = ['1팀', '2팀', '3팀', '취업팀'];

export const isTargetTeacher = (teacher) => teacher && (teacher.includes('천은선') || teacher.includes('서승희'));

/**
 * 한국어 받침(종성) 유무 판별 함수
 * - 대상 문자열 뒤의 닫는 괄호, 특수기호, 공백 등을 제거한 후 실질적인 끝음절의 종성을 검사합니다.
 * - 한글 완성형 (0xAC00 ~ 0xD7A3): (code - 0xAC00) % 28 > 0 이면 받침 있음
 * - 숫자: 0, 1, 3, 6, 7, 8 (영, 일, 삼, 육, 칠, 팔)은 받침 있음 / 2, 4, 5, 9 (이, 사, 오, 구)는 받침 없음
 * - 영문 끝소리: 대부분 모음 발음(에이, 비, 씨...)이며 L, M, N, R만 자음 받침(엘, 엠, 엔, 알)을 가짐
 */
export const hasJongseong = (str) => {
  if (!str) return false;
  const cleaned = String(str).trim().replace(/[\s)\]}"'.,·~]+$/g, '');
  if (!cleaned) return false;

  const lastChar = cleaned[cleaned.length - 1];
  const code = lastChar.charCodeAt(0);

  // 1. 한글 완성형 음절
  if (code >= 0xac00 && code <= 0xd7a3) {
    return (code - 0xac00) % 28 > 0;
  }

  // 2. 아라비아 숫자
  if (/[0-9]/.test(lastChar)) {
    return /[013678]/.test(lastChar);
  }

  // 3. 영문 알파벳 (L, M, N, R만 국문 표기 시 종성 자음 받침 형성)
  if (/[a-zA-Z]/.test(lastChar)) {
    return /[lmnr]/i.test(lastChar);
  }

  return false;
};

/**
 * 조사 '와/과' 자동 결합 (받침 있으면 '과', 없으면 '와')
 * 예: 카카오톡 -> 카카오톡과 / 제미나이 -> 제미나이와 / 소통 -> 소통과 / AI·스마트 도구 -> AI·스마트 도구와
 */
export const attachWaGwa = (word) => {
  if (!word) return '';
  return hasJongseong(word) ? `${word}과` : `${word}와`;
};

/**
 * 조사 '은/는' 자동 결합 (받침 있으면 '은', 없으면 '는')
 */
export const attachEunNeun = (word) => {
  if (!word) return '';
  return hasJongseong(word) ? `${word}은` : `${word}는`;
};

/**
 * 조사 '을/를' 자동 결합 (받침 있으면 '을', 없으면 '를')
 */
export const attachEulReul = (word) => {
  if (!word) return '';
  return hasJongseong(word) ? `${word}을` : `${word}를`;
};

/**
 * 조사 '이/가' 자동 결합 (받침 있으면 '이', 없으면 '가')
 */
export const attachYiGa = (word) => {
  if (!word) return '';
  return hasJongseong(word) ? `${word}이` : `${word}가`;
};

/**
 * 서술격 조사 '이에요/예요' 자동 결합 (받침 있으면 '이에요', 없으면 '예요')
 * 예: 수업 -> 수업이에요 / 사정 -> 사정이에요 / 미디어 -> 미디어예요 / 2건 -> 2건이에요
 */
export const attachYiYe = (word) => {
  if (!word) return '';
  return hasJongseong(word) ? `${word}이에요` : `${word}예요`;
};

/**
 * 조사 '로/으로' 자동 결합 (받침 없거나 'ㄹ' 받침은 '로', 그 외 받침은 '으로')
 */
export const attachRoEuro = (word) => {
  if (!word) return '';
  const cleaned = String(word).trim().replace(/[\s)\]}"'.,·~]+$/g, '');
  if (!cleaned) return word;

  const lastChar = cleaned[cleaned.length - 1];
  const code = lastChar.charCodeAt(0);

  if (code >= 0xac00 && code <= 0xd7a3) {
    const finalIndex = (code - 0xac00) % 28;
    return (finalIndex === 0 || finalIndex === 8) ? `${word}로` : `${word}으로`;
  }

  if (/[0-9]/.test(lastChar)) {
    return /[1245789]/.test(lastChar) ? `${word}로` : `${word}으로`;
  }

  if (/[a-zA-Z]/.test(lastChar)) {
    return /[lr]|[aeiou]/i.test(lastChar) ? `${word}로` : `${word}으로`;
  }

  return `${word}으로`;
};

/**
 * 한국어 단어 목록을 와/과 로 자연스럽게 나열
 * 예:
 * ['카카오톡'] -> '카카오톡'
 * ['카카오톡', '제미나이'] -> '카카오톡과 제미나이'
 * ['제미나이', '카카오톡'] -> '제미나이와 카카오톡'
 * ['카카오톡', '제미나이', '유튜브'] -> '카카오톡, 제미나이와 유튜브'
 * ['제미나이', '카카오톡', '유튜브'] -> '제미나이, 카카오톡과 유튜브'
 */
export const ATTENDANCE_TAGS = ['1', '결석', '종료', '선생님휴가'];

/**
 * daily_logs 레코드의 독립 attendance 컬럼과 메모 status 컬럼을 조합.
 * attendance가 비어 있고 status에 기존 출결 태그가 포함된 구버전 레코드도 그대로 호환됨.
 */
export const mergeAttendanceAndStatus = (attendanceStr, statusStr) => {
  const att = (attendanceStr || '').trim();
  const st = (statusStr || '').replace(/\u200B/g, '').trim();
  if (att && st) return `${att}, ${st}`;
  return att || st || '';
};

export const joinKoreanWithWaGwa = (list) => {
  if (!list || list.length === 0) return '';
  if (list.length === 1) return list[0];
  if (list.length === 2) {
    return `${attachWaGwa(list[0])} ${list[1]}`;
  }
  const prefix = list.slice(0, -2).join(', ');
  const secondLast = list[list.length - 2];
  const last = list[list.length - 1];
  const combined = `${attachWaGwa(secondLast)} ${last}`;
  return prefix ? `${prefix}, ${combined}` : combined;
};
