"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Loader2, Printer, RefreshCw, Info } from "lucide-react"
import { OccupancyCounter } from "@/components/admin/occupancy-counter"

type PlateItem = {
  id: string
  licensePlate: string
  paymentStatus: string
  source: string
  status: string
  startDate: string | null
  startTime: string | null
  apiBookingNumber: string | null
}

type ApiResponse = {
  occupiedCount: number
  maxLimit: number
  plates: PlateItem[]
}

export default function OccupancyPage() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
        return "LPR fără rezervare"
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

  const lprCount = data?.plates?.length ?? 0
  const liveCount = lprCount // folosim direct numărul din LPR isInside
  const maxLimit = data?.maxLimit ?? 0

  const handleSetAllOutside = async () => {
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Ocupare parcare</h1>
          <p className="text-sm text-muted-foreground">
            Total mașini prezente (bazat pe LPR isInside) + listă printabilă cu status plată.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-2" />
            Printează
          </Button>
          <Button variant="outline" onClick={handleSetAllOutside} disabled={resetting || loading}>
            {resetting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Setează toate isInside=false
          </Button>
          <Button variant="destructive" onClick={handleReset} disabled={resetting || loading}>
            {resetting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Reset contor la 0 (azi)
          </Button>
          <Button onClick={fetchData} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Reîncarcă
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="py-3 text-red-700">{error}</CardContent>
        </Card>
      )}

      <OccupancyCounter 
        title="Ocupare Curentă" 
        showProgress={true}
      />

      <Card id="plates-table-section">
        <CardHeader>
          <CardTitle>Numarul total al masinilor prezente in parecare/grad ocupare</CardTitle>
       
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Se încarcă lista...
            </div>
          ) : (data?.plates?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">Nicio mașină prezentă.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b">
                  <th className="py-2">Nr. Înmatriculare</th>
                  <th className="py-2">Start</th>
                  <th className="py-2">Sursă</th>
                  <th className="py-2">Status plată</th>
                </tr>
              </thead>
              <tbody>
                {data?.plates?.map((p) => {
                  const pay = paymentInfo(p.paymentStatus)
                  return (
                    <tr
                      key={p.id}
                      className={`border-b last:border-0 ${pay.label === "Neplătit" ? "bg-orange-50" : ""}`}
                    >
                      <td className="py-2 font-semibold">{p.licensePlate}</td>
                      <td className="py-2 text-xs text-muted-foreground">
                        {p.startDate || "-"} {p.startTime || ""}
                      </td>
                      <td className="py-2 text-xs">{sourceLabel(p.source)}</td>
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
    </div>
  )
}

