"use client"

import { Check } from "lucide-react"

interface CheckoutStepsProps {
  /** 1 = Detalii, 2 = Plasare, 3 = Confirmare */
  activeStep: 1 | 2 | 3
}

export default function CheckoutSteps({ activeStep }: CheckoutStepsProps) {
  const steps = [
    { id: 1, label: "Detalii rezervare" },
    { id: 2, label: "Plasare comandă" },
    { id: 3, label: "Confirmare" },
  ] as const

  return (
    <div className="max-w-3xl mx-auto mb-8 md:mb-12 px-4">
      {/* containerul de paşi */}
      <ol className="flex">
        {steps.map(({ id, label }, idx) => {
          const isDone = activeStep > id
          const isCurrent = activeStep === id
          const isLast = idx === steps.length - 1

          return (
            <li
              key={id}
              className="relative flex-1 flex flex-col items-center"
            >
              {/* linia către pasul următor (doar dacă nu e ultimul) */}
              {!isLast && (
                <span
                  className={`
                    absolute top-4 left-1/2 h-0.5
                    ${activeStep > id ? "bg-green-600" : "bg-gray-200"}
                  `}
                  style={{ width: "100%" }} // 100 % din li = de la centru la centru
                />
              )}

              {/* cercul */}
              <div
                className={`
                  z-10 flex items-center justify-center w-8 h-8 rounded-full
                  ${isDone || isCurrent
                    ? "bg-green-600 text-white"
                    : "bg-gray-200 text-gray-500"}
                `}
              >
                {isDone ? <Check className="h-5 w-5" /> : id}
              </div>

              {/* eticheta */}
              <span
                className={`
                  mt-2 text-xs sm:text-sm font-medium text-center
                  ${activeStep >= id ? "text-gray-900" : "text-gray-500"}
                `}
              >
                {label}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
