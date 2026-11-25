import React, { useState, useEffect, Suspense, lazy } from 'react';
import MainApp from './components/MainApp';
import AppDialog from './components/AppDialog';
import QuickNavBar from './components/QuickNavBar';
import {
  getSessionItem,
  setSessionItem,
  getSavedItem,
  setSavedItem,
  fetchAllTeachersFromDb
} from './utils/helpers';
import { applyAppAppearance, getRoomPopupMode } from './utils/appSettings';

const lazyWithRetry = (componentImport) =>
  lazy(async () => {
    let pageHasAlreadyBeenForceRefreshed = false;
    try {
      pageHasAlreadyBeenForceRefreshed = JSON.parse(
        window.sessionStorage.getItem('page-has-been-force-refreshed') || 'false'
      );
    } catch (e) {}
    try {
      const component = await componentImport();
      try {
        window.sessionStorage.setItem('page-has-been-force-refreshed', 'false');
      } catch (e) {}
      return component;
    } catch (error) {
      if (!pageHasAlreadyBeenForceRefreshed) {
        try {
          window.sessionStorage.setItem('page-has-been-force-refreshed', 'true');
        } catch (e) {}
        window.location.reload(true);
        return new Promise(() => {});
      }
      throw error;
    }
  });

const ClassroomApp = lazyWithRetry(() => import('./components/ClassroomApp'));
const DailyScheduleApp = lazyWithRetry(() => import('./components/DailyScheduleApp'));
const TeamScheduleApp = lazyWithRetry(() => import('./components/TeamScheduleApp'));
const MyWeeklyScheduleApp = lazyWithRetry(() => import('./components/MyWeeklyScheduleApp'));
const StudentSearchApp = lazyWithRetry(() => import('./components/StudentSearchApp'));
const TeacherManagementApp = lazyWithRetry(() => import('./components/TeacherManagementApp'));
const AutoScheduleApp = lazyWithRetry(() => import('./components/AutoScheduleApp'));
const AssistantScheduleApp = lazyWithRetry(() => import('./components/AssistantScheduleApp'));
const HolidayManagementApp = lazyWithRetry(() => import('./components/HolidayManagementApp'));
const NangmanStudioApp = lazyWithRetry(() => import('./components/NangmanStudioApp'));
const NoticeManagementApp = lazyWithRetry(() => import('./components/NoticeManagementApp'));
const StudentFormsAdminApp = lazyWithRetry(() => import('./components/StudentFormsAdminApp'));
const ClassApplicantsApp = lazyWithRetry(() => import('./components/ClassApplicantsApp'));
const NameCardApp = lazyWithRetry(() => import('./components/NameCardApp'));

const LoadingFallback = () => (
  <div className="min-h-[100dvh] app-surface flex flex-col items-center justify-center">
    <div className="w-12 h-12 border-[3px] border-blue-100 border-t-blue-600 rounded-full animate-spin"></div>
    <p className="mt-4 text-base font-semibold text-gray-500 animate-pulse">화면을 불러오는 중...</p>
  </div>
);

