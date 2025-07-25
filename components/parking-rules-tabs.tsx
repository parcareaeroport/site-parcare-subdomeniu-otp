"use client"

import { useState } from "react"
import Image from "next/image"
import { Car, Clock, CreditCard, CheckCircle } from "lucide-react"

export default function ParkingRulesTabs() {
  const [activeTab, setActiveTab] = useState<"sosire" | "plecare">("sosire")

  return (
    <section className="py-12 md:py-16 bg-gray-50">
      <div className="container mx-auto px-4">
        <div className="max-w-5xl mx-auto">
          {/* Tabs */}
          <div className="flex justify-center mb-12">
            <div className="grid grid-cols-2 w-full max-w-md bg-white rounded-lg overflow-hidden shadow-sm">
              <button
                className={`py-4 px-6 font-medium text-center transition-colors ${
                  activeTab === "sosire"
                    ? "bg-waze-blue/10 text-waze-blue border-b-2 border-waze-blue"
                    : "text-gray-600 hover:bg-gray-50"
                }`}
                onClick={() => setActiveTab("sosire")}
              >
                La sosire
              </button>
              <button
                className={`py-4 px-6 font-medium text-center transition-colors ${
                  activeTab === "plecare"
                    ? "bg-waze-blue/10 text-waze-blue border-b-2 border-waze-blue"
                    : "text-gray-600 hover:bg-gray-50"
                }`}
                onClick={() => setActiveTab("plecare")}
              >
                La plecare
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="grid md:grid-cols-2 gap-8 md:gap-12 items-center">
            {/* Left side - Image */}
            <div className="order-2 md:order-1">
              <div className="relative">
                <div className="rounded-xl overflow-hidden border-8 border-gray-100 shadow-xl w-full max-w-md mx-auto">
                  <Image
                    src={
                      activeTab === "sosire"
                        ? "/Cum functioneza la sosire - parcare otopeni.jpg"
                        : "/parcare_langa_aeroportul_otopeni_iesire.jpg"
                    }
                    alt={activeTab === "sosire" ? "Mașină la sosire în parcare" : "Mașină la plecare din parcare"}
                    width={500}
                    height={500}
                    className="object-cover w-full h-full"
                  />
                </div>
              </div>
            </div>

            {/* Right side - Content */}
            <div className="order-1 md:order-2">
              <h2 className="text-2xl md:text-3xl font-bold mb-6 text-waze-blue">
                {activeTab === "sosire" ? "Cum funcționează la sosire" : "Cum funcționează la plecare"}
              </h2>
              <p className="text-gray-600 mb-8">
                {activeTab === "sosire"
                  ? "Procesul de parcare este simplu și eficient. Urmați acești pași pentru o experiență fără probleme la sosirea în parcarea noastră."
                  : "Ieșirea din parcare este la fel de simplă ca intrarea. Urmați acești pași pentru a părăsi parcarea noastră rapid și fără probleme."}
              </p>

              <div className="space-y-6">
                {activeTab === "sosire" ? (
                  <>
                    {/* Arrival Steps */}
                    <div className="flex items-start">
                      <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mr-4">
                        <CreditCard className="h-5 w-5 text-slate-700" />
                      </div>
                      <div>
                        <h3 className="font-medium mb-1 text-waze-blue">1. Prezentați confirmarea rezervării</h3>
                        <p className="text-gray-600 text-sm">
                          La bariera de intrare, prezentați codul QR primit pe email sau introduceți codul de rezervare.
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start">
                      <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mr-4">
                        <Car className="h-5 w-5 text-slate-700" />
                      </div>
                      <div>
                        <h3 className="font-medium mb-1 text-waze-blue">2. Parcați în zona desemnată</h3>
                        <p className="text-gray-600 text-sm">
                        La intrare în parcare veți fi întâmpinat de un operator care vă va ghida în toate demersurile privind parcarea în siguranță a autovehiculului dumneavoastră.
                        </p>
                      </div>
                    </div>

    
                    <div className="flex items-start">
                      <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mr-4">
                        <CheckCircle className="h-5 w-5 text-slate-700" />
                      </div>
                      <div>
                        <h3 className="font-medium mb-1 text-waze-blue">3. Veți fi transferat la terminalul aeroportului Henri Coandă</h3>
                        <p className="text-gray-600 text-sm">
                          Dacă aveți nevoie de transfer către aeroport, prezentați-vă la punctul de întâlnire marcat.
                          Serviciul este gratuit și disponibil 24/7.
                        </p>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    {/* Departure Steps */}
                    <div className="flex items-start">
                      <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mr-4">
                        <Car className="h-5 w-5 text-slate-700" />
                      </div>
                      <div>
                        <h3 className="font-medium mb-1 text-waze-blue">1. Pregătiți-vă pentru plecare</h3>
                        <p className="text-gray-600 text-sm">
                          Verificați că nu ați uitat nimic în parcare și că aveți toate documentele necesare.
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start">
                      <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mr-4">
                        <CreditCard className="h-5 w-5 text-slate-700" />
                      </div>
                      <div>
                        <h3 className="font-medium mb-1 text-waze-blue">2. Verificați plata</h3>
                        <p className="text-gray-600 text-sm">
                          Dacă ați depășit perioada rezervată inițial, efectuați plata suplimentară la automatul de
                          plată sau online.
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start">
                      <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mr-4">
                        <Clock className="h-5 w-5 text-slate-700" />
                      </div>
                      <div>
                        <h3 className="font-medium mb-1 text-waze-blue">3. Respectați timpul de ieșire</h3>
                        <p className="text-gray-600 text-sm">
                          Aveți la dispoziție 15 minute pentru a părăsi parcarea după efectuarea plății suplimentare.
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start">
                      <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mr-4">
                        <CheckCircle className="h-5 w-5 text-slate-700" />
                      </div>
                      <div>
                        <h3 className="font-medium mb-1 text-waze-blue">4. Ieșiți prin bariera automată</h3>
                        <p className="text-gray-600 text-sm">
                          Sistemul va recunoaște automat numărul de înmatriculare sau puteți scana codul QR. Bariera se
                          va ridica automat.
                        </p>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
