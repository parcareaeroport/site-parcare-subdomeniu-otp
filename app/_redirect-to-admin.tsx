"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"

export default function RedirectToAdmin() {
  const router = useRouter()

  useEffect(() => {
    router.replace("/admin")
  }, [router])

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Se redirecționează către Admin…
      </div>
    </div>
  )
}


