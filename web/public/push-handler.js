self.addEventListener('push', event => {
  let message = {}
  try { message = event.data ? event.data.json() : {} } catch { /* Use generic fallback. */ }
  event.waitUntil(self.registration.showNotification('Intent · Напоминание', {
    body: 'В календаре есть запланированное дело. Откройте «Сегодня».',
    icon: '/icon-192.png', badge: '/icon-192.png', tag: message.tag || 'intent-reminder',
    data: { url: '/?view=today' },
  }))
})
self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.navigate('/?view=today')
        return client.focus()
      }
    }
    return self.clients.openWindow('/?view=today')
  })())
})
