import type { Diary } from './diary-model'
export type Account = { id: string; username: string; expiresAt: number; admin?: boolean }
export type LocalDiary = { account: Account; base: Diary; data: Diary; dirty: boolean }
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('intent-diary', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('accounts')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
export async function readLocal(): Promise<LocalDiary | undefined> {
  const db = await database()
  try { return await new Promise((resolve, reject) => { const r = db.transaction('accounts').objectStore('accounts').get('active'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) }) }
  finally { db.close() }
}
export async function persist(value?: LocalDiary): Promise<void> {
  const db = await database()
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('accounts', 'readwrite'); const store = tx.objectStore('accounts')
    if (value) store.put(value, 'active'); else store.clear()
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error)
  }) } finally { db.close() }
}
