"use client"

import { useEffect, useRef, useState } from "react"
import { AlertCircle, Loader2 } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import type { CancellationPreview, CancellationResult } from "@/lib/booking-cancellation-types"

export type CancellationBooking = {
  id: string
  apiBookingNumber?: string
  licensePlate: string
  clientEmail?: string
}

type Props = {
  open: boolean
  booking: CancellationBooking
  request: (url: string, init?: RequestInit) => Promise<Response>
  onOpenChange: (open: boolean) => void
  onCancelled: (result: CancellationResult, reason: string) => Promise<void> | void
}

export function BookingCancellationDialog({ open, booking, request, onOpenChange, onCancelled }: Props) {
  const [preview, setPreview] = useState<CancellationPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [previewError, setPreviewError] = useState("")
  const [submitError, setSubmitError] = useState("")
  const [reason, setReason] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const submittingRef = useRef(false)

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setPreview(null)
    setPreviewError("")
    setLoading(true)
    async function load() {
      try {
        const response = await request(`/api/admin/bookings/cancel-preview?bookingId=${encodeURIComponent(booking.id)}`, {
          method: "GET", cache: "no-store", signal: controller.signal,
        })
        const data = await response.json().catch(() => { throw new Error("Nu am putut verifica punctele. Reîncercați.") })
        if (!response.ok) throw new Error(data.error || "Nu am putut verifica punctele.")
        if (!controller.signal.aborted) setPreview(data)
      } catch (error) {
        if (!controller.signal.aborted) setPreviewError(error instanceof Error ? error.message : "Nu am putut verifica punctele.")
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void load()
    return () => controller.abort()
  }, [open, booking.id, request, attempt])

  const ready = !loading && !previewError && preview?.bookingId === booking.id && preview.canConfirm
  const loyalty = preview?.loyalty

  async function confirm() {
    if (!ready || submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    setSubmitError("")
    try {
      const response = await request("/api/admin/bookings/cancel", {
        method: "POST", body: JSON.stringify({ bookingId: booking.id, reason: reason.trim() || undefined }),
      })
      const result = await response.json().catch(() => { throw new Error("Nu am putut confirma rezultatul anulării. Reîncercați verificarea.") })
      if (!response.ok) {
        // Refresh the balance and any reconciliation block before another attempt.
        setPreview(null)
        setAttempt(value => value + 1)
        throw new Error(result.error || "Nu am putut anula rezervarea.")
      }
      await onCancelled(result, reason.trim())
      onOpenChange(false)
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Nu am putut anula rezervarea.")
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={next => { if (!submittingRef.current) onOpenChange(next) }}>
      <AlertDialogContent className="max-h-[90vh] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>Anulezi rezervarea?</AlertDialogTitle>
          <AlertDialogDescription>
            După anulare, rezervarea nu va mai apărea în Intrări/Ieșiri și statusul va fi marcat ca ANULATĂ.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-4">
          <div className="text-sm text-gray-700">
            <div><strong>Nr. API / ID:</strong> {booking.apiBookingNumber || booking.id}</div>
            <div><strong>Nr. înmatriculare:</strong> {booking.licensePlate}</div>
            <div><strong>Email client:</strong> {booking.clientEmail || "-"}</div>
          </div>
          {loading ? (
            <div role="status" className="flex items-center gap-2 rounded-md bg-gray-50 p-4 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Se verifică punctele clientului…
            </div>
          ) : previewError ? (
            <Alert variant="destructive">
              <AlertTitle>Verificarea punctelor a eșuat</AlertTitle>
              <AlertDescription>{previewError}</AlertDescription>
              <Button type="button" variant="outline" className="mt-3" onClick={() => setAttempt(value => value + 1)}>Reîncearcă</Button>
            </Alert>
          ) : loyalty ? (
            <Alert className="border-amber-300 bg-amber-50 text-amber-950">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              <AlertTitle>Atenție: modificarea punctelor</AlertTitle>
              <AlertDescription className="space-y-2">
                {loyalty.status === "needs_review" ? (
                  <p>Punctele necesită verificare manuală. Soldul după anulare nu poate fi stabilit sigur.</p>
                ) : loyalty.before && loyalty.after ? (
                  <>
                    <p><strong>{loyalty.clientLabel}</strong> are <strong>{loyalty.before.points} {loyalty.before.points === 1 ? "punct" : "puncte"}</strong>. După anularea acestei rezervări va avea <strong>{loyalty.after.points} {loyalty.after.points === 1 ? "punct" : "puncte"}</strong>.</p>
                    {loyalty.pointsRemoved === 0 && <p>Soldul de puncte nu scade pentru această anulare.</p>}
                    {loyalty.before.freeDaysAvailable !== loyalty.after.freeDaysAvailable && (
                      <p>Zile gratuite disponibile: <strong>{loyalty.before.freeDaysAvailable} → {loyalty.after.freeDaysAvailable}</strong>.</p>
                    )}
                    {loyalty.pointsToRecoverAdded > 0 && (
                      <p>Se {loyalty.pointsToRecoverAdded === 1 ? "va recupera" : "vor recupera"} <strong>{loyalty.pointsToRecoverAdded} {loyalty.pointsToRecoverAdded === 1 ? "punct" : "puncte"}</strong> din rezervările viitoare.</p>
                    )}
                    {loyalty.freeDaysReturned > 0 && <p>Ziua gratuită folosită pentru această rezervare va fi returnată înainte de recalcularea progresului.</p>}
                  </>
                ) : <p>Această rezervare nu are un punct de retras. Soldul nu scade.</p>}
                {loyalty.basis === "legacy_eligibility" && loyalty.status === "reversed" && <p className="text-xs">Pentru această rezervare veche, corecția se bazează pe eligibilitatea înregistrată.</p>}
                <p className="text-xs">Sold la momentul verificării. La confirmare se recalculează folosind datele actuale.</p>
              </AlertDescription>
            </Alert>
          ) : null}
          {preview?.blockingMessage && (
            <Alert variant="destructive">
              <AlertTitle>Anularea necesită verificare</AlertTitle>
              <AlertDescription>{preview.blockingMessage}</AlertDescription>
              <Button type="button" variant="outline" className="mt-3" disabled={submitting} onClick={() => setAttempt(value => value + 1)}>Reverifică</Button>
            </Alert>
          )}
          {preview && !preview.blockingMessage && <p className="text-xs text-gray-500">{preview.multiparkRequired ? "Se va anula și în Multipark, apoi local." : "Anularea se va face în sistemul local."}</p>}
          <div className="space-y-2">
            <Label htmlFor="cancel-reason">Motiv anulare (opțional)</Label>
            <Input id="cancel-reason" value={reason} onChange={event => setReason(event.target.value)} disabled={submitting} maxLength={1000} placeholder="Ex: Clientul a solicitat anularea" />
          </div>
          {submitError && <Alert variant="destructive"><AlertTitle>Anularea nu a fost finalizată</AlertTitle><AlertDescription>{submitError}</AlertDescription></Alert>}
        </div>
        <AlertDialogFooter>
          <Button type="button" variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>Renunță</Button>
          <Button type="button" variant="destructive" disabled={!ready || submitting} onClick={() => void confirm()}>
            {submitting ? "Se anulează…" : "Anulează"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
