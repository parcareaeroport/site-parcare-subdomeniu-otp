"use client"

import Link from "next/link"
import Image from "next/image"
import { Instagram, Facebook, Twitter, Linkedin, ArrowUp, Phone, Mail, MapPin, Navigation } from "lucide-react"

export default function Footer() {
  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    })
  }

  return (
    <footer className="bg-waze-blue text-white pt-10 sm:pt-16 pb-8">
      <div className="container mx-auto px-4">


        {/* Main Footer Content - Three Sections with Better Visual Balance */}
        <div className="flex flex-col md:flex-row gap-8 md:gap-8 mb-8 md:mb-12">
          
          {/* Left Section - Description - Takes more space */}
          <div className="md:flex-[1] space-y-3">
            <h3 className="text-lg font-semibold mb-4 text-white inline-block">Despre noi</h3>
            <p className="text-gray-300 text-sm leading-relaxed">
              Oferim servicii de parcare securizată la doar 500 metri de aeroportul Henri Coandă. 
              Cu transfer gratuit, supraveghere 24/7 și facilități moderne, suntem alegerea ideală pentru călătoriile tale.
            </p>
            <p className="text-gray-300 text-sm">
              Experiență fără stres, siguranță maximă și servicii profesionale pentru mașina ta.
            </p>
            
            {/* ANPC Images */}
            <div className="flex items-center gap-4 pt-2">
              <Image
                src="/anpc-sol.webp"
                alt="ANPC - Solutionarea Online a Litigiilor"
                width={160}
                height={80}
                className="hover:opacity-80 transition-opacity"
              />
              <Image
                src="/anpc-sal.webp"
                alt="ANPC - Solutionarea Alternativa a Litigiilor"
                width={160}
                height={80}
               className="hover:opacity-80 transition-opacity"
              />
            </div>
          </div>

          {/* Middle Section - Utile (Site Pages) - Compact to bring Contact closer */}
          <div className="md:flex-[1] space-y-3 md:flex md:flex-col md:items-center">
            <ul className="space-y-3">
            <li>
            <h3 className="text-lg font-semibold mb-4 text-white inline-block">Utile</h3>
            </li>
              <li>
                <Link href="/" className="text-gray-300 hover:text-white transition-colors text-sm">
                  Acasă
                </Link>
              </li>
      
              <li>
                <Link href="/tarife" className="text-gray-300 hover:text-white transition-colors text-sm">
                  Tarife
                </Link>
              </li>
          
              <li>
                <Link href="/termeni" className="text-gray-300 hover:text-white transition-colors text-sm">
                  Termeni
                </Link>
              </li>
              <li>
                <Link href="/confidentialitate" className="text-gray-300 hover:text-white transition-colors text-sm">
                  Confidențialitate
                </Link>
              </li>
            </ul>
          </div>

          {/* Right Section - Contact rapid - Half size */}
          <div className="md:flex-[1] space-y-3 md:flex md:flex-col md:items-center">
            <div className="space-y-4">
            <div className="flex items-center space-x-3">
            <h3 className="text-lg font-semibold mb-4 text-white inline-block">Contact rapid</h3>
            </div>
              {/* Phone */}
              <div className="flex items-center space-x-3">
                <Phone size={16} className="text-[#ee7f1a] flex-shrink-0" />
                <a href="tel:+40742039955" className="text-gray-300 hover:text-white transition-colors text-sm">
                  0742.039.955
                </a>
              </div>
              
              {/* Email */}
              <div className="flex items-center space-x-3">
                <Mail size={16} className="text-[#ee7f1a] flex-shrink-0" />
                <a href="mailto:contact.parcareaeroport@gmail.com" className="text-gray-300 hover:text-white transition-colors text-sm">
                  contact.parcareaeroport@gmail.com
                </a>
              </div>

              {/* Maps */}
              <div className="space-y-3 pt-2">
                <p className="text-gray-400 text-sm mb-2">Navigare rapidă:</p>
                
                {/* Google Maps */}
                <div className="flex items-center space-x-3">
                  <MapPin size={16} className="text-[#ee7f1a] flex-shrink-0" />
                  <a 
                    href="https://maps.app.goo.gl/GhoVMNWvst6BamHx5?g_st=aw" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-gray-300 hover:text-white transition-colors text-sm"
                  >
                    Google Maps
                  </a>
                </div>
                
                {/* Waze */}
                <div className="flex items-center space-x-3">
                  <Navigation size={16} className="text-[#ee7f1a] flex-shrink-0" />
                  <a 
                    href="https://waze.com/ul?ll=44.575660,26.069918&navigate=yes" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-gray-300 hover:text-white transition-colors text-sm"
                  >
                    Waze
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Social Media Links */}
        <div className="flex flex-col md:flex-row justify-between items-center border-t border-waze-blue/40 pt-6 md:pt-8">
          <div className="flex space-x-4 mb-6 md:mb-0">
            <Link href="https://www.instagram.com/parcare_aeroport?igsh=MXV5d2d2M3NibHh0Yg%3D%3D&utm_source=qr" target="_blank" rel="noopener noreferrer" className="text-gray-300 hover:text-white transition-colors">
              <Instagram size={20} className="sm:w-5 sm:h-5" />
            </Link>
            <Link href="https://www.facebook.com/share/1EYNt8Zp19/?mibextid=wwXIfr" target="_blank" rel="noopener noreferrer" className="text-gray-300 hover:text-white transition-colors">
              <Facebook size={20} className="sm:w-5 sm:h-5" />
            </Link>
            <Link href="https://www.tiktok.com/@parcare_aeroport?_t=ZN-8wmzQZdnbra&_r=1" target="_blank" rel="noopener noreferrer" className="text-gray-300 hover:text-white transition-colors">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z"/>
              </svg>
            </Link>
          </div>
        </div>

        {/* Copyright and Legal */}
        <div className="flex flex-col md:flex-row justify-between items-center border-t border-waze-blue/40 pt-6 md:pt-8 mt-6 md:mt-8 text-xs sm:text-sm text-gray-400">
          <div className="mb-4 md:mb-0">© Copyright parcare-aeroport.ro {new Date().getFullYear()}</div>
          <div className="flex flex-wrap justify-center gap-4 sm:gap-6">
            <Link href="/politica-anulare" className="hover:text-white transition-colors">
              Politica de anulare
            </Link>
            <Link href="/confidentialitate" className="hover:text-white transition-colors">
              Politica de confidențialitate
            </Link>
            <Link href="/termeni" className="hover:text-white transition-colors">
              Termeni de utilizare
            </Link>
          </div>
        </div>



        {/* Scroll to top button */}
        <button
          onClick={scrollToTop}
          className="fixed bottom-4 right-4 sm:bottom-8 sm:right-8 bg-[#ee7f1a] hover:bg-[#d67016] text-white rounded-full p-3 sm:p-4 shadow-lg transition-all duration-300 hover:scale-110 z-[9999]"
          aria-label="Scroll to top"
        >
          <ArrowUp size={20} className="sm:w-6 sm:h-6" />
        </button>
      </div>
    </footer>
  )
}
