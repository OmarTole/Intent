export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

let accountId: string | null = null
export function setAccountId(id: string | null) { accountId = id }

export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method, credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-Intent-Request': '1', ...(accountId ? { 'X-Intent-User': accountId } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(path === '/interpret' || path === '/agent/respond' || path === '/planner/propose' || path.endsWith('/coach') ? 145_000 : 20_000),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new ApiError(typeof payload.detail === 'string' ? payload.detail : 'Проверьте введённые данные и повторите запрос.', response.status)
  }
  return response.status === 204 ? undefined as T : response.json()
}

export function errorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message
  return 'Не удалось связаться с сервером. Проверьте подключение и повторите попытку.'
}
