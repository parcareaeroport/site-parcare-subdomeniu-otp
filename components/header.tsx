"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Menu, X, Phone } from "lucide-react"

export default function Header() {
  const [isScrolled, setIsScrolled] = useState(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10)
    }
    window.addEventListener("scroll", handleScroll)
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (isMobileMenuOpen) {
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = "unset"
    }
    return () => {
      document.body.style.overflow = "unset"
    }
  }, [isMobileMenuOpen])

  const navItems = [
    { name: "Acasa", href: "/", title: "Pagina principală Parcare Otopeni" },
    { name: "Regulile Parcarii", href: "/reguli", title: "Regulile parcării Otopeni" },
    { name: "Contact", href: "/contact", title: "Contactează-ne pentru parcare Otopeni" },
  ]

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-300 bg-white border-b border-gray-200`}
    >
      <div className="container mx-auto flex items-center justify-between py-1.5">
        {/* Logo în stânga */}
          <Link href="/" className="flex items-center" title="OTP Parking" aria-label="Acasă">
            {/* Mobile logo */}
            <Image
              src="/otp_parking.png"
              alt="OTP Parking Logo"
              width={170}
              height={55}
              className="h-12 w-auto md:hidden"
              priority
            />
            {/* Desktop logo */}
            <Image
              src="/otp_parking.png"
              alt="OTP Parking Logo"
              width={280}
              height={80}
              className="hidden md:block w-auto -my-2 p-2"
              style={{ maxHeight: '72px' }}
              priority
            />
          </Link>

        {/* Meniul și butoanele în dreapta */}
        <div className="flex items-center gap-2 md:gap-6">
          {/* Meniul de navigare */}
          <nav className="hidden md:flex items-center space-x-1" aria-label="Navigare principală">
            <div className="flex items-center space-x-1">
              {navItems.map((item) => (
                <Link
                  key={item.name}
                  href={item.href}
                  title={item.title}
                  aria-current={pathname === item.href ? "page" : undefined}
                >
                  <Button
                    variant="ghost"
                    className={`flex items-center gap-1 rounded-md text-sm font-medium transition-all duration-200 text-[#13005a] hover:bg-[#13005a]/10 hover:text-[#13005a] hover:scale-105 ${
                      pathname === item.href ? "bg-[#13005a]/20 text-[#13005a]" : ""
                    }`}
                  >
                    {item.name}
                  </Button>
                </Link>
              ))}
            </div>
          </nav>
          {/* Buton Secundar - Border alb + Text alb + Fundal transparent */}
          <Link href="/tarife">
            <Button
              className="group bg-transparent hover:bg-[#13005a] text-[#13005a] border-2 border-[#13005a] hover:border-[#13005a] rounded-md text-sm font-medium px-3 md:px-4 py-2 h-auto transition-all duration-200 shadow-sm hover:shadow-md"
              aria-label="Vezi tarifele"
            >
              <span className="group-hover:text-white transition-colors duration-200">Tarife</span>
            </Button>
          </Link>
          {/* Buton Principal - Fundal roz + Text alb */}
          <Link
            href="tel:+40742039955"
            className="bg-[#ee7f1a] hover:bg-[#d67016] rounded-md text-sm font-medium shadow-md hover:shadow-lg px-3 md:px-4 py-2 h-auto flex items-center text-white transition-all duration-200"
            aria-label="Contact rapid telefonic"
          >
            <Phone className="h-4 w-4 md:mr-2" />
            <span className="hidden md:inline">Contact rapid</span>
          </Link>
          <Button
            variant="ghost"
            className="md:hidden rounded-full text-[#13005a] hover:bg-[#13005a]/10 p-4 w-14 h-14"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            aria-expanded={isMobileMenuOpen}
            aria-controls="mobile-menu"
            aria-label={isMobileMenuOpen ? "Închide meniul" : "Deschide meniul"}
          >
            {isMobileMenuOpen ? (
              <X style={{ width: 32, height: 32 }} />
            ) : (
              <Menu style={{ width: 32, height: 32 }} />
            )}
          </Button>
        </div>
      </div>

      {/* Mobile sidebar menu - slides from left */}
      {isMobileMenuOpen && (
        <>
          {/* Backdrop overlay */}
          <div
            className="md:hidden fixed inset-0 bg-black/50 z-40 transition-opacity duration-300"
            onClick={() => setIsMobileMenuOpen(false)}
            aria-hidden="true"
          ></div>

          {/* Sidebar */}
          <div
            className="md:hidden fixed inset-0 left-0 w-[280px] h-[100vh] bg-white z-50 shadow-xl overflow-y-auto animate-slide-in"
            id="mobile-menu"
            role="dialog"
            aria-modal="true"
            aria-label="Meniu mobil"
            style={{ height: "100vh", maxHeight: "100vh", top: 0 }}
          >
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <Link
                href="/"
                className="flex items-center"
                onClick={() => setIsMobileMenuOpen(false)}
                title="OTP Parking"
              >
                <Image
                  src="/otp_parking.png"
                  alt="OTP Parking Logo"
                  width={100}
                  height={35}
                  className="h-7 w-auto"
                />
              </Link>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-full"
                onClick={() => setIsMobileMenuOpen(false)}
                aria-label="Închide meniul"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>

            <div className="py-4 px-4 space-y-6">
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider">Navigare</h3>
                <div className="space-y-1">
                  {navItems.map((item) => (
                    <Link
                      key={item.name}
                      href={item.href}
                      onClick={() => setIsMobileMenuOpen(false)}
                      title={item.title}
                      aria-current={pathname === item.href ? "page" : undefined}
                    >
                      <Button
                        variant="ghost"
                        className={`flex items-center justify-start w-full rounded-lg text-left h-auto py-3 transition-all duration-200 hover:bg-[#13005a]/10 hover:text-[#13005a] hover:pl-4 ${
                          pathname === item.href ? "bg-[#13005a]/10 text-[#13005a]" : ""
                        }`}
                      >
                        <span className="font-medium">{item.name}</span>
                      </Button>
                    </Link>
                  ))}
                </div>
              </div>

              {/* Butoane în sidebar mobil */}
              <div className="space-y-3 pt-4 border-t border-gray-100">
                <Link href="/tarife" onClick={() => setIsMobileMenuOpen(false)}>
                  <Button className="w-full bg-transparent hover:bg-[#13005a] text-[#13005a] hover:text-white border-2 border-[#13005a] hover:border-[#13005a] rounded-md text-sm font-medium py-3 transition-all duration-200">
                    Tarife
                  </Button>
                </Link>
                <Link 
                  href="tel:+40742039955" 
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="block"
                >
                  <Button className="w-full bg-[#ee7f1a] hover:bg-[#d67016] text-white rounded-md text-sm font-medium py-3 transition-all duration-200 shadow-md hover:shadow-lg">
                    <Phone className="h-4 w-4 mr-2" />
                    Contact rapid
                  </Button>
                </Link>
              </div>

              <div className="pt-4 border-t border-gray-100">
                <div className="flex justify-center space-x-4 mt-6">
                  <a
                    href="https://www.instagram.com/parcare_aeroport?igsh=MXV5d2d2M3NibHh0Yg%3D%3D&utm_source=qr"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-400 hover:text-[#13005a] transition-all duration-200 hover:scale-110"
                    aria-label="Instagram"
                    title="Urmărește-ne pe Instagram"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-6 w-6"
                      aria-hidden="true"
                    >
                      <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
                      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
                    </svg>
                  </a>
                  <a
                    href="https://www.facebook.com/share/1EYNt8Zp19/?mibextid=wwXIfr"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-400 hover:text-[#13005a] transition-all duration-200 hover:scale-110"
                    aria-label="Facebook"
                    title="Urmărește-ne pe Facebook"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-6 w-6"
                      aria-hidden="true"
                    >
                      <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
                    </svg>
                  </a>
                  <a
                    href="https://www.tiktok.com/@parcare_aeroport?_t=ZN-8wmzQZdnbra&_r=1"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-400 hover:text-[#13005a] transition-all duration-200 hover:scale-110"
                    aria-label="TikTok"
                    title="Urmărește-ne pe TikTok"
                  >
                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z"/>
                    </svg>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </header>
  )
}
