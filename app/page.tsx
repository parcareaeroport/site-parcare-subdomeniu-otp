import type { Metadata } from "next"
import Header from "@/components/header"
import HeroSection from "@/components/hero-section"
import MapSection from "@/components/map-section"
import HowItWorksSection from "@/components/how-it-works-section"
import WhyChooseSection from "@/components/why-choose-section"
import PricingTableSection from "@/components/pricing-table-section"
import FacilitiesSection from "@/components/facilities-section"
import SeoTextSection from "@/components/seo-text-section"
import VideoSection from "@/components/video-section"
import ReviewsSection from "@/components/reviews-section"
import Footer from "@/components/footer"
import Script from "next/script"

// Enhanced SEO metadata for better ranking
export const metadata: Metadata = {
  title: "OTP Parking - Rezervare Online | Transfer Gratuit 24/7",
  description: "Parcare sigură lângă Aeroportul Otopeni cu transfer gratuit, supraveghere 24/7, locuri asfaltate. Rezervă online cu reduceri de până la 30%. Serviciu premium la prețuri avantajoase.",
  keywords: "parcare otopeni, parcare aeroport, parcare henri coanda, rezervare parcare online, transfer gratuit aeroport, parcare sigura otopeni, parcare asfaltata",
  openGraph: {
    title: "OTP Parking - Transfer Gratuit & Securitate 24/7",
    description: "Cea mai convenabilă parcare lângă Aeroportul Otopeni. Transfer gratuit, supraveghere video, locuri asfaltate. Rezervă acum cu reducere!",
    type: "website",
    url: "https://parcare-aeroport.ro",
    images: [
      {
        url: "/parcare_otopeni_seo_image.jpg",
        width: 1200,
        height: 630,
        alt: "OTP Parking - Serviciu Premium"
      }
    ],
    locale: "ro_RO",
    siteName: "OTP Parking"
  },
  twitter: {
    card: "summary_large_image",
    title: "OTP Parking - Transfer Gratuit 24/7",
    description: "Parcare sigură cu transfer gratuit la Aeroportul Otopeni. Rezervă online cu reduceri!",
    images: ["/parcare_otopeni_seo_image.jpg"]
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  alternates: {
    canonical: "https://parcare-aeroport.ro"
  }
}

export default function Home() {
  return (
    <main className="min-h-screen">
      {/* <Header /> */}
      <HeroSection />
      {/* <MapSection />
      <PricingTableSection />
      <HowItWorksSection />
      <WhyChooseSection />
      <FacilitiesSection />
      <SeoTextSection />
      <VideoSection />
      <ReviewsSection />
      {/* <Footer /> */}

      {/* Schema.org structured data pentru LocalBusiness */}
      <Script id="schema-parking" type="application/ld+json" strategy="afterInteractive">
        {`
          {
            "@context": "https://schema.org",
            "@type": "ParkingFacility",
            "name": "Parcare-Aeroport Otopeni",
            "image": "https://parcare-aeroport.ro/images/parking-lot.jpg",
            "url": "https://parcare-aeroport.ro",
            "telephone": "+40742039955",
            "address": {
              "@type": "PostalAddress",
              "streetAddress": "Strada Aeroportului 10",
              "addressLocality": "Otopeni",
              "addressRegion": "Ilfov",
              "postalCode": "075100",
              "addressCountry": "RO"
            },
            "geo": {
              "@type": "GeoCoordinates",
              "latitude": 44.5675,
              "longitude": 26.0847
            },
            "openingHoursSpecification": {
              "@type": "OpeningHoursSpecification",
              "dayOfWeek": [
                "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"
              ],
              "opens": "00:00",
              "closes": "23:59"
            },
            "priceRange": "$$",
            "description": "Parcare sigură lângă Aeroportul Otopeni, cu supraveghere 24/7 și transfer gratuit la terminal.",
            "amenityFeature": [
              {
                "@type": "LocationFeatureSpecification",
                "name": "Supraveghere video",
                "value": true
              },
              {
                "@type": "LocationFeatureSpecification",
                "name": "Transfer gratuit la aeroport",
                "value": true
              },
              {
                "@type": "LocationFeatureSpecification",
                "name": "Parcare asfaltată",
                "value": true
              },
              {
                "@type": "LocationFeatureSpecification",
                "name": "Pază 24/7",
                "value": true
              }
            ],
            "aggregateRating": {
              "@type": "AggregateRating",
              "ratingValue": "4.5",
              "reviewCount": "151132"
            }
          }
        `}
      </Script>

      {/* Schema.org pentru FAQPage */}
      <Script id="schema-faq" type="application/ld+json" strategy="afterInteractive">
        {`
          {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": [
              {
                "@type": "Question",
                "name": "Cum pot rezerva un loc de parcare?",
                "acceptedAnswer": {
                  "@type": "Answer",
                  "text": "Rezervarea unui loc de parcare este simplă. Accesați site-ul nostru, introduceți datele de sosire și plecare și urmați pașii pentru finalizarea plății. Veți primi o confirmare pe email cu toate detaliile necesare."
                }
              },
              {
                "@type": "Question",
                "name": "Ce se întâmplă dacă întârzii la ora rezervată?",
                "acceptedAnswer": {
                  "@type": "Answer",
                  "text": "Locul de parcare vă este rezervat pentru întreaga perioadă specificată în rezervare. Dacă ajungeți mai târziu decât ora specificată, locul vă rămâne rezervat, dar nu se oferă reduceri sau rambursări pentru timpul neutilizat."
                }
              },
              {
                "@type": "Question",
                "name": "Există serviciu de transfer către aeroport?",
                "acceptedAnswer": {
                  "@type": "Answer",
                  "text": "Da, oferim un serviciu gratuit de transfer către și de la Aeroportul Otopeni. Transferul funcționează 24/7 și durează aproximativ 4 minute."
                }
              }
            ]
          }
        `}
      </Script>

      {/* Preload critical images - moved to head via next/script */}
      <Script id="preload-images" strategy="afterInteractive">
        {`
          // Preload important images for better Core Web Vitals
          const imageUrls = [
            "/slider-otp-parking.jpg",
            "/parcare_otopeni_seo_image.jpg"
          ];
          
          imageUrls.forEach((url) => {
            const link = document.createElement("link");
            link.rel = "preload";
            link.as = "image";
            link.href = url;
            document.head.appendChild(link);
          });
        `}
      </Script>
    </main>
  )
}
