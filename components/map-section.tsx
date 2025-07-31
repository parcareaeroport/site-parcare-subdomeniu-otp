"use client"

import Image from "next/image"

export default function MapSection() {
  return (
    <section className="w-full bg-gradient-to-b from-gray-50 to-white py-12 md:py-20">
      <div className="max-w-7xl mx-auto px-4 md:px-6">
        {/* Header - Text Content */}
        <div className="text-center mb-8 md:mb-12">
          <h2 className="text-2xl sm:text-3xl font-bold mb-3 text-waze-blue">
          Locația OTP Parking
          </h2>
          <p className="text-lg sm:text-xl mb-4 sm:mb-5">
            Parcarea noastră este amplasată strategic la doar 500 de metri de Aeroportul Henri Coandă, 
            oferind acces rapid și convenabil cu transferul nostru gratuit.
          </p>
        </div>
        
        {/* Map Image */}
        <div className="relative w-full max-w-4xl mx-auto">
          <Image
            src="/harta-parcare.png"
            alt="Hartă parcarea aeroportului Otopeni - locația exactă a parcării private"
            width={800}
            height={600}
            className="w-full h-auto rounded-3xl shadow-lg border border-gray-200"
            priority
          />
        </div>

    
      </div>
    </section>
  )
} 