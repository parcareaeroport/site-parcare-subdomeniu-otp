"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { Phone } from "lucide-react"

export default function CallFloating() {
  console.log('Call button component rendering...')

  return (
    <div className="fixed bottom-4 left-4 z-[9999] pointer-events-auto">
      <Link
        href="tel:+40742039955"
        className="relative flex items-center justify-center w-16 h-16 bg-blue-500 hover:bg-blue-600 text-white rounded-full shadow-2xl hover:shadow-xl transition-all duration-300 transform hover:scale-105 border-2 border-white"
        aria-label="Sună acum - 0742.039.955"
      >
        {/* Phone icon */}
        <Phone className="w-8 h-8" />
      </Link>
    </div>
  )
} 