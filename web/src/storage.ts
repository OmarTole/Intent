import type { Snapshot } from './types'

// One active account per browser profile. No password or session token is stored here.
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('intent-offline', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('snapshot')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function readSnapshot(): Promise<Snapshot | undefined> {
  const db = await database()
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('snapshot').objectStore('snapshot').get('current')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally { db.close() }
}

export async function writeSnapshot(snapshot?: Snapshot): Promise<void> {
  const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('snapshot', 'readwrite')
      const store = tx.objectStore('snapshot')
      if (snapshot) store.put(snapshot, 'current')
      else store.clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally { db.close() }
}
