import { getSavedItem, setSavedItem, removeSavedItem } from './helpers';

export const BG_GRAY_LEVEL_KEY = 'sungdong_bg_gray_level';
export const ROOM_POPUP_MODE_KEY = 'sungdong_room_popup_mode';
export const FONT_SCALE_KEY = 'sungdong_font_scale';
export const ADMIN_PASSWORD_KEY = 'sungdong_admin_password';

export const DEFAULT_BG_GRAY_LEVEL = 20;
export const DEFAULT_ROOM_POPUP_MODE = 'once';
export const DEFAULT_FONT_SCALE = 'normal';

export const getFontScale = () => {
  try {
    const saved = getSavedItem(FONT_SCALE_KEY);
    return (saved === 'large' || saved === 'xlarge') ? saved : DEFAULT_FONT_SCALE;
  } catch (_) {
    return DEFAULT_FONT_SCALE;
  }
};

const lerp = (start, end, ratio) => Math.round(start + (end - start) * ratio);

const toRgb = (r, g, b) => `rgb(${r}, ${g}, ${b})`;

export const clampBgGrayLevel = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return DEFAULT_BG_GRAY_LEVEL;
  return Math.max(0, Math.min(100, Math.round(num)));
};

export const getBgGrayLevel = () => {
  try {
    const raw = getSavedItem(BG_GRAY_LEVEL_KEY);
    if (raw === null || raw === undefined || raw === '') {
      return DEFAULT_BG_GRAY_LEVEL;
    }
    return clampBgGrayLevel(raw);
  } catch (_) {
    return DEFAULT_BG_GRAY_LEVEL;
  }
};

export const getRoomPopupMode = () => {
  try {
    const saved = getSavedItem(ROOM_POPUP_MODE_KEY);
    return saved === 'always' ? 'always' : 'once';
  } catch (_) {
    return DEFAULT_ROOM_POPUP_MODE;
  }
};

export const getExpectedAdminPassword = () => import.meta.env.VITE_ADMIN_PASSWORD || 'qqq';

export const getSavedAdminPassword = () => {
  try {
    return getSavedItem(ADMIN_PASSWORD_KEY, '') || '';
  } catch (_) {
    return '';
  }
};

export const verifyAdminPassword = (input) => {
  return typeof input === 'string' && input === getExpectedAdminPassword();
};

export const hasValidSavedAdminPassword = () => {
  const saved = getSavedAdminPassword();
  return Boolean(saved) && saved === getExpectedAdminPassword();
};

export const clearSavedAdminPassword = () => {
  removeSavedItem(ADMIN_PASSWORD_KEY);
  removeSavedItem('sungdong_admin_logged_in');
};

export const saveAdminPassword = (input) => {
  if (!input) {
    clearSavedAdminPassword();
    return { ok: true, saved: false };
  }
  if (verifyAdminPassword(input)) {
    setSavedItem(ADMIN_PASSWORD_KEY, input);
    setSavedItem('sungdong_admin_logged_in', 'true');
    return { ok: true, saved: true };
  }
  return {
    ok: false,
    saved: hasValidSavedAdminPassword(),
    error: '관리자 비밀번호가 일치하지 않습니다.'
  };
};

export const computeMainBgColors = (level) => {
  const ratio = clampBgGrayLevel(level) / 100;
  return {
    mainBg: toRgb(lerp(255, 200, ratio), lerp(255, 210, ratio), lerp(255, 225, ratio)),
    outerBg: toRgb(lerp(252, 197, ratio), lerp(253, 213, ratio), lerp(255, 225, ratio))
  };
};

export const applyAppAppearance = (grayLevelOverride, fontScaleOverride) => {
  if (typeof document === 'undefined') return;
  const grayLevel = grayLevelOverride !== undefined ? clampBgGrayLevel(grayLevelOverride) : getBgGrayLevel();
  const fontScale = fontScaleOverride !== undefined ? fontScaleOverride : getFontScale();
  const root = document.documentElement;

  root.classList.remove('dark');
  try {
    removeSavedItem('sungdong_theme_mode');
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem('sungdong_theme_mode');
    }
  } catch (_) {}

  const { mainBg, outerBg } = computeMainBgColors(grayLevel);
  root.style.setProperty('--main-bg-color', mainBg);
  root.style.setProperty('--main-outer-bg-color', outerBg);
  root.style.fontSize = fontScale === 'xlarge' ? '115%' : fontScale === 'large' ? '107.5%' : '100%';
};

export const saveFontScale = (scale) => {
  const normalized = (scale === 'large' || scale === 'xlarge') ? scale : DEFAULT_FONT_SCALE;
  setSavedItem(FONT_SCALE_KEY, normalized);
  applyAppAppearance(undefined, normalized);
  return normalized;
};

export const saveBgGrayLevel = (level) => {
  const clamped = clampBgGrayLevel(level);
  setSavedItem(BG_GRAY_LEVEL_KEY, String(clamped));
  applyAppAppearance(clamped);
  return clamped;
};

export const saveRoomPopupMode = (mode) => {
  const normalized = mode === 'always' ? 'always' : 'once';
  setSavedItem(ROOM_POPUP_MODE_KEY, normalized);
  return normalized;
};
