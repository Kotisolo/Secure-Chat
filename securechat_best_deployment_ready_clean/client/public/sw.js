self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(key => caches.delete(key))))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(key => caches.delete(key))))
      .then(() => clients.claim())
  );
});

self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Naad', body: event.data ? event.data.text() : '' };
  }

  if (data.type === 'incoming-call') {
    const title = `Incoming ${data.callType === 'video' ? 'video' : 'voice'} call`;
    event.waitUntil(
      self.registration.showNotification(title, {
        body: `${data.callerName || 'Someone'} is calling you`,
        tag: 'incoming-call-' + (data.callerId || ''),
        requireInteraction: true,
        data
      })
    );
    return;
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'Naad', {
      body: data.body || '',
      tag: data.tag || undefined,
      data
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
      const existing = windows[0];
      return existing ? existing.focus() : clients.openWindow('/');
    })
  );
});
