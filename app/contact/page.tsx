import type { Metadata } from "next"
import Header from "@/components/header"
import Footer from "@/components/footer"
import ContactHero from "@/components/contact-hero"
import ContactInfo from "@/components/contact-info"
import ContactForm from "@/components/contact-form"
import ContactMap from "@/components/contact-map"
import Script from "next/script"

export const metadata: Metadata = {
  title: "Contact Parcare Otopeni | Asistență 24/7",
  description:
    "Contactează-ne pentru orice întrebare legată de parcarea de lângă Aeroportul Otopeni. Echipa noastră de suport este disponibilă 24/7 pentru a-ți oferi asistența necesară.",
  keywords: [
    "contact parcare otopeni",
    "telefon parcare aeroport",
    "email parcare otopeni",
    "locatie parcare aeroport",
  ],
  alternates: {
    canonical: "/contact",
  },
  openGraph: {
    title: "Contact Parcare Otopeni | Asistență 24/7",
    description:
      "Contactează-ne pentru orice întrebare legată de parcarea de lângă Aeroportul Otopeni. Echipa noastră de suport este disponibilă 24/7 pentru a-ți oferi asistența necesară.",
    url: "https://parcare-aeroport.ro/contact",
  },
}

export default function ContactPage() {
  return (
    <main className="min-h-screen bg-white">
      {/* <Header /> */}
      <ContactHero />
      <ContactInfo />
      <ContactForm />
      <ContactMap />
      {/* <Footer /> */}

      {/* Schema.org pentru pagina de contact */}
      <Script id="schema-contact" type="application/ld+json" strategy="afterInteractive">
        {`
          {
            "@context": "https://schema.org",
            "@type": "ContactPage",
            "name": "Contact Parcare-Aeroport Otopeni",
            "description": "Contactează-ne pentru orice întrebare legată de parcarea de lângă Aeroportul Otopeni.",
            "mainEntity": {
              "@type": "Organization",
              "name": "Parcare-Aeroport SRL",
              "telephone": "+40734292818",
              "email": "contact.parcareaeroport@gmail.com",
              "address": {
                "@type": "PostalAddress",
                "streetAddress": "Strada Aeroportului 10",
                "addressLocality": "Otopeni",
                "addressRegion": "Ilfov",
                "postalCode": "075100",
                "addressCountry": "RO"
              },
              "contactPoint": {
                "@type": "ContactPoint",
                "telephone": "+40734292818",
                "contactType": "customer service",
                "availableLanguage": ["Romanian", "English"],
                "hoursAvailable": {
                  "@type": "OpeningHoursSpecification",
                  "dayOfWeek": [
                    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"
                  ],
                  "opens": "00:00",
                  "closes": "23:59"
                }
              }
            }
          }
        `}
      </Script>
    </main>
  )
}
