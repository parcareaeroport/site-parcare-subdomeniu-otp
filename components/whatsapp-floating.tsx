"use client"

import { useState, useEffect } from "react"
import Link from "next/link"

export default function WhatsAppFloating() {
  console.log('WhatsApp component rendering...')

  return (
    <div className="fixed bottom-4 left-4 z-[9999] pointer-events-auto">
      <Link
        href="https://wa.me/40742039955"
        target="_blank"
        rel="noopener noreferrer"
        className="relative flex items-center justify-center w-16 h-16 bg-green-500 hover:bg-green-600 text-white rounded-full shadow-2xl hover:shadow-xl transition-all duration-300 transform hover:scale-105 border-2 border-white"
        aria-label="Contactează-ne pe WhatsApp"
      >
        {/* WhatsApp icon - bigger size */}
        <i className="fab fa-whatsapp text-4xl"></i>
      </Link>
    </div>
  )
} 