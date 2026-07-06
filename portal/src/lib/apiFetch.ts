export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

// Same shape as web/src/lib/apiFetch.ts but a separate module entirely — the
// portal never imports from web/ (SECURITY.md §13.14: separate origin,
// separate everything). A 401 redirects to the portal's own /login, never
// the staff app's.
export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit & { noRedirect?: boolean } = {},
): Promise<T> {
  const base = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000'
  const url = `${base}${path.startsWith('/') ? path : '/' + path}`
  const { noRedirect, ...fetchInit } = init
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(fetchInit.headers as Record<string, string> | undefined),
  }
  if (!(fetchInit.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
  }

  const res = await fetch(url, { ...fetchInit, credentials: 'include', headers })

  if (res.status === 401) {
    if (!noRedirect) window.location.replace('/login')
    throw new ApiError(401, 'Unauthorized')
  }

  if (!res.ok) {
    const text = await res.text()
    throw new ApiError(res.status, text || res.statusText)
  }

  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}
