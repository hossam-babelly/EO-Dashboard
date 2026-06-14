// Service Worker لإشعارات Web Push — EO-Dashboard
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data.json(); } catch (e) { data = { title: 'تنبيه', body: event.data ? event.data.text() : '' }; }
  event.waitUntil(
    self.registration.showNotification(data.title || 'لوحة المكتب التنفيذي', {
      body: data.body || '',
      dir: 'rtl',
      lang: 'ar',
      tag: 'eo-digest',
      data: { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data.url || '/'));
});
