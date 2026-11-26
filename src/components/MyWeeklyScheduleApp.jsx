// 나의 주간 일정 보기

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabaseClient } from '../utils/supabase';
import {
  getLocalDateString,
  getTeacherShifts,
  getTeamDefaultShifts,
  getGlobalTeachersList,
  getTeacherGroup,
  getSavedItem,
  setSavedItem,
  normalizeTeacherName,
  mergeAttendanceAndStatus
} from '../utils/helpers';
import { User, Home, Clock, CalendarDaysIcon } from './Icons';

// 회차 배지 스타일 (팀별 오늘 일정보기와 동일)
const getSessionBadgeStyle = (count) => {
  if (count >= 15) return 'bg-amber-100 text-amber-950 border border-amber-300 font-bold';
  if (count >= 10) return 'bg-indigo-950 text-white font-bold';
  if (count >= 7) return 'bg-purple-100 text-purple-900 border border-purple-200 font-bold';
  return 'bg-slate-200 text-slate-800 font-bold';
};

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

export default function MyWeeklyScheduleApp({
  team: initialTeam,
  teacher: initialTeacher,
  onNavigateBack
}) {
  const [viewMode, setViewMode] = useState('weekly'); // 'weekly' | 'monthly'
  const [monthlyDate, setMonthlyDate] = useState(() => new Date());
  const [monthlyRecords, setMonthlyRecords] = useState([]);
  const [isMonthlyLoading, setIsMonthlyLoading] = useState(false);

  const [team, setTeam] = useState(() => {
    return (
      initialTeam ||
      getSavedItem('sungdong_weekly_team', '') ||
      getSavedItem('sungdong_team', '') ||
      getSavedItem('sungdong_schedule_team', '') ||
      ''
    ).trim();
  });

  const [teacher, setTeacher] = useState(() => {
    return (
      initialTeacher ||
      getSavedItem('sungdong_weekly_teacher', '') ||
      getSavedItem('sungdong_teacher', '') ||
      ''
    ).trim();
  });

  useEffect(() => {
    if (initialTeam && initialTeam.trim() && initialTeam.trim() !== team) {
      setTeam(initialTeam.trim());
    }
  }, [initialTeam, team]);

  useEffect(() => {
    if (initialTeacher && initialTeacher.trim() && initialTeacher.trim() !== teacher) {
      setTeacher(initialTeacher.trim());
    }
  }, [initialTeacher, teacher]);

  useEffect(() => {
    if (team) {
      setSavedItem('sungdong_weekly_team', team);
    }
    if (teacher) {
      setSavedItem('sungdong_weekly_teacher', teacher);
    }
  }, [team, teacher]);

  // 팀 정보가 비어있고 선생님 이름이 있을 때, 선생님 테이블에서 소속팀 자동 복구
  useEffect(() => {
    if ((!team || team === '전체') && teacher) {
      const cleanTeacher = normalizeTeacherName(teacher);
      const list = getGlobalTeachersList();
      const found = list.find(t => normalizeTeacherName(t.name) === cleanTeacher);
      if (found && found.team) {
        setTeam(found.team);
        setSavedItem('sungdong_team', found.team);
        setSavedItem('sungdong_weekly_team', found.team);
        return;
      }

      const lookupTeacherTeam = async () => {
        try {
          const { data, error } = await supabaseClient
            .from('teachers')
            .select('name, team')
            .limit(100);
          if (!error && data && data.length > 0) {
            const match = data.find(t => normalizeTeacherName(t.name) === cleanTeacher);
            if (match && match.team) {
              setTeam(match.team);
              setSavedItem('sungdong_team', match.team);
              setSavedItem('sungdong_weekly_team', match.team);
            }
          }
        } catch (err) {
          console.warn('선생님 소속팀 조회 오류:', err);
        }
      };
      lookupTeacherTeam();
    }
  }, [team, teacher]);

  const [currentWeekStart, setCurrentWeekStart] = useState(() => {
    const d = new Date();
    const day = d.getDay();
    if (day === 0) d.setDate(d.getDate() + 1);
    else if (day === 6) d.setDate(d.getDate() + 2);
    const newDay = d.getDay();
    const diff = d.getDate() - newDay + (newDay === 0 ? -6 : 1);
    return new Date(d.setDate(diff));
  });

  const [scheduleData, setScheduleData] = useState(null);
  const [specialDays, setSpecialDays] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [supabaseRecords, setSupabaseRecords] = useState([]);
  const [allTeamRecords, setAllTeamRecords] = useState([]);
  const [dbHolidays, setDbHolidays] = useState([]);
  const [noDataMessage, setNoDataMessage] = useState("");
  const [teamLeader, setTeamLeader] = useState(null);
  const [selectedStudentDates, setSelectedStudentDates] = useState(null);
  const [selectedClassDetail, setSelectedClassDetail] = useState(null);
  const [expandedMemos, setExpandedMemos] = useState({}); // 메모 펼침 상태 { "시간|날짜": true }
  const toggleMemo = (key) => setExpandedMemos(prev => ({ ...prev, [key]: !prev[key] }));

  const weekDays = ['월', '화', '수', '목', '금'];
  const [timeSlots, setTimeSlots] = useState([]);

  const getCurrentWeekDays = useCallback(() => {
    const days = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(currentWeekStart);
      d.setDate(currentWeekStart.getDate() + i);
      days.push(d);
    }
    return days;
  }, [currentWeekStart]);

  const currentDays = getCurrentWeekDays();
  const startMonth = currentDays[0].getMonth() + 1;
  const startDay = currentDays[0].getDate();
  const endMonth = currentDays[4].getMonth() + 1;
  const endDay = currentDays[4].getDate();

  const checkDataExistsForWeek = async (weekStart) => {
    try {
      const days = [];
      for (let i = 0; i < 5; i++) {
        const d = new Date(weekStart);
        d.setDate(weekStart.getDate() + i);
        days.push(d);
      }
      const startStr = getLocalDateString(days[0]);
      const endStr = getLocalDateString(days[4]);

      let query = supabaseClient
        .from('daily_logs')
        .select('id')
        .eq('team', team)
        .gte('log_date', startStr)
        .lte('log_date', endStr);

      if (teacher !== "__ALL__") {
        query = query.eq('teacher', teacher);
      }

      const { data, error } = await query.limit(1);
      if (error) throw error;
      return data && data.length > 0;
    } catch (e) {
      console.error("데이터 체크 실패:", e);
      return false;
    }
  };

  const changeWeek = async (offsetWeeks) => {
    if (isLoading) return;
    const newDate = new Date(currentWeekStart);
    newDate.setDate(newDate.getDate() + (offsetWeeks * 7));

    setIsLoading(true);
    const hasData = await checkDataExistsForWeek(newDate);
    setIsLoading(false);

    if (!hasData) {
      setNoDataMessage("더 이상 데이터가 없습니다.");
      setTimeout(() => {
        setNoDataMessage("");
      }, 2000);
      return;
    }
    setCurrentWeekStart(newDate);
  };

  const handleCurrentWeekClick = async () => {
    if (isLoading) return;
    const d = new Date();
    const day = d.getDay();
    if (day === 0) d.setDate(d.getDate() + 1);
    else if (day === 6) d.setDate(d.getDate() + 2);
    const newDay = d.getDay();
    const diff = d.getDate() - newDay + (newDay === 0 ? -6 : 1);
    const targetDate = new Date(d.setDate(diff));

    setIsLoading(true);
    const hasData = await checkDataExistsForWeek(targetDate);
    setIsLoading(false);

    if (!hasData) {
      setNoDataMessage("더 이상 데이터가 없습니다.");
      setTimeout(() => {
        setNoDataMessage("");
      }, 2000);
      return;
    }
    setCurrentWeekStart(targetDate);
  };

  // 1.5 주간 Supabase 데이터 페칭 (요일 범위나 팀, 선생님 변경 시)
  useEffect(() => {
    if (!team || !teacher || !currentWeekStart) return;

    const fetchWeeklySupabase = async () => {
      try {
        const days = getCurrentWeekDays();
        const startStr = getLocalDateString(days[0]);
        const endStr = getLocalDateString(days[4]);

        // 팀장(seq_num=1) 이름 가져오기
        const { data: leaderData } = await supabaseClient
          .from('teachers')
          .select('name')
          .eq('team', team)
          .eq('seq_num', 1)
          .limit(1);
        if (leaderData && leaderData.length > 0) {
          setTeamLeader(leaderData[0].name);
        }

        // 팀장 일정도 확인해야 하므로 teacher 필터 없이 팀 전체 스케줄 로드
        let query = supabaseClient
          .from('daily_logs')
          .select('*')
          .eq('team', team)
          .gte('log_date', startStr)
          .lte('log_date', endStr);

        const { data, error } = await query;
        if (error) throw error;
        
        const mappedData = (data || []).map(r => ({
          ...r,
          status: mergeAttendanceAndStatus(r.attendance, r.status),
          shift: mapShiftToOfficial(r.team, r.teacher, r.shift)
        }));
        setSupabaseRecords(mappedData);

        let allHistRecords = [];
        let histFrom = 0;
        const histStep = 1000;
        let histHasMore = true;

        while (histHasMore) {
          const histTo = histFrom + histStep - 1;
          const { data: histData, error: histError } = await supabaseClient
            .from('daily_logs')
            .select('log_date, student, status, attendance, teacher, shift')
            .eq('team', team)
            .neq('student', '')
            .not('student', 'is', null)
            .lte('log_date', endStr)
            .order('log_date', { ascending: true })
            .order('id', { ascending: true })
            .range(histFrom, histTo);

          if (histError) throw histError;
          if (histData && histData.length > 0) {
            const mappedHist = histData.map(r => ({
              ...r,
              status: mergeAttendanceAndStatus(r.attendance, r.status)
            }));
            allHistRecords = allHistRecords.concat(mappedHist);
            if (histData.length < histStep) histHasMore = false;
            else histFrom += histStep;
          } else {
            histHasMore = false;
          }
        }
        const getT = (s) => {
          if (!s) return 9999;
          const m = s.match(/(\d+):(\d+)/);
          return m ? parseInt(m[1]) * 60 + (m[2] ? parseInt(m[2]) : 0) : 9999;
        };
        allHistRecords.sort((a, b) => {
          const dateA = new Date(a.log_date).getTime();
          const dateB = new Date(b.log_date).getTime();
          if (dateA !== dateB) return dateA - dateB;
          return getT(a.shift) - getT(b.shift);
        });
        setAllTeamRecords(allHistRecords);

        const { data: holidayData, error: holidayError } = await supabaseClient
          .from('holidays')
          .select('*');
        if (!holidayError && holidayData) {
          setDbHolidays(holidayData);
        }
      } catch (e) {
        console.error("주간 Supabase 데이터 로드 실패:", e);
      }
    };

    fetchWeeklySupabase();
  }, [team, teacher, currentWeekStart]);

  // 2. Supabase에서 읽어온 주간 레코드를 바탕으로 시간대별, 요일별 데이터 구조화
  useEffect(() => {
    if (!teacher || !currentWeekStart) return;

    const excludeKeywords = ["보조강사", "자체학습", "대상자발굴", "도선복지관", "소양교육", "간담회", "수업", "준비", "컴기초", "공휴일", "근로자의날", "근로자의 날", "삼일절", "3.1절", "어린이날", "현충일", "광복절", "개천절", "한글날", "석가탄신일", "부처님오신날", "성탄절", "제헌절", "추석", "설날", "신정", "대체공휴일", "지방선거일", "지방 선거일", "선거일", "안전교육", "안전교율", "직무교육", "왕초보", "왕초보컴퓨터", "왕초보검퓨터", "왕초보컴퓨터반", "왕초보검퓨터반"];
    const studentHistoryMap = {};
    const studentExtraDatesMap = {};
    const studentOffsetsMap = {};
    const seenDateShiftMap = {}; // name -> Set of "date|shift" already processed
    
    const dayStatusMap = {};
    allTeamRecords.forEach(hRow => {
      if (!hRow.student) return;
      const names = hRow.student.split(/[/,]/).map(s => s.trim().split('(')[0].trim()).filter(Boolean);
      names.forEach((name, nameIdx) => {
        let personalStatus = hRow.status || "";
        if (personalStatus.includes('/')) {
          const segments = personalStatus.split('/');
          if (segments.length > nameIdx) personalStatus = segments[nameIdx].trim();
        }
        const hasEndOrCancel = hasIndependentKeyword(personalStatus, ["취소"]);
        const hasAttendance = hasIndependentKeyword(personalStatus, ["1"]);
        const isAttended = hasAttendance && !hasEndOrCancel;
        const isAbsent = (personalStatus.includes("결석") && !hasAttendance) || (personalStatus.includes("선생님휴가") && !hasAttendance) || (hasEndOrCancel && !hasAttendance);
        
        if (!dayStatusMap[name]) dayStatusMap[name] = {};
        
        if (isAttended) {
          dayStatusMap[name][hRow.log_date] = 'attended';
        } else if (isAbsent && dayStatusMap[name][hRow.log_date] !== 'attended') {
          dayStatusMap[name][hRow.log_date] = 'absent';
        }
      });
    });

    allTeamRecords.forEach(hRow => {
      if (!hRow.student) return;
      const names = hRow.student.split(/[/,]/).map(s => s.trim().split('(')[0].trim()).filter(Boolean);
      names.forEach((name, nameIdx) => {
        if (excludeKeywords.some(kw => name.includes(kw))) return;
        
        let personalStatus = hRow.status || "";
        if (personalStatus.includes('/')) {
          const segments = personalStatus.split('/');
          if (segments.length > nameIdx) personalStatus = segments[nameIdx].trim();
        }
        
        const hasEndOrCancel = hasIndependentKeyword(personalStatus, ["취소"]);
        const hasAttendance = hasIndependentKeyword(personalStatus, ["1"]);
        const isVacationOnly = (personalStatus.includes("선생님휴가") || personalStatus.includes("휴가")) && !hasAttendance;
        const isAbsent = (personalStatus.includes("결석") && !hasAttendance) || isVacationOnly || (hasEndOrCancel && !hasAttendance);
        // 취업팀: 결석 단독(선생님휴가/취소 제외)이면 회차 포함
        const isOnlyAbsent = (personalStatus.includes("결석") && !hasAttendance) && !isVacationOnly && !(hasEndOrCancel && !hasAttendance);
        
        const textToMatch = (hRow.memo || hRow.status || "");
        const memoMatches = Array.from(textToMatch.matchAll(/(\d+)\s*회차(?![가-힣a-zA-Z0-9])/g));
        const hasExplicitCount = memoMatches.length > 0;
        
        const dateObj = hRow.log_date;
        const dayStatus = dayStatusMap[name] && dayStatusMap[name][dateObj];

        const isTargetTeacher = (t) => t && (t.includes("천은선") || t.includes("서승희"));
        const isTarget = isTargetTeacher(hRow.teacher);

        let isValidDay = false;
        if (isTarget) {
          isValidDay = (dayStatus === 'attended');
        } else if (team === '취업팀' && isOnlyAbsent) {
          // 취업팀: 결석이어도 회차 포함
          isValidDay = true;
        } else {
          isValidDay = !isAbsent;
        }

        if (!isValidDay && (isOnlyAbsent || isVacationOnly)) {
          if (!studentExtraDatesMap[name]) studentExtraDatesMap[name] = [];
          const hGroup = getTeacherGroup(team, hRow.teacher);
          const hShift = mapShiftToOfficial(team, hRow.teacher, hRow.shift);
          const dup = studentExtraDatesMap[name].some(d => d.date === dateObj && d.shift === hShift && d.group === hGroup);
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
           if (!studentHistoryMap[name]) studentHistoryMap[name] = [];
           if (!studentOffsetsMap[name]) studentOffsetsMap[name] = [];
           if (!seenDateShiftMap[name]) seenDateShiftMap[name] = new Set();
           
           const hGroup = getTeacherGroup(team, hRow.teacher);
           const hShift = mapShiftToOfficial(team, hRow.teacher, hRow.shift);
           
           const dateShiftKey = isTarget ? `${dateObj}|target` : `${dateObj}|${hShift}|${hGroup}`;
           // 이미 처리한 조합이면 스킵 (빈 상태 중복 레코드 방지)
           if (seenDateShiftMap[name].has(dateShiftKey)) {
             return;
           }
           seenDateShiftMap[name].add(dateShiftKey);
           
           let isNew = false;
           if (isValidDay) {
               const alreadyHas = studentHistoryMap[name].some(d => {
                   if (isTarget) {
                       const isSameTargetBucket = isTargetTeacher(d.teacher);
                       let isSameClassBucket = false;
                       if (team === '취업팀') {
                           isSameClassBucket = (d.shift === hShift && d.group === hGroup);
                       } else {
                           isSameClassBucket = (d.group === hGroup);
                       }
                       return d.date === dateObj && (isSameTargetBucket || isSameClassBucket);
                   } else {
                       if (team === '취업팀') {
                           return d.date === dateObj && d.shift === hShift && d.group === hGroup;
                       } else {
                           return d.date === dateObj && d.group === hGroup;
                       }
                   }
               });
               if (!alreadyHas) isNew = true;
           }
           
           if (isNew) {
               const isAbsentEntry = team === '취업팀' && isOnlyAbsent;
               const isEndEntry = team === '취업팀' && personalStatus.split(/[,/]+/).map(t => t.trim()).some(t => t === '종료') && !hasAttendance;
               studentHistoryMap[name].push({ date: dateObj, shift: hShift, group: hGroup, teacher: hRow.teacher, isAbsent: isAbsentEntry, isEnd: isEndEntry });
           }

           if (hasExplicitCount) {
               const matchObj = memoMatches.length > nameIdx ? memoMatches[nameIdx] : memoMatches[0];
               const explicitCount = parseInt(matchObj[1], 10);
               const currentLen = studentHistoryMap[name].length;
               const newOffset = explicitCount - currentLen;
               studentOffsetsMap[name].push({ date: dateObj, shift: hShift, offset: newOffset });
           }
        }
      });
    });

    // 시간대가 빠른 것부터 회차 계산을 위해 정렬
    Object.keys(studentHistoryMap).forEach(name => {
      studentHistoryMap[name].sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        const getT = (s) => {
          if (!s) return 9999;
          const m = s.match(/(\d+):(\d+)/) || s.match(/(\d+)\s*시/);
          return m ? parseInt(m[1]) * 60 + (m[2] ? parseInt(m[2]) : 0) : 9999;
        };
        return getT(a.shift) - getT(b.shift);
      });
    });

    Object.keys(studentOffsetsMap).forEach(name => {
      studentOffsetsMap[name].sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        const getT = (s) => {
          if (!s) return 9999;
          const m = s.match(/(\d+):(\d+)/) || s.match(/(\d+)\s*시/);
          return m ? parseInt(m[1]) * 60 + (m[2] ? parseInt(m[2]) : 0) : 9999;
        };
        return getT(a.shift) - getT(b.shift);
      });
    });

    // 휴무일(holidays DB) 및 팀장의 스케줄을 확인하여 specialDays(공휴일/간담회/소양교육) 설정
    const newSpecialDays = {};
    const days = getCurrentWeekDays();
    days.forEach(day => {
      const dateStr = getLocalDateString(day);
      const monthDayStr = dateStr.substring(5); // MM-DD 형식
      
      const matchedHoliday = dbHolidays.find(h => {
        if (!h || !h.date) return false;
        return h.date === monthDayStr || h.date === dateStr || (h.date && h.date.endsWith(monthDayStr));
      });

      if (matchedHoliday) {
        if (!matchedHoliday.vacation_available) {
          newSpecialDays[dateStr] = {
            student: matchedHoliday.name || "공휴일",
            location: matchedHoliday.content1 || "",
            memo: matchedHoliday.content2 || ""
          };
          return; // DB에 공휴일이 있으면 우선 적용
        }
        // vacation_available이 true인 경우 개별 수업시간대 데이터가 표시되도록 specialDays로 등록하지 않고 통과
        return;
      }

      if (teamLeader) {
        const leaderRecords = supabaseRecords.filter(r => r.log_date === dateStr && r.teacher === teamLeader);
        const specialRec = leaderRecords.find(r => {
          const content = (r.student || "") + " " + (r.location || "");
          return content.includes("공휴일") || content.includes("간담회") || content.includes("소양교육");
        });
        if (specialRec) {
          let hasOwnSchedule = false;
          if (teacher && teacher !== teamLeader && teacher !== "__ALL__") {
            const ownRecords = supabaseRecords.filter(r => r.log_date === dateStr && r.teacher === teacher && (r.student || r.location || r.status));
            if (ownRecords.length > 0) {
              hasOwnSchedule = true;
            }
          }

          if (!hasOwnSchedule) {
            newSpecialDays[dateStr] = {
              student: specialRec.student || "",
              location: specialRec.location || "",
              memo: specialRec.status || ""
            };
          }
        }
      }
    });
    setSpecialDays(newSpecialDays);

    let baseSlots = [];
    if (teacher && teacher !== "__ALL__") {
      baseSlots = getTeacherShifts(team, teacher);
    } else {
      const allTeachersInTeam = getGlobalTeachersList().filter(t => t.team === team);
      const allShifts = new Set();
      allTeachersInTeam.forEach(t => {
        if (t.shift1) allShifts.add(t.shift1);
        if (t.shift2) allShifts.add(t.shift2);
        if (t.shift3) allShifts.add(t.shift3);
      });
      baseSlots = allShifts.size > 0 ? Array.from(allShifts) : getTeamDefaultShifts(team);
    }

    const extractedSlots = new Set(baseSlots);
    supabaseRecords.forEach(r => {
      // 해당 선생님의 시간대만 추출
      if (r.shift && (teacher === "__ALL__" || r.teacher === teacher)) {
        extractedSlots.add(r.shift);
      }
    });

    const finalSlots = Array.from(extractedSlots).sort((a, b) => {
        const getT = (s) => {
          const m = s.match(/(\d+):(\d+)/) || s.match(/(\d+)\s*시/);
          return m ? parseInt(m[1]) * 60 + (m[2] ? parseInt(m[2]) : 0) : 9999;
        };
        return getT(a) - getT(b);
      });

    setTimeSlots(finalSlots);

    const parsedData = {};
    finalSlots.forEach((slot, slotIdx) => {
      parsedData[slot] = {};
      currentDays.forEach(day => {
        const dateStr = getLocalDateString(day);
        const isSpecialDay = newSpecialDays[dateStr];

        // 첫 번째 슬롯에 팀장 일정 복사, 나머지는 빈칸 (특수한 날인 경우)
        if (isSpecialDay && slotIdx === 0) {
          parsedData[slot][dateStr] = {
            student: isSpecialDay.student,
            location: isSpecialDay.location,
            status: isSpecialDay.memo,
            sessionCounts: null,
            isSpecial: true
          };
        } else if (isSpecialDay && slotIdx > 0) {
          parsedData[slot][dateStr] = { student: "", location: "", status: "", sessionCounts: null, isSpecial: true };
        } else {
          const supRec = supabaseRecords.find(r => r.log_date === dateStr && r.shift === slot && (teacher === "__ALL__" || r.teacher === teacher));
          if (supRec) {
            const countsForCell = [];
            const names = (supRec.student || "").split(/[/,]/).map(s => s.trim().split('(')[0].trim()).filter(Boolean);
            names.forEach(name => {
                if (excludeKeywords.some(kw => name.includes(kw))) return;
                
                const histList = studentHistoryMap[name] || [];
                
                const getTLocal = (s) => {
                  if (!s) return 9999;
                  const m = s.match(/(\d+):(\d+)/) || s.match(/(\d+)\s*시/);
                  return m ? parseInt(m[1]) * 60 + (m[2] ? parseInt(m[2]) : 0) : 9999;
                };
                const currentShiftT = getTLocal(slot);
                
                const validDates = histList.filter(h => {
                    if (h.date < dateStr) return true;
                    if (h.date === dateStr) {
                        if (team === '취업팀') {
                            return getTLocal(h.shift) <= currentShiftT;
                        } else {
                            return true;
                        }
                    }
                    return false;
                });
                const count = validDates.length;
                
                const offsets = studentOffsetsMap[name] || [];
                let applicableOffset = 0;
                offsets.forEach(o => {
                    if (o.date < dateStr) {
                        applicableOffset = o.offset;
                    } else if (o.date === dateStr) {
                        if (team === '취업팀') {
                            if (getTLocal(o.shift) <= currentShiftT) {
                                applicableOffset = o.offset;
                            }
                        } else {
                            applicableOffset = o.offset;
                        }
                    }
                });
                
                if (count > 0 || applicableOffset > 0) {
                    // dates 배열 구성 (sessionNum 포함)
                    const validDatesForCell = validDates.slice().sort((a, b) => {
                      if (a.date !== b.date) return a.date.localeCompare(b.date);
                      const getT2 = (s) => {
                        if (!s) return 9999;
                        const m2 = s.match(/(\d+):(\d+)/) || s.match(/(\d+)\s*시/);
                        return m2 ? parseInt(m2[1]) * 60 + (m2[2] ? parseInt(m2[2]) : 0) : 9999;
                      };
                      return getT2(a.shift) - getT2(b.shift);
                    });
                    // sessionNum 계산 (offset 적용)
                    const offsetsForName = studentOffsetsMap[name] || [];
                    let runningOffset = 0;
                    const dateObjList = validDatesForCell.map((h, hIdx) => {
                      const dParts = h.date.split('-');
                      const dateObj2 = new Date(parseInt(dParts[0], 10), parseInt(dParts[1], 10) - 1, parseInt(dParts[2], 10));
                      // offset 적용
                      const applicableOff = offsetsForName.filter(o => o.date < h.date || (o.date === h.date && getTLocal(o.shift) <= getTLocal(h.shift)));
                      if (applicableOff.length > 0) {
                        runningOffset = applicableOff[applicableOff.length - 1].offset;
                      }
                      return {
                        date: dateObj2,
                        shift: h.shift,
                        group: h.group,
                        teacher: h.teacher,
                        sessionNum: (hIdx + 1) + runningOffset,
                        isAbsent: !!h.isAbsent,
                        isEnd: !!h.isEnd
                      };
                    });
                    const extraDatesForCell = (studentExtraDatesMap[name] || []).filter(h => {
                      if (h.date < dateStr) return true;
                      if (h.date === dateStr) {
                        return team === '취업팀' ? getTLocal(h.shift) <= currentShiftT : true;
                      }
                      return false;
                    }).map(h => {
                      const dParts = h.date.split('-');
                      const dateObj2 = new Date(parseInt(dParts[0], 10), parseInt(dParts[1], 10) - 1, parseInt(dParts[2], 10));
                      return {
                        date: dateObj2,
                        shift: h.shift,
                        group: h.group,
                        teacher: h.teacher,
                        isAbsent: !!h.isAbsent,
                        isVacation: !!h.isVacation,
                        excludeFromCount: true
                      };
                    });
                    const combinedDates = [...dateObjList, ...extraDatesForCell].sort((a, b) => {
                      const ta = a.date.getTime();
                      const tb = b.date.getTime();
                      if (ta !== tb) return ta - tb;
                      return getTLocal(a.shift) - getTLocal(b.shift);
                    });
                    countsForCell.push({ name: name, count: count + applicableOffset, dates: combinedDates });
                }
            });

            parsedData[slot][dateStr] = {
              student: supRec.student || "",
              location: supRec.location || "",
              status: supRec.status || "",
              sessionCounts: countsForCell.length > 0 ? countsForCell : null,
              isSpecial: false
            };
          } else {
            parsedData[slot][dateStr] = { student: "", location: "", status: "", sessionCounts: null, isSpecial: false };
          }
        }
      });
    });

    setScheduleData(parsedData);
  }, [teacher, currentWeekStart, supabaseRecords, teamLeader, dbHolidays, allTeamRecords]);

  // 월간 활동 요약 데이터 로드
  useEffect(() => {
    if (viewMode !== 'monthly' || !team || !teacher || teacher === '__ALL__') return;
    let isMounted = true;
    const fetchMonthly = async () => {
      setIsMonthlyLoading(true);
      try {
        const y = monthlyDate.getFullYear();
        const m = monthlyDate.getMonth() + 1;
        const monthStart = `${y}-${String(m).padStart(2, '0')}-01`;
        const lastDay = new Date(y, m, 0).getDate();
        const monthEnd = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
        const { data, error } = await supabaseClient
          .from('daily_logs')
          .select('log_date, shift, student, location, attendance, status')
          .eq('team', team)
          .eq('teacher', teacher)
          .gte('log_date', monthStart)
          .lte('log_date', monthEnd);
        if (!isMounted) return;
        if (!error && Array.isArray(data)) {
          setMonthlyRecords(data);
        } else {
          setMonthlyRecords([]);
        }
      } catch (_) {
        if (isMounted) setMonthlyRecords([]);
      } finally {
        if (isMounted) setIsMonthlyLoading(false);
      }
    };
    fetchMonthly();
    return () => { isMounted = false; };
  }, [viewMode, monthlyDate, team, teacher]);

  const monthlyStats = useMemo(() => {
    const workDateSet = new Set();
    let totalClasses = 0;
    let attendedCount = 0;
    let absentCount = 0;
    let vacationCount = 0;
    let specialCount = 0;

    monthlyRecords.forEach(r => {
      const st = (r.student || '').trim();
      const loc = (r.location || '').trim();
      if (!st || st === '-' || st.includes('자체학습') || st.includes('대상자발굴') || st.includes('공휴일') || loc.includes('공휴일') || loc.includes('휴무일')) return;
      totalClasses += 1;
      const merged = mergeAttendanceAndStatus(r.attendance, r.status).replace(/\u200B/g, '').trim();
      if (st.includes('경로당') || loc.includes('경로당') || st.includes('보조강사')) {
        specialCount += 1;
      }
      if (hasIndependentKeyword(merged, ['선생님휴가']) || merged.includes('선생님휴가')) {
        vacationCount += 1;
      } else {
        workDateSet.add(r.log_date);
        const hasAtt = hasIndependentKeyword(merged, ['1', '출석']);
        if (merged.includes('결석') && !hasAtt) {
          absentCount += 1;
        } else if (hasAtt || /^[1-9]\d*/.test(merged) || merged.length > 2) {
          attendedCount += 1;
        }
      }
    });

    return {
      workDays: workDateSet.size,
      totalClasses,
      attendedCount,
      absentCount,
      vacationCount,
      specialCount
    };
  }, [monthlyRecords]);

  const getStatusColorClass = (statusStr) => {
    if (!statusStr) return "text-gray-800";
    const parts = statusStr.split(',').map(s => s.trim().replace(/\s+/g, ''));
    if (parts.includes("결석") || parts.includes("종료") || parts.includes("취소")) return "text-red-600";
    if (parts.includes("휴가") || parts.includes("선생님휴가")) return "text-gray-500";
    return "text-blue-700";
  };

  const parseWeeklyStatus = (statusStr) => {
    if (!statusStr) return { tags: [], memo: "" };
    const parts = statusStr.split(',').map(s => s.trim()).filter(Boolean);
    let tags = [];
    let memos = [];

    const tagKeywords = ['출석', '결석', '종료', '취소', '선생님휴가', '휴가'];

    parts.forEach((part, i) => {
      const cleanPart = part.replace(/\s+/g, '');

      // 다인원 출석 패턴 처리 (/ 포함 시)
      if (cleanPart.includes('/')) {
        const subParts = cleanPart.split('/');
        if (subParts.length === 2) {
          const [p1, p2] = subParts;
          const isP1Tag = /^\d+$/.test(p1) || tagKeywords.includes(p1);
          const isP2Tag = /^\d+$/.test(p2) || tagKeywords.includes(p2);

          if (isP1Tag && isP2Tag) {
            let t1 = p1 === '1' ? '출석' : (/^\d+$/.test(p1) ? '출석' + p1 : p1);
            let t2 = p2 === '1' ? '출석' : (/^\d+$/.test(p2) ? '출석' + p2 : p2);

            tags.push(`${t1}/${t2}`);
            return;
          }
        }
      }

      const isNumber = /^\d+$/.test(cleanPart);
      const hasKeyword = tagKeywords.some(k => cleanPart === k);

      let isTag = false;
      if (hasKeyword) {
        isTag = true;
      } else if (isNumber) {
        isTag = (i === 0);
      }

      if (isTag) {
        let displayTag = part;
        if (part === '1') displayTag = '출석';
        else if (isNumber) displayTag = `출석${part}`;
        tags.push(displayTag);
      } else {
        memos.push(part);
      }
    });

    return { tags, memo: memos.join(', ') };
  };

  return (
    <div className="min-h-[100dvh] flex flex-col app-surface font-sans">
      <div className="shrink-0 app-header text-white z-40 relative">
        <div className="max-w-5xl lg:max-w-[1536px] mx-auto px-2.5 sm:px-5 pb-4 pt-safe-4 flex justify-between items-center">
          <div className="flex items-center">
            <div className="flex flex-col">
              <div className="flex items-center mb-1">
                <img src="/Logo_of_Seoul.jpg" alt="서울시 로고" className="h-7 hdr-logo object-contain mr-2 shrink-0" onError={(e) => e.target.style.display = 'none'} />
                <h1 className="font-black text-xl leading-tight">성동노인종합복지관</h1>
              </div>
              <p className="text-lg font-semibold text-yellow-300">디지털교육 서포터즈</p>
              <p className="text-base opacity-95 flex items-center mt-1 font-bold">
                <User className="w-4 h-4 mr-1 shrink-0" /> [{team || getSavedItem('sungdong_team', '') || '2팀'}] {(teacher || getSavedItem('sungdong_teacher', '') || '').replace(/\n/g, ' ')} 선생님
              </p>
            </div>
          </div>
          <button onClick={onNavigateBack} className="text-xs flex flex-col items-center font-bold p-2 rounded-lg shadow-md transition-all touch-manipulation hdr-btn shrink-0">
            <Home className="w-5 h-5 mb-1" /> 처음으로
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col pb-4">
        <div className="max-w-5xl lg:max-w-[1536px] w-full mx-auto flex-1 flex flex-col px-2.5 sm:px-5 py-3 md:py-6 mt-1">
          <div className="pb-2 px-1 flex items-center justify-between gap-2">
            <h2 className="text-[19px] sm:text-xl font-bold text-gray-800 flex items-center tracking-tight">
              <span className="flex items-center"><CalendarDaysIcon className="w-5 h-5 mr-2 text-blue-600" /> {viewMode === 'weekly' ? '나의 주간 일정' : '나의 월간 활동 요약'}</span>
            </h2>
            {teacher && teacher !== '__ALL__' && (
              <div className="inline-flex bg-slate-200/80 p-0.5 rounded-xl border border-slate-300/60 shrink-0">
                <button
                  type="button"
                  onClick={() => setViewMode('weekly')}
                  className={`px-3 py-1 rounded-lg text-[13px] font-extrabold transition ${viewMode === 'weekly' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  주간
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('monthly')}
                  className={`px-3 py-1 rounded-lg text-[13px] font-extrabold transition ${viewMode === 'monthly' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  월간 요약
                </button>
              </div>
            )}
          </div>
          {viewMode === 'monthly' ? (
            <div className="bg-white rounded-2xl shadow-lg ring-1 ring-gray-900/5 p-4 sm:p-6 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setMonthlyDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
                  className="w-11 h-11 flex items-center justify-center rounded-xl bg-white ring-1 ring-gray-200 shadow-sm hover:bg-gray-50 active:scale-95 text-gray-600"
                >
                  <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor"><path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6 1.41-1.41z" /></svg>
                </button>
                <div className="flex-1 h-11 flex items-center justify-center ring-1 ring-blue-200 rounded-xl bg-white text-[17px] sm:text-[19px] font-extrabold text-slate-900 shadow-sm">
                  {monthlyDate.getFullYear()}년 {monthlyDate.getMonth() + 1}월
                </div>
                <button
                  type="button"
                  onClick={() => setMonthlyDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
                  className="w-11 h-11 flex items-center justify-center rounded-xl bg-white ring-1 ring-gray-200 shadow-sm hover:bg-gray-50 active:scale-95 text-gray-600"
                >
                  <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" /></svg>
                </button>
              </div>
              {isMonthlyLoading ? (
                <div className="py-12 text-center text-slate-500 font-bold">월간 활동 내역을 불러오는 중...</div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div className="p-4 rounded-2xl bg-blue-50 border border-blue-200 text-center">
                    <div className="text-[13px] font-bold text-blue-700">총 근무일수</div>
                    <div className="text-3xl font-black text-blue-950 mt-1">{monthlyStats.workDays}<span className="text-base font-bold ml-0.5">일</span></div>
                  </div>
                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-center">
                    <div className="text-[13px] font-bold text-slate-600">배정 수업</div>
                    <div className="text-3xl font-black text-slate-900 mt-1">{monthlyStats.totalClasses}<span className="text-base font-bold ml-0.5">건</span></div>
                  </div>
                  <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-center">
                    <div className="text-[13px] font-bold text-emerald-700">출석 진행</div>
                    <div className="text-3xl font-black text-emerald-900 mt-1">{monthlyStats.attendedCount}<span className="text-base font-bold ml-0.5">건</span></div>
                  </div>
                  <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-center">
                    <div className="text-[13px] font-bold text-rose-700">학생 결석</div>
                    <div className="text-3xl font-black text-rose-900 mt-1">{monthlyStats.absentCount}<span className="text-base font-bold ml-0.5">건</span></div>
                  </div>
                  <div className="p-4 rounded-2xl bg-gray-100 border border-gray-300 text-center">
                    <div className="text-[13px] font-bold text-gray-600">선생님 휴가</div>
                    <div className="text-3xl font-black text-gray-800 mt-1">{monthlyStats.vacationCount}<span className="text-base font-bold ml-0.5">건</span></div>
                  </div>
                  <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-center">
                    <div className="text-[13px] font-bold text-amber-800">경로당·보조강사</div>
                    <div className="text-3xl font-black text-amber-950 mt-1">{monthlyStats.specialCount}<span className="text-base font-bold ml-0.5">건</span></div>
                  </div>
                </div>
              )}
            </div>
          ) : (
          <div className="bg-white rounded-2xl shadow-lg ring-1 ring-gray-900/5 flex flex-col flex-1 overflow-hidden">
          <div className="shrink-0 bg-white px-2 sm:px-4 pt-4 pb-3 shadow-sm relative z-10 flex flex-col items-center border-b border-gray-100">
            <div className="flex items-center gap-1.5 sm:gap-2 w-full">
              <button onClick={() => changeWeek(-1)} className="w-11 sm:w-12 h-11 sm:h-12 flex items-center justify-center rounded-xl bg-white ring-1 ring-gray-200 shadow-sm hover:bg-gray-50 active:bg-gray-100 active:scale-95 text-gray-600 shrink-0 transition-all touch-manipulation">
                <svg className="w-6 h-6 sm:w-7 sm:h-7" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6 1.41-1.41z" /></svg>
              </button>
              <div className="flex-1 h-11 sm:h-12 flex items-center justify-center ring-1 ring-blue-200 rounded-xl bg-white text-center shadow-sm">
                <h2 className="font-extrabold text-[#1e3a8a] text-[15px] min-[360px]:text-[17px] sm:text-[20px] tracking-tighter whitespace-nowrap">{startMonth}/{startDay} ~ {endMonth}/{endDay}</h2>
              </div>
              <button onClick={handleCurrentWeekClick} className="text-[14px] sm:text-[15px] px-3 sm:px-4 h-11 sm:h-12 rounded-xl font-bold bg-blue-600 text-white shadow-sm shadow-blue-600/30 hover:bg-blue-700 active:scale-95 shrink-0 transition-all touch-manipulation whitespace-nowrap">이번 주</button>
              <button onClick={() => changeWeek(1)} className="w-11 sm:w-12 h-11 sm:h-12 flex items-center justify-center rounded-xl bg-white ring-1 ring-gray-200 shadow-sm hover:bg-gray-50 active:bg-gray-100 active:scale-95 text-gray-600 shrink-0 transition-all touch-manipulation">
                <svg className="w-6 h-6 sm:w-7 sm:h-7" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" /></svg>
              </button>
            </div>
            {noDataMessage && <div className="mt-2 text-red-600 font-bold text-base text-center animate-fadeIn">{noDataMessage}</div>}
            {notice && <div className="mt-2 text-red-600 font-bold text-center animate-fadeIn">{notice}</div>}
            {isLoading && <div className="mt-3 text-sm sm:text-base text-red-600 font-bold flex items-center animate-pulse"><Clock className="w-4 h-4 mr-1 animate-spin" />일정 데이터를 불러오는 중...</div>}
          </div>

          <div className="flex-1 overflow-x-auto overflow-y-auto bg-gray-50/50 p-2 sm:p-4">
            <div className="min-w-[740px] w-full bg-white rounded-xl shadow-sm border-2 border-gray-300 overflow-hidden mx-auto">
              <table className="w-full table-fixed text-center border-collapse">
                <thead>
                  <tr className="bg-[#eef2ff] border-b-2 border-gray-300">
                    <th className="w-[12%] py-2 md:py-3 border-r-2 border-gray-300 font-black text-gray-800 text-[clamp(1rem,2.2vw,1.3rem)]">수업시간</th>
                    {currentDays.map((day, i) => {
                      const dateStr = getLocalDateString(day);
                      const todayStr = getLocalDateString(new Date());
                      const isToday = dateStr === todayStr;

                      return (
                        <th key={i} style={{ width: '17.6%' }} className={`py-2 md:py-3 font-black text-[clamp(1rem,2.2vw,1.3rem)] tracking-tight transition-all ${isToday ? 'border-l-4 border-r-4 border-t-4 border-blue-600 text-blue-700 bg-blue-50' : 'border-r-2 border-gray-300 text-blue-900 last:border-0'}`}>
                          {day.getMonth() + 1}/{day.getDate()} ({weekDays[i]})
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {timeSlots.map((time, idx) => (
                    <tr key={idx} className="border-b-2 border-gray-300 last:border-0">
                      <td className="py-3 md:py-5 px-1 border-r-2 border-gray-300 bg-[#f8fafc] font-black text-blue-800 text-[clamp(0.95rem,2.1vw,1.25rem)] whitespace-pre-line leading-tight">
                        {time.replace('~', '\n~\n')}
                      </td>
                      {currentDays.map((day, i) => {
                        const dateStr = getLocalDateString(day);
                        const todayStr = getLocalDateString(new Date());
                        const isToday = dateStr === todayStr;
                        const specialDayInfo = specialDays && specialDays[dateStr];

                        const isLastSlot = idx === timeSlots.length - 1;
                        const todayBorderClass = isToday ? `border-l-4 border-r-4 ${isLastSlot ? 'border-b-4' : ''} border-blue-600 z-10` : 'border-r-2 border-gray-300 last:border-0';

                        const cellData = scheduleData?.[time]?.[dateStr];

                        if (!cellData || (!cellData.student && !cellData.location && !cellData.status)) {
                          return (
                            <td key={i} className={`p-0 align-top hover:bg-gray-50 transition-colors overflow-hidden ${todayBorderClass} ${specialDayInfo ? 'bg-red-300' : ''}`}>
                              <div className="flex items-center justify-center h-full min-h-[110px] text-gray-400 font-bold text-[clamp(1rem,2vw,1.2rem)]">
                              </div>
                            </td>
                          );
                        }

                        const parsedStatus = parseWeeklyStatus(cellData.status);
                        const isHoliday = !!specialDayInfo || (cellData.student && /공휴일|근로자의날|어린이날|휴일|공휴/.test(cellData.student.replace(/\s/g, ''))) ||
                          (cellData.status && /공휴일|근로자의날|어린이날|휴일|공휴/.test(cellData.status.replace(/\s/g, ''))) ||
                          (cellData.location && /공휴일|근로자의날|어린이날|휴일|공휴/.test(cellData.location.replace(/\s/g, '')));
                        const isAbsent = !!(cellData.status && cellData.status.includes('결석'));

                        // 배경: 기본 흰색 통일, 결석은 연한 빨강, 휴일은 기존 빨강 유지
                        let cellBgClass = isAbsent ? "bg-red-50" : "bg-white";
                        if (specialDayInfo) {
                          cellBgClass = "bg-red-300";
                        }

                        const showTags = parsedStatus.tags.length > 0 && !cellData.student?.includes("간담회");
                        const showSessions = cellData.sessionCounts && !cellData.student?.includes("간담회") && !cellData.student?.includes("안전교육") && !cellData.student?.includes("소양교육") && !cellData.student?.includes("직무교육");
                        const memoKey = `${time}|${dateStr}`;
                        const isMemoExpanded = !!expandedMemos[memoKey];

                        return (
                          <td
                            key={i}
                            onClick={() => {
                              if (!isHoliday && cellData.student) {
                                setSelectedClassDetail({
                                  dateStr,
                                  dayLabel: weekDays[i],
                                  time,
                                  student: cellData.student,
                                  location: cellData.location || '복지관',
                                  tags: parsedStatus.tags,
                                  memo: parsedStatus.memo,
                                  sessionCounts: cellData.sessionCounts,
                                  isAbsent
                                });
                              }
                            }}
                            className={`${cellBgClass} p-0 align-top transition-all overflow-hidden h-full hover:brightness-95 ${!isHoliday && cellData.student ? 'cursor-pointer' : ''} ${todayBorderClass}`}
                          >
                            <div className={`flex flex-col gap-1 justify-start items-center h-full min-h-[110px] overflow-hidden w-full max-w-full ${isHoliday ? 'px-2 py-2.5 sm:p-3 bg-red-300 text-white' : 'px-1.5 py-2.5 sm:p-3'}`}>
                              {(showTags || showSessions) && (
                                <div className="flex flex-wrap gap-1 justify-center items-center w-full mb-1">
                                  {showTags && parsedStatus.tags.map((tag, tIdx) => {
                                    let tagStyle = "bg-blue-100 text-blue-700 border-blue-300";
                                    if (tag.includes('결석')) tagStyle = "bg-red-100 text-red-700 border-red-300";
                                    else if (tag.includes('종료') || tag.includes('취소')) tagStyle = "bg-orange-100 text-orange-700 border-orange-300";
                                    else if (tag.includes('휴가')) tagStyle = "bg-gray-200 text-gray-700 border-gray-400";
                                    else if (tag.includes('출석') || /^\d+/.test(tag)) tagStyle = "bg-blue-500 text-white border-blue-600 shadow-inner";
                                    return (
                                      <span key={`t${tIdx}`} className={`px-1.5 sm:px-2 py-0.5 rounded-md text-[12px] sm:text-[13px] font-extrabold border shadow-sm leading-tight whitespace-nowrap overflow-hidden text-ellipsis max-w-full ${tagStyle}`}>
                                        {tag}
                                      </span>
                                    );
                                  })}
                                  {showSessions && cellData.sessionCounts.map((sc, scIdx) => (
                                    <button
                                      key={`s${scIdx}`}
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedStudentDates(sc);
                                      }}
                                      title="출석 일자 보기"
                                      className={`px-1.5 sm:px-2 py-0.5 rounded-md text-[12px] sm:text-[13px] leading-tight whitespace-nowrap shadow-2xs cursor-pointer hover:brightness-95 active:scale-95 transition-all ${getSessionBadgeStyle(sc.count)}`}
                                    >
                                      {sc.count}회차
                                    </button>
                                  ))}
                                </div>
                              )}
                              {cellData.student && <div className={`font-bold ${isHoliday ? 'text-white w-full' : (cellData.isSpecial ? 'text-red-700 w-full' : 'text-gray-900 w-full')} text-[clamp(1.1rem,2.6vw,1.7rem)] leading-tight break-keep whitespace-pre-wrap text-center flex-shrink-0`}>{cellData.student.replace(/\n/g, ' ').replace(/부처님오신날/g, '부처님\n오신날').replace(/보조강사\s*/g, '보조강사\n').replace(/\//g, '/\n').trim()}</div>}
                              {cellData.location && cellData.location !== "복지관" && team !== '취업팀' && <div className={`${isHoliday ? 'text-gray-100' : 'text-gray-600'} text-[clamp(0.9rem,2.1vw,1.35rem)] font-bold break-keep whitespace-pre-wrap text-center max-w-full leading-tight mt-1`}>{cellData.location.replace(/대체공휴일/g, '대체\n공휴일')}</div>}
                              {parsedStatus.memo && (
                                <div
                                  className={`font-normal text-[clamp(0.9rem,2.1vw,1.35rem)] leading-snug break-keep whitespace-pre-wrap text-center mt-1 w-full ${isMemoExpanded ? '' : 'line-clamp-3'} ${isHoliday ? 'text-gray-100' : (isAbsent ? 'text-red-600' : 'text-gray-900')}`}
                                >
                                  {parsedStatus.memo.replace(/대체공휴일/g, '대체\n공휴일').split(/(\d+\s*회차)/g).map((part, i) => {
                                    if (/\d+\s*회차/.test(part)) {
                                      return <span key={i} className="text-blue-600">{part}</span>;
                                    }
                                    return part;
                                  })}
                                </div>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
          )}
      </div>
    </div>

      {selectedClassDetail && (() => {
        const cleanNames = (selectedClassDetail.student || '')
          .split(/[/,]+/)
          .map(s => s.trim().split('(')[0].trim())
          .filter(Boolean);
        const groupedHistoryMap = {};
        (allTeamRecords || []).forEach(r => {
          if (!r.student || r.log_date >= selectedClassDetail.dateStr) return;
          const rNames = r.student.split(/[/,]+/).map(s => s.trim().split('(')[0].trim()).filter(Boolean);
          if (!cleanNames.some(n => rNames.includes(n))) return;
          const parsed = parseWeeklyStatus(r.status || '');
          const key = `${r.log_date}__${r.shift || ''}`;
          if (!groupedHistoryMap[key]) {
            groupedHistoryMap[key] = {
              log_date: r.log_date,
              shift: r.shift || '',
              tags: [],
              memos: []
            };
          }
          parsed.tags.forEach(t => {
            if (t && !groupedHistoryMap[key].tags.includes(t)) {
              groupedHistoryMap[key].tags.push(t);
            }
          });
          if (parsed.memo && !groupedHistoryMap[key].memos.includes(parsed.memo)) {
            groupedHistoryMap[key].memos.push(parsed.memo);
          }
        });
        const recentHistory = Object.values(groupedHistoryMap)
          .sort((a, b) => b.log_date.localeCompare(a.log_date));

        return (
          <div
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-[3px] flex items-center justify-center z-[60] p-3 sm:p-4"
            onClick={() => setSelectedClassDetail(null)}
          >
            <div
              className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh] animate-fadeIn border border-slate-200"
              onClick={e => e.stopPropagation()}
            >
              <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-4 py-3.5 flex items-center justify-between shrink-0">
                <div className="min-w-0">
                  <h3 className="font-extrabold text-[18px] sm:text-[20px] truncate">
                    {selectedClassDetail.student} 수업 정보
                  </h3>
                  <p className="text-blue-100 text-[13px] sm:text-[14px] font-semibold">
                    {selectedClassDetail.dateStr} ({selectedClassDetail.dayLabel}) · {selectedClassDetail.time}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedClassDetail(null)}
                  className="p-1 rounded-lg text-white/90 hover:bg-white/20 active:scale-90 transition"
                  aria-label="닫기"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="p-4 overflow-y-auto space-y-4 text-left">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-800 border border-slate-200 text-[13.5px] font-extrabold">
                    📍 {selectedClassDetail.location || '복지관'}
                  </span>
                  {selectedClassDetail.tags.map((tag, idx) => {
                    let badgeStyle = 'bg-blue-100 text-blue-800 border-blue-200';
                    if (tag.includes('결석')) badgeStyle = 'bg-red-100 text-red-700 border-red-200';
                    else if (tag.includes('휴가')) badgeStyle = 'bg-gray-200 text-gray-700 border-gray-300';
                    else if (tag.includes('종료') || tag.includes('취소')) badgeStyle = 'bg-orange-100 text-orange-700 border-orange-200';
                    return (
                      <span key={idx} className={`px-2.5 py-1 rounded-lg border text-[13.5px] font-extrabold ${badgeStyle}`}>
                        {tag}
                      </span>
                    );
                  })}
                  {selectedClassDetail.sessionCounts && selectedClassDetail.sessionCounts.map((sc, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setSelectedClassDetail(null);
                        setSelectedStudentDates(sc);
                      }}
                      title="출석 일자 보기"
                      className={`px-2.5 py-1 rounded-lg text-[13.5px] cursor-pointer active:scale-95 transition ${getSessionBadgeStyle(sc.count)}`}
                    >
                      {sc.count}회차
                    </button>
                  ))}
                </div>

                {(() => {
                  const hasAtt = selectedClassDetail.tags.some(t => t.includes('출석') || /^\d+/.test(t));
                  const hasVacation = !hasAtt && selectedClassDetail.tags.some(t => t.includes('휴가'));
                  const memoBoxStyle = selectedClassDetail.isAbsent && !hasAtt
                    ? 'bg-rose-50 border-rose-200 text-red-600'
                    : hasVacation
                      ? 'bg-gray-100 border-gray-300 text-gray-500'
                      : 'bg-slate-50 border-slate-200 text-slate-900';
                  return (
                    <div>
                      <div className="text-[13px] font-extrabold text-slate-500 mb-1">수업 메모</div>
                      <div className={`p-3 rounded-xl border text-[15px] sm:text-[16px] font-bold whitespace-pre-wrap break-words leading-relaxed ${memoBoxStyle}`}>
                        {selectedClassDetail.memo || '등록된 수업 메모가 없습니다.'}
                      </div>
                    </div>
                  );
                })()}

                {recentHistory.length > 0 && (
                  <div>
                    <div className="text-[13px] font-extrabold text-slate-500 mb-1.5">이전 수업 기록 ({recentHistory.length}건)</div>
                    <div className="space-y-1.5">
                      {recentHistory.map((h, hIdx) => {
                        const memoText = h.memos.join('\n');
                        const hasAtt = h.tags.some(t => t.includes('출석') || /^\d+/.test(t));
                        const isAbs = !hasAtt && h.tags.some(t => t.includes('결석'));
                        const isVac = !hasAtt && h.tags.some(t => t.includes('휴가'));
                        const statusColor = isAbs ? 'text-red-600' : isVac ? 'text-gray-500' : 'text-blue-700';
                        const memoColor = isAbs ? 'text-red-600' : isVac ? 'text-gray-500' : 'text-slate-700';
                        return (
                          <div key={hIdx} className="p-2.5 rounded-xl bg-gray-50 border border-gray-200 text-[13.5px]">
                            <div className="flex items-center justify-between gap-2 font-extrabold text-slate-700 mb-0.5">
                              <span>{h.log_date} ({h.shift ? h.shift.split('~')[0] : ''})</span>
                              <span className={statusColor}>{h.tags.join(', ') || '-'}</span>
                            </div>
                            <div className={`${memoColor} font-medium whitespace-pre-wrap break-words`}>
                              {memoText || '메모 없음'}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-end shrink-0">
                <button
                  type="button"
                  onClick={() => setSelectedClassDetail(null)}
                  className="px-5 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 font-extrabold text-[14px] active:scale-95 transition"
                >
                  닫기
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {selectedStudentDates && (
        <div className="fixed inset-0 bg-slate-900/45 backdrop-blur-[3px] flex items-center justify-center z-[60] p-3 sm:p-4" onClick={() => setSelectedStudentDates(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl overflow-hidden flex flex-col max-h-[85vh] animate-fadeIn" onClick={e => e.stopPropagation()}>
            <div className="bg-purple-600 text-white py-3 px-4 flex justify-between items-center shrink-0">
              <h3 className="font-bold text-[18px] sm:text-[20px]">{selectedStudentDates.name}님의 출석 일자 <span className="text-purple-200 text-[15px] sm:text-[16px]">({selectedStudentDates.count}회)</span></h3>
              <button onClick={() => setSelectedStudentDates(null)} className="text-white hover:text-gray-200 active:scale-90 transition-transform p-1">
                <svg className="w-6 h-6 sm:w-7 sm:h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>
            <div className="p-3 sm:p-4 overflow-y-auto">
              <div className="grid grid-cols-4 gap-2 sm:gap-3">
                {(selectedStudentDates.dates || []).map((d, idx) => {
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
              {(!selectedStudentDates.dates || selectedStudentDates.dates.length === 0) && (
                <div className="text-center text-gray-500 py-4 font-bold text-[16px] sm:text-[18px]">출석 기록이 없습니다.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