export default function App() {
  const [currentView, setCurrentView] = useState(() => {
    const urlView = new URLSearchParams(window.location.search).get('view');
    if (urlView) return urlView;
    return getSessionItem('sungdong_current_view', 'main');
  });
  const [selectedTeamForSchedule, setSelectedTeamForSchedule] = useState(() => getSavedItem('sungdong_schedule_team', '') || getSavedItem('sungdong_team', ''));
  const [selectedTeacherForWeekly, setSelectedTeacherForWeekly] = useState(() => getSavedItem('sungdong_weekly_teacher', '') || getSavedItem('sungdong_teacher', ''));
  const [selectedFormsTeacher, setSelectedFormsTeacher] = useState(() => getSavedItem('sungdong_teacher', ''));
  const [selectedFormsTeam, setSelectedFormsTeam] = useState(() => getSavedItem('sungdong_team', ''));
  const [isFormsAdminMode, setIsFormsAdminMode] = useState(() => {
    return getSessionItem('sungdong_forms_admin_mode', 'false') === 'true';
  });
  const [selectedNoticeForView, setSelectedNoticeForView] = useState(null);

  useEffect(() => {
    applyAppAppearance();
  }, []);

  // [화면 전환 및 브라우저 History(뒤로가기) 연동]
  const navigateTo = (viewName, replace = false) => {
    if (viewName === currentView) return;
    if (viewName !== 'main') {
      try {
        if (getRoomPopupMode() !== 'always') {
          window.__sungdong_initial_room_popup_shown = true;
          window.sessionStorage.setItem('sungdong_room_popup_session_done', 'true');
        }
      } catch (_) {}
    }
    const targetUrl = viewName === 'main' ? window.location.pathname : `?view=${viewName}`;
    if (replace) {
      window.history.replaceState({ view: viewName }, '', targetUrl);
    } else {
      window.history.pushState({ view: viewName }, '', targetUrl);
    }
    setCurrentView(viewName);
  };

  const handleNavigateBack = () => {
    setIsFormsAdminMode(false);
    setSessionItem('sungdong_forms_admin_mode', 'false');
    if (window.history.state && window.history.state.view && window.history.state.view !== 'main') {
      window.history.back();
    } else {
      navigateTo('main', true);
    }
  };

  useEffect(() => {
    // 1. 초기 브라우저 History 설정: 작업화면 직접 진입 시에도 뒤로가기 누르면 메인으로 복귀할 수 있도록 스택 구성
    const initialView = new URLSearchParams(window.location.search).get('view') || currentView || 'main';
    if (initialView && initialView !== 'main') {
      window.history.replaceState({ view: 'main' }, '', window.location.pathname);
      window.history.pushState({ view: initialView }, '', `?view=${initialView}`);
    } else {
      window.history.replaceState({ view: 'main' }, '', window.location.pathname);
    }

    // 2. 스마트폰 하드웨어/제스처 뒤로가기(popstate) 이벤트 핸들러
    const handlePopState = (e) => {
      const stateView = e.state?.view || new URLSearchParams(window.location.search).get('view') || 'main';
      if (stateView === 'main') {
        setIsFormsAdminMode(false);
        setSessionItem('sungdong_forms_admin_mode', 'false');
      }
      setCurrentView(stateView);
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  useEffect(() => {
    setSessionItem('sungdong_current_view', currentView);
    // 메뉴(화면) 전환 시 구글 애널리틱스로 페이지 뷰 이벤트 전송
    if (typeof window !== 'undefined' && window.gtag) {
      window.gtag('event', 'page_view', {
        page_title: currentView,
        page_path: '/' + currentView
      });
    }
  }, [currentView]);

  useEffect(() => {
    if (selectedTeamForSchedule) {
      setSavedItem('sungdong_schedule_team', selectedTeamForSchedule);
    }
  }, [selectedTeamForSchedule]);

  useEffect(() => {
    if (selectedTeacherForWeekly) {
      setSavedItem('sungdong_weekly_teacher', selectedTeacherForWeekly);
    }
  }, [selectedTeacherForWeekly]);

  useEffect(() => {
    fetchAllTeachersFromDb();
  }, []);

  // [전역 버전 체크 및 자동 최신화 로직]
  // 어느 화면에 있든 새 버전이 배포되면 스마트폰/PC에서 즉시 감지하여 최신 코드로 자동 새로고침합니다.
  useEffect(() => {
    const checkVersion = async () => {
      try {
        const res = await fetch(`/version.json?t=${new Date().getTime()}`);
        if (res.ok) {
          const contentType = res.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            const data = await res.json();
            if (data && data.version) {
              const serverVersion = Number(data.version);
              const clientVersion = Number(import.meta.env.VITE_APP_VERSION);
              if (clientVersion && serverVersion > clientVersion) {
                console.log('새 버전이 배포되어 앱을 최신 상태로 갱신합니다.', { clientVersion, serverVersion });
                const activeView = getSessionItem('sungdong_current_view', 'main');
                // 서류 관리, 일정 관리 등 작업/조회 화면에서는 강제 새로고침을 하지 않고 메인 화면일 때만 갱신
                if (activeView === 'main') {
                  window.location.reload(true);
                }
              }
            }
          }
        }
      } catch (err) {
        console.warn('앱 버전 확인 오류:', err);
      }
    };

    checkVersion();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkVersion();
      }
    };
    window.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', checkVersion);
    return () => {
      window.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', checkVersion);
    };
  }, []);

  const renderView = () => {
    if (currentView === 'classroom') {
      return (
        <ClassroomApp
          onNavigateBack={handleNavigateBack}
          onNavigateToNangmanStudio={() => navigateTo('nangmanStudio')}
        />
      );
    }

    if (currentView === 'dailySchedule') {
      return (
        <DailyScheduleApp
          initialTeam={selectedTeamForSchedule}
          onNavigateBack={handleNavigateBack}
          onTeamChange={(team) => setSelectedTeamForSchedule(team)}
        />
      );
    }

    if (currentView === 'teamSchedule') {
      return <TeamScheduleApp team={selectedTeamForSchedule} onNavigateBack={handleNavigateBack} />;
    }

    if (currentView === 'myWeeklySchedule') {
      const activeTeam = selectedTeamForSchedule || getSavedItem('sungdong_schedule_team', '') || getSavedItem('sungdong_team', '');
      const activeTeacher = selectedTeacherForWeekly || getSavedItem('sungdong_weekly_teacher', '') || getSavedItem('sungdong_teacher', '');
      return (
        <MyWeeklyScheduleApp
          team={activeTeam}
          teacher={activeTeacher}
          onNavigateBack={handleNavigateBack}
        />
      );
    }

    if (currentView === 'studentSearch') {
      return <StudentSearchApp onNavigateBack={handleNavigateBack} />;
    }

    if (currentView === 'teacherManagement') {
      return <TeacherManagementApp onNavigateBack={handleNavigateBack} />;
    }

    if (currentView === 'autoSchedule') {
      return (
        <AutoScheduleApp
          onNavigateBack={handleNavigateBack}
          onNavigateToAssistantSchedule={() => navigateTo('assistantSchedule')}
        />
      );
    }

    if (currentView === 'assistantSchedule') {
      return <AssistantScheduleApp onNavigateBack={handleNavigateBack} />;
    }

    if (currentView === 'holidayManagement') {
      return <HolidayManagementApp onNavigateBack={handleNavigateBack} />;
    }

    if (currentView === 'nangmanStudio') {
      return (
        <NangmanStudioApp
          onNavigateBack={handleNavigateBack}
          onNavigateToClassroom={() => navigateTo('classroom')}
        />
      );
    }

    if (currentView === 'noticeManagement') {
      return <NoticeManagementApp onNavigateBack={handleNavigateBack} initialNotice={selectedNoticeForView} />;
    }

    if (currentView === 'studentFormsAdmin') {
      return (
        <StudentFormsAdminApp
          onNavigateBack={handleNavigateBack}
          initialTeacher={selectedFormsTeacher || getSavedItem('sungdong_teacher', '')}
          initialTeam={selectedFormsTeam || getSavedItem('sungdong_team', '')}
          isAdminMode={isFormsAdminMode}
        />
      );
    }

    if (currentView === 'classApplicants') {
      return <ClassApplicantsApp onNavigateBack={handleNavigateBack} />;
    }

    if (currentView === 'nameCard') {
      return <NameCardApp onNavigateBack={handleNavigateBack} />;
    }

    return (
      <MainApp
        onNavigateToClassroom={() => navigateTo('classroom')}
        onNavigateToDailySchedule={(team) => {
          setSelectedTeamForSchedule(team);
          try {
            window.sessionStorage.removeItem('sungdong_daily_schedule_date');
          } catch (e) {}
          navigateTo('dailySchedule');
        }}
        onNavigateToMyWeeklySchedule={() => {
          const t = getSavedItem('sungdong_team', '') || selectedTeamForSchedule;
          const th = getSavedItem('sungdong_teacher', '') || selectedTeacherForWeekly;
          setSelectedTeamForSchedule(t);
          setSelectedTeacherForWeekly(th);
          if (t) setSavedItem('sungdong_schedule_team', t);
          if (th) setSavedItem('sungdong_weekly_teacher', th);
          navigateTo('myWeeklySchedule');
        }}
        onNavigateToStudentSearch={() => navigateTo('studentSearch')}
        onNavigateToStudentFormsAdmin={(options = {}) => {
          const t = options.team || getSavedItem('sungdong_team', '');
          const th = options.teacher || getSavedItem('sungdong_teacher', '');
          setSelectedFormsTeam(t);
          setSelectedFormsTeacher(th);
          const adminMode = !!options.isAdminMode;
          setIsFormsAdminMode(adminMode);
          setSessionItem('sungdong_forms_admin_mode', adminMode ? 'true' : 'false');
          navigateTo('studentFormsAdmin');
        }}
        onNavigateToClassApplicants={() => navigateTo('classApplicants')}
        onNavigateToTeamSchedule={(team) => {
          setSelectedTeamForSchedule(team);
          navigateTo('teamSchedule');
        }}
        onNavigateToTeacherManagement={() => navigateTo('teacherManagement')}
        onNavigateToAutoSchedule={() => navigateTo('autoSchedule')}
        onNavigateToHolidayManagement={() => navigateTo('holidayManagement')}
        onNavigateToNangmanStudio={() => navigateTo('nangmanStudio')}
        onNavigateToNoticeManagement={(notice = null) => {
          setSelectedNoticeForView(notice);
          navigateTo('noticeManagement');
        }}
        onNavigateToNameCard={() => navigateTo('nameCard')}
      />
    );
  };

  const showQuickNav = ['dailySchedule', 'myWeeklySchedule', 'studentSearch'].includes(currentView);

  const handleQuickNavSelect = (targetView) => {
    if (targetView === 'main') {
      const savedTeam = getSavedItem('sungdong_team', '');
      const savedTeacher = getSavedItem('sungdong_teacher', '');
      if (savedTeam && savedTeacher) {
        setSessionItem('sungdong_is_logged_in', 'true');
      }
      navigateTo('main');
      return;
    }
    if (targetView === 'myWeeklySchedule') {
      const t = getSavedItem('sungdong_team', '') || selectedTeamForSchedule;
      const th = getSavedItem('sungdong_teacher', '') || selectedTeacherForWeekly;
      if (t) setSelectedTeamForSchedule(t);
      if (th) setSelectedTeacherForWeekly(th);
    }
    navigateTo(targetView);
  };

  return (
    <Suspense fallback={<LoadingFallback />}>
      <div className={showQuickNav ? 'pb-16' : ''}>
        {renderView()}
      </div>
      {showQuickNav && <QuickNavBar currentView={currentView} onSelectView={handleQuickNavSelect} />}
      <AppDialog />
    </Suspense>
  );
}
