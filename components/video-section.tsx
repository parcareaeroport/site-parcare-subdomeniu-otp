import Link from "next/link"

export default function VideoSection() {
  return (
    <section className="relative h-[500px] sm:h-[600px] md:h-[700px] lg:h-[800px] w-full overflow-hidden">
      {/* Background Image */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: "url('/parcare_otopeni_reguli_parcare_sosire.jpg')",
          filter: "brightness(0.6)",
        }}
      ></div>

      {/* Content Overlay */}
      <div className="relative z-10 flex flex-col items-center justify-center h-full text-white text-center px-4">
        <h2 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold mb-8 sm:mb-10 md:mb-12 tracking-tight">
          Mașina ta este în siguranță la noi! Îți dorim călătorie placută!
        </h2>
        
        <p className="text-base sm:text-lg md:text-xl lg:text-2xl max-w-4xl mb-8 sm:mb-10 md:mb-12 opacity-90 leading-relaxed">
          Am gândit fiecare serviciu pentru a-ți simplifica experiența și a adăuga o notă de relaxare chiar înainte de zbor sau imediat după aterizare. Dacă încă nu ai rezervat, o poți face acum!
        </p>

        <Link
          href="/#rezerva-formular"
          className="inline-flex items-center gap-3 bg-[#ee7f1a] hover:bg-[#d67016] text-white px-8 py-4 rounded-md transition-all duration-200 font-medium shadow-md hover:shadow-lg hover:scale-105"
        >
          <span>Rezervă locul tău de parcare și zboară liniștit</span>
        </Link>
      </div>
    </section>
  )
}
