"use client"

import { useState } from "react"
import Image from "next/image"
import { Search, Car, ArrowRight, Star } from "lucide-react"

export default function HowItWorksToggle() {
  const [activeTab, setActiveTab] = useState("intrare")

  return (
    <div>
      {/* Toggle Buttons */}
      <div className="flex justify-center mb-8 md:mb-10">
        <div className="bg-white p-1 sm:p-1.5 rounded-full inline-flex shadow-md">
          <button
            onClick={() => setActiveTab("intrare")}
            className={`px-4 sm:px-8 py-2 sm:py-3 rounded-full text-xs sm:text-sm font-medium transition-all ${
              activeTab === "intrare" ? "bg-waze-blue text-white shadow-md" : "text-gray-700 hover:bg-gray-100"
            }`}
          >
            Intrare în parcare
          </button>
          <button
            onClick={() => setActiveTab("iesire")}
            className={`px-4 sm:px-8 py-2 sm:py-3 rounded-full text-xs sm:text-sm font-medium transition-all ${
              activeTab === "iesire" ? "bg-waze-blue text-white shadow-md" : "text-gray-700 hover:bg-gray-100"
            }`}
          >
            Ieșire din parcare
          </button>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-8 md:gap-12 items-start">
        {/* Conținutul text - stânga */}
        <div>
          {activeTab === "intrare" && (
            <>
              {/* Pas 1: Efectuarea rezervării */}
              <div className="flex items-start mb-8 md:mb-10 group">
                <div className="bg-primary/10 p-3 sm:p-4 rounded-2xl mr-4 sm:mr-5 group-hover:bg-primary/20 transition-colors flex-shrink-0">
                  <Search className="h-5 w-5 sm:h-6 sm:w-6 text-waze-blue" />
                </div>
                <div>
                  <h3 className="text-lg sm:text-xl font-bold mb-2 sm:mb-3 text-waze-blue">Efectuarea rezervării</h3>
                  <p className="text-gray-600 leading-relaxed text-sm sm:text-base">
                    Alege metoda preferată: rapid și ușor pe site-ul nostru securizat sau direct la locația parcării, în funcție de disponibilitate.
                  </p>
                </div>
              </div>

              {/* Pas 2: Găsește-ne fără efort */}
              <div className="flex items-start mb-8 md:mb-10 group">
                <div className="bg-primary/10 p-3 sm:p-4 rounded-2xl mr-4 sm:mr-5 group-hover:bg-primary/20 transition-colors flex-shrink-0">
                  <Search className="h-5 w-5 sm:h-6 sm:w-6 text-waze-blue" />
                </div>
                <div>
                  <h3 className="text-lg sm:text-xl font-bold mb-2 sm:mb-3 text-waze-blue">Găsește-ne fără efort</h3>
                  <p className="text-gray-600 leading-relaxed text-sm sm:text-base">
                    Dacă dorești să ne găsești rapid, apasă click pe pictograma locației de pe site-ul nostru sau folosește aplicația preferată de navigație.
                  </p>
                </div>
              </div>

              {/* Pas 3: Sosirea la parcare */}
              <div className="flex items-start mb-8 md:mb-10 group">
                <div className="bg-primary/10 p-3 sm:p-4 rounded-2xl mr-4 sm:mr-5 group-hover:bg-primary/20 transition-colors flex-shrink-0">
                  <Car className="h-5 w-5 sm:h-6 sm:w-6 text-waze-blue" />
                </div>
                <div>
                  <h3 className="text-lg sm:text-xl font-bold mb-2 sm:mb-3 text-waze-blue">Sosirea la parcare</h3>
                  <p className="text-gray-600 leading-relaxed text-sm sm:text-base">
                    Când ai sosit, intră în parcare, vei fi întâmpinat cu un călduros "Bine ați venit!" de către personalul nostru amabil. Apoi, poți parca mașina în locul indicat. În doar câteva minute, șoferul nostru te va prelua pentru transfer.
                  </p>
                </div>
              </div>

              {/* Pas 4: Transfer Gratuit la Aeroport */}
              <div className="flex items-start group">
                <div className="bg-primary/10 p-3 sm:p-4 rounded-2xl mr-4 sm:mr-5 group-hover:bg-primary/20 transition-colors flex-shrink-0">
                  <ArrowRight className="h-5 w-5 sm:h-6 sm:w-6 text-waze-blue" />
                </div>
                <div>
                  <h3 className="text-lg sm:text-xl font-bold mb-2 sm:mb-3 text-waze-blue">Transfer Gratuit la Aeroport</h3>
                  <p className="text-gray-600 leading-relaxed text-sm sm:text-base">
                    Beneficiezi de transfer gratuit la aeroport în mașina noastră modernă și confortabilă. Te conducem pe tine și pe însoțitorii tăi gratuit și în siguranță la terminalul de plecări al aeroportului.
                  </p>
                </div>
              </div>
            </>
          )}

          {activeTab === "iesire" && (
            <>
              <div className="flex items-start mb-8 md:mb-10 group">
                <div className="bg-primary/10 p-3 sm:p-4 rounded-2xl mr-4 sm:mr-5 group-hover:bg-primary/20 transition-colors flex-shrink-0">
                  <Car className="h-5 w-5 sm:h-6 sm:w-6 text-waze-blue" />
                </div>
                <div>
                  <h3 className="text-lg sm:text-xl font-bold mb-2 sm:mb-3 text-waze-blue">Pregătește-te de plecare</h3>
                  <p className="text-gray-600 leading-relaxed text-sm sm:text-base">
                    Când ești gata să pleci, nu este nevoie de nicio acțiune suplimentară. Totul este deja configurat în
                    sistem în baza rezervării tale.
                  </p>
                </div>
              </div>

              <div className="flex items-start mb-8 md:mb-10 group">
                <div className="bg-primary/10 p-3 sm:p-4 rounded-2xl mr-4 sm:mr-5 group-hover:bg-primary/20 transition-colors flex-shrink-0">
                  <ArrowRight className="h-5 w-5 sm:h-6 sm:w-6 text-waze-blue" />
                </div>
                <div>
                  <h3 className="text-lg sm:text-xl font-bold mb-2 sm:mb-3 text-waze-blue">Ieșire automată</h3>
                  <p className="text-gray-600 leading-relaxed text-sm sm:text-base">
                    Apropie-te de bariera de ieșire. Sistemul nostru va recunoaște automat numărul de înmatriculare și
                    bariera se va ridica. Nu este nevoie de bilet sau de alte formalități.
                  </p>
                </div>
              </div>

              <div className="flex items-start group">
                <div className="bg-primary/10 p-3 sm:p-4 rounded-2xl mr-4 sm:mr-5 group-hover:bg-primary/20 transition-colors flex-shrink-0">
                  <Star className="h-5 w-5 sm:h-6 sm:w-6 text-waze-blue" />
                </div>
                <div>
                  <h3 className="text-lg sm:text-xl font-bold mb-2 sm:mb-3 text-waze-blue">
                    Feedback și următoarea rezervare
                  </h3>
                  <p className="text-gray-600 leading-relaxed text-sm sm:text-base">
                    După ieșire, vei primi un email pentru a evalua experiența ta. Rezervă din nou pentru următoarea ta
                    călătorie și beneficiază de reduceri pentru clienții fideli.
                  </p>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Imaginea fixă - dreapta */}
        <div className="flex justify-center mt-6 md:mt-0">
          <div className="relative">
            <div className="absolute -z-10 w-48 sm:w-72 h-48 sm:h-72 bg-waze-blue/10 rounded-full blur-3xl top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2"></div>
            <Image
              src={activeTab === "intrare" ? "/Intrarea in parcare - parcare Otopeni sigura.jpg" : "/parcare_langa_aeroportul_otopeni_iesire.jpg"}
              alt={activeTab === "intrare" ? "Intrare în parcare" : "Ieșire din parcare"}
              width={450}
              height={550}
              className="rounded-2xl shadow-xl object-cover h-[300px] sm:h-[400px] md:h-[500px] w-full"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
