"use client"
import { useEffect, type ReactNode, useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { useRouter, usePathname } from "next/navigation"
import { AuthProvider, useAuth } from "@/context/auth-context"
import { Button } from "@/components/ui/button"
import { LayoutDashboard, ListTree, LogOut, Tag, Car, Loader2, RefreshCw, Menu, ArrowLeftRight } from "lucide-react"

function AdminLayoutContent({ children }: { children: ReactNode }) {
  const { user, loading, isAdmin, signOut } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  console.log("[AdminLayoutContent] Rendering. Pathname:", pathname, "Loading:", loading, "User:", user, "IsAdmin:", isAdmin)

  useEffect(() => {
    console.log("[AdminLayoutContent] useEffect triggered. Pathname:", pathname, "Loading:", loading, "User:", user, "IsAdmin:", isAdmin)
    if (loading || pathname === "/admin/login") {
      console.log("[AdminLayoutContent] useEffect: Exiting early (loading or on login page).")
      return
    }
    if (!user) {
      console.log("[AdminLayoutContent] useEffect: No user and not on login page, redirecting to /admin/login.")
      router.push("/admin/login")
      return
    }
    
    // Redirect non-admin users trying to access admin-only pages
    if (user && !isAdmin && pathname !== "/admin/dashboard/bookings" && pathname !== "/admin/dashboard/entries-exits") {
      console.log("[AdminLayoutContent] useEffect: Non-admin user trying to access admin page, redirecting to bookings.")
      router.push("/admin/dashboard/bookings")
    }
  }, [user, loading, isAdmin, router, pathname])

  if (loading && pathname !== "/admin/login") {
    console.log("[AdminLayoutContent] Displaying global loader for admin area.")
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <p className="ml-3 text-lg">Se verifică autentificarea...</p>
      </div>
    )
  }

  // Modificat: Verifică dacă user este null *după* ce loading este false și nu suntem pe pagina de login
  // Aceasta este o măsură de siguranță, useEffect ar trebui să se ocupe de redirect.
  if (!user && !loading && pathname !== "/admin/login") {
    console.log(
      "[AdminLayoutContent] No user, not loading, not on login page. Returning null (should be redirected by useEffect).",
    )
    return null
  }

  if (pathname === "/admin/login") {
    console.log("[AdminLayoutContent] Rendering children directly for /admin/login.")
    return <>{children}</>
  }

  // Navigație pentru admin (doar dacă user-ul este logat și nu suntem pe pagina de login)
  if (user) {
    console.log("[AdminLayoutContent] User is authenticated, rendering admin dashboard layout.")
    
    // Define navigation items based on admin status
    const adminNavItems = isAdmin ? [
      { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/admin/dashboard/bookings", label: "Rezervări", icon: Car },
      { href: "/admin/dashboard/entries-exits", label: "Intrări/Ieșiri", icon: ArrowLeftRight },
      { href: "/admin/dashboard/statistics", label: "Statistici", icon: RefreshCw },
      { href: "/admin/dashboard/prices", label: "Prețuri", icon: Tag },
      { href: "/admin/dashboard/api-test", label: "Test API", icon: ListTree },
    ] : [
      { href: "/admin/dashboard/bookings", label: "Rezervări", icon: Car },
      { href: "/admin/dashboard/entries-exits", label: "Intrări/Ieșiri", icon: ArrowLeftRight },
    ]

    const SidebarContent = () => (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-center p-6 border-b">
          {/* Mobile logo for sidebar */}
          <Image
            src="/otp_parking.png"
            alt="OTP Parking Logo"
            width={120}
            height={48}
            className="h-8 w-auto md:hidden"
          />
          {/* Desktop logo for sidebar */}
          <Image
            src="/otp_parking.png"
            alt="OTP Parking Logo"
            width={120}
            height={48}
            className="hidden md:block h-8 w-auto"
          />
        </div>
        <nav className="flex-1 px-4 py-6 space-y-2">
          {adminNavItems.map((item) => {
            const Icon = item.icon
            const isActive = pathname === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center px-4 py-3 text-sm font-medium rounded-lg transition-colors ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-gray-700 hover:bg-gray-100 hover:text-gray-900"
                }`}
                onClick={() => setMobileNavOpen(false)}
              >
                <Icon className="mr-3 h-5 w-5" />
                {item.label}
              </Link>
            )
          })}
        </nav>
        <div className="p-4 border-t">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm">
              <p className="font-medium text-gray-900">{user.email}</p>
              <p className="text-gray-500">{isAdmin ? "Administrator" : "Utilizator"}</p>
            </div>
          </div>
          <Button
            onClick={signOut}
            variant="outline"
            size="sm"
            className="w-full justify-start"
          >
            <LogOut className="mr-2 h-4 w-4" />
            Deconectare
          </Button>
        </div>
      </div>
    )

    return (
      <div className="flex h-screen bg-gray-100">
        {/* Desktop Sidebar */}
        <div className="hidden md:flex md:w-64 md:flex-col">
          <div className="flex flex-col flex-grow bg-white shadow-sm">
            <SidebarContent />
          </div>
        </div>

        {/* Mobile Sidebar */}
        {mobileNavOpen && (
          <div className="fixed inset-0 z-50 md:hidden">
            <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setMobileNavOpen(false)} />
            <div className="fixed left-0 top-0 bottom-0 w-64 bg-white shadow-lg">
              <SidebarContent />
            </div>
          </div>
        )}

        {/* Main Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Mobile Header */}
          <div className="md:hidden bg-white shadow-sm border-b px-4 py-3 flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMobileNavOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>
            <Image
              src="/otp_parking.png"
              alt="OTP Parking Logo"
              width={100}
              height={40}
              className="h-6 w-auto"
            />
            <div className="w-8" /> {/* Spacer */}
          </div>

          {/* Page Content */}
          <main className="flex-1 overflow-auto bg-gray-50 p-6">
            {children}
          </main>
        </div>
      </div>
    )
  }

  return null
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  console.log("[AdminLayout] Rendering. Wrapping children with AuthProvider.")
  return (
    <AuthProvider>
      <AdminLayoutContent>{children}</AdminLayoutContent>
    </AuthProvider>
  )
}
