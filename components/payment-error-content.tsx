"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { XCircle, AlertCircle, CreditCard, Phone, Mail, RefreshCw } from "lucide-react"
import Link from "next/link"
import { useToast } from "@/hooks/use-toast"

interface ErrorInfo {
  title: string
  message: string
  suggestion: string
  canRetry: boolean
  icon: any
  variant: "destructive" | "warning" | "info"
}

const ERROR_SCENARIOS: Record<string, ErrorInfo> = {
  // Stripe error codes
  card_declined: {
    title: "Card Declined",
    message: "Cardul dvs. a fost refuzat de bancă.",
    suggestion: "Verificați datele cardului sau încercați cu un alt card.",
    canRetry: true,
    icon: CreditCard,
    variant: "destructive"
  },
  insufficient_funds: {
    title: "Fonduri Insuficiente", 
    message: "Nu aveți fonduri suficiente pe card pentru această tranzacție.",
    suggestion: "Verificați soldul cardului sau folosiți un alt card.",
    canRetry: true,
    icon: CreditCard,
    variant: "warning"
  },
  expired_card: {
    title: "Card Expirat",
    message: "Cardul folosit a expirat.",
    suggestion: "Verificați data de expirare sau folosiți un alt card.",
    canRetry: true,
    icon: CreditCard,
    variant: "destructive"
  },
  incorrect_cvc: {
    title: "CVC Incorect",
    message: "Codul de securitate (CVC) introdus este incorect.",
    suggestion: "Verificați codul de pe spatele cardului și încercați din nou.",
    canRetry: true,
    icon: CreditCard,
    variant: "warning"
  },
  incorrect_number: {
    title: "Număr Card Incorect",
    message: "Numărul cardului introdus nu este valid.",
    suggestion: "Verificați numărul cardului și încercați din nou.",
    canRetry: true,
    icon: CreditCard,
    variant: "destructive"
  },
  processing_error: {
    title: "Eroare de Procesare",
    message: "A apărut o eroare temporară la procesarea plății.",
    suggestion: "Încercați din nou în câteva minute.",
    canRetry: true,
    icon: RefreshCw,
    variant: "warning"
  },
  lost_card: {
    title: "Card Raportat Pierdut",
    message: "Acest card a fost raportat ca pierdut.",
    suggestion: "Contactați banca sau folosiți un alt card.",
    canRetry: false,
    icon: XCircle,
    variant: "destructive"
  },
  stolen_card: {
    title: "Card Raportat Furat",
    message: "Acest card a fost raportat ca furat.",
    suggestion: "Contactați banca sau folosiți un alt card.",
    canRetry: false,
    icon: XCircle,
    variant: "destructive"
  },
  // Generic errors
  payment_failed: {
    title: "Plată Eșuată",
    message: "Plata nu a putut fi procesată cu succes.",
    suggestion: "Verificați datele cardului și încercați din nou.",
    canRetry: true,
    icon: XCircle,
    variant: "destructive"
  },
  network_error: {
    title: "Problemă de Conexiune",
    message: "A apărut o problemă de conexiune în timpul procesării.",
    suggestion: "Verificați conexiunea la internet și încercați din nou.",
    canRetry: true,
    icon: RefreshCw,
    variant: "warning"
  },
  timeout: {
    title: "Timeout",
    message: "Procesarea plății a depășit timpul limită.",
    suggestion: "Încercați din nou în câteva minute.",
    canRetry: true,
    icon: RefreshCw,
    variant: "warning"
  }
}

