"use client"

import { useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Loader2, Printer, RefreshCw, Info } from "lucide-react"
import { OccupancyCounter } from "@/components/admin/occupancy-counter"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { OccupancyForecast } from "@/components/admin/occupancy-forecast"
import { useSearchParams } from "next/navigation"
import { useAuth } from "@/context/auth-context"
import { auth } from "@/lib/firebase"
import { EmailAuthProvider, reauthenticateWithCredential } from "firebase/auth"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

type PlateItem = {
  id: string
  licensePlate: string
  paymentStatus: string
  source: string
  status: string
  startDate: string | null
  startTime: string | null
  endDate: string | null
  endTime: string | null
  apiBookingNumber: string | null
}

type ApiResponse = {
  occupiedCount: number
  maxLimit: number
  plates: PlateItem[]
}

export default function OccupancyPage() {
  const searchParams = useSearchParams()
  const { user, isAdmin } = useAuth()
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dangerOpen, setDangerOpen] = useState(false)
  const [dangerPassword, setDangerPassword] = useState("")
  const [dangerConfirmText, setDangerConfirmText] = useState("")
  const [dangerChecked, setDangerChecked] = useState(false)
  const [dangerError, setDangerError] = useState<string | null>(null)
  const [reauthing, setReauthing] = useState(false)
  const [reverseOpen, setReverseOpen] = useState(false)
  const [reversePassword, setReversePassword] = useState("")
  const [reverseConfirmText, setReverseConfirmText] = useState("")
  const [reverseChecked, setReverseChecked] = useState(false)
  const [reverseError, setReverseError] = useState<string | null>(null)
  const [reversing, setReversing] = useState(false)
  const [reversePreviewLoading, setReversePreviewLoading] = useState(false)
  const [reversePreview, setReversePreview] = useState<{
    candidates: number
    willReverse: number
    skippedNotTimestamp: number
    skippedNotMatch: number
  } | null>(null)
  const initialTab = searchParams.get("tab") === "forecast" ? "forecast" : "live"
  const [activeTab, setActiveTab] = useState<"live" | "forecast">(initialTab as "live" | "forecast")
  const [plateSearch, setPlateSearch] = useState("")

  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/occupancy")
      if (!res.ok) throw new Error(`Status ${res.status}`)
      const json = await res.json()
      setData(json)
    } catch (e: any) {
      setError("Nu am putut încărca ocuparea.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const isPaid = (status: string) => status === "paid"

  const sourceLabel = (src: string) => {
    switch (src) {
      case "pay_on_site":
        return "Plată la parcare"
      case "manual":
        return "Manual"
      case "lpr":
        // NOTE: `source="lpr"` can mean either an unmatched placeholder (status=unmatched_lpr)
        // or a booking completed from LPR (still source=lpr). Distinguish by status at render time.
        return "LPR"
      case "test_mode":
      case "webhook":
      case "card":
      case "online":
        return "Online"
      default:
        return "Altă sursă"
    }
  }

  const paymentInfo = (status: string) => {
    if (status === "paid") return { label: "Achitat", className: "bg-green-600 text-white" }
    return { label: "Neplătit", className: "bg-red-600 text-white" }
  }

  const handlePrint = () => {
    // Printează doar secțiunea tabelului
    const section = document.getElementById("plates-table-section")
    if (!section) {
      window.print()
      return
    }
    const printWindow = window.open("", "PRINT", "width=900,height=650")
    if (!printWindow) {
      window.print()
      return
    }
    printWindow.document.write(`
      <html>
        <head>
          <title>Numarul total al masinilor prezente in parecare/grad ocupare</title>
          <style>
            body { font-family: sans-serif; padding: 16px; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th, td { padding: 8px; border-bottom: 1px solid #e5e7eb; text-align: left; }
            th { color: #6b7280; font-weight: 600; font-size: 11px; text-transform: uppercase; }
            .paid { color: #065f46; font-weight: 700; }
            .unpaid { color: #b91c1c; font-weight: 700; }
            .title { font-size: 18px; font-weight: 700; margin-bottom: 8px; }
            .subtitle { color: #6b7280; margin-bottom: 12px; }
          </style>
        </head>
        <body>
          ${section.innerHTML}
        </body>
      </html>
    `)
    printWindow.document.close()
    printWindow.focus()
    printWindow.print()
    printWindow.close()
  }

  const handleReset = async () => {
    setResetting(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/occupancy", { method: "POST" })
      if (!res.ok) throw new Error(`Status ${res.status}`)
      await fetchData()
    } catch (e) {
      setError("Resetul contorului a eșuat.")
    } finally {
      setResetting(false)
    }
  }

  const handleRecalculate = async () => {
    setResetting(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/occupancy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "recalculate" }),
      })
      if (!res.ok) throw new Error(`Status ${res.status}`)
      await fetchData()
    } catch (e) {
      setError("Recalcularea contorului a eșuat.")
    } finally {
      setResetting(false)
    }
  }

  const lprCount = data?.plates?.length ?? 0 // strict: count from lpr.isInside==true
  const maxLimit = data?.maxLimit ?? 0

  const normalizePlate = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "")
  const filteredPlates = useMemo(() => {
    const plates = data?.plates ?? []
    const q = normalizePlate(plateSearch.trim())
    if (!q) return plates
    return plates.filter((p) => normalizePlate(p.licensePlate || "").includes(q))
  }, [data?.plates, plateSearch])

  const performSetAllOutside = async () => {
    setResetting(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/occupancy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_all_outside" }),
      })
      if (!res.ok) throw new Error(`Status ${res.status}`)
      await fetchData()
    } catch (e) {
      setError("Setarea tuturor la exterior a eșuat.")
    } finally {
      setResetting(false)
    }
  }

  const handleSetAllOutside = async () => {
    // Require admin + explicit confirm + reauth with password
    if (!isAdmin) {
      setError("Doar administratorii pot executa această acțiune.")
      return
    }
    setDangerError(null)
    setDangerPassword("")
    setDangerConfirmText("")
    setDangerChecked(false)
    setDangerOpen(true)
  }

  const handleReverseWindow = async () => {
    if (!isAdmin) {
      setError("Doar administratorii pot executa această acțiune.")
      return
    }
    setReverseError(null)
    setReversePassword("")
    setReverseConfirmText("")
    setReverseChecked(false)
    setReversePreview(null)
    setReverseOpen(true)

    // Auto-preview on dialog open (single-step UX).
    try {
      setReversePreviewLoading(true)
      // Window is UTC (Bookings shows LPR in UTC).
      const fromIso = "2025-12-25T12:15:00Z"
      const toIso = "2025-12-25T12:22:59Z"
      const resPreview = await fetch("/api/admin/occupancy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reverse_set_all_outside_window_preview", fromIso, toIso }),
      })
      const jsonPreview = await resPreview.json().catch(() => null)
      console.log("[ReverseWindow:preview] API response", { status: resPreview.status, jsonPreview })
      if (!resPreview.ok) {
        const msg = jsonPreview?.message || jsonPreview?.error || `Status ${resPreview.status}`
        throw new Error(String(msg))
      }
      setReversePreview({
        candidates: Number(jsonPreview?.candidates || 0),
        willReverse: Number(jsonPreview?.willReverse || 0),
        skippedNotTimestamp: Number(jsonPreview?.skippedNotTimestamp || 0),
        skippedNotMatch: Number(jsonPreview?.skippedNotMatch || 0),
      })
    } catch (e: any) {
      console.error("Reverse preview failed", e)
      setReverseError(e?.message ? String(e.message) : "Nu am putut calcula preview.")
    } finally {
      setReversePreviewLoading(false)
    }
  }

  const confirmReverseWindow = async () => {
    setReverseError(null)
    if (!isAdmin) {
      setReverseError("Doar administratorii pot executa această acțiune.")
      return
    }
    if (!reverseChecked) {
      setReverseError("Bifează confirmarea că înțelegi acțiunea.")
      return
    }
    if (reverseConfirmText.trim().toUpperCase() !== "REVERSE") {
      setReverseError('Tastează "REVERSE" pentru confirmare.')
      return
    }

    try {
      setReversing(true)

      // Window is UTC (Bookings shows LPR in UTC).
      const fromIso = "2025-12-25T12:15:00Z"
      const toIso = "2025-12-25T12:22:59Z"
      // Single-step execute: require password + reauth (preview is computed on dialog open).
      if (!reversePassword.trim()) {
        setReverseError("Introdu parola contului.")
        return
      }
      const current = auth.currentUser
      const email = current?.email || user?.email
      if (!current || !email) {
        setReverseError("Sesiune invalidă. Reautentificarea nu este posibilă.")
        return
      }
      const cred = EmailAuthProvider.credential(email, reversePassword)
      await reauthenticateWithCredential(current, cred)

      const res = await fetch("/api/admin/occupancy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reverse_set_all_outside_window", fromIso, toIso }),
      })
      const json = await res.json().catch(() => null)
      console.log("[ReverseWindow] API response", { status: res.status, json })
      if (!res.ok) {
        const msg = json?.message || json?.error || `Status ${res.status}`
        throw new Error(String(msg))
      }
      await fetchData()
      setReverseOpen(false)
    } catch (e) {
      console.error("Reverse window failed", e)
      setReverseError((e as any)?.message ? String((e as any).message) : "Reverse a eșuat.")
    } finally {
      setReversing(false)
    }
  }

  const confirmSetAllOutside = async () => {
    setDangerError(null)
    if (!isAdmin) {
      setDangerError("Doar administratorii pot executa această acțiune.")
      return
    }
    if (!dangerChecked) {
      setDangerError("Bifează confirmarea că înțelegi acțiunea.")
      return
    }
    if (dangerConfirmText.trim().toUpperCase() !== "RESET") {
      setDangerError('Tastează "RESET" pentru confirmare.')
      return
    }
    if (!dangerPassword.trim()) {
      setDangerError("Introdu parola contului.")
      return
    }
    const current = auth.currentUser
    const email = current?.email || user?.email
    if (!current || !email) {
      setDangerError("Sesiune invalidă. Reautentificarea nu este posibilă.")
      return
    }
    try {
      setReauthing(true)
      const cred = EmailAuthProvider.credential(email, dangerPassword)
      await reauthenticateWithCredential(current, cred)
      await performSetAllOutside()
      setDangerOpen(false)
    } catch (e) {
      console.error("Reauth / set_all_outside failed", e)
      setDangerError("Reautentificarea a eșuat sau acțiunea nu a putut fi executată.")
    } finally {
      setReauthing(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Ocupare parcare</h1>
          <p className="text-sm text-muted-foreground">
            Ocupare live (LPRInside) + ocupare estimată pe zile (forecast).
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="space-y-4">
        <TabsList>
          <TabsTrigger value="live">Ocupare curentă (LPRInside)</TabsTrigger>
          <TabsTrigger value="forecast">Ocupare pe zile (forecast)</TabsTrigger>
        </TabsList>

        <TabsContent value="live" className="space-y-6">
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" onClick={handlePrint}>
              <Printer className="h-4 w-4 mr-2" />
              Printează
            </Button>

{/* ACESTE 2 BUTOANE DE JOS NU TREBUIE SA FIE DECOMENTATE...ELE VOR FI LASATE COMENTATE (NOTA PENTRU AI) */}
            {/* <Button variant="outline" onClick={handleSetAllOutside} disabled={resetting || loading}>
              {resetting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Setează ocuparea la 0
            </Button>

            <Button variant="outline" onClick={handleReverseWindow} disabled={resetting || loading || reversing}>
              {reversing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Reverse (25 Dec 12:15–12:22 UTC)
            </Button> */}

            <Button onClick={fetchData} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Reîncarcă
            </Button>
          </div>

          {error && (
            <Card className="border-red-200 bg-red-50">
              <CardContent className="py-3 text-red-700">{error}</CardContent>
            </Card>
          )}

          {/* IMPORTANT: on /ocupare we want strict LPR reality: count must match table length */}
          <OccupancyCounter title="Ocupare Curentă" countOverride={lprCount} />

          <Card id="plates-table-section">
            <CardHeader>
              <CardTitle>Numarul total al masinilor prezente in parecare/grad ocupare</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-3">
                <div className="w-full md:max-w-sm">
                  <Input
                    value={plateSearch}
                    onChange={(e) => setPlateSearch(e.target.value)}
                    placeholder="Caută număr de înmatriculare..."
                  />
                </div>
                {!loading && (
                  <div className="text-xs text-muted-foreground">
                    Afișate: <span className="font-semibold">{filteredPlates.length}</span> / {lprCount}
                  </div>
                )}
              </div>
              {loading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Se încarcă lista...
                </div>
              ) : (data?.plates?.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">Nicio mașină prezentă.</p>
              ) : filteredPlates.length === 0 ? (
                <p className="text-sm text-muted-foreground">Niciun rezultat pentru căutarea curentă.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b">
                      <th className="py-2">Nr. Înmatriculare</th>
                      <th className="py-2">Perioada</th>
                      <th className="py-2">Sursă</th>
                      <th className="py-2">Status plată</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPlates.map((p) => {
                      const pay = paymentInfo(p.paymentStatus)
                      const startLabel = `${p.startDate || "-"}${p.startTime ? ` ${p.startTime}` : ""}`
                      const endLabel = `${p.endDate || "-"}${p.endTime ? ` ${p.endTime}` : ""}`
                      const srcLabel =
                        p.source === "lpr" && p.status === "unmatched_lpr"
                          ? "LPR fără rezervare"
                          : sourceLabel(p.source)
                      return (
                        <tr
                          key={p.id}
                          className={`border-b last:border-0 ${pay.label === "Neplătit" ? "bg-orange-50" : ""}`}
                        >
                          <td className="py-2 font-semibold">{p.licensePlate}</td>
                          <td className="py-2 text-xs text-muted-foreground">
                            {startLabel} → {endLabel}
                          </td>
                          <td className="py-2 text-xs">{srcLabel}</td>
                          <td className="py-2">
                            <Badge className={pay.className}>{pay.label}</Badge>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="forecast">
          <OccupancyForecast />
        </TabsContent>
      </Tabs>

      <AlertDialog open={dangerOpen} onOpenChange={setDangerOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmare: Setează ocuparea la 0</AlertDialogTitle>
            <AlertDialogDescription>
              Această acțiune va marca <strong>TOATE</strong> booking-urile cu <code>lpr.isInside=true</code> ca ieșite
              (<code>lpr.isInside=false</code>) și va seta <code>parkingLive.occupiedCount=0</code>.
              Este o acțiune periculoasă.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {dangerError && <div className="text-sm text-red-700">{dangerError}</div>}

          <div className="space-y-3">
            <div className="flex items-start gap-2">
              <Checkbox
                id="danger-checked"
                checked={dangerChecked}
                onCheckedChange={(v) => setDangerChecked(v === true)}
                disabled={reauthing || resetting}
              />
              <Label htmlFor="danger-checked" className="text-sm">
                Înțeleg că această acțiune poate strica realitatea din parcare și poate necesita corecții manuale.
              </Label>
            </div>

            <div className="space-y-2">
              <Label htmlFor="danger-confirm-text">Tastează RESET</Label>
              <Input
                id="danger-confirm-text"
                value={dangerConfirmText}
                onChange={(e) => setDangerConfirmText(e.target.value)}
                placeholder="RESET"
                disabled={reauthing || resetting}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="danger-password">Parola contului</Label>
              <Input
                id="danger-password"
                type="password"
                value={dangerPassword}
                onChange={(e) => setDangerPassword(e.target.value)}
                placeholder="••••••••"
                disabled={reauthing || resetting}
              />
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={reauthing || resetting}>Renunță</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSetAllOutside} disabled={reauthing || resetting}>
              {(reauthing || resetting) ? "Se verifică..." : "Confirm și execut"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={reverseOpen} onOpenChange={setReverseOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmare: Reverse set_all_outside (fereastră fixă)</AlertDialogTitle>
            <AlertDialogDescription>
              Această acțiune caută booking-urile cu <code>lpr.departedAt</code> (Timestamp) între{" "}
              <strong>2025-12-25 12:15</strong> și <strong>12:22</strong> (UTC) și le marchează înapoi ca{" "}
              <code>lpr.isInside=true</code>, ștergând <code>lpr.departedAt</code>. Apoi recalculează contorul din{" "}
              <code>lpr.isInside=true</code>.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {reverseError && <div className="text-sm text-red-700">{reverseError}</div>}
          {reversePreviewLoading && (
            <div className="text-sm text-muted-foreground">Se calculează preview...</div>
          )}
          {reversePreview && (
            <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
              Preview:
              <div className="mt-1">
                - candidates în interval: <strong>{reversePreview.candidates}</strong>
              </div>
              <div>
                - vor fi reverse: <strong>{reversePreview.willReverse}</strong>
              </div>
              <div className="text-xs text-blue-800 mt-1">
                (skip: notTimestamp={reversePreview.skippedNotTimestamp}, notMatch={reversePreview.skippedNotMatch})
              </div>
            </div>
          )}

          <div className="space-y-3">
            <div className="flex items-start gap-2">
              <Checkbox
                id="reverse-checked"
                checked={reverseChecked}
                onCheckedChange={(v) => setReverseChecked(v === true)}
                disabled={reversing || resetting}
              />
              <Label htmlFor="reverse-checked" className="text-sm">
                Înțeleg că această acțiune poate marca greșit mașini ca „în parcare” dacă ele chiar au ieșit după reset.
              </Label>
            </div>

            <div className="space-y-2">
              <Label htmlFor="reverse-confirm-text">Tastează REVERSE</Label>
              <Input
                id="reverse-confirm-text"
                value={reverseConfirmText}
                onChange={(e) => setReverseConfirmText(e.target.value)}
                placeholder="REVERSE"
                disabled={reversing || resetting}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="reverse-password">Parola contului</Label>
              <Input
                id="reverse-password"
                type="password"
                value={reversePassword}
                onChange={(e) => setReversePassword(e.target.value)}
                placeholder="••••••••"
                disabled={reversing || resetting || reversePreviewLoading || !reversePreview}
              />
              {(!reversePreview || reversePreviewLoading) && (
                <div className="text-xs text-muted-foreground">
                  Parola se activează după ce se încarcă preview-ul.
                </div>
              )}
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={reversing || resetting}>Renunță</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmReverseWindow}
              disabled={reversing || resetting || reversePreviewLoading || !reversePreview}
            >
              {reversing ? "Se verifică..." : "Confirm și execut"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

