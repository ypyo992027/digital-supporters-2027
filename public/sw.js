self.addEventListener('install', function(event) {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', function(event) {
  // 외부 도메인 요청(Google Apps Script, Supabase 등) 및 POST 요청은 Service Worker가 가로채면 CORS/리다이렉트 오류가 발생하므로 예외 처리
  if (
    event.request.method !== 'GET' ||
    !event.request.url.startsWith(self.location.origin) ||
    event.request.url.includes('supabase.co') ||
    event.request.url.includes('apis.data.go.kr') ||
    event.request.url.includes('script.google.com') ||
    event.request.url.includes('script.googleusercontent.com')
  ) {
    return;
  }
  
  event.respondWith(fetch(event.request));
});
