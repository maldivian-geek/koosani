import type { Context } from 'hono'

// Validates an IP string — rejects garbage and the literal string "(null)"
const VALID_IP = /^[\d.:a-fA-F]+$/

// RFC 1918 + loopback + link-local IPv4/IPv6
const PRIVATE_IP =
  /^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|127\.|::1$|fd[0-9a-f]{2}|fe80|::ffff:)/i

export function isPrivateIp(ip: string): boolean {
  return PRIVATE_IP.test(ip)
}

// Priority per SECURITY.md:
// 1. X-Real-IP (set by trusted reverse proxy)
// 2. X-Forwarded-For (first public IP left-to-right)
// 3. Raw socket remoteAddress (via @hono/node-server env)
export function getRealIp(c: Context): string {
  const xRealIp = c.req.header('x-real-ip')
  if (xRealIp && VALID_IP.test(xRealIp) && xRealIp !== '(null)') {
    return xRealIp
  }

  const xff = c.req.header('x-forwarded-for')
  if (xff) {
    for (const part of xff.split(',')) {
      const ip = part.trim()
      if (VALID_IP.test(ip) && !isPrivateIp(ip)) return ip
    }
  }

  // @hono/node-server stores the IncomingMessage in c.env.incoming
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined
  return env?.incoming?.socket?.remoteAddress ?? '0.0.0.0'
}
