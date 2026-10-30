"use client"

import { useEffect, useRef, useState } from "react"
import { useAuth } from "@/context/auth-context"
import { adminAuthorizedFetch } from "@/lib/admin-authorized-fetch"
import type { BookingDeletionContext, BookingDeletionResult } from "@/lib/booking-deletion-contract"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"

export function BookingDeletionDialog({ bookingId, onClose, onDeleted }: {
  bookingId: string; onClose: () => void; onDeleted: (result: BookingDeletionResult) => Promise<void>
}) {
  const { user } = useAuth()
  const [context, setContext] = useState<BookingDeletionContext | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [error, setError] = useState("")
  const [reload, setReload] = useState(0)
  const requestId = useRef("")
  const inFlight = useRef(false)
  const request = (body: object, signal?: AbortSignal) => adminAuthorizedFetch("/api/admin/bookings/delete", user, {
    method: "POST", body: JSON.stringify(body), cache: "no-store", signal,
  })

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setContext(null); setError(""); setConflict(false); setConfirmed(false)
    requestId.current = crypto.randomUUID()
    void (async () => {
      try {
        const response = await adminAuthorizedFetch("/api/admin/bookings/delete", user, {
          method: "POST", body: JSON.stringify({ action: "prepare", bookingId }), cache: "no-store", signal: controller.signal,
        })
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || "Verificarea nu a reușit.")
        if (!controller.signal.aborted) setContext(body)
      } catch (e) {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Verificarea nu a reușit.")
      } finally { if (!controller.signal.aborted) setLoading(false) }
    })()
    return () => controller.abort()
  }, [bookingId, user, reload])

  const save = async () => {
    if (!context || inFlight.current || completed || conflict || context.blockedReason || context.inside && !confirmed) return
    inFlight.current = true
    setSaving(true); setError("")
    try {
      const response = await request({ action: "save", bookingId, version: context.version,
        requestId: requestId.current, confirmNotPresent: confirmed })
      const body = await response.json()
      if (!response.ok) {
        if (["CONTEXT_CHANGED", "DELETE_REQUIRES_REVIEW", "NOT_FOUND", "REQUEST_REUSED", "INVALID_REQUEST"].includes(body.code)) setConflict(true)
        throw new Error(body.error || "Ștergerea nu a fost efectuată.")
      }
      setCompleted(true)
      try { await onDeleted(body) } catch {
        setError("Rezervarea a fost ștearsă, dar lista nu s-a actualizat. Închide dialogul și reîncarcă pagina.")
        return
      }
      onClose()
    } catch (e) { setError(e instanceof Error ? e.message : "Ștergerea nu a fost efectuată.") }
    finally { inFlight.current = false; setSaving(false) }
  }

  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose() }}>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[580px]">
      <DialogHeader>
        <DialogTitle>Ștergi rezervarea?</DialogTitle>
        <DialogDescription>Rezervarea dispare din lista activă. Istoricul se păstrează în arhivă pentru verificări.</DialogDescription>
      </DialogHeader>
      {loading && <p role="status">Se verifică rezervarea și prezența...</p>}
      {error && <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {context && <div className="space-y-3 text-sm">
        <p><strong>Număr auto:</strong> {context.booking.licensePlate}</p>
        <p><strong>Perioada:</strong> {context.booking.startDate || "?"} {context.booking.startTime || "?"} → {context.booking.endDate || "?"} {context.booking.endTime || "?"}</p>
        <p className="break-all"><strong>ID:</strong> {context.booking.id}</p>
        {context.blockedReason ? <p role="alert" className="rounded border border-amber-400 bg-amber-50 p-3">{context.blockedReason}</p>
          : context.inside ? <div className="space-y-3 rounded border border-amber-400 bg-amber-50 p-3">
            <p>Mașina apare prezentă. Continuă numai după verificarea fizică. Operația o scoate din evidența ocupării și arhivează rezervarea.</p>
            <div className="flex items-start gap-2">
              <Checkbox id="delete-confirm-absent" checked={confirmed} disabled={saving || conflict || completed}
                onCheckedChange={value => { setConfirmed(value === true); requestId.current = crypto.randomUUID() }} />
              <Label htmlFor="delete-confirm-absent" className="leading-relaxed">Confirm că mașina nu mai este fizic în parcare.</Label>
            </div>
          </div> : <p>Rezervarea nu ocupă un loc. Ștergerea nu modifică ocuparea.</p>}
      </div>}
      {!completed && !saving && (conflict || !context && !loading || context?.blockedReason) &&
        <Button variant="outline" onClick={() => setReload(v => v + 1)}>Reîncarcă verificarea</Button>}
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>{completed ? "Închide" : "Renunță"}</Button>
        {!completed && <Button variant="destructive" onClick={save}
          disabled={loading || saving || conflict || !context || !!context.blockedReason || context.inside && !confirmed}>
          {saving ? "Se șterge..." : context?.inside ? "Scoate din evidență și șterge" : "Șterge"}
        </Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
