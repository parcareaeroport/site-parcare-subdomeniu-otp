"use client"

import Image from "next/image"
import Link from "next/link"
import { useState, useEffect } from "react"
import ReservationForm from "@/components/reservation-form"
import { AlertTriangle, Phone } from "lucide-react"

const SLIDES = [
  {
    headline: "Parcare premium la doar 500 de metri de aeroportul Otopeni",
    subheadline:
      "Parcarea ta inteligentă și sigură, situată fix lângă Aeroportul Internațional Henri Coandă. Confort garantat, asfaltată. transfer rapid și zero stres, la un preț avantajos. Pentru călătoria ta perfectă!",
    image: "/slider-otp-parking.jpg",
    alt: "OTP Parking - Parcare premium lângă Aeroportul Henri Coandă - vedere panoramică a parcării asfaltate"
  },
  // Poți adăuga mai multe slide-uri aici cu alte imagini și texte
  {
    headline: "OTP PARKING - PARCARE OTOPENI CU TRANSFER RAPID",
    subheadline:
      "Transfer gratuit la aeroport, pază 24/7 și locuri asfaltate. Rezervă online și călătorește fără griji!",
    image: "/slider-otp-parking.jpg",
    alt: "OTP Parking - Parcare cu transfer rapid la aeroport Otopeni"
  }
]

export default function HeroSection() {
  const [current, setCurrent] = useState(0)
  // Efect de slide simplu cu CSS
  const handleGoTo = (idx: number) => setCurrent(idx)

  // Autoplay: slide automat la fiecare 5 secunde
  useEffect(() => {
    const timeout = setTimeout(() => {
      setCurrent((prev) => (prev + 1) % SLIDES.length)
    }, 5000)
    return () => clearTimeout(timeout)
  }, [current])

  return (
    <>
      {/* Top phone bar */}
      <div className="bg-[#13005a] text-white py-2 px-4 text-center">
        <Link 
          href="tel:+40742039955" 
          className="inline-flex items-center gap-2 hover:text-[#ee7f1a] transition-colors duration-200"
        >
          <Phone className="h-4 w-4" />
          <span className="text-sm md:text-base font-medium">+40 742 039 955 - Contact</span>
        </Link>
      </div>

      <section id="rezerva-formular" className="relative w-full bg-gradient-to-br from-[#ee7f1a] to-[#13005a] py-10 md:py-16 overflow-hidden min-h-screen md:h-[95vh] flex flex-col justify-center md:justify-end">
        {/* Imagine de fundal cu fade pentru fiecare slide, toate în DOM pentru SEO */}
        <div className="absolute inset-0 w-full h-full z-0 pointer-events-none">
          {SLIDES.map((slide, idx) => (
            <Image
              key={idx}
              src={slide.image}
              alt={slide.alt}
              fill
              className={`object-cover w-full h-full mask-fade-right transition-all duration-700 ease-in-out absolute top-0 left-0 ${current === idx ? 'opacity-100' : 'opacity-0'} ${current === idx ? 'z-10' : 'z-0'}`}
              priority={idx === 0}
              aria-hidden={current !== idx}
            />
          ))}
          {/* Gradient roz-mov peste imagine, acum vertical roz->albastru și cu mask-fade-right */}
          <div
            className="absolute inset-0 mask-fade-right"
            style={{ background: 'linear-gradient(to bottom, #ee7f1a 0%, #13005a 80%)' }}
          />
        </div>

        {/* Logo container - positioned above reservation form on mobile, top-left on desktop */}
        <div className="relative z-20 w-full flex justify-center md:justify-start md:absolute md:top-4 md:left-6 -mt-2 md:mt-0">
          <Link 
            href="https://otp-parking.ro"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block"
            title="OTP Parking - Accesează site-ul principal"
          >
            <div className="bg-white rounded-lg p-3 md:p-4 shadow-lg hover:shadow-xl transition-shadow duration-200">
              <Image
                src="/otp_parking.png"
                alt="OTP Parking Logo"
                width={200}
                height={65}
                className="h-16 md:h-16 w-auto"
                priority
              />
            </div>
          </Link>
        </div>

        {/* Formularul fix în partea superioară a imaginii pe toate ecranele */}
        <div className="w-full flex justify-center md:absolute md:top-32 md:left-1/2 md:-translate-x-1/2 z-20 px-2 md:px-0 mt-4">
          <div className="w-full max-w-6xl">
            <ReservationForm />
          </div>
        </div>

        {/* Conținutul sliderului */}
        <div className="relative z-10 w-full max-w-7xl mx-auto px-2 md:px-6 flex flex-col gap-4 md:gap-6 mt-8 md:mt-0 md:pt-48">
          {/* Formularul a fost mutat în partea superioară a imaginii */}
          {/* Slide-uri headline/subheadline, toate în DOM pentru SEO, doar unul vizibil */}
          <div className="w-full flex flex-col items-center md:items-start text-white z-10 relative min-h-[160px] md:min-h-[180px]">
            {SLIDES.map((slide, idx) => (
              <div
                key={idx}
                aria-hidden={current !== idx}
                className={`transition-all duration-700 ease-in-out w-full md:max-w-2xl ${current === idx ? 'opacity-100 translate-x-0 pointer-events-auto' : 'opacity-0 -translate-x-8 pointer-events-none'} absolute md:relative top-0 left-0`}
                style={{ position: current === idx ? 'relative' : 'absolute' }}
              >
                <h1 className="text-2xl md:text-4xl font-extrabold text-center md:text-left mb-3 leading-tight drop-shadow-lg uppercase tracking-tight w-full">
                  {slide.headline}
                </h1>
                <p className="text-sm md:text-lg text-center md:text-left mb-4 drop-shadow-md font-medium w-full">
                  {slide.subheadline}
                </p>
              </div>
            ))}
          </div>

          {/* Bara de navigare cu linii drepte */}
          <nav className="w-full flex justify-center mt-4">
            <div className="flex space-x-2" role="tablist" aria-label="Navigare slide-uri">
              {SLIDES.map((_, idx) => (
                <button
                  key={idx}
                  className={`w-10 h-1 transition-all duration-300 ease-in-out rounded-sm ${
                    current === idx ? 'bg-white shadow-md' : 'bg-white/30 hover:bg-white/50'
                  }`}
                  onClick={() => handleGoTo(idx)}
                  role="tab"
                  aria-selected={current === idx}
                  aria-label={`Slide ${idx + 1}`}
                />
              ))}
            </div>
          </nav>
        </div>
      </section>
    </>
  )
}
