// 팀 별 오늘 일정 보기

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { supabaseClient } from '../utils/supabase';
import {
  getSavedItem,
  getLocalDateString,
  getInitialWeekday,
  getTeacherGroup,
  getTeacherSortWeight,
  getGroupWeight,
  getShiftWeight,
  getDirectImageUrl,
  getTeacherShifts,
  getTeamTeacherNames,
  findTeacherRecord,
  attachWaGwa,
  attachYiYe,
  joinKoreanWithWaGwa,
  mergeAttendanceAndStatus
} from '../utils/helpers';
import { Home, LucideCalendar, Clock, BookOpen, Sparkles, User, CalendarClockIcon } from './Icons';

// 문자열 내에 콤마나 슬래시로 구분된 특정 키워드가 정확히 일치하는지 검사하는 유틸리티 함수
const hasIndependentKeyword = (str, keywords) => {
  if (!str) return false;
  const tokens = str.split(/[,/]+/).map(t => t.trim());
  return tokens.some(token => keywords.includes(token));
};

const mapShiftToOfficial = (team, teacherName, originalShift) => {
  if (!originalShift || !teacherName) return originalShift;
  const officialShifts = getTeacherShifts(team, teacherName);
  if (!officialShifts || officialShifts.length === 0) return originalShift;
  if (officialShifts.includes(originalShift)) return originalShift;

  const standardDefaults = team === "3팀"
    ? ["13:00~14:00", "14:00~15:00", "15:00~16:00"]
    : ["9:30~10:30", "10:30~11:30", "11:30~12:30"];

  const idx = standardDefaults.indexOf(originalShift);
  if (idx !== -1 && officialShifts[idx]) {
    return officialShifts[idx];
  }
  return originalShift;
};

const checkIsCanceled = (status) => {
  if (!status) return false;
  const tokens = status.split(/[,/]+/).map(t => t.trim());
  const isFirstWord = tokens[0] === "취소" || tokens[0] === "종료";
  const isSecondWord = tokens.length > 1 && (tokens[1] === "취소" || tokens[1] === "종료");
  return isFirstWord || isSecondWord;
};

const checkIsEnded = (status) => {
  if (!status) return false;
  const tokens = status.split(/[,/]+/).map(t => t.trim());
  return tokens[0] === "종료" || (tokens.length > 1 && tokens[1] === "종료");
};

// 회차 배지 스타일 (대비 개선 및 범례 일치)
const getSessionBadgeStyle = (count) => {
  if (count >= 15) {
    return 'bg-amber-100 text-amber-950 border border-amber-300 font-bold';
  } else if (count >= 10) {
    return 'bg-indigo-950 text-white font-bold';
  } else if (count >= 7) {
    return 'bg-purple-100 text-purple-900 border border-purple-200 font-bold';
  } else {
    return 'bg-slate-200 text-slate-800 font-bold';
  }
};

// 핵심 교육 테마 분류 정의 (구체적이고 명확한 주제명 및 세부 실습 규칙)
const THEMES = [
  {
    name: '생성형 AI·스마트렌즈·번역',
    keywords: [
      'Gemini', 'AI', 'GPT', '제미나이', '재미나이', '구글렌즈', '클로바', '챗지피티', '챗GPT',
      '인공지능', '파파고', '번역', '음성인식', '스마트렌즈', '빅스비', '시리', '챗봇', '음성검색', '구글번역'
    ],
    icon: '✨',
    subKeywordRules: [
      { label: '제미나이·AI', keywords: ['제미나이', '재미나이', 'Gemini', '챗GPT', 'GPT', '챗지피티', '인공지능', 'AI', '클로바'] },
      { label: '구글렌즈(사물·꽃 검색)', keywords: ['구글렌즈', '스마트렌즈', '렌즈'] },
      { label: '파파고·외국어 번역', keywords: ['파파고', '번역', '구글번역'] },
      { label: '음성인식·비서(빅스비)', keywords: ['빅스비', '시리', '음성인식', '음성검색', '마이크'] }
    ],
    defaultDetails: '제미나이/ChatGPT 인공지능, 구글렌즈 사물인식, 파파고 번역, 음성비서'
  },
  {
    name: '유튜브·사진·동영상',
    keywords: [
      '유튜브', '유트브', '사진', '영상', '동영상', '편집', '갤러리', '숏츠', '쇼츠', '릴스', '틱톡',
      '키네마스터', 'VITA', '캡처', '촬영', '음악', '멜론', '라디오', '팟캐스트', '콜라주', '스티커'
    ],
    icon: '🎥',
    subKeywordRules: [
      { label: '유튜브(시청·구독·쇼츠)', keywords: ['유튜브', '유트브', '쇼츠', '숏츠', '릴스'] },
      { label: '사진 촬영·앨범 정리', keywords: ['사진', '촬영', '앨범', '갤러리', '콜라주', '스티커'] },
      { label: '영상 편집(키네마스터 등)', keywords: ['영상', '동영상', '편집', '키네마스터', 'VITA'] },
      { label: '음악 감상(라디오/멜론)', keywords: ['음악', '멜론', '라디오', '팟캐스트'] }
    ],
    defaultDetails: '유튜브 동영상 시청·쇼츠, 사진 촬영 및 갤러리 관리, 영상 편집'
  },
  {
    name: '카카오톡·문자 소통',
    keywords: [
      '카카오톡', '카톡', '메시지', '메세지', 'SMS', '문자', '이메일', '페이스톡', '영상통화',
      '밴드', '인스타그램', '페이스북', '유선', '연락처', '전화', '단톡방', '오픈채팅', '친구추가'
    ],
    icon: '💬',
    subKeywordRules: [
      { label: '카카오톡(대화·사진전송)', keywords: ['카카오톡', '카톡', '단톡방', '오픈채팅', '친구추가'] },
      { label: '문자(SMS)·영상통화', keywords: ['문자', '메시지', '메세지', 'SMS', '페이스톡', '영상통화'] },
      { label: '밴드·SNS', keywords: ['밴드', '인스타그램', '페이스북'] }
    ],
    defaultDetails: '카카오톡 대화·사진 전송, 단체방, 문자(SMS), 영상통화'
  },
  {
    name: '모바일뱅킹·간편결제',
    keywords: [
      '페이', '이체', '은행', '지로', '보험', '증권', '토스', '카드', '서울페이', '제로페이',
      '카카오페이', '삼성페이', '네이버페이', '계좌', '송금', '환전', '금융'
    ],
    icon: '💰',
    subKeywordRules: [
      { label: '은행 앱 계좌이체', keywords: ['은행', '이체', '송금', '계좌'] },
      { label: '간편결제(서울페이·삼성페이 등)', keywords: ['페이', '카카오페이', '서울페이', '제로페이', '삼성페이', '네이버페이', '토스', '카드'] }
    ],
    defaultDetails: '은행 앱 계좌이체, 토스, 카카오페이/서울페이 간편결제'
  },
  {
    name: '스마트폰 기초설정·스미싱예방',
    keywords: [
      '와이파이', '블루투스', '화면', '소리', '벨소리', '알림', '글자', '업데이트', '비밀번호',
      '잠금', '보안', '용량', '배터리', '설정', '스미싱', '보이스피싱', '스팸', '바이러스', '백신', '키패드'
    ],
    icon: '⚙️',
    subKeywordRules: [
      { label: '기기 기본설정(글자·화면·소리)', keywords: ['화면', '글자', '소리', '벨소리', '알림', '와이파이', '블루투스', '배터리', '용량', '설정'] },
      { label: '보이스피싱·스미싱 예방', keywords: ['스미싱', '보이스피싱', '보안', '바이러스', '백신', '스팸', '비밀번호', '잠금'] }
    ],
    defaultDetails: '화면 밝기·글자 크기, 와이파이, 보이스피싱/스미싱 예방'
  },
  {
    name: '지도·길찾기·교통예매',
    keywords: [
      '지도', '카카오T', '카카오티', '택시', '코레일', '따릉이', 'SRT', '고속버스', '길찾기',
      '길찿기', '내비게이션', '지하철', '버스', '성공버스', '노선', '승차권', '티켓', '기차', '예매'
    ],
    icon: '🚲',
    subKeywordRules: [
      { label: '지도 길찾기(네이버·카카오)', keywords: ['지도', '길찾기', '길찿기', '내비게이션'] },
      { label: '택시 호출(카카오T)', keywords: ['카카오T', '카카오티', '택시'] },
      { label: '대중교통(버스·지하철)', keywords: ['버스', '지하철', '노선', '성공버스', '따릉이'] },
      { label: '기차·고속버스 예매', keywords: ['코레일', 'SRT', '고속버스', '승차권', '티켓', '기차', '예매'] }
    ],
    defaultDetails: '지도 길찾기, 카카오T 택시 호출, 버스 노선, 기차표 예매'
  },
  {
    name: '온라인쇼핑·배달·키오스크',
    keywords: [
      '배민', '배달의민족', '요기요', '쿠팡', '당근', '당근마켓', '중고나라', '쇼핑', '마트',
      '장보기', '이마트', '홈플러스', 'G마켓', '11번가', '주문', '키오스크', '무인'
    ],
    icon: '🛒',
    subKeywordRules: [
      { label: '온라인쇼핑(쿠팡·당근마켓)', keywords: ['쿠팡', '당근', '당근마켓', '쇼핑', '마트', '장보기', '중고나라'] },
      { label: '배달앱 주문', keywords: ['배달', '배민', '배달의민족', '요기요', '주문'] },
      { label: '무인 키오스크 실습', keywords: ['키오스크', '무인'] }
    ],
    defaultDetails: '쿠팡·당근마켓 쇼핑, 배달앱 주문, 무인 키오스크 실습'
  },
  {
    name: '정부24·병원·건강앱',
    keywords: [
      '정부24', '손목닥터', '9988', '홈택스', '주민등록', '증명서', '민원', '국세청', '보조금',
      '복지로', 'PASS', '패스', '모바일신분증', '병원', '약국', '건강', '만보기', '혈압', '진료', '똑닥', '실손24'
    ],
    icon: '🏥',
    subKeywordRules: [
      { label: '손목닥터 9988·건강관리', keywords: ['손목닥터', '9988', '건강', '만보기', '혈압'] },
      { label: '정부24·민원증명서', keywords: ['정부24', '홈택스', '주민등록', '증명서', '민원', '국세청', '보조금', '복지로', '모바일신분증', 'PASS', '패스'] },
      { label: '병원·약국(똑닥·실손24)', keywords: ['병원', '약국', '진료', '똑닥', '실손24'] }
    ],
    defaultDetails: '손목닥터 9988, 정부24 민원증명서, 병원 예약 및 모바일신분증'
  }
];

