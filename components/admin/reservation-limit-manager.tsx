// ReservationLimitManager v2 – limită + toggle activare, fără defocus & cu flux logic robust
"use client"

import { useState, useEffect, useRef, type ChangeEvent } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Settings, Save, Loader2, Power, PowerOff, AlertTriangle, RefreshCw } from "lucide-react"
import { db } from "@/lib/firebase"
import { doc, setDoc, onSnapshot, collection, query, getCountFromServer, where, getDocs, updateDoc, serverTimestamp, increment } from "firebase/firestore"
import { useToast } from "@/components/ui/use-toast"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { OccupancyCounter } from "./occupancy-counter"
import { useAuth } from "@/context/auth-context"
import { adminAuthorizedFetch } from "@/lib/admin-authorized-fetch"

export function ReservationLimitManager() {
  const { toast } = useToast()
  const { user } = useAuth()

  /*──────────────────────────────────┐
  │   STATE                         │
  └──────────────────────────────────*/
  // limită
  const [maxInput, setMaxInput] = useState("")
  const [currentLimit, setCurrentLimit] = useState<number | null>(null)

  // toggle rezervări
  const [reservationsEnabled, setReservationsEnabled] = useState<boolean | null>(null)

  // statistici
  const [activeBookings, setActiveBookings] = useState<number | null>(null)
  const [lprInsideCount, setLprInsideCount] = useState<number | null>(null)
  const [payOnSiteCancelMinutes, setPayOnSiteCancelMinutes] = useState<number | null>(null)
  const [payOnSiteCancelMinutesInput, setPayOnSiteCancelMinutesInput] = useState("")
  const [payOnSiteAutoCancelEnabled, setPayOnSiteAutoCancelEnabled] = useState<boolean | null>(null)

  // flags
  const [loadingSettings, setLoadingSettings] = useState(true)
  const [savingLimit, setSavingLimit] = useState(false)
  const [savingToggle, setSavingToggle] = useState(false)
  const [savingPayOnSiteAutoCancelToggle, setSavingPayOnSiteAutoCancelToggle] = useState(false)

  // refs pentru focus‑handling
  const hasLoadedOnce = useRef(false)
  const userTyped = useRef(false)

  /*──────────────────────────────────┐
  │   SNAPSHOT: settings (limită + toggle) │
  └──────────────────────────────────*/
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "config", "reservationSettings"),
      (snap) => {
        const data = snap.data() ?? {}
        const dbLimit = data.maxTotalReservations ?? 0
        const dbEnabled = data.reservationsEnabled ?? true
        const dbPayOnSiteMinutes = data.payOnSiteAutoCancelMinutes ?? 180
        const dbPayOnSiteAutoCancelEnabled = data.payOnSiteAutoCancelEnabled ?? true

        setCurrentLimit(dbLimit)
        setReservationsEnabled(dbEnabled)
        setPayOnSiteCancelMinutes(dbPayOnSiteMinutes)
        setPayOnSiteAutoCancelEnabled(dbPayOnSiteAutoCancelEnabled)

        if (!hasLoadedOnce.current && !userTyped.current) {
          setMaxInput(dbLimit.toString())
          setPayOnSiteCancelMinutesInput(dbPayOnSiteMinutes.toString())
        }

        hasLoadedOnce.current = true
        setLoadingSettings(false)
      },
      (err) => {
        console.error(err)
        toast({ title: "Eroare", description: "Nu s-au putut încărca setările.", variant: "destructive" })
        setLoadingSettings(false)
      },
    )
    return () => unsub()
  }, [toast])

  /*──────────────────────────────────┐
  │   SNAPSHOT: Occupancy live        │
  │   Rezervări Active Acum = parkingLive.occupiedCount
  └──────────────────────────────────*/
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "config", "parkingLive"),
      (snap) => {
        const count = Math.max(0, Number(snap.data()?.occupiedCount || 0))
        setActiveBookings(count)
        console.log("📊 Active bookings from parkingLive.occupiedCount:", { count })
      },
      (err) => {
        console.error("❌ Error listening to parkingLive occupancy:", err)
      },
    )

    return () => unsub()
  }, [])

  // IMPORTANT: Keep the dashboard occupancy card consistent with /admin/dashboard/ocupare:
  // use strict LPR reality (count of bookings where lpr.isInside == true) via /api/admin/occupancy
  useEffect(() => {
    let cancelled = false

    const refresh = async () => {
      if (!user) return

      try {
        const res = await adminAuthorizedFetch("/api/admin/occupancy", user)
        if (!res.ok) return
        const json = (await res.json()) as { occupiedCount?: number; plates?: any[] }
        const count =
          typeof json?.occupiedCount === "number"
            ? json.occupiedCount
            : Array.isArray(json?.plates)
              ? json.plates.length
              : null
        if (!cancelled) setLprInsideCount(typeof count === "number" ? Math.max(0, count) : null)
      } catch {
        // ignore: we'll just fall back to live counter
      }
    }

    refresh()
    const id = setInterval(refresh, 60000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [user])

  /*──────────────────────────────────┐
  │   HANDLERS                       │
  └──────────────────────────────────*/
  const onLimitChange = (e: ChangeEvent<HTMLInputElement>) => {
    userTyped.current = true
    setMaxInput(e.target.value)
  }

  const onPayOnSiteMinutesChange = (e: ChangeEvent<HTMLInputElement>) => {
    userTyped.current = true
    setPayOnSiteCancelMinutesInput(e.target.value)
  }

  const saveLimit = async () => {
    const newLimit = Number.parseInt(maxInput, 10)
    if (isNaN(newLimit) || newLimit < 0) {
      toast({ title: "Valoare invalidă", description: "Limita trebuie să fie un număr pozitiv.", variant: "destructive" })
      return
    }

    const prev = currentLimit
    setCurrentLimit(newLimit)
    setSavingLimit(true)

    try {
      await setDoc(doc(db, "config", "reservationSettings"), { maxTotalReservations: newLimit }, { merge: true })
      userTyped.current = false
      toast({ title: "Succes", description: "Limita a fost actualizată." })
    } catch (err) {
      console.error(err)
      setCurrentLimit(prev)
      toast({ title: "Eroare", description: "Salvarea a eșuat.", variant: "destructive" })
    } finally {
      setSavingLimit(false)
    }
  }

  const savePayOnSiteCancelMinutes = async () => {
    const newMinutes = Number.parseInt(payOnSiteCancelMinutesInput, 10)
    if (isNaN(newMinutes) || newMinutes <= 0) {
      toast({
        title: "Valoare invalidă",
        description: "Pragul trebuie să fie un număr de minute mai mare decât 0.",
        variant: "destructive",
      })
      return
    }

    const prev = payOnSiteCancelMinutes
    setPayOnSiteCancelMinutes(newMinutes)
    setSavingLimit(true)

    try {
      await setDoc(
        doc(db, "config", "reservationSettings"),
        { payOnSiteAutoCancelMinutes: newMinutes },
        { merge: true },
      )
      userTyped.current = false
      toast({
        title: "Succes",
        description: "Pragul pentru anularea rezervărilor cu Plată la Parcare a fost actualizat.",
      })
    } catch (err) {
      console.error(err)
      setPayOnSiteCancelMinutes(prev)
      toast({
        title: "Eroare",
        description: "Nu s-a putut salva pragul de anulare.",
        variant: "destructive",
      })
    } finally {
      setSavingLimit(false)
    }
  }

  const toggleEnabled = async (enabled: boolean) => {
    const prev = reservationsEnabled
    setReservationsEnabled(enabled)
    setSavingToggle(true)

    try {
      await setDoc(doc(db, "config", "reservationSettings"), { reservationsEnabled: enabled }, { merge: true })
      toast({ title: "Succes", description: `Rezervările au fost ${enabled ? "activate" : "dezactivate"}.` })
    } catch (err) {
      console.error(err)
      setReservationsEnabled(prev)
      toast({ title: "Eroare", description: "Nu s-a putut actualiza statusul.", variant: "destructive" })
    } finally {
      setSavingToggle(false)
    }
  }

  const togglePayOnSiteAutoCancelEnabled = async (enabled: boolean) => {
    const prev = payOnSiteAutoCancelEnabled
    setPayOnSiteAutoCancelEnabled(enabled)
    setSavingPayOnSiteAutoCancelToggle(true)

    try {
      await setDoc(
        doc(db, "config", "reservationSettings"),
        { payOnSiteAutoCancelEnabled: enabled },
        { merge: true },
      )
      toast({
        title: "Succes",
        description: `Anularea automată pentru Plată la Parcare a fost ${enabled ? "activată" : "dezactivată"}.`,
      })
    } catch (err) {
      console.error(err)
      setPayOnSiteAutoCancelEnabled(prev)
      toast({ title: "Eroare", description: "Nu s-a putut actualiza statusul.", variant: "destructive" })
    } finally {
      setSavingPayOnSiteAutoCancelToggle(false)
    }
  }

  /**
   * Cleanup manual pentru rezervările expirate
   */
  const handleExpiredCleanup = async () => {
    setLoadingSettings(true)
    try {
      const now = new Date()
      const currentDateStr = now.toISOString().split('T')[0] // YYYY-MM-DD
      
      console.log('🧹 Manual cleanup for expired bookings at:', currentDateStr)
      
      const bookingsRef = collection(db, 'bookings')
      
      // Query pentru rezervările care ar trebui să fie active dar poate au expirat
      const potentiallyExpiredQuery = query(
        bookingsRef,
        where('status', 'in', ['confirmed_paid', 'confirmed_test', 'confirmed', 'paid', 'confirmed_pay_on_site']),
        where('endDate', '<=', currentDateStr) // Toate rezervările care se termină astăzi sau în trecut
      )
      
      const snapshot = await getDocs(potentiallyExpiredQuery)
      let expiredCount = 0
      
      for (const docSnapshot of snapshot.docs) {
        const booking = docSnapshot.data()
        const endDateTime = new Date(`${booking.endDate}T${booking.endTime}:00`)
        
        if (endDateTime <= now) {
          // Marchează rezervarea ca expirată
          await updateDoc(docSnapshot.ref, {
            status: 'expired',
            expiredAt: serverTimestamp(),
            lastUpdated: serverTimestamp()
          })
          
          expiredCount++
          console.log('⏰ Manually marked booking as expired:', {
            id: docSnapshot.id,
            licensePlate: booking.licensePlate,
            endDate: booking.endDate,
            endTime: booking.endTime
          })
        }
      }
      
      if (expiredCount > 0) {
        // Actualizează statisticile - scade numărul de rezervări active
        const statsDocRef = doc(db, "config", "reservationStats")
        await updateDoc(statsDocRef, {
          activeBookingsCount: increment(-expiredCount),
          lastUpdated: serverTimestamp()
        })
        
        toast({
          title: "Cleanup Finalizat",
          description: `Au fost marcate ${expiredCount} rezervări ca expirate.`,
        })
      } else {
        toast({
          title: "Cleanup Complet",
          description: "Nu au fost găsite rezervări expirate de curățat.",
        })
      }
      
    } catch (error) {
      console.error('❌ Error during manual cleanup:', error)
      toast({
        title: "Eroare Cleanup",
        description: "A apărut o eroare la curățarea rezervărilor expirate.",
        variant: "destructive",
      })
    } finally {
      setLoadingSettings(false)
    }
  }

  /*──────────────────────────────────┐
  │   DERIVED                        │
  └──────────────────────────────────*/
  const limitDirty = maxInput !== (currentLimit ?? "").toString()
  const anySaving = savingLimit || savingToggle
  const disabledAll = loadingSettings || anySaving

  /*──────────────────────────────────┐
  │   UI                             │
  └──────────────────────────────────*/
  return (
    <Card>
      <CardHeader>
        <CardTitle>Limită Rezervări & Cleanup</CardTitle>
        <CardDescription>
          Gestionează numărul maxim de rezervări și curăță rezervările expirate
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Reservations Toggle */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label htmlFor="reservations-enabled">Rezervări Active</Label>
            <p className="text-sm text-muted-foreground">
              Activează sau dezactivează posibilitatea de a face rezervări noi
            </p>
          </div>
          <Switch
            id="reservations-enabled"
            checked={reservationsEnabled ?? false}
            onCheckedChange={toggleEnabled}
            disabled={loadingSettings}
          />
        </div>

        {/* PayOnSite auto-cancel Toggle */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label htmlFor="payonsite-autocancel-enabled">Auto-anulare „Plată la Parcare”</Label>
            <p className="text-sm text-muted-foreground">
              Dezactivează complet sistemul de anulare automată pentru rezervările cu Plată la Parcare.
            </p>
          </div>
          <Switch
            id="payonsite-autocancel-enabled"
            checked={payOnSiteAutoCancelEnabled ?? true}
            onCheckedChange={togglePayOnSiteAutoCancelEnabled}
            disabled={loadingSettings || savingPayOnSiteAutoCancelToggle}
          />
        </div>

        {/* Current Status */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <OccupancyCounter 
            title="Ocupare curenta" 
            compact
            // same as /admin/dashboard/ocupare
            countOverride={typeof lprInsideCount === "number" ? lprInsideCount : undefined}
          />
          <div className="space-y-2 p-4 rounded-lg border-2 bg-blue-50 border-blue-200">
            <Label>Status Rezervări</Label>
            <Badge variant={reservationsEnabled ? "default" : "secondary"} className="text-sm">
              {reservationsEnabled ? "ACTIVE" : "DEZACTIVATE"}
            </Badge>
          </div>
        </div>

        {/* Limit Management */}
        <div className="space-y-2">
          <Label htmlFor="max-reservations">Limită Maximă Rezervări</Label>
          <div className="flex space-x-2">
            <Input
              id="max-reservations"
              type="number"
              min="0"
              max="1000"
              value={maxInput}
              onChange={onLimitChange}
              placeholder="Ex: 100"
              disabled={loadingSettings}
            />
            <Button onClick={saveLimit} disabled={loadingSettings || !limitDirty}>
              {loadingSettings ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvează"}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Setează 0 pentru rezervări nelimitate. Limita se aplică doar rezervărilor active (neexpirate).
          </p>
        </div>

        {/* Prag anulare Plată la Parcare */}
        <div className="space-y-2">
          <Label htmlFor="payonsite-cancel-minutes">Prag anulare „Plată la Parcare” (minute)</Label>
          <div className="flex space-x-2">
            <Input
              id="payonsite-cancel-minutes"
              type="number"
              min="1"
              max="1440"
              value={payOnSiteCancelMinutesInput}
              onChange={onPayOnSiteMinutesChange}
              placeholder="Ex: 180"
              disabled={loadingSettings}
            />
            <Button onClick={savePayOnSiteCancelMinutes} disabled={loadingSettings}>
              {loadingSettings ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvează"}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            După acest număr de minute peste ora de ieșire, rezervările cu <strong>Plată la Parcare</strong> vor fi
            anulate automat de funcția Firebase (dacă anularea automată este activată).
          </p>
        </div>

  
      </CardContent>
    </Card>
  )
}
