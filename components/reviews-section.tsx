"use client"

import { useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"

export default function ReviewsSection() {
  const [activeSlide, setActiveSlide] = useState(0)

  const reviews = [
    {
      text: "Atât de ușor să găsești un loc de parcare potrivit înainte de călătorie. Elimină stresul de a găsi un loc când ajungi la aeroport.",
      author: "Andrei M.",
      date: "12 Mai 2025",
      rating: 5,
    },
    {
      text: "Totul a decurs conform planului în ceea ce privește comunicarea, indicațiile și programul... ca să fiu sincer, cu întârzierile zborurilor și o ofertă consistentă pentru un transfer cu autobuzul... parcarea a fost cea mai bună opțiune.",
      author: "Maria D.",
      date: "3 Aprilie 2025",
      rating: 5,
    },
    {
      text: "Liniște sufletească prin rezervarea cu ușurință în avans. Multe opțiuni și valoare rezonabilă pentru parcare. Cu siguranță voi folosi din nou.",
      author: "Ion P.",
      date: "27 Martie 2025",
      rating: 5,
    },
  ]

  const nextSlide = () => {
    setActiveSlide((prev) => (prev === reviews.length - 1 ? 0 : prev + 1))
  }

  const prevSlide = () => {
    setActiveSlide((prev) => (prev === 0 ? reviews.length - 1 : prev - 1))
  }

  return (
    <section className="py-12 md:py-16 bg-gray-50">
      <div className="container mx-auto px-4">
        <div className="max-w-5xl mx-auto text-center">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-6 sm:mb-8 text-waze-blue">
            Ce spun șoferii despre noi
          </h2>
          <p className="text-base sm:text-lg mb-10 sm:mb-16 text-gray-600">
            Recenzii reale de la clienții noștri care au folosit serviciile de parcare.
          </p>

          {/* Mobile Reviews Slider */}
          <div className="md:hidden relative">
            <div className="overflow-hidden">
              <div
                className="flex transition-transform duration-300 ease-in-out"
                style={{ transform: `translateX(-${activeSlide * 100}%)` }}
              >
                {reviews.map((review, index) => (
                  <div key={index} className="w-full flex-shrink-0 px-4">
                    <div className="bg-white p-6 rounded-2xl shadow-lg text-left h-full">
                      <div className="flex mb-4">
                        {[...Array(review.rating)].map((_, i) => (
                          <svg
                            key={i}
                            width="20"
                            height="20"
                            viewBox="0 0 24 24"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path
                              d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
                              fill="#FFD700"
                              stroke="#FFD700"
                              strokeWidth="1"
                            />
                          </svg>
                        ))}
                      </div>
                      <p className="text-gray-700 text-base sm:text-lg leading-relaxed">" {review.text} "</p>
                      <div className="mt-6 pt-4 border-t border-gray-200">
                        <p className="text-sm text-gray-500">
                          {review.author} • {review.date}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Navigation Dots */}
            <div className="flex justify-center mt-6 space-x-2">
              {reviews.map((_, index) => (
                <button
                  key={index}
                  onClick={() => setActiveSlide(index)}
                  className={`w-2.5 h-2.5 rounded-full transition-colors ${
                    activeSlide === index ? "bg-primary" : "bg-gray-300"
                  }`}
                  aria-label={`Go to slide ${index + 1}`}
                />
              ))}
            </div>

            {/* Navigation Arrows */}
            <button
              onClick={prevSlide}
              className="absolute left-0 top-1/2 -translate-y-1/2 bg-white rounded-full p-2 shadow-md"
              aria-label="Previous review"
            >
              <ChevronLeft className="h-5 w-5 text-gray-600" />
            </button>
            <button
              onClick={nextSlide}
              className="absolute right-0 top-1/2 -translate-y-1/2 bg-white rounded-full p-2 shadow-md"
              aria-label="Next review"
            >
              <ChevronRight className="h-5 w-5 text-gray-600" />
            </button>
          </div>

          {/* Desktop Reviews Grid - Hidden on Mobile */}
          <div className="hidden md:grid md:grid-cols-3 gap-8">
            {reviews.map((review, index) => (
              <div
                key={index}
                className="bg-white p-8 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 text-left transform hover:-translate-y-2 card-hover"
              >
                <div className="flex mb-4">
                  {[...Array(review.rating)].map((_, i) => (
                    <svg
                      key={i}
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
                        fill="#FFD700"
                        stroke="#FFD700"
                        strokeWidth="1"
                      />
                    </svg>
                  ))}
                </div>
                <p className="text-gray-700 text-lg leading-relaxed">" {review.text} "</p>
                <div className="mt-6 pt-4 border-t border-gray-200">
                  <p className="text-sm text-gray-500">
                    {review.author} • {review.date}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
