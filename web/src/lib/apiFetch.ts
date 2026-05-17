export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

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

export async function apiFetchDownload(path: string, filename: string): Promise<void> {
  const base = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000'
  const url = `${base}${path.startsWith('/') ? path : '/' + path}`
  const res = await fetch(url, { credentials: 'include' })
  if (res.status === 401) {
    window.location.replace('/login')
    throw new ApiError(401, 'Unauthorized')
  }
  if (!res.ok) throw new ApiError(res.status, res.statusText)
  const blob = await res.blob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(a.href)
}
