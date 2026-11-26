import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  getStudentPhotoGasUrl,
  buildStudentPhotoFileName,
  parseStudentPhotoFileName,
  getCurrentGeoCoords,
  formatCaptureTime,
  compressImageFileToDataUrl,
  uploadStudentPhotoToDrive,
  listStudentPhotosFromDrive,
  deleteStudentPhotoFromDrive
} from '../utils/studentPhotoDrive';
import { showAlert, showConfirm } from '../utils/dialog';

export default function StudentPhotoModal({ target, onClose, onPhotosChanged }) {
  const cameraInputRef = useRef(null);
  const albumInputRef = useRef(null);
  const preFetchedCoordsRef = useRef(null);

  const gasUrl = getStudentPhotoGasUrl();

  const [photos, setPhotos] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [previewPhoto, setPreviewPhoto] = useState(null);
  const [previewAddress, setPreviewAddress] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const studentName = (target?.studentName || '').trim();

  const loadPhotos = useCallback(async () => {
    if (!gasUrl || !studentName) return;
    setIsLoading(true);
    setErrorMsg('');
    try {
      const list = await listStudentPhotosFromDrive(studentName);
      setPhotos(list);
      onPhotosChanged?.(studentName, list.length);
    } catch (err) {
      setErrorMsg(err?.message || '사진 목록을 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, [gasUrl, studentName]);

  useEffect(() => {
    loadPhotos();
  }, [loadPhotos]);

  // 모달이 열릴 때 미리 GPS 위치를 확보해 둠 (실내 지연 방지)
  useEffect(() => {
    let isMounted = true;
    getCurrentGeoCoords(7000).then((coords) => {
      if (isMounted && coords) {
        preFetchedCoordsRef.current = coords;
      }
    });
    return () => { isMounted = false; };
  }, []);

  useEffect(() => {
    setPreviewAddress('');
    if (!previewPhoto) return;
    const meta = parseStudentPhotoFileName(previewPhoto.name);
    if (!meta.coords) return;
    let isMounted = true;
    fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${meta.coords.lat}&lon=${meta.coords.lng}&accept-language=ko`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (!isMounted || !data) return;
        const addr = data.display_name || '';
        if (addr) {
          setPreviewAddress(addr.split(',').slice(0, 4).reverse().map((s) => s.trim()).filter(Boolean).join(' '));
        }
      })
      .catch(() => {});
    return () => { isMounted = false; };
  }, [previewPhoto]);

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!gasUrl) {
      await showAlert('구글 드라이브 연동 URL이 설정되지 않았습니다.');
      return;
    }

    setIsUploading(true);
    setErrorMsg('');
    try {
      const [dataUrl, freshCoords] = await Promise.all([
        compressImageFileToDataUrl(file),
        getCurrentGeoCoords(6000)
      ]);
      const coords = freshCoords || preFetchedCoordsRef.current;
      const fileName = buildStudentPhotoFileName({
        studentName,
        date: target?.date || '',
        shift: target?.shift || '',
        teacher: target?.teacher || '',
        coords
      });
      const uploaded = await uploadStudentPhotoToDrive({
        fileName,
        imageData: dataUrl,
        studentName,
        date: target?.date || '',
        shift: target?.shift || '',
        teacher: target?.teacher || ''
      });
      if (uploaded) {
        setPhotos((prev) => {
          const next = [uploaded, ...prev];
          onPhotosChanged?.(studentName, next.length);
          return next;
        });
      } else {
        await loadPhotos();
      }
    } catch (err) {
      setErrorMsg(err?.message || '사진 업로드에 실패했습니다.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (photo) => {
    const ok = await showConfirm(`'${photo.name}' 사진을 삭제할까요?\n(구글 드라이브 휴지통으로 이동됩니다)`);
    if (!ok) return;
    setDeletingId(photo.id);
    try {
      await deleteStudentPhotoFromDrive(photo.id);
      setPhotos((prev) => {
        const next = prev.filter((p) => p.id !== photo.id);
        onPhotosChanged?.(studentName, next.length);
        return next;
      });
      if (previewPhoto?.id === photo.id) setPreviewPhoto(null);
    } catch (err) {
      await showAlert('삭제 실패: ' + (err?.message || '오류가 발생했습니다.'));
    } finally {
      setDeletingId('');
    }
  };

  if (!target) return null;

  return (
    <div
      className="fixed inset-0 bg-slate-900/55 backdrop-blur-[3px] flex items-center justify-center z-[90] p-3 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[88vh] animate-fadeIn border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-4 py-3.5 flex items-center justify-between shrink-0">
          <div className="min-w-0">
            <h3 className="font-extrabold text-[17px] sm:text-[19px] truncate">
              {studentName} 님 사진
            </h3>
            <p className="text-blue-100 text-[12.5px] font-semibold truncate">
              {target.date} · {(target.shift || '').split('~')[0]}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-lg text-white/90 hover:bg-white/20 active:scale-90 transition"
              aria-label="닫기"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-4 overflow-y-auto space-y-4">
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleFileChange}
          />
          <input
            ref={albumInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />

          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              disabled={isUploading}
              onClick={() => cameraInputRef.current?.click()}
              className="py-3 px-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-[15px] shadow-md active:scale-95 transition flex items-center justify-center gap-1.5 disabled:opacity-50 touch-manipulation"
            >
              <span>📷</span>
              <span>{isUploading ? '저장 중...' : '카메라 촬영'}</span>
            </button>
            <button
              type="button"
              disabled={isUploading}
              onClick={() => albumInputRef.current?.click()}
              className="py-3 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 font-extrabold text-[15px] active:scale-95 transition flex items-center justify-center gap-1.5 disabled:opacity-50 touch-manipulation"
            >
              <span>🖼️</span>
              <span>앨범에서 선택</span>
            </button>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-[13.5px] font-bold">
              {errorMsg}
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[14px] font-extrabold text-slate-800">
                저장된 사진 ({photos.length}장)
              </span>
              {gasUrl && (
                <button
                  type="button"
                  onClick={loadPhotos}
                  disabled={isLoading}
                  className="text-[12.5px] font-bold text-blue-600 hover:underline disabled:opacity-50"
                >
                  {isLoading ? '불러오는 중...' : '새로고침'}
                </button>
              )}
            </div>

            {isLoading && photos.length === 0 ? (
              <div className="py-8 text-center text-slate-500 font-bold text-[14px]">
                사진 목록을 불러오는 중입니다...
              </div>
            ) : photos.length === 0 ? (
              <div className="py-8 text-center text-slate-400 font-bold text-[14px] bg-slate-50 rounded-xl border border-dashed border-slate-200">
                저장된 사진이 없습니다.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2.5">
                {photos.map((photo) => {
                  const meta = parseStudentPhotoFileName(photo.name);
                  return (
                    <div
                      key={photo.id}
                      className="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden flex flex-col shadow-xs"
                    >
                      <button
                        type="button"
                        onClick={() => setPreviewPhoto(photo)}
                        className="aspect-[4/3] w-full bg-slate-200 overflow-hidden"
                      >
                        <img
                          src={photo.thumbnailUrl || (photo.id ? `https://drive.google.com/thumbnail?id=${photo.id}&sz=w800` : photo.viewUrl)}
                          alt={photo.name}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      </button>
                      <div className="p-2 flex items-center justify-between gap-1">
                        <div className="min-w-0 text-left">
                          <div className="text-[12px] font-extrabold text-slate-800 truncate">
                            {meta.date || photo.name}
                          </div>
                          <div className="text-[11px] font-semibold text-slate-500 truncate">
                            {[meta.shift, meta.teacher].filter(Boolean).join(' · ') || '구글 드라이브'}
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={deletingId === photo.id}
                          onClick={() => handleDelete(photo)}
                          className="px-2 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 text-[11.5px] font-extrabold shrink-0 disabled:opacity-50"
                        >
                          {deletingId === photo.id ? '삭제중' : '삭제'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 font-extrabold text-[14px] active:scale-95 transition"
          >
            닫기
          </button>
        </div>
      </div>

      {previewPhoto && (() => {
        const meta = parseStudentPhotoFileName(previewPhoto.name);
        const captureTimeText = formatCaptureTime(previewPhoto.createdTime, meta.timestamp);
        const coordText = meta.coords ? `${meta.coords.lat.toFixed(5)}, ${meta.coords.lng.toFixed(5)}` : '';
        const locationLabel = meta.coords
          ? (previewAddress ? `${previewAddress} (${coordText})` : `위도 ${meta.coords.lat.toFixed(5)}, 경도 ${meta.coords.lng.toFixed(5)}`)
          : 'GPS 위치 정보 없음';
        return (
          <div
            className="fixed inset-0 bg-black/90 z-[100] flex flex-col items-center justify-center p-3 sm:p-5"
            onClick={(e) => {
              e.stopPropagation();
              setPreviewPhoto(null);
            }}
          >
            <img
              src={previewPhoto.id ? `https://drive.google.com/thumbnail?id=${previewPhoto.id}&sz=w1600` : (previewPhoto.thumbnailUrl || previewPhoto.viewUrl)}
              alt={previewPhoto.name}
              referrerPolicy="no-referrer"
              onError={(e) => {
                if (previewPhoto.thumbnailUrl && e.currentTarget.src !== previewPhoto.thumbnailUrl) {
                  e.currentTarget.src = previewPhoto.thumbnailUrl;
                }
              }}
              className="max-w-full max-h-[74vh] rounded-xl shadow-2xl object-contain"
              onClick={(e) => e.stopPropagation()}
            />
            <div
              className="mt-3 w-full max-w-md rounded-xl bg-white/10 backdrop-blur-md border border-white/20 px-3.5 py-2.5 text-white text-[13px] sm:text-[14px] space-y-1 text-left"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2">
                <span className="text-white/70 font-bold shrink-0">촬영시간</span>
                <span className="font-extrabold tabular-nums">{captureTimeText || meta.date || '정보 없음'}</span>
              </div>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 min-w-0">
                  <span className="text-white/70 font-bold shrink-0">촬영위치</span>
                  <span className="font-bold break-words">{locationLabel}</span>
                </div>
                {meta.coords && (
                  <a
                    href={`https://maps.google.com/?q=${meta.coords.lat},${meta.coords.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sky-300 hover:underline font-extrabold text-[12.5px] shrink-0"
                  >
                    지도 ↗
                  </a>
                )}
              </div>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(previewPhoto);
                }}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-[14px]"
              >
                사진 삭제
              </button>
              <button
                type="button"
                onClick={() => setPreviewPhoto(null)}
                className="px-4 py-2 rounded-xl bg-white text-slate-900 font-extrabold text-[14px]"
              >
                닫기
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
