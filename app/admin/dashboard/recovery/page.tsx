"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { useToast } from "@/components/ui/use-toast"
import { useAuth } from "@/context/auth-context"
import { 
  RefreshCw, 
  AlertTriangle, 
  DollarSign, 
  Clock, 
  CheckCircle,
  XCircle,
  TrendingUp
} from "lucide-react"
import { 
  recoverFailedBookings, 
  recoverSpecificBooking, 
  getFailedBookingsStats 
} from "@/app/actions/booking-recovery"
import { format } from "date-fns"
import { ro } from "date-fns/locale"

interface RecoveryStats {
  total: number
  paidFailures: number
  unpaidFailures: number
  totalAmount: number
  oldestFailure?: Date
}

export default function RecoveryPage() {
  const { user } = useAuth()
  const { toast } = useToast()

  const [stats, setStats] = useState<RecoveryStats | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRecovering, setIsRecovering] = useState(false)
  const [recoveryResult, setRecoveryResult] = useState<{
    success: boolean
    recovered: number
    failed: number
    details: string[]
  } | null>(null)

  // Încarcă statisticile la mount
  useEffect(() => {
    loadStats()
  }, [])

  const loadStats = async () => {
    try {
      setIsLoading(true)
      const result = await getFailedBookingsStats()
      setStats(result)
    } catch (error) {
      console.error("Error loading stats:", error)
      toast({
        title: "Eroare",
        description: "Nu s-au putut încărca statisticile",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleRecoverAll = async () => {
    setIsRecovering(true)
    setRecoveryResult(null)

    try {
      const result = await recoverFailedBookings()
      setRecoveryResult(result)
      
      if (result.success && result.recovered > 0) {
        toast({
          title: "Recovery Complet",
          description: `${result.recovered} rezervări recuperate cu succes!`,
        })
        
        // Reîncarcă statisticile
        await loadStats()
      } else if (result.success && result.recovered === 0) {
        toast({
          title: "Nicio rezervare recuperată",
          description: "Toate rezervările continuă să eșueze la API.",
          variant: "destructive",
        })
      }
    } catch (error) {
      toast({
        title: "Eroare Recovery",
        description: "A apărut o eroare în timpul procesului de recovery",
        variant: "destructive",
      })
    } finally {
      setIsRecovering(false)
    }
  }

  if (!user) {
    return <div>Nu ești autentificat</div>
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Recovery Rezervări</h1>
          <p className="text-muted-foreground">
            Recuperare rezervări cu plăți procesate dar API eșuat
          </p>
        </div>
        <Button onClick={loadStats} disabled={isLoading} variant="outline">
          <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          Actualizează
        </Button>
      </div>

      {/* Statistici */}
      {stats && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Eșuate</CardTitle>
              <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
              <p className="text-xs text-muted-foreground">
                rezervări cu API eșuat
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Plăți Procesate</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{stats.paidFailures}</div>
              <p className="text-xs text-muted-foreground">
                cu bani luați dar fără rezervare
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Sumă Afectată</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">
                {stats.totalAmount.toFixed(2)} RON
              </div>
              <p className="text-xs text-muted-foreground">
                total bani fără rezervare
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Prima Eșuată</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {stats.oldestFailure ? 
                  format(stats.oldestFailure, "dd MMM", { locale: ro }) : 
                  "N/A"
                }
              </div>
              <p className="text-xs text-muted-foreground">
                cea mai veche rezervare eșuată
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Alert pentru rezervări cu plăți procesate */}
      {stats && stats.paidFailures > 0 && (
        <Alert className="border-red-200 bg-red-50">
          <AlertTriangle className="h-4 w-4 text-red-600" />
          <AlertTitle className="text-red-800">
            Atenție: {stats.paidFailures} rezervări cu plăți procesate
          </AlertTitle>
          <AlertDescription className="text-red-700">
            Există {stats.paidFailures} rezervări unde banii au fost luați prin Stripe dar 
            API-ul de parcare a eșuat. Aceste rezervări trebuie recuperate urgent pentru 
            a evita reclamațiile clienților. Suma totală afectată: <strong>{stats.totalAmount.toFixed(2)} RON</strong>.
          </AlertDescription>
        </Alert>
      )}

      {/* Recovery Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Acțiuni Recovery</CardTitle>
          <CardDescription>
            Încearcă să recuperezi rezervările eșuate prin reapelarea API-ului de parcare
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium">Recovery Automat - Toate Rezervările</h3>
              <p className="text-sm text-muted-foreground">
                Încearcă să recupereze toate rezervările cu plăți procesate dar API eșuat
              </p>
            </div>
            <Button 
              onClick={handleRecoverAll}
              disabled={isRecovering || !stats || stats.paidFailures === 0}
              className="ml-4"
            >
              {isRecovering ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Se recuperează...
                </>
              ) : (
                <>
                  <CheckCircle className="mr-2 h-4 w-4" />
                  Recuperează Toate
                </>
              )}
            </Button>
          </div>

          {stats && stats.paidFailures === 0 && (
            <div className="text-sm text-green-600 flex items-center">
              <CheckCircle className="mr-2 h-4 w-4" />
              Nu există rezervări de recuperat
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recovery Results */}
      {recoveryResult && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              {recoveryResult.success ? (
                <CheckCircle className="mr-2 h-5 w-5 text-green-600" />
              ) : (
                <XCircle className="mr-2 h-5 w-5 text-red-600" />
              )}
              Rezultate Recovery
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">
                  {recoveryResult.recovered}
                </div>
                <p className="text-sm text-muted-foreground">Recuperate</p>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-red-600">
                  {recoveryResult.failed}
                </div>
                <p className="text-sm text-muted-foreground">Încă Eșuate</p>
              </div>
            </div>

            <Separator className="my-4" />

            <div className="space-y-2">
              <h4 className="font-medium">Detalii Recovery:</h4>
              <div className="bg-gray-50 p-3 rounded-md max-h-96 overflow-y-auto">
                {recoveryResult.details.map((detail, index) => (
                  <div key={index} className="text-sm font-mono">
                    {detail}
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Instrucțiuni */}
      <Card>
        <CardHeader>
          <CardTitle>Cum Funcționează Recovery</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <strong>1. Identificare:</strong> Systemul găsește rezervările cu status "api_error" 
            dar cu plata procesată cu succes.
          </p>
          <p>
            <strong>2. Retry API:</strong> Pentru fiecare rezervare eșuată, se încearcă din nou 
            apelul către API-ul de parcare cu timeout extins de 45 secunde.
          </p>
          <p>
            <strong>3. Actualizare:</strong> Dacă API-ul reușește, rezervarea este marcată ca 
            "confirmed_paid" și se generează numărul de rezervare.
          </p>
          <p>
            <strong>4. Notificare:</strong> După recovery, se pot trimite automat email-urile 
            de confirmare către clienți.
          </p>
        </CardContent>
      </Card>
    </div>
  )
} 