"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useToast } from "@/components/ui/use-toast"
import { Loader2 } from "lucide-react"

export default function PaymentCallbackPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { toast } = useToast()
  const [isProcessing, setIsProcessing] = useState(true)

  useEffect(() => {
    async function processPaymentResult() {
      try {
        // Obținem parametrii din URL
        const paymentIntentId = searchParams.get("payment_intent")
        const paymentIntentClientSecret = searchParams.get("payment_intent_client_secret")
        const redirectStatus = searchParams.get("redirect_status")

        if (!paymentIntentId || !paymentIntentClientSecret) {
          throw new Error("Parametri lipsă în URL")
        }

        // Verificăm statusul plății
        if (redirectStatus === "succeeded") {
          // Obținem datele comenzii din sessionStorage
          const orderDataStr = sessionStorage.getItem("completeOrderData")
          if (!orderDataStr) {
            throw new Error("Datele comenzii nu au fost găsite")
          }

          const orderData = JSON.parse(orderDataStr)

          // Creăm rezultatul rezervării
          const bookingResult = {
            ...orderData,
            bookingNumber: `PO-${Date.now()}`,
            success: true,
            transactionId: paymentIntentId,
          }

          // Salvăm rezultatul în sessionStorage
          sessionStorage.setItem("bookingResult", JSON.stringify(bookingResult))

          // Redirecționăm către pagina de confirmare CU parametrii de plată
          const confirmationUrl = new URL("/confirmare", window.location.origin)
          confirmationUrl.searchParams.set("payment_intent", paymentIntentId)
          confirmationUrl.searchParams.set("payment_intent_client_secret", paymentIntentClientSecret)
          confirmationUrl.searchParams.set("redirect_status", "succeeded")
          
          router.push(confirmationUrl.toString())
        } else {
          // Plata a eșuat sau a fost anulată
          toast({
            title: "Plată nefinalizată",
            description: "Plata nu a fost finalizată cu succes. Vă rugăm să încercați din nou.",
            variant: "destructive",
          })
          router.push("/plasare-comanda")
        }
      } catch (error: any) {
        console.error("Error processing payment callback:", error)
        toast({
          title: "Eroare",
          description: error.message || "A apărut o eroare la procesarea plății. Vă rugăm să încercați din nou.",
          variant: "destructive",
        })
        router.push("/plasare-comanda")
      } finally {
        setIsProcessing(false)
      }
    }

    processPaymentResult()
  }, [router, searchParams, toast])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-8 rounded-2xl shadow-lg max-w-md w-full text-center">
        <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
        <h1 className="text-2xl font-bold mb-2">Procesăm plata dvs.</h1>
        <p className="text-gray-600">Vă rugăm să așteptați, procesăm detaliile plății...</p>
      </div>
    </div>
  )
}