export default function DailyScheduleApp({ initialTeam, onNavigateBack, onTeamChange }) {
  const [selectedTeam, setSelectedTeam] = useState(initialTeam || "1팀");
  const [activeTab, setActiveTab] = useState('schedule'); // 'schedule' | 'summary'

  // 수업 내용 메모 접기/펼치기 상태 관리
  const [expandedMemos, setExpandedMemos] = useState({});

  const savedTeacher = useMemo(() => (getSavedItem('sungdong_teacher', '') || '').trim(), []);

  const [currentDisplayDate, setCurrentDisplayDate] = useState(() => {
    try {
      const savedDate = window.sessionStorage.getItem('sungdong_daily_schedule_date');
      if (savedDate) {
        const parsedDate = new Date(parseInt(savedDate, 10));
        if (!isNaN(parsedDate.getTime())) return parsedDate;
      }
    } catch (e) { }

    let d = new Date();
    d.setHours(0, 0, 0, 0);
    if (d.getDay() === 6) d.setDate(d.getDate() + 2);
    else if (d.getDay() === 0) d.setDate(d.getDate() + 1);
    return d;
  });

  useEffect(() => {
    try {
      window.sessionStorage.setItem('sungdong_daily_schedule_date', currentDisplayDate.getTime().toString());
    } catch (e) { }
  }, [currentDisplayDate]);

  const [scheduleData, setScheduleData] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [holidaysDbList, setHolidaysDbList] = useState([]);
  const [selectedStudentDates, setSelectedStudentDates] = useState(null);
  const [showLegend, setShowLegend] = useState(false);

  const touchStartX = useRef(null);
  const touchStartY = useRef(null);
  const latestFetchRef = useRef(null);

  useEffect(() => {
    document.documentElement.style.overscrollBehaviorY = 'auto';
    document.body.style.overscrollBehaviorY = 'auto';
  }, []);

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

    if (isLoading) {
      touchStartX.current = null;
      touchStartY.current = null;
      return;
    }

    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 150) {
      if (deltaX > 0) handleDateChange(1);
      else handleDateChange(-1);
    }

    touchStartX.current = null;
    touchStartY.current = null;
  };

  // 공휴일 로드
  useEffect(() => {
    const loadHolidays = async () => {
      try {
        const { data, error } = await supabaseClient.from('holidays').select('*');
        if (!error && data) {
          setHolidaysDbList(data);
        }
      } catch (e) {
        console.error("holidays fetch error", e);
      }
    };
    loadHolidays();
  }, []);

  // 주말 건너뛰기
  useEffect(() => {
    if (holidaysDbList.length > 0) {
      setCurrentDisplayDate(prev => {
        let temp = new Date(prev);
        let changed = false;
        while (temp.getDay() === 0 || temp.getDay() === 6) {
          temp.setDate(temp.getDate() + 1);
          changed = true;
        }
        return changed ? temp : prev;
      });
    }
  }, [holidaysDbList]);

  // 팀 데이터 로드
  const fetchTeamData = useCallback(async (teamName, displayDate) => {
    if (!teamName) return;

    const fetchId = Date.now().toString() + Math.random().toString();
    latestFetchRef.current = fetchId;

    setIsLoading(true);
    setScheduleData([]);
    setNotice("");
    setExpandedMemos({});

    try {
      const dateStr = getLocalDateString(displayDate);
      const { data: supabaseRecords, error: supabaseError } = await supabaseClient
        .from('daily_logs')
        .select('*')
        .eq('team', teamName)
        .eq('log_date', dateStr);

      if (supabaseError) throw supabaseError;

      const records = (supabaseRecords || []).map(r => ({
        ...r,
        status: mergeAttendanceAndStatus(r.attendance, r.status)
      }));

      if (records.length === 0) {
        if (latestFetchRef.current !== fetchId) return;
        setScheduleData([]);
        setNotice(`⚠️ 해당 날짜(${dateStr})의 일지 데이터가 없습니다.`);
        setIsLoading(false);
        return;
      }

      const parsedData = [];
      const teamTeachers = getTeamTeacherNames(teamName).filter(teacher => {
        const tRec = findTeacherRecord(teamName, teacher);
        if (!tRec) return true;
        if (tRec.hire_date && dateStr < tRec.hire_date) return false;
        if (tRec.resign_date && dateStr > tRec.resign_date) return false;
        return true;
      });

      teamTeachers.forEach(teacher => {
        const officialShifts = getTeacherShifts(teamName, teacher) || [];
        const group = getTeacherGroup(teamName, teacher);
        officialShifts.forEach(shift => {
          parsedData.push({
            group: group,
            teacher: teacher,
            time: shift,
            student: "-",
            status: "-",
            location: "",
            sessionCounts: null,
            isSpecial: false
          });
        });
      });

      records.forEach(r => {
        const tRec = findTeacherRecord(teamName, r.teacher);
        if (tRec) {
          if (tRec.hire_date && dateStr < tRec.hire_date) return;
          if (tRec.resign_date && dateStr > tRec.resign_date) return;
        }

        const group = getTeacherGroup(teamName, r.teacher);
        const mappedTime = mapShiftToOfficial(teamName, r.teacher, r.shift);

        const existingIdx = parsedData.findIndex(p => p.teacher === r.teacher && p.time === mappedTime && p.student === "-");
        const formattedRecord = {
          group: group,
          teacher: r.teacher,
          time: mappedTime,
          student: r.student || "",
          status: r.status || "",
          location: r.location || "",
          sessionCounts: null,
          isSpecial: false
        };

        if (existingIdx !== -1) {
          parsedData[existingIdx] = formattedRecord;
        } else {
          parsedData.push(formattedRecord);
        }
      });

      // 학생별 과거 회차 계산
      const allStudents = [];
      const excludeKeywords = ["보조강사", "자체학습", "대상자발굴", "도선복지관", "소양교육", "간담회", "수업", "준비", "컴기초", "공휴일", "근로자의날", "근로자의 날", "삼일절", "3.1절", "어린이날", "현충일", "광복절", "개천절", "한글날", "석가탄신일", "부처님오신날", "성탄절", "제헌절", "추석", "설날", "신정", "대체공휴일", "지방선거일", "지방 선거일", "선거일", "안전교육", "안전교율", "직무교육", "왕초보", "왕초보컴퓨터", "왕초보검퓨터", "왕초보컴퓨터반", "왕초보검퓨터반"];

      parsedData.forEach(row => {
        if (!row.student || row.student.trim() === '-') return;
        const names = row.student.split(/[/,]/).map(s => s.trim().split('(')[0].trim()).filter(Boolean);
        names.forEach(name => {
          if (!excludeKeywords.some(kw => name.includes(kw))) {
            if (!allStudents.includes(name)) allStudents.push(name);
          }
        });
      });

      let allTeamRecords = [];
      if (allStudents.length > 0) {
        const orConditions = allStudents.map(name => `student.ilike.%${name}%`).join(',');
        const { data: histData, error: histError } = await supabaseClient
          .from('daily_logs')
          .select('log_date, student, status, attendance, teacher, shift')
          .neq('student', '')
          .not('student', 'is', null)
          .lte('log_date', dateStr)
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
      }

      const studentDatesMap = {};
      const studentExtraDatesMap = {};
      const studentOffsetsMap = {};
      const dayStatusMap = {};

      allTeamRecords.forEach(hRow => {
        if (!hRow.student) return;
        const names = hRow.student.split(/[/,]/).map(s => s.trim().split('(')[0].trim()).filter(Boolean);
        names.forEach((name, nameIdx) => {
          let personalStatus = hRow.status || "";
          if (personalStatus.includes('/')) {
            const segments = personalStatus.split('/');
            if (segments.length > nameIdx) {
              personalStatus = segments[nameIdx].trim();
            }
          }
          const hasEndOrCancel = checkIsCanceled(personalStatus);
          const hasAttendance = hasIndependentKeyword(personalStatus, ["1", "출석"]);
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
        const names = hRow.student.split(/[/,]/).map(s => s.trim().split('(')[0].trim()).filter(Boolean);
        names.forEach((name, nameIdx) => {
          if (excludeKeywords.some(keyword => name.includes(keyword))) return;

          let personalStatus = hRow.status || "";
          if (personalStatus.includes('/')) {
            const segments = personalStatus.split('/');
            if (segments.length > nameIdx) {
              personalStatus = segments[nameIdx].trim();
            }
          }

          const hasEndOrCancel = checkIsCanceled(personalStatus);
          const hasAttendance = hasIndependentKeyword(personalStatus, ["1", "출석"]);
          const isAbsentOrCanceled = (personalStatus.includes("결석") && !hasAttendance) || (personalStatus.includes("선생님휴가") && !hasAttendance) || (hasEndOrCancel && !hasAttendance);
          const textToMatch = (hRow.memo || hRow.status || "");
          const memoMatches = Array.from(textToMatch.matchAll(/(\d+)\s*회차(?![가-힣a-zA-Z0-9])/g));
          const hasExplicitCount = memoMatches.length > 0;

          if (hRow.log_date === dateStr) return; // 오늘 날짜는 건너뜀

          const dParts = hRow.log_date.split('-');
          const dateObj = new Date(parseInt(dParts[0], 10), parseInt(dParts[1], 10) - 1, parseInt(dParts[2], 10));
          const dayStatus = dayStatusMap[name] && dayStatusMap[name][dateObj.getTime()];

          const isTargetTeacher = (t) => t && (t.includes("천은선") || t.includes("서승희"));
          const isTarget = isTargetTeacher(hRow.teacher);

          const isVacationOnly = (personalStatus.includes("선생님휴가") || personalStatus.includes("휴가")) && !hasAttendance;
          const isOnlyAbsent = (personalStatus.includes("결석") && !hasAttendance) && !isVacationOnly && !(hasEndOrCancel && !hasAttendance);
          const isOnlyEnd = teamName === '취업팀' && personalStatus.split(/[,/]+/).map(t => t.trim()).some(t => t === '종료') && !hasAttendance;

          let isValidDay = false;
          if (isTarget) {
            isValidDay = (dayStatus === 'attended');
          } else if (teamName === '취업팀' && isOnlyAbsent) {
            isValidDay = true;
          } else if (isOnlyEnd) {
            isValidDay = true;
          } else {
            isValidDay = !isAbsentOrCanceled;
          }

          if (!isValidDay && (isOnlyAbsent || isVacationOnly)) {
            if (!studentExtraDatesMap[name]) studentExtraDatesMap[name] = [];
            const hGroup = getTeacherGroup(teamName, hRow.teacher);
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

          if (hasExplicitCount || isValidDay) {
            if (!studentDatesMap[name]) studentDatesMap[name] = [];
            if (studentOffsetsMap[name] === undefined) studentOffsetsMap[name] = 0;
            const hGroup = getTeacherGroup(teamName, hRow.teacher);
            const hShift = hRow.shift || "";

            let alreadyHas = false;
            if (isValidDay) {
              alreadyHas = studentDatesMap[name].some(d => {
                if (isTarget) {
                  const isSameTargetBucket = isTargetTeacher(d.teacher);
                  let isSameClassBucket = (teamName === '취업팀') ? (d.shift === hShift && d.group === hGroup) : (d.group === hGroup);
                  return d.date.getTime() === dateObj.getTime() && (isSameTargetBucket || isSameClassBucket);
                } else {
                  return (teamName === '취업팀')
                    ? (d.date.getTime() === dateObj.getTime() && d.shift === hShift && d.group === hGroup)
                    : (d.date.getTime() === dateObj.getTime() && d.group === hGroup);
                }
              });
            }

            let explicitVal = null;
            if (hasExplicitCount) {
              const matchObj = memoMatches.length > nameIdx ? memoMatches[nameIdx] : memoMatches[0];
              explicitVal = parseInt(matchObj[1], 10);
            }

            if (!alreadyHas && isValidDay) {
              const isAbsentEntry = teamName === '취업팀' && isOnlyAbsent;
              const isEndEntry = teamName === '취업팀' && personalStatus.split(/[,/]+/).map(t => t.trim()).some(t => t === '종료');
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

      // 회차 계산
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

      // 오늘 날짜 데이터와 병합하여 최종 회차 산출
      parsedData.sort((a, b) => {
        const weightA = getGroupWeight(a.group);
        const weightB = getGroupWeight(b.group);
        if (weightA !== weightB) return weightA - weightB;
        if (a.teacher !== b.teacher) {
          return getTeacherSortWeight(teamName, a.teacher) - getTeacherSortWeight(teamName, b.teacher);
        }
        return getShiftWeight(a.time) - getShiftWeight(b.time);
      });

      const todayParts = dateStr.split('-');
      const todayDateObj = new Date(parseInt(todayParts[0], 10), parseInt(todayParts[1], 10) - 1, parseInt(todayParts[2], 10));

      parsedData.forEach(row => {
        if (!row.student || row.student.trim() === '-') {
          row.sessionCounts = null;
          return;
        }

        const names = row.student.split(/[/,]/).map(s => s.trim().split('(')[0].trim()).filter(Boolean);
        const countsForThisRow = [];

        names.forEach((name, nameIdx) => {
          if (excludeKeywords.some(keyword => name.includes(keyword))) return;
          const dates = studentDatesMap[name] || [];
          const extraDates = studentExtraDatesMap[name] || [];

          let todayPersonalStatus = row.status || "";
          if (names.length > 1 && todayPersonalStatus.includes('/')) {
            const segments = todayPersonalStatus.split('/');
            if (segments.length > nameIdx) {
              todayPersonalStatus = segments[nameIdx].trim();
            }
          }
          const todayHasEndOrCancel = checkIsCanceled(todayPersonalStatus);
          const todayHasAttendance = hasIndependentKeyword(todayPersonalStatus, ["1", "출석"]);
          const todayIsVacation = (todayPersonalStatus.includes("선생님휴가") || todayPersonalStatus.includes("휴가")) && !todayHasAttendance;
          const todayIsOnlyAbsent = (todayPersonalStatus.includes("결석") && !todayHasAttendance) && !todayIsVacation && !(todayHasEndOrCancel && !todayHasAttendance);
          const todayIsEnd = todayPersonalStatus.split(/[,/]+/).map(t => t.trim()).some(t => t === '종료');
          const todayIsNonCounted = (todayIsVacation || todayIsOnlyAbsent) && !(teamName === '취업팀' && todayIsOnlyAbsent);

          const currentCount = dates.length > 0 ? (dates[dates.length - 1].sessionNum || dates.length) + 1 : 1;
          const todayEntry = todayIsNonCounted
            ? {
                date: todayDateObj,
                shift: row.time,
                group: row.group,
                teacher: row.teacher,
                isAbsent: todayIsOnlyAbsent,
                isVacation: todayIsVacation,
                excludeFromCount: true
              }
            : {
                date: todayDateObj,
                shift: row.time,
                group: row.group,
                teacher: row.teacher,
                sessionNum: currentCount,
                isAbsent: teamName === '취업팀' && todayIsOnlyAbsent,
                isEnd: todayIsEnd
              };

          const combinedDates = [...dates, ...extraDates, todayEntry].sort((a, b) => a.date.getTime() - b.date.getTime());
          countsForThisRow.push({
            name: name,
            count: currentCount,
            dates: combinedDates
          });
        });

        row.sessionCounts = countsForThisRow.length > 0 ? countsForThisRow : null;
      });

      if (latestFetchRef.current !== fetchId) return;
      setScheduleData(parsedData);
    } catch (error) {
      if (latestFetchRef.current !== fetchId) return;
      console.error("데이터 로드 에러:", error);
      setNotice("⚠️ 데이터를 가져오지 못했습니다.");
    } finally {
      if (latestFetchRef.current === fetchId) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchTeamData(selectedTeam, currentDisplayDate);
  }, [selectedTeam, currentDisplayDate, fetchTeamData]);

  // 날짜 변경 핸들러
  const handleDateChange = (daysToAdd) => {
    setCurrentDisplayDate(prevDate => {
      let tempDate = new Date(prevDate);
      do {
        tempDate.setDate(tempDate.getDate() + daysToAdd);
      } while (tempDate.getDay() === 0 || tempDate.getDay() === 6);
      tempDate.setHours(0, 0, 0, 0);
      return tempDate;
    });
    setNotice("");
  };

  const handleToday = () => {
    let d = new Date();
    d.setHours(0, 0, 0, 0);
    while (d.getDay() === 0 || d.getDay() === 6) {
      d.setDate(d.getDate() + 1);
    }
    setCurrentDisplayDate(d);
    setNotice("");
  };

  const handleDatePick = (e) => {
    if (!e.target.value) return;
    const parts = e.target.value.split('-');
    const selectedDate = new Date(parts[0], parseInt(parts[1]) - 1, parts[2]);
    selectedDate.setHours(0, 0, 0, 0);
    setCurrentDisplayDate(selectedDate);
    setNotice("");
  };

  // 수업 내용 메모 접기/펼치기 토글
  const toggleMemo = (key) => {
    setExpandedMemos(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  // 학생별 출결 상태 판정
  const getRowAttendance = useCallback((row, studentName) => {
    const s = (row.status || "").trim();
    if (!s || s === "-") return 'unconfirmed';

    if (s.includes("선생님휴가") || (s.includes("휴가") && (!row.student || row.student.trim() === '-'))) {
      return 'vacation';
    }
    const hasAttendance = hasIndependentKeyword(s, ["1", "출석"]);
    if ((s.includes("결석") && !hasAttendance) || (checkIsCanceled(s) && !hasAttendance)) {
      return 'absent';
    }
    if (hasAttendance || /^[1-9]\d*/.test(s) || s.length > 2) {
      return 'attended';
    }
    return 'unconfirmed';
  }, []);

  // 현재 일정 중 수업 내용 메모가 있는 모든 행의 고유 키 목록
  const memoRowKeys = useMemo(() => {
    const keys = [];
    scheduleData.forEach(row => {
      const studentStr = (row.student || "").trim();
      const isUnassigned = !studentStr || studentStr === "-" || studentStr.includes("자체학습") || studentStr.includes("대상자발굴");
      const names = studentStr ? studentStr.split(/[/,]/).map(s => s.trim()).filter(Boolean) : [];
      const att = isUnassigned ? 'unassigned' : getRowAttendance(row, names[0]);
      const rawStatus = (row.status || "").trim();
      const hasMemo = rawStatus && rawStatus !== '-' && rawStatus !== '출석' && rawStatus !== '1' && rawStatus.length > 2;
      if (!isUnassigned && att !== 'vacation' && hasMemo) {
        keys.push(`${row.teacher}_${row.time}`);
      }
    });
    return Array.from(new Set(keys));
  }, [scheduleData, getRowAttendance]);

  // 모든 수업 메모가 펼쳐져 있는지 여부
  const isAllExpanded = memoRowKeys.length > 0 && memoRowKeys.every(k => !!expandedMemos[k]);

  // 전체 수업 내용 보기 / 수업 내용 접기 일괄 토글
  const handleToggleAllMemos = () => {
    if (memoRowKeys.length === 0) return;
    if (isAllExpanded) {
      setExpandedMemos({});
    } else {
      const next = {};
      memoRowKeys.forEach(k => {
        next[k] = true;
      });
      setExpandedMemos(next);
    }
  };

  // 통계 계산
  const stats = useMemo(() => {
    let totalStudents = 0;
    let attendedCount = 0;
    let absentCount = 0;
    let vacationCount = 0;
    let unconfirmedCount = 0;
    const absentDetails = [];
    const vacationDetails = [];

    scheduleData.forEach(row => {
      const studentStr = (row.student || "").trim();
      if (!studentStr || studentStr === "-" || studentStr.includes("자체학습") || studentStr.includes("대상자발굴")) return;

      const names = studentStr.split(/[/,]/).map(s => s.trim()).filter(Boolean);
      names.forEach(name => {
        totalStudents++;
        const att = getRowAttendance(row, name);
        if (att === 'attended') {
          attendedCount++;
        } else if (att === 'absent') {
          absentCount++;
          absentDetails.push({ teacher: row.teacher, student: name, status: row.status });
        } else if (att === 'vacation') {
          vacationCount++;
          vacationDetails.push({ teacher: row.teacher, student: name, status: row.status });
        } else {
          unconfirmedCount++;
        }
      });
    });

    const checkedCount = attendedCount + absentCount + vacationCount;
    const currentPercent = totalStudents > 0 ? Math.round((checkedCount / totalStudents) * 100) : 0;
    const finalRate = (attendedCount + absentCount) > 0 ? Math.round((attendedCount / (attendedCount + absentCount)) * 100) : (totalStudents > 0 ? Math.round((attendedCount / totalStudents) * 100) : 0);

    return {
      totalStudents,
      attendedCount,
      absentCount,
      vacationCount,
      unconfirmedCount,
      checkedCount,
      currentPercent,
      finalRate,
      absentDetails,
      vacationDetails
    };
  }, [scheduleData, getRowAttendance]);

  // 교육 내용 메모 기반 주제 카테고리화 및 세부 실습 내용 분석
  const categorizedThemes = useMemo(() => {
    const contents = scheduleData
      .filter(row => row.status && row.status.length > 2 && !/^\d+$/.test(row.status) && !row.status.includes("복지관으로 이동"))
      .map(row => ({
        teacher: row.teacher,
        content: row.status,
        student: row.student
      }));

    const matchedThemes = THEMES.map(theme => {
      const matched = contents.filter(c => theme.keywords.some(k => c.content.toLowerCase().includes(k.toLowerCase())));

      // 해당 테마 안에서 발견된 구체적 실습 키워드 집계 및 친숙한 세부 명칭 매핑
      const kwCountMap = {};
      matched.forEach(item => {
        const text = item.content.toLowerCase();
        theme.subKeywordRules?.forEach(rule => {
          if (rule.keywords.some(k => text.includes(k.toLowerCase()))) {
            kwCountMap[rule.label] = (kwCountMap[rule.label] || 0) + 1;
          }
        });
      });

      const topKeywords = Object.entries(kwCountMap)
        .sort((a, b) => b[1] - a[1])
        .map(([label, count]) => `${label} ${count}건`);

      const cleanSubLabels = Object.entries(kwCountMap)
        .sort((a, b) => b[1] - a[1])
        .map(([label]) => label);

      const detailSummary = topKeywords.length > 0
        ? topKeywords.join(', ')
        : theme.defaultDetails;

      return {
        ...theme,
        count: matched.length,
        items: matched,
        detailSummary,
        cleanSubLabels
      };
    }).filter(t => t.count > 0);

    const categorizedCount = matchedThemes.reduce((acc, t) => acc + t.count, 0);
    const uncategorizedCount = Math.max(0, contents.length - categorizedCount);

    return {
      themes: matchedThemes,
      uncategorizedCount: uncategorizedCount,
      totalMemos: contents.length
    };
  }, [scheduleData]);

  // 근거 중심의 신뢰할 수 있는 사실 문장 3개 생성
  const factualInsights = useMemo(() => {
    const { totalStudents, attendedCount, absentCount, vacationCount, unconfirmedCount, checkedCount, finalRate } = stats;

    // 1. 출결 체크 현황
    let sentence1 = '';
    if (totalStudents === 0) {
      sentence1 = '오늘 배정된 수업 일정이 없습니다.';
    } else if (unconfirmedCount > 0) {
      sentence1 = `수업 ${totalStudents}건 중 출석 확인은 ${checkedCount}건이에요. 아직 ${unconfirmedCount}건이 남아 있어서 출석률은 집계 중입니다.`;
    } else {
      sentence1 = `수업 ${totalStudents}건 모두 출결 확인이 완료되었으며, 출석률은 ${finalRate}%(${attendedCount}건 출석)입니다.`;
    }

    // 2. 결석 · 휴가 사유
    let sentence2 = '';
    if (absentCount === 0 && vacationCount === 0) {
      sentence2 = '오늘 결석 및 휴가자 없이 모든 수업 일정이 순조롭게 진행되었습니다.';
    } else {
      const parts = [];
      if (absentCount > 0) {
        parts.push(`결석 ${absentCount}건은 개인 사정`);
      }
      if (vacationCount > 0) {
        const vacTeachers = Array.from(new Set(stats.vacationDetails.map(d => d.teacher))).filter(Boolean);
        const vacTeacherStr = vacTeachers.length > 0 ? `${vacTeachers.join(', ')} 선생님` : '';
        parts.push(vacTeacherStr ? `휴가 ${vacationCount}건은 ${vacTeacherStr} 수업` : `휴가 ${vacationCount}건은 선생님 휴가 일정`);
      }

      if (parts.length === 1) {
        sentence2 = `${attachYiYe(parts[0])}.`;
      } else {
        const head = parts.slice(0, -1).join('이고, ');
        const tail = parts[parts.length - 1];
        sentence2 = `${head}이고, ${attachYiYe(tail)}.`;
      }
    }

    // 3. 수업 내용 메모 기반 주제
    let sentence3 = '';
    const sorted = [...categorizedThemes.themes].sort((a, b) => b.count - a.count);
    if (sorted.length > 0) {
      const top1 = sorted[0];
      const top2 = sorted[1];

      let topicNames = '';
      if (top2 && top2.count === top1.count) {
        topicNames = `${attachWaGwa(top1.name)} ${top2.name}(각 ${top1.count}건)`;
      } else if (top2) {
        topicNames = `${attachWaGwa(`${top1.name}(${top1.count}건)`)} ${top2.name}(${top2.count}건)`;
      } else {
        topicNames = `${top1.name}(${top1.count}건)`;
      }

      // 구체적 실습 키워드 발췌 (상위 2개 테마의 실제 세부 실습 명칭)
      const foundKeywords = [];
      sorted.slice(0, 2).forEach(t => {
        if (t.cleanSubLabels && t.cleanSubLabels.length > 0) {
          t.cleanSubLabels.forEach(k => {
            if (!foundKeywords.includes(k)) {
              foundKeywords.push(k);
            }
          });
        }
      });

      const sampleKeywords = foundKeywords.slice(0, 3);
      const sampleText = sampleKeywords.length > 0
        ? `세부 실습으로는 ${joinKoreanWithWaGwa(sampleKeywords)} 등이 주로 다루어졌습니다.`
        : '학습자 눈높이에 맞춘 맞춤형 개별 실습이 순조롭게 진행되었습니다.';

      sentence3 = `가장 많이 다룬 주제는 ${attachYiYe(topicNames)}. ${sampleText}`;
    } else {
      sentence3 = '등록된 상세 수업 내용 메모가 없어 교육 주제를 분석 중입니다.';
    }

    return [
      { text: sentence1, evidence: '근거: 출결 체크 현황' },
      { text: sentence2, evidence: '근거: 결석 · 휴가 표시' },
      { text: sentence3, evidence: '근거: 수업 내용 메모' },
    ];
  }, [stats, categorizedThemes]);

  // 조별 -> 선생님별 그룹화
  const groupedByGroup = useMemo(() => {
    const groups = {};
    scheduleData.forEach(row => {
      const grp = row.group || '기타';
      if (!groups[grp]) groups[grp] = {};
      const t = row.teacher || '기타';
      if (!groups[grp][t]) groups[grp][t] = [];
      groups[grp][t].push(row);
    });

    const sortedGroupKeys = Object.keys(groups).sort((a, b) => getGroupWeight(a) - getGroupWeight(b));

    return sortedGroupKeys.map(grpKey => {
      const teachersMap = groups[grpKey];
      const sortedTeacherKeys = Object.keys(teachersMap).sort((a, b) => getTeacherSortWeight(selectedTeam, a) - getTeacherSortWeight(selectedTeam, b));

      return {
        groupName: grpKey,
        teachers: sortedTeacherKeys.map(tKey => ({
          teacherName: tKey,
          shifts: teachersMap[tKey].sort((a, b) => getShiftWeight(a.time) - getShiftWeight(b.time))
        }))
      };
    });
  }, [scheduleData, selectedTeam]);

  // 날짜 문자열 포맷
  const y = currentDisplayDate.getFullYear();
  const m = String(currentDisplayDate.getMonth() + 1).padStart(2, '0');
  const d = String(currentDisplayDate.getDate()).padStart(2, '0');
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  const day = dayNames[currentDisplayDate.getDay()];
  const datePickerValue = `${y}-${m}-${d}`;

  return (
    <div className="min-h-[100dvh] flex flex-col app-surface dark:bg-slate-900 font-sans text-slate-800 dark:text-slate-100">
      {/* 1. 상단 메인 헤더 (원본 헤더 유지) */}
      <div className="shrink-0 app-header text-white z-40 relative">
        <div className="max-w-5xl lg:max-w-[1536px] mx-auto px-2.5 sm:px-5 pb-4 pt-safe-4 flex justify-between items-center">
          <div className="flex items-center min-w-0">
            <div className="flex flex-col min-w-0">
              <div className="flex items-center mb-1">
                <img src="/Logo_of_Seoul.jpg" alt="서울시 로고" className="h-7 hdr-logo object-contain mr-2 shrink-0" onError={(e) => e.target.style.display = 'none'} />
                <h1 className="font-black text-xl leading-tight">성동노인종합복지관</h1>
              </div>
              <p className="text-lg font-semibold text-yellow-300">디지털교육 서포터즈</p>
              <p className="text-base opacity-95 flex items-center mt-1 font-bold">
                {(() => {
                  const savedTeacher = (getSavedItem('sungdong_teacher', '') || '').trim();
                  const savedTeam = (getSavedItem('sungdong_team', '') || '').trim();
                  return savedTeacher ? (
                    <>
                      <User className="w-4 h-4 mr-1 shrink-0" /> [{savedTeam || selectedTeam}] {savedTeacher.replace(/\n/g, ' ')} 선생님
                    </>
                  ) : (
                    <>
                      <User className="w-4 h-4 mr-1 shrink-0" /> [{selectedTeam}] 팀별 오늘 일정
                    </>
                  );
                })()}
              </p>
            </div>
          </div>
          <button onClick={onNavigateBack} className="text-xs flex flex-col items-center font-bold p-2 rounded-lg shadow-md transition-all touch-manipulation hdr-btn shrink-0">
            <Home className="w-5 h-5 mb-1" /> 처음으로
          </button>
        </div>
      </div>

      {/* 2. 본문 컨테이너 */}
      <div
        className="flex-1 flex flex-col pb-4"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <div className="max-w-5xl lg:max-w-[1536px] w-full mx-auto flex-1 flex flex-col px-2.5 sm:px-5 py-3 md:py-6 mt-1">

          {/* 날짜 선택 바 위에 섹션 제목 + 일정/요약 탭 스위처 */}
          <div className="pb-1.5 px-1 flex items-center justify-between gap-2">
            <h2 className="text-[19px] sm:text-xl font-bold text-gray-800 dark:text-gray-100 flex items-center tracking-tight whitespace-nowrap">
              <span className="flex items-center"><CalendarClockIcon className="w-5 h-5 mr-2 text-blue-600" /> 팀별 오늘 일정</span>
            </h2>

            {/* 일정 / 요약 탭 스위처 */}
            <div className="bg-slate-200/80 dark:bg-slate-800 p-0.5 rounded-lg flex items-center shadow-inner shrink-0">
              <button
                type="button"
                onClick={() => setActiveTab('schedule')}
                className={`px-3 sm:px-4 py-0.5 text-[13px] sm:text-[14px] font-bold rounded-md transition-all touch-manipulation text-center cursor-pointer whitespace-nowrap ${activeTab === 'schedule'
                    ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
                  }`}
              >
                일정
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('summary')}
                className={`px-3 sm:px-4 py-0.5 text-[13px] sm:text-[14px] font-bold rounded-md transition-all touch-manipulation text-center cursor-pointer whitespace-nowrap ${activeTab === 'summary'
                    ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
                  }`}
              >
                요약
              </button>
            </div>
          </div>

          {/* 상단 고정 영역: 날짜 선택 바 + 팀 선택 필 */}
          <div
            className="sticky top-0 z-30 app-surface dark:bg-slate-900 pt-1.5 pb-2 -mx-3 px-3 md:-mx-6 md:px-6 shadow-xs border-b border-slate-200/60 dark:border-slate-800"
            onTouchStart={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
          >
            {/* 날짜 선택 바 */}
            <div className="flex items-center justify-between gap-1.5 sm:gap-2 w-full mb-2">
              <button
                onClick={() => handleDateChange(-1)}
                title="이전 날짜"
                className="w-10 sm:w-11 h-10 sm:h-11 flex items-center justify-center border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700 active:scale-95 text-slate-700 dark:text-slate-200 shrink-0 transition-all touch-manipulation cursor-pointer"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6 1.41-1.41z" />
                </svg>
              </button>

              <div className="flex-1 h-10 sm:h-11 relative flex items-center justify-center border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-center shadow-sm">
                <input
                  type="date"
                  value={datePickerValue}
                  onChange={handleDatePick}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  title="달력 열기"
                />
                <span className="font-extrabold text-slate-800 dark:text-slate-100 text-[16px] sm:text-[18px] tracking-tight whitespace-nowrap">
                  {currentDisplayDate.getMonth() + 1}/{currentDisplayDate.getDate()} ({day})
                </span>
              </div>

              <button
                onClick={handleToday}
                className="h-10 sm:h-11 px-3.5 sm:px-4 border border-blue-600 rounded-xl font-bold bg-blue-600 hover:bg-blue-700 active:scale-95 text-white text-[14.5px] sm:text-[15.5px] shrink-0 transition-all shadow-sm touch-manipulation whitespace-nowrap cursor-pointer"
              >
                오늘
              </button>

              <button
                onClick={() => handleDateChange(1)}
                title="다음 날짜"
                className="w-10 sm:w-11 h-10 sm:h-11 flex items-center justify-center border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700 active:scale-95 text-slate-700 dark:text-slate-200 shrink-0 transition-all touch-manipulation cursor-pointer"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" />
                </svg>
              </button>
            </div>

            {/* 팀 선택 필 (1팀 / 2팀 / 3팀 / 취업팀) */}
            <div className="grid grid-cols-4 gap-1.5 sm:gap-2 w-full">
              {["1팀", "2팀", "3팀", "취업팀"].map(team => (
                <button
                  key={team}
                  onClick={() => {
                    setSelectedTeam(team);
                    if (onTeamChange) onTeamChange(team);
                  }}
                  className={`h-10 sm:h-11 flex items-center justify-center text-[15px] sm:text-[16px] font-bold rounded-xl border text-center transition-all touch-manipulation cursor-pointer ${selectedTeam === team
                      ? 'bg-slate-800 dark:bg-slate-200 border-slate-800 dark:border-slate-200 text-white dark:text-slate-900 shadow-sm'
                      : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
                    }`}
                >
                  {team}
                </button>
              ))}
            </div>
          </div>

          {/* 로딩 및 안내 메시지 */}
          <div className="text-center min-h-[16px] mb-2 flex items-center justify-center">
            {isLoading ? (
              <div className="flex items-center justify-center text-blue-600 font-bold text-sm animate-pulse tracking-tight">
                <Clock className="w-4 h-4 mr-1.5 animate-spin" />
                최신 데이터 확인 중...
              </div>
            ) : notice ? (
              <span className="text-red-500 text-sm font-bold">{notice}</span>
            ) : null}
          </div>

          {/* 공휴일 안내 배너 (있는 경우) */}
          {(() => {
            const _y = currentDisplayDate.getFullYear();
            const _m = String(currentDisplayDate.getMonth() + 1).padStart(2, '0');
            const _d = String(currentDisplayDate.getDate()).padStart(2, '0');
            const _currentDateStr = `${_y}-${_m}-${_d}`;
            const _currentDateStrShort = `${_m}-${_d}`;
            const currentHoliday = holidaysDbList.find(h => h.date === _currentDateStr || h.date === _currentDateStrShort || (h.date && h.date.endsWith(_currentDateStrShort)));

            if (currentHoliday && !currentHoliday.vacation_available) {
              return (
                <div className="bg-red-50 dark:bg-red-950/40 border-2 border-red-300 dark:border-red-800 rounded-2xl p-4 sm:p-5 text-center shadow-sm mb-4 animate-fadeIn">
                  <h3 className="text-lg sm:text-xl font-black text-red-700 dark:text-red-400 mb-1">
                    {currentHoliday.name}
                  </h3>
                  {currentHoliday.content1 && (
                    <p className="text-sm sm:text-base font-bold text-red-600 dark:text-red-300">
                      {currentHoliday.content1}
                    </p>
                  )}
                </div>
              );
            }
            return null;
          })()}

          {/* ============================================================== */}
          {/* TAB 1: 일정 탭                                                 */}
          {/* ============================================================== */}
          {activeTab === 'schedule' && (
            <div className="space-y-2.5 animate-fadeIn">

              {/* 회차 색상 안내 토글 & 우측 전체 수업 내용 보기 토글 버튼 */}
              <div className="flex items-center justify-between gap-2 px-0.5 sm:px-1">
                <button
                  type="button"
                  onClick={() => setShowLegend(prev => !prev)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[14px] sm:text-[14.5px] font-bold rounded-lg transition-all touch-manipulation cursor-pointer border shadow-xs active:scale-95 ${showLegend
                      ? 'bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900 border-slate-800 dark:border-slate-200 shadow-sm'
                      : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-slate-900'
                    }`}
                >
                  <span>회차 색상</span>
                  <span className="text-[12px] leading-none opacity-80">{showLegend ? '▴' : '▾'}</span>
                </button>

                {/* 우측 끝: 전체 수업 내용 보기 / 수업 내용 접기 토글버튼 */}
                <button
                  type="button"
                  onClick={handleToggleAllMemos}
                  disabled={memoRowKeys.length === 0}
                  className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-[14px] sm:text-[14.5px] font-bold rounded-lg transition-all touch-manipulation whitespace-nowrap border shadow-xs active:scale-95 ${memoRowKeys.length === 0
                      ? 'text-slate-400 dark:text-slate-500 border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 cursor-not-allowed opacity-60 shadow-none'
                      : isAllExpanded
                        ? 'bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900 border-slate-800 dark:border-slate-200 shadow-sm'
                        : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-slate-900'
                    }`}
                  title={isAllExpanded ? "모든 수업 내용 접기" : "모든 수업 내용 보기"}
                >
                  <span>{isAllExpanded ? '수업 내용 접기' : '수업 내용 보기'}</span>
                  <span className="text-[12px] leading-none opacity-80">{isAllExpanded ? '▴' : '▾'}</span>
                </button>
              </div>

              {showLegend && (
                <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap px-2.5 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl animate-fadeIn">
                  <span className="px-2.5 py-0.5 rounded-md text-[13px] sm:text-[14px] font-bold bg-slate-200 text-slate-800 border border-slate-300">1–6회</span>
                  <span className="px-2.5 py-0.5 rounded-md text-[13px] sm:text-[14px] font-bold bg-purple-100 text-purple-900 border border-purple-200">7–9회</span>
                  <span className="px-2.5 py-0.5 rounded-md text-[13px] sm:text-[14px] font-bold bg-indigo-950 text-white">10–14회</span>
                  <span className="px-2.5 py-0.5 rounded-md text-[13px] sm:text-[14px] font-bold bg-amber-100 text-amber-950 border border-amber-300">15회 이상</span>
                </div>
              )}

              {/* 3. 조별 & 선생님별 카드 목록 */}
              {groupedByGroup.length === 0 ? (
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-8 text-center text-slate-500 font-medium">
                  일정 데이터가 없습니다.
                </div>
              ) : (
                groupedByGroup.map(grp => (
                  <div key={grp.groupName} className="space-y-2">
                    {/* 조 배지 */}
                    <div className="pt-1">
                      <span className="bg-slate-700 dark:bg-slate-600 text-white font-extrabold text-[12.5px] px-2.5 py-0.5 rounded-full shadow-xs">
                        {grp.groupName}
                      </span>
                    </div>

                    {/* 조에 속한 선생님별 카드 */}
                    {grp.teachers.map(teacher => {
                      const isMe = savedTeacher && (teacher.teacherName.trim() === savedTeacher);
                      return (
                        <div
                          key={teacher.teacherName}
                          className={`bg-white dark:bg-slate-800 rounded-xl sm:rounded-2xl border shadow-sm overflow-hidden ${
                            isMe ? 'border-blue-400 dark:border-blue-500 ring-2 ring-blue-400/30' : 'border-slate-300 dark:border-slate-600'
                          }`}
                        >
                          {/* 선생님 카드 헤더 */}
                          <div className={`px-3.5 py-2 tracking-tight flex items-center justify-between border-b text-white ${
                            isMe
                              ? 'bg-blue-700 dark:bg-blue-800 border-blue-800 dark:border-blue-900'
                              : 'bg-slate-700 dark:bg-slate-900 border-slate-800 dark:border-slate-950'
                          }`}>
                            <span className="flex items-baseline gap-1">
                              <span className="font-black text-[17px] sm:text-[18px]">{teacher.teacherName}</span>
                              <span className="font-semibold text-[14px] sm:text-[15px] text-white/85">선생님</span>
                            </span>
                            {isMe && (
                              <span className="text-[12px] font-extrabold bg-white text-blue-700 px-2 py-0.5 rounded-full shadow-2xs">
                                내 일정
                              </span>
                            )}
                          </div>

                          {/* 시간대별 수업 목록 */}
                          <div className="divide-y divide-slate-400 dark:divide-slate-500">
                            {teacher.shifts.map((row, idx) => {
                              const rawStartTime = typeof row.time === 'string'
                                ? row.time.split('~')[0].trim()
                                : String(row.time || '');
                              const startTime = /^\d:\d{2}$/.test(rawStartTime) ? `0${rawStartTime}` : rawStartTime;

                              const studentStr = (row.student || "").trim();
                              const isUnassigned = !studentStr || studentStr === '-';
                              const names = isUnassigned ? [] : studentStr.split(/[/,]/).map(s => s.trim().split('(')[0].trim()).filter(Boolean);

                              const rowKey = `${row.teacher}_${row.time}`;
                              const isExpanded = !!expandedMemos[rowKey];

                              // 메모 내용 추출 (상태 텍스트 중 실제 교육 내용)
                              const rawStatus = (row.status || "").trim();
                              const hasMemo = rawStatus && rawStatus !== '-' && rawStatus !== '출석' && rawStatus !== '1' && rawStatus.length > 2;

                              const att = isUnassigned ? 'unassigned' : getRowAttendance(row, names[0]);

                              // 상태별 좌측 막대 색상 및 배경 톤
                              let barColorClass = '';
                              let rowBgClass = '';

                              if (isUnassigned) {
                                barColorClass = 'bg-slate-200 border-r border-slate-300 dark:bg-slate-700 dark:border-slate-600'; // 배정 없음: 연한 회색 막대
                                rowBgClass = 'bg-slate-50/40 dark:bg-slate-800/40';
                              } else if (att === 'attended') {
                                barColorClass = 'bg-emerald-300 border-r border-emerald-400 dark:bg-emerald-700 dark:border-emerald-600'; // 출석: 에메랄드 그린 막대
                                rowBgClass = 'bg-emerald-50/20 dark:bg-emerald-950/10';
                              } else if (att === 'absent') {
                                barColorClass = 'bg-rose-300 border-r border-rose-400 dark:bg-rose-700 dark:border-rose-600'; // 결석: 코랄 로즈 레드 막대
                                rowBgClass = 'bg-rose-50/20 dark:bg-rose-950/10';
                              } else if (att === 'vacation') {
                                barColorClass = 'bg-amber-300 border-r border-amber-400 dark:bg-amber-700 dark:border-amber-600'; // 휴가: 웜 앰버 막대
                                rowBgClass = 'bg-amber-50/20 dark:bg-amber-950/10';
                              } else {
                                barColorClass = 'bg-slate-300 border-r border-slate-400 dark:bg-slate-600 dark:border-slate-500'; // 확인 전/진행 중: 슬레이트 그레이 막대
                                rowBgClass = 'bg-white dark:bg-slate-800';
                              }

                              const canToggleMemo = !isUnassigned && att !== 'vacation' && hasMemo;

                              return (
                                <div
                                  key={idx}
                                  onClick={canToggleMemo ? () => toggleMemo(rowKey) : undefined}
                                  className={`relative py-1.5 px-2.5 sm:py-2 sm:px-3 pl-3 sm:pl-3.5 transition-colors ${rowBgClass} ${canToggleMemo ? 'cursor-pointer hover:bg-slate-50/70 dark:hover:bg-slate-700/40' : ''}`}
                                >
                                  {/* 시간대 좌측 상태 표시 막대 (우측 버튼과 동일한 색상 배색) */}
                                  <div className={`absolute left-0 top-0 bottom-0 w-2 sm:w-2.5 ${barColorClass} transition-colors`} />

                                  {/* 상단 라인: 시간대, 학생명, 회차 배지 및 우측 끝 출결 토글 버튼 */}
                                  <div className="flex items-center justify-between gap-1.5 sm:gap-2">
                                    <div className="min-w-0 flex-1">
                                      {/* 시간대 & 학생명 & 회차 */}
                                      <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap min-w-0">
                                        {/* 시간대와 학생이름: 무조건 같은 라인에 표시 */}
                                        <div className="inline-flex items-center gap-1.5 sm:gap-2 shrink-0">
                                          <span className="font-bold text-slate-700 dark:text-slate-300 text-[14.5px] sm:text-[16px] whitespace-nowrap tabular-nums">
                                            {startTime}
                                          </span>
                                          {isUnassigned ? (
                                            <span className="text-slate-400 dark:text-slate-500 font-semibold text-[14px] sm:text-[15px] whitespace-nowrap">
                                              배정 없음
                                            </span>
                                          ) : (
                                            <span className="font-bold text-slate-900 dark:text-slate-100 text-[16px] sm:text-[17.5px] tracking-tight whitespace-nowrap">
                                              {studentStr}
                                            </span>
                                          )}
                                        </div>

                                        {/* 회차 배지 및 장소 (공간 부족 시 줄바꿈되더라도 학생이름은 시간대와 항상 같은 라인 유지) */}
                                        {!isUnassigned && (
                                          <div className="inline-flex items-center gap-1 sm:gap-1.5 flex-wrap">
                                            {/* 회차 배지 */}
                                            {row.sessionCounts && row.sessionCounts.map((sc, scIdx) => (
                                              <button
                                                key={scIdx}
                                                type="button"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setSelectedStudentDates(sc);
                                                }}
                                                title="출석 일자 보기"
                                                className={`px-1.5 sm:px-2 py-0.5 rounded-md text-[11.5px] sm:text-[12.5px] tracking-tight shadow-2xs hover:brightness-95 active:scale-95 transition-all touch-manipulation whitespace-nowrap cursor-pointer ${getSessionBadgeStyle(sc.count)}`}
                                              >
                                                {sc.count}회차
                                              </button>
                                            ))}

                                            {/* 장소 표시 (있을 경우) */}
                                            {row.location && row.location !== '-' && row.location !== '복지관' && !row.location.startsWith('http') && (
                                              <span className="text-[11px] sm:text-xs font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap">
                                                ({row.location})
                                              </span>
                                            )}

                                            {/* 수업 메모 있음 아이콘 표시 */}
                                            {canToggleMemo && (
                                              <span
                                                title={isExpanded ? '클릭하여 수업 내용 접기' : '클릭하여 수업 내용 보기'}
                                                className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded-md text-[11px] font-bold transition-colors whitespace-nowrap ${
                                                  isExpanded
                                                    ? 'bg-blue-600 text-white'
                                                    : 'bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
                                                }`}
                                              >
                                                📝
                                              </span>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    </div>

                                    {/* 우측 끝: 출결 상태 버튼 (모바일 화면 폭 최적화: min-w-[48px]로 축소) */}
                                    {!isUnassigned && (
                                      <div className="shrink-0 ml-1">
                                        {(() => {
                                          const att = getRowAttendance(row, names[0]);
                                          const isEnded = checkIsEnded(rawStatus);
                                          let btnClass = '';
                                          let btnLabel = '';

                                          if (att === 'attended') {
                                            btnClass = 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700';
                                            btnLabel = '출석';
                                          } else if (att === 'absent') {
                                            btnClass = 'bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-700';
                                            btnLabel = '결석';
                                          } else if (att === 'vacation') {
                                            btnClass = 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700';
                                            btnLabel = '휴가';
                                          } else {
                                            btnClass = 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600';
                                            btnLabel = '확인 전';
                                          }

                                          return (
                                            <div className="flex items-center gap-1 sm:gap-1.5">
                                              <div
                                                className={`min-h-[26px] sm:min-h-[30px] min-w-[48px] sm:min-w-[60px] px-2 sm:px-2.5 py-0.5 sm:py-1 text-[12.5px] sm:text-[13.5px] font-bold rounded-lg shadow-2xs select-none flex items-center justify-center cursor-default whitespace-nowrap ${btnClass}`}
                                              >
                                                {btnLabel}
                                              </div>
                                              {isEnded && (
                                                <div
                                                  className="min-h-[26px] sm:min-h-[30px] min-w-[44px] sm:min-w-[52px] px-2 sm:px-2.5 py-0.5 sm:py-1 text-[12.5px] sm:text-[13.5px] font-bold rounded-lg shadow-2xs select-none flex items-center justify-center cursor-default whitespace-nowrap bg-indigo-100 dark:bg-indigo-950/60 text-indigo-800 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-700"
                                                >
                                                  종료
                                                </div>
                                              )}
                                            </div>
                                          );
                                        })()}
                                      </div>
                                    )}
                                  </div>

                                  {/* 펼쳐진 수업 메모 내용 */}
                                  {!isUnassigned && att !== 'vacation' && hasMemo && isExpanded && (
                                    <div className="mt-1.5 p-3 rounded-xl bg-blue-50/80 dark:bg-slate-700/60 border border-blue-100 dark:border-slate-600 text-slate-950 dark:text-white font-medium text-[15.5px] sm:text-[16.5px] leading-relaxed whitespace-pre-wrap break-words animate-fadeIn">
                                      {rawStatus}
                                    </div>
                                  )}

                                  {/* 취업팀 서명 이미지 (있을 경우) */}
                                  {row.location && (row.location.startsWith('http') || row.location.startsWith('data:')) && (
                                    <div className="mt-2">
                                      <img
                                        src={getDirectImageUrl(row.location)}
                                        alt="서명"
                                        className="h-12 w-auto object-contain rounded border border-slate-200 bg-white p-0.5"
                                      />
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 2: 요약 탭                                                 */}
          {/* ============================================================== */}
          {activeTab === 'summary' && (
            <div className="space-y-4 animate-fadeIn">

              {/* 0. 출석 확인 현황 카드 & 진행 막대 */}
              <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 sm:p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-extrabold text-[17px] text-slate-800 dark:text-slate-100 tracking-tight">
                    출석 확인
                  </span>
                  <span className="font-extrabold text-[17px] text-slate-800 dark:text-slate-100">
                    {isLoading ? '- / -명' : `${stats.checkedCount} / ${stats.totalStudents}명`}
                  </span>
                </div>

                {/* 진행 막대 */}
                <div className="w-full bg-slate-100 dark:bg-slate-700 h-3 rounded-full overflow-hidden mb-3.5">
                  <div
                    className="bg-blue-600 h-full rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${isLoading ? 0 : stats.currentPercent}%` }}
                  />
                </div>

                {/* 4개 출결 상태 통계 박스 */}
                <div className="grid grid-cols-4 gap-1.5 sm:gap-2 text-center">
                  <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl py-2 flex flex-col items-center justify-center">
                    <span className="text-[20px] font-black text-emerald-800 dark:text-emerald-400 leading-tight">
                      {isLoading ? '-' : stats.attendedCount}
                    </span>
                    <span className="text-[12px] font-bold text-emerald-700 dark:text-emerald-400 mt-0.5">
                      출석
                    </span>
                  </div>

                  <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl py-2 flex flex-col items-center justify-center">
                    <span className="text-[20px] font-black text-rose-800 dark:text-rose-400 leading-tight">
                      {isLoading ? '-' : stats.absentCount}
                    </span>
                    <span className="text-[12px] font-bold text-rose-700 dark:text-rose-400 mt-0.5">
                      결석
                    </span>
                  </div>

                  <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl py-2 flex flex-col items-center justify-center">
                    <span className="text-[20px] font-black text-amber-800 dark:text-amber-400 leading-tight">
                      {isLoading ? '-' : stats.vacationCount}
                    </span>
                    <span className="text-[12px] font-bold text-amber-700 dark:text-amber-400 mt-0.5">
                      휴가
                    </span>
                  </div>

                  <div className="bg-slate-100 dark:bg-slate-700/60 border border-slate-200 dark:border-slate-700 rounded-xl py-2 flex flex-col items-center justify-center">
                    <span className="text-[20px] font-black text-slate-800 dark:text-slate-200 leading-tight">
                      {isLoading ? '-' : stats.unconfirmedCount}
                    </span>
                    <span className="text-[12px] font-bold text-slate-600 dark:text-slate-300 mt-0.5">
                      확인 전
                    </span>
                  </div>
                </div>
              </div>

              {/* 1. 오늘 다룬 주제 */}
              <div className="pt-0.5">
                <div className="flex items-center justify-between mb-2.5">
                  <h3 className="font-extrabold text-[18px] sm:text-[19px] text-slate-900 dark:text-slate-100 tracking-tight">
                    오늘 다룬 주제
                  </h3>
                  <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                    수업 내용 메모 분석
                  </span>
                </div>

                <div className="space-y-2.5">
                  {categorizedThemes.themes.map((t, idx) => (
                    <div
                      key={idx}
                      className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3.5 sm:p-4 rounded-2xl shadow-sm transition-all"
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-xl sm:text-2xl">{t.icon}</span>
                          <span className="font-extrabold text-[15.5px] sm:text-[16.5px] text-slate-900 dark:text-slate-100">
                            {t.name}
                          </span>
                        </div>
                        <span className="text-blue-600 dark:text-blue-400 font-black text-[16px] sm:text-[17px] shrink-0 ml-2">
                          {t.count}건
                        </span>
                      </div>
                      <div className="text-[13px] sm:text-[13.5px] text-slate-600 dark:text-slate-300 pl-7 sm:pl-8 leading-relaxed flex items-start gap-1">
                        <span className="text-slate-400 dark:text-slate-500 shrink-0 font-medium">↳ 세부 실습:</span>
                        <span className="font-medium text-slate-700 dark:text-slate-200 break-keep">{t.detailSummary}</span>
                      </div>
                    </div>
                  ))}

                  {categorizedThemes.uncategorizedCount > 0 && (
                    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3.5 sm:p-4 rounded-2xl shadow-sm flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xl sm:text-2xl">📝</span>
                        <span className="font-extrabold text-[15.5px] sm:text-[16.5px] text-slate-900 dark:text-slate-100">
                          기타 맞춤 실습
                        </span>
                      </div>
                      <span className="text-blue-600 dark:text-blue-400 font-black text-[16px] sm:text-[17px] shrink-0 ml-2">
                        {categorizedThemes.uncategorizedCount}건
                      </span>
                    </div>
                  )}

                  {categorizedThemes.themes.length === 0 && categorizedThemes.uncategorizedCount === 0 && (
                    <div className="text-slate-500 dark:text-slate-400 text-sm font-medium py-4 text-center bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">
                      등록된 수업 내용 메모가 없습니다.
                    </div>
                  )}
                </div>
              </div>

              {/* 3. 오늘의 인사이트 (사실 근거 문장 3개) */}
              <div className="pt-2">
                <h3 className="font-extrabold text-[18px] sm:text-[19px] text-slate-900 dark:text-slate-100 mb-3 tracking-tight">
                  오늘의 인사이트
                </h3>
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 sm:p-5 shadow-sm divide-y divide-slate-200 dark:divide-slate-700">
                  {factualInsights.map((insight, idx) => (
                    <div key={idx} className={`${idx > 0 ? 'pt-3.5' : ''} ${idx < factualInsights.length - 1 ? 'pb-3.5' : ''}`}>
                      <p className="text-[15.5px] sm:text-[16.5px] font-semibold text-slate-800 dark:text-slate-100 leading-relaxed break-keep mb-1">
                        {insight.text}
                      </p>
                      <span className="text-[13px] font-medium text-slate-500 dark:text-slate-400">
                        {insight.evidence}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          )}

        </div>
      </div>

      {/* 3. 학생별 과거 출석 일자 팝업 모달 */}
      {selectedStudentDates && (
        <div className="fixed inset-0 bg-slate-900/45 backdrop-blur-[3px] flex items-center justify-center z-[60] p-3 sm:p-4" onClick={() => setSelectedStudentDates(null)}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-xl overflow-hidden flex flex-col max-h-[85vh] animate-fadeIn" onClick={e => e.stopPropagation()}>
            <div className="bg-purple-600 text-white py-3 px-4 flex justify-between items-center shrink-0">
              <h3 className="font-bold text-[18px] sm:text-[20px]">
                {selectedStudentDates.name}님의 출석 일자 <span className="text-purple-200 text-[15px] sm:text-[16px]">({selectedStudentDates.count}회)</span>
              </h3>
              <button onClick={() => setSelectedStudentDates(null)} className="text-white hover:text-gray-200 active:scale-90 transition-transform p-1">
                <svg className="w-6 h-6 sm:w-7 sm:h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                </svg>
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
    </div>
  );
}
