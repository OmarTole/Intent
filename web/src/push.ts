import { api, ApiError } from './api'

export async function existingPush(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null
  const registration = await navigator.serviceWorker.getRegistration()
  return registration ? registration.pushManager.getSubscription() : null
}

export async function disablePush() {
  const subscription = await existingPush()
  if (!subscription) return
  // Revoke server delivery before removing the browser endpoint.
  try {
    await api('/push/unsubscribe', 'POST', { endpoint: subscription.endpoint })
  } catch (error) {
    // An expired login cannot revoke via API, but the browser can invalidate its own endpoint.
    if (!(error instanceof ApiError) || error.status !== 401) throw error
  }
  await subscription.unsubscribe()
}
