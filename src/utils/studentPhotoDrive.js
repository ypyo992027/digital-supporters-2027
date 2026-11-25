import { getSavedItem, setSavedItem, removeSavedItem } from './helpers';

export const STUDENT_PHOTO_FOLDER_ID = '1LMdhlJ8DVkfY0mSvPnUbieWUpVnmAtDy';
export const STUDENT_PHOTO_FOLDER_URL = `https://drive.google.com/drive/u/3/folders/${STUDENT_PHOTO_FOLDER_ID}`;
export const STUDENT_PHOTO_GAS_URL_KEY = 'sungdong_student_photo_gas_url';
export const DEFAULT_STUDENT_PHOTO_GAS_URL = 'https://script.google.com/macros/s/AKfycbxS2DoYvFJkjOG8NxOLilNAaJ1VsvtIPnf_O3lVrJJYhiYaPT3qs7G9boaelzaNBUBS/exec';

export const getStudentPhotoGasUrl = () => {
  const saved = (getSavedItem(STUDENT_PHOTO_GAS_URL_KEY, '') || '').trim();
  if (saved) return saved;
  return (import.meta.env.VITE_STUDENT_PHOTO_GAS_URL || DEFAULT_STUDENT_PHOTO_GAS_URL).trim();
};

export const saveStudentPhotoGasUrl = (url) => {
  const trimmed = (url || '').trim();
  if (!trimmed) {
    removeSavedItem(STUDENT_PHOTO_GAS_URL_KEY);
    return '';
  }
  setSavedItem(STUDENT_PHOTO_GAS_URL_KEY, trimmed);
  return trimmed;
};

const sanitizePart = (str) =>
  String(str || '')
    .trim()
    .replace(/[\\/:*?"<>|\s_]+/g, '-')
    .replace(/^-+|-+$/g, '') || '미지정';

// 파일명 규칙: {학생이름}_{날짜}_{교시}_{선생님}_{타임스탬프}.jpg
export const buildStudentPhotoFileName = ({ studentName, date, shift, teacher }) => {
  const cleanStudent = sanitizePart(studentName);
  const cleanDate = sanitizePart(date);
  const cleanShift = sanitizePart((shift || '').split('~')[0]);
  const cleanTeacher = sanitizePart(teacher);
  return `${cleanStudent}_${cleanDate}_${cleanShift}_${cleanTeacher}_${Date.now()}.jpg`;
};

export const parseStudentPhotoFileName = (fileName) => {
  const base = String(fileName || '').replace(/\.[^.]+$/, '');
  const parts = base.split('_');
  return {
    studentName: parts[0] || '',
    date: parts[1] || '',
    shift: parts[2] || '',
    teacher: parts[3] || ''
  };
};

export const compressImageFileToDataUrl = (file, maxSize = 1600, quality = 0.85) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('이미지 파일을 읽을 수 없습니다.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('이미지를 불러올 수 없습니다.'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxSize || height > maxSize) {
          if (width >= height) {
            height = Math.round((height * maxSize) / width);
            width = maxSize;
          } else {
            width = Math.round((width * maxSize) / height);
            height = maxSize;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
};

const postToStudentPhotoGas = async (payload, timeoutMs = 20000) => {
  const gasUrl = getStudentPhotoGasUrl();
  if (!gasUrl) {
    throw new Error('GAS_URL_NOT_CONFIGURED');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(gasUrl, {
      method: 'POST',
      mode: 'cors',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      signal: controller.signal,
      body: JSON.stringify({
        folderId: STUDENT_PHOTO_FOLDER_ID,
        ...payload
      })
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      throw new Error(data?.error || '구글 드라이브 요청에 실패했습니다.');
    }
    return data;
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('구글 드라이브 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.');
    }
    if (err?.message === 'Failed to fetch' || err?.name === 'TypeError') {
      throw new Error('구글 드라이브 연결에 실패했습니다. 웹 앱 배포 권한(모든 사용자)과 URL(/exec)을 확인해 주세요.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
};

export const uploadStudentPhotoToDrive = async ({ fileName, imageData, studentName, date, shift, teacher }) => {
  const data = await postToStudentPhotoGas({
    action: 'uploadStudentPhoto',
    fileName,
    imageData,
    studentName,
    date,
    shift,
    teacher
  }, 25000);
  return data.file;
};

export const listStudentPhotosFromDrive = async (studentName) => {
  const data = await postToStudentPhotoGas({
    action: 'listStudentPhotos',
    studentName
  }, 15000);
  return Array.isArray(data.files) ? data.files : [];
};

export const deleteStudentPhotoFromDrive = async (fileId) => {
  return postToStudentPhotoGas({
    action: 'deleteStudentPhoto',
    fileId
  }, 15000);
};
