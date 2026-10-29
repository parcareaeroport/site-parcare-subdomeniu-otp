"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { useAuth } from "@/context/auth-context"
import { adminAuthorizedFetch } from "@/lib/admin-authorized-fetch"
import type { ParkingFullSummary } from "@/lib/parking-full-summary"

export default function ParkingFullBanner() {
  const { user, role, loading } = useAuth()
  const pathname = usePathname()
  const active = !loading && !!user && !!role && pathname.startsWith("/admin/") && pathname !== "/admin/login"
  // Scope results to their account so a switch cannot briefly display another user's result.
  const owner = active ? `${user!.uid}:${role}` : null
  const [state, setState] = useState<{ owner: string; summary?: ParkingFullSummary; error?: boolean } | null>(null)

  useEffect(() => {
    if (!active || !user || !owner) return
    let cancelled = false
    let controller: AbortController | undefined
    const refresh = async () => {
      controller?.abort()
      const request = new AbortController()
      controller = request
      try {
        const response = await adminAuthorizedFetch("/api/admin/parking-full-summary", user, {
          cache: "no-store", signal: request.signal,
        })
        if (!response.ok) throw new Error("Summary unavailable")
        const summary: ParkingFullSummary = await response.json()
        if (!cancelled && !request.signal.aborted) setState({ owner, summary })
      } catch {
        if (!cancelled && !request.signal.aborted) setState({ owner, error: true })
      }
    }
    void refresh()
    const timer = setInterval(refresh, 5 * 60 * 1000)
    return () => { cancelled = true; controller?.abort(); clearInterval(timer) }
  }, [active, user, owner])

  if (!owner || state?.owner !== owner) return null
  if (state.error) return <div role="alert" className="shrink-0 bg-amber-100 px-4 py-2 text-center text-sm text-amber-950">Avertizarea de ocupare nu poate fi actualizată</div>
  const days = state.summary?.warningDays ?? []
  if (!days.length) return null
  const shown = days.slice(0, 5).map(date => date.split("-").reverse().join("."))
  const remaining = days.length - shown.length
  return (
    <div role="status" className="sticky top-0 z-40 w-full shrink-0 bg-red-600 text-white">
      <div className="mx-auto max-w-7xl px-4 py-2 text-center text-sm font-semibold">
        Atenție: conform estimării, în următoarele 30 de zile rămân cel mult 5 locuri disponibile în {shown.join(", ")}{remaining > 0 ? ` (+${remaining} zile)` : ""}.{" "}
        {(role === "admin" || role === "employee") && (
          <Link href="/admin/dashboard/ocupare?tab=forecast" className="underline underline-offset-2">Vezi mai multe aici</Link>
        )}
      </div>
    </div>
  )
}
