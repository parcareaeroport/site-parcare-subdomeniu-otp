"use client"

import type React from "react"
import { useEffect, useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import { BarChart3, Calendar, DollarSign, Wrench } from "lucide-react"

interface DashboardLayoutProps {
  children: React.ReactNode
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  // Autentificarea este gestionată de AuthContext în layout-ul principal admin
  // Acest layout nu mai face verificări de autentificare
  return <>{children}</>
}
