"use client"

import { useState } from "react"
import { Plus, Minus } from "lucide-react"

type FAQItem = {
  question: string
  answer: string
}

export default function FAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  const toggleFAQ = (index: number) => {
    setOpenIndex(openIndex === index ? null : index)
  }

  const faqItems: FAQItem[] = [
    {
      question: "Cum pot rezerva un loc de parcare?",
      answer:
        "Rezervarea unui loc de parcare este simplă. Accesați site-ul nostru, introduceți datele de sosire și plecare și urmați pașii pentru finalizarea plății. Veți primi o confirmare pe email cu toate detaliile necesare.",
    },
    {
      question: "Ce se întâmplă dacă întârzii la ora rezervată?",
      answer:
        "Locul de parcare vă este rezervat pentru întreaga perioadă specificată în rezervare. Dacă ajungeți mai târziu decât ora specificată, locul vă rămâne rezervat, dar nu se oferă reduceri sau rambursări pentru timpul neutilizat.",
    },
    {
      question: "Pot să prelungesc perioada de parcare dacă am nevoie de mai mult timp?",
      answer:
        "Prelungirea se poate face online pe site-ul nostru. Vă recomandăm să faceți prelungirea cu cel puțin 24 de ore înainte de expirarea rezervării inițiale.",
    },
    {
      question: "Ce metode de plată acceptați?",
      answer:
        "Acceptăm plăți cu cardul de credit/debit (Visa, Mastercard), plăți prin transfer bancar și plăți prin aplicații mobile precum Apple Pay și Google Pay.",
    },
    {
      question: "Există serviciu de transfer către aeroport?",
      answer:
        "Da, oferim un serviciu gratuit de transfer către și de la Aeroportul Otopeni. Transferul funcționează 24/7 și durează aproximativ 4 minute.",
    },
    {
      question: "Ce măsuri de siguranță sunt implementate în parcare?",
      answer:
        "Parcarea noastră este complet împrejmuită, iluminată corespunzător și monitorizată video 24/7. Avem personal de securitate prezent permanent și sisteme de alarmă conectate la dispeceratul de securitate. Accesul în parcare se face doar pe baza codului de rezervare sau prin recunoașterea numărului de înmatriculare.",
    },
    {
      question: "Caut parcare Otopeni preț, care sunt prețurile voastre?",
      answer: "Prețul este în funcție de durata aleasa și le poți vedea în tabelul atașat.",
    },
  ]

  return (
    <section className="py-12 md:py-16 bg-gray-50">
      <div className="container mx-auto px-4 md:px-6">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-8 md:mb-10 text-center text-primary">Întrebări frecvente</h2>

          <div className="space-y-4">
            {faqItems.map((item, index) => (
              <div key={index} className="bg-white rounded-lg overflow-hidden shadow-sm border border-gray-100">
                <button
                  className="w-full flex items-center justify-between p-6 md:p-8 text-left focus:outline-none"
                  onClick={() => toggleFAQ(index)}
                  aria-expanded={openIndex === index}
                  aria-controls={`faq-answer-${index}`}
                >
                  <h3 className="text-lg font-medium text-gray-900">{item.question}</h3>
                  <span className="ml-6 flex-shrink-0 text-primary">
                    {openIndex === index ? <Minus className="h-6 w-6" /> : <Plus className="h-6 w-6" />}
                  </span>
                </button>
                <div
                  id={`faq-answer-${index}`}
                  className={`transition-all duration-300 ease-in-out overflow-hidden ${
                    openIndex === index ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
                  }`}
                >
                  <div className="p-6 md:p-8 pt-0 text-gray-600 text-justify">{item.answer}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-12 text-center">
            <p className="text-gray-600">
              Ai alte întrebări?{" "}
              <a href="/contact" className="text-primary font-medium hover:underline">
                Contactează-ne
              </a>
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
