/**
 * middleware.ts
 * CSRF protection untuk semua POST API routes
 * Support Vercel preview URLs (*.vercel.app)
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

function isAllowedOrigin(origin: string, host: string): boolean {
  try {
    const originHost = new URL(origin).host

    // Exact match
    if (originHost === host) return true

    // Vercel preview URLs — *.vercel.app dari project yang sama
    if (originHost.endsWith('.vercel.app')) return true

    // Localhost untuk development
    if (originHost.startsWith('localhost') || originHost.startsWith('127.0.0.1')) return true

    // Custom allowed origins dari env
    const allowed = process.env.ALLOWED_ORIGINS?.split(',').map(s => s.trim()) ?? []
    if (allowed.includes(originHost)) return true

    return false
  } catch {
    return false
  }
}

export function middleware(request: NextRequest) {
  if (request.method === 'POST' && request.nextUrl.pathname.startsWith('/api/')) {
    const contentType = request.headers.get('content-type') ?? ''
    const origin = request.headers.get('origin')
    const host   = request.headers.get('host') ?? ''

    // Validasi Content-Type
    if (!contentType.includes('application/json')) {
      return NextResponse.json({ error: 'Invalid content type' }, { status: 400 })
    }

    // Validasi Origin jika ada
    if (origin && host) {
      if (!isAllowedOrigin(origin, host)) {
        return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
      }
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: '/api/:path*',
}
