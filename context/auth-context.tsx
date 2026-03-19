"use client"
import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { getIdTokenResult, onIdTokenChanged, type User, signOut as firebaseSignOut } from "firebase/auth"
import { auth } from "@/lib/firebase"
import { useRouter } from "next/navigation"
import { getDefaultAdminRoute, normalizeAdminRole, type AdminRole } from "@/lib/admin-roles"

interface AuthContextType {
  user: User | null
  loading: boolean
  role: AdminRole | null
  isAdmin: boolean
  defaultRoute: string
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [role, setRole] = useState<AdminRole | null>(null)
  const router = useRouter()
  const isAdmin = role === "admin"
  const defaultRoute = role ? getDefaultAdminRoute(role) : "/admin/login"

  console.log("[AuthProvider] Initializing. Current state - loading:", loading, "user:", user, "role:", role)

  useEffect(() => {
    console.log("[AuthProvider] useEffect triggered. Subscribing to onIdTokenChanged.")

    // Verifică dacă 'auth' este valid înainte de a subscrie
    if (!auth) {
      console.error("[AuthProvider] Firebase auth instance is not available. Cannot subscribe to onAuthStateChanged.")
      setRole(null)
      setLoading(false) // Oprește încărcarea dacă auth nu e valid
      return
    }

    const unsubscribe = onIdTokenChanged(
      auth,
      async (currentUser) => {
        console.log("[AuthProvider] onAuthStateChanged callback. currentUser:", currentUser)
        setUser(currentUser)
        if (currentUser) {
          try {
            const tokenResult = await getIdTokenResult(currentUser)
            setRole(normalizeAdminRole(tokenResult.claims.role, currentUser.email))
          } catch (error) {
            console.error("[AuthProvider] Failed to resolve role from token, falling back.", error)
            setRole(normalizeAdminRole(undefined, currentUser.email))
          }
        } else {
          setRole(null)
        }
        setLoading(false)
      },
      (error) => {
        console.error("[AuthProvider] Error in onAuthStateChanged subscription:", error)
        setUser(null) // Resetează userul în caz de eroare
        setRole(null)
        setLoading(false)
      },
    )

    return () => {
      console.log("[AuthProvider] Cleanup useEffect. Unsubscribing from onAuthStateChanged.")
      unsubscribe()
    }
  }, []) // Dependențe goale, rulează o singură dată la montare

  const signOut = async () => {
    console.log("[AuthProvider] signOut called.")
    try {
      if (!auth) {
        console.error("[AuthProvider] Firebase auth instance is not available for signOut.")
        return
      }
      await firebaseSignOut(auth)
      console.log("[AuthProvider] Firebase signOut successful.")
      setUser(null) // Asigură-te că starea locală este actualizată imediat
      setRole(null)
      router.push("/admin/login")
    } catch (error) {
      console.error("[AuthProvider] Error signing out: ", error)
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, role, isAdmin, defaultRoute, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
