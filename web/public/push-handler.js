self.addEventListener('push', event => {
  let message = {}
  try { message = event.data ? event.data.json() : {} } catch { /* Use generic fallback. */ }
  event.waitUntil(self.registration.showNotification(message.title || 'Задача', {
    body: message.body || '',
    icon: '/icon-192.png', badge: '/icon-192.png', tag: message.tag || 'intent-reminder',
    data: { url: typeof message.url === 'string' && /^\/\?view=today&date=\d{4}-\d{2}-\d{2}$/.test(message.url) ? message.url : '/?view=today' },
  }))
})
self.addEventListener('notificationclick', event => {
  event.notification.close()
  const target = event.notification.data?.url || '/?view=today'
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.navigate(target)
        return client.focus()
      }
    }
    return self.clients.openWindow(target)
  })())
})
