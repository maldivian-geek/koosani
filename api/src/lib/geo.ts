import { config } from './config.js'
import { isPrivateIp } from './ip.js'

export type GeoResult = { city: string | null; country: string | null }

const NULL_GEO: GeoResult = { city: null, country: null }

export async function geoLookup(ip: string): Promise<GeoResult> {
  if (isPrivateIp(ip) || ip === '0.0.0.0') return NULL_GEO
  if (config.GEO_PROVIDER === 'disabled') return NULL_GEO

  if (config.GEO_PROVIDER === 'ip-api') {
    // ip-api is unencrypted — dev/LAN only per SECURITY.md
    try {
      const res = await fetch(`http://ip-api.com/json/${ip}?fields=status,city,country`)
      const data = (await res.json()) as {
        status?: string
        city?: string
        country?: string
      }
      if (data.status !== 'success') return NULL_GEO
      return { city: data.city ?? null, country: data.country ?? null }
    } catch {
      return NULL_GEO
    }
  }

  // maxmind: not yet implemented; return null until Phase 18 hardening
  return NULL_GEO
}
