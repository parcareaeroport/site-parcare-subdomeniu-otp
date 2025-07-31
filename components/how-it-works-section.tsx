"use client"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import HowItWorksToggle from "@/components/how-it-works-toggle"

export default function HowItWorksSection() {
  return (
    <section className="py-12 md:py-16 bg-gray-50">
      <div className="container mx-auto px-4">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold mb-8 md:mb-12 text-center text-waze-blue">
            <span className="relative inline-block">
            Pași de urmat, la sosirea si plecarea din unitate
              <span className="absolute bottom-2 left-0 w-full h-3 bg-yellow-200 -z-10 rounded-full"></span>
            </span>
          </h2>

          <HowItWorksToggle />

          <div className="mt-10 md:mt-12 text-center">
            <Link
              href="/#rezerva-formular"
              className="inline-flex items-center gap-2 bg-[#ee7f1a] hover:bg-[#d67016] text-white px-8 py-4 rounded-md transition-all duration-200 font-medium shadow-md hover:shadow-lg hover:scale-105"
            >
              Rezervă locul tău acum
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
