/**
 * [독립형] 디지털교육 서포터즈 - 학생 사진 촬영/조회/삭제 구글 드라이브 스크립트
 * - https://script.google.com (구글 드라이브 폴더 소유 계정 /u/3/) 에서 "새 프로젝트"로 배포
 * - 대상 폴더: https://drive.google.com/drive/u/3/folders/1LMdhlJ8DVkfY0mSvPnUbieWUpVnmAtDy
 * - 배포: [배포] -> [새 배포] -> 유형: [웹 앱] -> 실행 주체: [나] -> 액세스 권한: [모든 사용자]
 */

var TARGET_FOLDER_ID = '1LMdhlJ8DVkfY0mSvPnUbieWUpVnmAtDy';

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return jsonResponse({ ok: true, service: 'ds-student-photo-drive', folderId: TARGET_FOLDER_ID });
}

function doPost(e) {
  try {
    var raw = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    var params = JSON.parse(raw);
    var action = params.action ? String(params.action) : 'uploadStudentPhoto';
    var folderId = params.folderId ? String(params.folderId) : TARGET_FOLDER_ID;
    var folder = DriveApp.getFolderById(folderId);

    if (action === 'uploadStudentPhoto') {
      var fileName = params.fileName ? String(params.fileName) : ('학생사진_' + Date.now() + '.jpg');
      var imageData = params.imageData ? String(params.imageData) : '';
      if (!imageData || imageData.indexOf('data:image') !== 0) {
        return jsonResponse({ success: false, error: '올바른 이미지 데이터가 아닙니다.' });
      }
      var mimeMatch = imageData.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,/);
      var mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
      var base64Data = imageData.split(',')[1];
      var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, fileName);
      var file = folder.createFile(blob);
      try {
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      } catch (shareErr) {}

      return jsonResponse({
        success: true,
        file: {
          id: file.getId(),
          name: file.getName(),
          url: file.getUrl(),
          thumbnailUrl: 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w800',
          viewUrl: 'https://drive.google.com/uc?export=view&id=' + file.getId(),
          createdTime: file.getDateCreated().toISOString()
        }
      });
    }

    if (action === 'listStudentPhotos') {
      var studentName = params.studentName ? String(params.studentName).trim() : '';
      var prefix = studentName ? (studentName + '_') : '';
      var files = folder.getFiles();
      var list = [];
      while (files.hasNext()) {
        var f = files.next();
        if (f.isTrashed()) continue;
        var name = f.getName() || '';
        if (prefix && name.indexOf(prefix) !== 0 && name.indexOf(studentName) === -1) continue;
        list.push({
          id: f.getId(),
          name: name,
          url: f.getUrl(),
          thumbnailUrl: 'https://drive.google.com/thumbnail?id=' + f.getId() + '&sz=w800',
          viewUrl: 'https://drive.google.com/uc?export=view&id=' + f.getId(),
          createdTime: f.getDateCreated().toISOString()
        });
      }
      list.sort(function (a, b) {
        return b.createdTime < a.createdTime ? -1 : b.createdTime > a.createdTime ? 1 : 0;
      });
      return jsonResponse({ success: true, files: list });
    }

    if (action === 'deleteStudentPhoto') {
      var fileId = params.fileId ? String(params.fileId).trim() : '';
      if (!fileId) {
        return jsonResponse({ success: false, error: 'fileId가 필요합니다.' });
      }
      var targetFile = DriveApp.getFileById(fileId);
      targetFile.setTrashed(true);
      return jsonResponse({ success: true, deletedId: fileId });
    }

    return jsonResponse({ success: false, error: '지원하지 않는 작업입니다: ' + action });
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}
