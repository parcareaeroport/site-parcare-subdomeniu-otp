import Image from "next/image"

export default function WhyChooseSection() {
  const features = [
    {
      icon: <Image src="/icons homepage/Confort si Siguranta Garantate - Parcare Aeroport Otopeni OTP Parking (1).png" alt="Confort și siguranță garantate" width={64} height={64} className="h-16 w-16" />,
      title: "Confort și siguranță garantate",
      description: "Ai parte de o parcare iluminată, asfaltată, locuri de parcare generoase trasate și un spațiu special pentru relaxare, cu cafea si snacks-uri. Parchezi ușor și eviți zgârieturile, cu spațiu suficient între vehicule. Rămâne doar să rezervi!"
    },
    {
      icon: <Image src="/icons homepage/Parcare inteligentă cu rezervare online și acces automatizat - Parcare Otopeni OTP Parking (1).png" alt="Parcare inteligentă cu rezervare online și acces automatizat" width={64} height={64} className="h-16 w-16" />,
      title: "Parcare inteligentă cu rezervare online și acces automatizat",
      description: "Am pregătit pentru tine un sistem de rezervare online simplu și intuitiv. Accesul în parcare se poate face și prin citirea automată a numărului de înmatriculare sau a codului QR pe care îl generăm special pentru tine."
    },
    {
      icon: <Image src="/icons homepage/Supraveghere CCTV și pază dedicată - Parcare Ieftina Otopeni OTP Parking.png" alt="Supraveghere CCTV și pază dedicată" width={64} height={64} className="h-16 w-16" />,
      title: "Supraveghere CCTV și pază dedicată",
      description: "Monitorizare video CCTV 24/7 la care tu ai acces, pază umană, gard împrejmuitor și barieră cu cod de acces. Mașina ta este protejată în permanență."
    }
  ]

  return (
    <section className="py-12 md:py-16 bg-white">
      <div className="container mx-auto px-4 md:px-6">
        <div className="text-center mb-8 md:mb-10">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-4 text-waze-blue">
            De ce să alegi parcarea noastră?
          </h2>
          <p className="text-base md:text-lg text-gray-600 max-w-3xl mx-auto">
            Oferim cele mai bune servicii de parcare pentru călătoriile tale, cu siguranță garantată și confort maxim.
              </p>
            </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
          {features.map((feature, index) => (
            <div 
              key={index}
              className="group p-6 md:p-8 bg-gray-50 rounded-2xl hover:bg-primary/5 transition-all duration-300 hover:shadow-lg"
            >
              <div className="text-waze-blue mb-4">
                {feature.icon}
              </div>
              <h3 className="text-lg font-bold mb-3 text-gray-800">
                {feature.title}
              </h3>
              <p className="text-sm text-gray-600 leading-relaxed">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
