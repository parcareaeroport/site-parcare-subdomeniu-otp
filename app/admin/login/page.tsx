"use client"

import type React from "react"
import { useState, useEffect } from "react" // Adaugă useEffect pentru log
import { useRouter } from "next/navigation"
import Image from "next/image"
import { signInWithEmailAndPassword } from "firebase/auth"
import { auth } from "@/lib/firebase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertCircle } from "lucide-react"

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  // Log la montarea componentei
  useEffect(() => {
    console.log("[LoginPage] Component mounted.")
    if (!auth) {
      console.error("[LoginPage] Firebase auth instance is NOT available on mount!")
      setError("Eroare critică de configurare Firebase. Contactați administratorul.")
    } else {
      console.log("[LoginPage] Firebase auth instance IS available on mount.")
    }
  }, [])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    console.log("[LoginPage] handleLogin called. Email:", email)
    setIsLoading(true)
    setError("")

    if (!auth) {
      console.error("[LoginPage] Firebase auth instance is not available for login.")
      setError("Eroare de configurare Firebase. Nu se poate autentifica.")
      setIsLoading(false)
      return
    }

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password)
      console.log("[LoginPage] Firebase signInWithEmailAndPassword successful.")
      
      // Redirect based on admin status
      const isAdmin = userCredential.user.email === "contact.parcareaeroport@gmail.com"
      if (isAdmin) {
        router.push("/admin/dashboard")
      } else {
        router.push("/admin/dashboard/bookings")
      }
    } catch (err: any) {
      console.error("[LoginPage] Firebase login error:", err)
      if (
        err.code === "auth/invalid-credential" ||
        err.code === "auth/user-not-found" ||
        err.code === "auth/wrong-password" ||
        err.code === "auth/invalid-email" // Adăugat pentru validare mai bună
      ) {
        setError("Email sau parolă invalidă.")
      } else if (err.code === "auth/too-many-requests") {
        setError("Prea multe încercări eșuate. Încercați din nou mai târziu.")
      } else if (err.code === "auth/network-request-failed") {
        setError("Eroare de rețea. Verificați conexiunea la internet.")
      } else {
        setError("A apărut o eroare la autentificare. Încercați din nou.")
      }
    } finally {
      setIsLoading(false)
    }
  }

  console.log("[LoginPage] Rendering component. Error state:", error, "IsLoading state:", isLoading)

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="w-full max-w-md p-8 space-y-8 bg-white rounded-xl shadow-lg">
        <div className="text-center">
          <div className="flex justify-center mb-4">
            {/* Mobile logo */}
            <Image
              src="/otp_parking.png"
              alt="OTP Parking Logo"
              width={150}
              height={60}
              className="h-12 w-auto md:hidden"
            />
            {/* Desktop logo */}
            <Image
              src="/otp_parking.png"
              alt="OTP Parking Logo"
              width={150}
              height={60}
              className="hidden md:block h-12 w-auto"
            />
          </div>
          <p className="mt-2 text-gray-600">Panou de administrare</p>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <form className="mt-8 space-y-6" onSubmit={handleLogin}>
          <div className="space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="mt-1"
                placeholder="Introduceți adresa de email"
              />
            </div>

            <div>
              <Label htmlFor="password">Parolă</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="mt-1"
                placeholder="Introduceți parola"
              />
            </div>
          </div>

          <div>
            <Button type="submit" className="w-full gradient-bg" disabled={isLoading}>
              {isLoading ? "Se procesează..." : "Autentificare"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
