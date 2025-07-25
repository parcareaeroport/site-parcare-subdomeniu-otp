'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'

export function TrackingPage() {
  const searchParams = useSearchParams()

  useEffect(() => {
    // Initialize Tagual SDK when available
    if (typeof window !== 'undefined') {
      // Tagual SDK will be loaded here
      console.log('Tracking page loaded for subdomain')
      
      // Capture tracking parameters
      const trackingData = {
        source: searchParams.get('source') || 'direct',
        campaign: searchParams.get('campaign') || 'organic',
        medium: searchParams.get('medium') || 'web',
        referrer: document.referrer,
        timestamp: new Date().toISOString(),
        url: window.location.href,
      }
      
      console.log('Tracking data:', trackingData)
      
      // TODO: Send to Tagual when SDK is integrated
      // tagual.track('page_view', trackingData)
      
      // Redirect back to main site after tracking (optional)
      const returnUrl = searchParams.get('return_url')
      if (returnUrl) {
        setTimeout(() => {
          window.location.href = decodeURIComponent(returnUrl)
        }, 1000) // Give time for tracking to complete
      }
    }
  }, [searchParams])

  return (
    <div className="min-h-screen bg-white">
      {/* Minimal content - just for tracking */}
      <div className="hidden">
        <h1>Tracking Page</h1>
        <p>This page is used for analytics tracking only.</p>
      </div>
      
      {/* Loading indicator */}
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600"></div>
      </div>
    </div>
  )
} 