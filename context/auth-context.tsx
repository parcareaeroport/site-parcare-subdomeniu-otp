"use client"
import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { onAuthStateChanged, type User, signOut as firebaseSignOut } from "firebase/auth"
import { auth } from "@/lib/firebase"
import { useRouter } from "next/navigation"

interface AuthContextType {
  user: User | null
  loading: boolean
  isAdmin: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  // Check if user is admin based on email
  const isAdmin = user?.email === "contact.parcareaeroport@gmail.com"

  console.log("[AuthProvider] Initializing. Current state - loading:", loading, "user:", user, "isAdmin:", isAdmin)

  useEffect(() => {
    console.log("[AuthProvider] useEffect triggered. Subscribing to onAuthStateChanged.")

    // Verifică dacă 'auth' este valid înainte de a subscrie
    if (!auth) {
      console.error("[AuthProvider] Firebase auth instance is not available. Cannot subscribe to onAuthStateChanged.")
      setLoading(false) // Oprește încărcarea dacă auth nu e valid
      return
    }

    const unsubscribe = onAuthStateChanged(
      auth,
      (currentUser) => {
        console.log("[AuthProvider] onAuthStateChanged callback. currentUser:", currentUser)
        setUser(currentUser)
        setLoading(false)
      },
      (error) => {
        console.error("[AuthProvider] Error in onAuthStateChanged subscription:", error)
        setUser(null) // Resetează userul în caz de eroare
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
      router.push("/admin/login")
    } catch (error) {
      console.error("[AuthProvider] Error signing out: ", error)
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, isAdmin, signOut }}>
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
