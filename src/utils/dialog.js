// 앱 전역 커스텀 알림/확인 모달 제어 유틸리티

let dialogListener = null;

export const registerDialogListener = (listener) => {
  dialogListener = listener;
  return () => {
    if (dialogListener === listener) {
      dialogListener = null;
    }
  };
};

export const showAlert = (message) => {
  const text = String(message ?? '');
  if (!dialogListener) {
    window.alert(text);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    dialogListener({
      type: 'alert',
      message: text,
      resolve: () => resolve()
    });
  });
};

export const showConfirm = (message) => {
  const text = String(message ?? '');
  if (!dialogListener) {
    return Promise.resolve(window.confirm(text));
  }
  return new Promise((resolve) => {
    dialogListener({
      type: 'confirm',
      message: text,
      resolve: (confirmed) => resolve(Boolean(confirmed))
    });
  });
};