export default function PaymentErrorContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { toast } = useToast()
  const [errorInfo, setErrorInfo] = useState<ErrorInfo | null>(null)
  const [isRetrying, setIsRetrying] = useState(false)

  useEffect(() => {
    const errorCode = searchParams.get('code')
    const errorMessage = searchParams.get('message')
    const paymentIntentId = searchParams.get('payment_intent')

    console.log('Payment Error Details:', {
      errorCode,
      errorMessage,
      paymentIntentId
    })

    if (errorCode && ERROR_SCENARIOS[errorCode]) {
      setErrorInfo(ERROR_SCENARIOS[errorCode])
    } else {
      // Default error for unknown codes
      setErrorInfo(ERROR_SCENARIOS.payment_failed)
    }

    // Show toast with error details
    if (errorMessage) {
      toast({
        title: "Eroare Plată",
        description: errorMessage,
        variant: "destructive"
      })
    }
  }, [searchParams, toast])

  const handleRetryPayment = () => {
    setIsRetrying(true)
    
    // Delay to show loading state
    setTimeout(() => {
      router.push('/plasare-comanda?retry=true')
    }, 1000)
  }

  const handleNewReservation = () => {
    // Clear any stored payment data
    sessionStorage.removeItem("reservationData")
    sessionStorage.removeItem("completeOrderData")
    sessionStorage.removeItem("bookingResult")
    
    router.push('/rezerva')
  }

  if (!errorInfo) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8 text-center">
          <div className="animate-pulse space-y-4">
            <div className="h-16 w-16 bg-gray-200 rounded-full mx-auto"></div>
            <div className="h-8 bg-gray-200 rounded w-3/4 mx-auto"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2 mx-auto"></div>
          </div>
        </div>
      </div>
    )
  }

  const IconComponent = errorInfo.icon

  return (
    <div className="max-w-4xl mx-auto">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8">
        <div className="text-center mb-8">
          <div className={`mx-auto w-16 h-16 rounded-full flex items-center justify-center mb-4 ${
            errorInfo.variant === 'destructive' ? 'bg-red-100' :
            errorInfo.variant === 'warning' ? 'bg-yellow-100' : 'bg-blue-100'
          }`}>
            <IconComponent className={`w-8 h-8 ${
              errorInfo.variant === 'destructive' ? 'text-red-600' :
              errorInfo.variant === 'warning' ? 'text-yellow-600' : 'text-blue-600'
            }`} />
          </div>
          
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2">
            {errorInfo.title}
          </h1>
          
          <p className="text-gray-600 text-lg mb-4">
            {errorInfo.message}
          </p>
          
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <div className="flex items-start">
              <AlertCircle className="w-5 h-5 text-blue-600 mr-2 flex-shrink-0 mt-0.5" />
              <p className="text-blue-800 text-sm">
                <strong>Recomandare:</strong> {errorInfo.suggestion}
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
          {errorInfo.canRetry && (
            <Button 
              onClick={handleRetryPayment}
              disabled={isRetrying}
              className="gradient-bg px-8 py-3"
            >
              {isRetrying ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Se încarcă...
                </>
              ) : (
                'Încearcă din nou'
              )}
            </Button>
          )}
          
          <Button 
            onClick={handleNewReservation}
            variant="outline" 
            className="px-8 py-3"
          >
            Rezervare nouă
          </Button>
          
          <Button asChild variant="ghost" className="px-8 py-3">
            <Link href="/">Pagina principală</Link>
          </Button>
        </div>

        {/* Help Section */}
        <div className="border-t pt-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 text-center">
            Ai nevoie de ajutor?
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="flex items-center p-4 bg-gray-50 rounded-lg">
              <Phone className="w-6 h-6 text-primary mr-3" />
              <div>
                <p className="font-medium text-gray-900">Telefon</p>
                <p className="text-gray-600">0742.039.955</p>
              </div>
            </div>
            
            <div className="flex items-center p-4 bg-gray-50 rounded-lg">
              <Mail className="w-6 h-6 text-primary mr-3" />
              <div>
                <p className="font-medium text-gray-900">Email</p>
                <p className="text-gray-600">support@parcare-otopeni.ro</p>
              </div>
            </div>
          </div>
          
          <div className="mt-6 text-center">
            <p className="text-sm text-gray-500">
              Programul de suport: Luni - Duminică, 8:00 - 22:00
            </p>
          </div>
        </div>

        {/* Debug Info (only in development) */}
        {process.env.NODE_ENV === 'development' && (
          <div className="mt-8 p-4 bg-gray-100 rounded-lg">
            <h3 className="font-medium text-gray-900 mb-2">Debug Info:</h3>
            <div className="text-xs text-gray-600 space-y-1">
              <p>Error Code: {searchParams.get('code') || 'unknown'}</p>
              <p>Error Message: {searchParams.get('message') || 'none'}</p>
              <p>Payment Intent: {searchParams.get('payment_intent') || 'none'}</p>
              <p>Decline Code: {searchParams.get('decline_code') || 'none'}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
} 