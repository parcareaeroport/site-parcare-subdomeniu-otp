"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/context/auth-context"

export default function AdminRedirect() {
  const router = useRouter()
  const { user, loading, isAdmin } = useAuth()

  useEffect(() => {
    if (loading) return // Așteaptă până când autentificarea este verificată
    
    if (user) {
      // Redirect based on admin status
      if (isAdmin) {
        router.push("/admin/dashboard")
      } else {
        router.push("/admin/dashboard/bookings")
      }
    } else {
      router.push("/admin/login")
    }
  }, [user, loading, isAdmin, router])

  if (loading) {
    return <div>Se verifică autentificarea...</div>
  }

  return null
}
