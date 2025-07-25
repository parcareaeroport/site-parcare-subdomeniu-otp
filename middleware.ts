import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const hostname = request.headers.get('host') || ''

  // Check if it's the tracking subdomain
  if (hostname.startsWith('patrack.')) {
    // Allow API routes to work normally
    if (pathname.startsWith('/api/')) {
      return NextResponse.next()
    }
    
    // Rewrite all other pages to tracking page
    return NextResponse.rewrite(new URL('/tracking', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
} 