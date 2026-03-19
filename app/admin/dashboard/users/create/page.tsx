"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Loader2, ShieldAlert, UserPlus } from "lucide-react"
import { useAuth } from "@/context/auth-context"
import { adminAuthorizedFetch } from "@/lib/admin-authorized-fetch"

export default function CreateEmployeePage() {
  const { user, loading, isAdmin } = useAuth()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError("")
    setSuccess("")

    if (!isAdmin) {
      setError("Doar administratorii pot crea conturi de angajat.")
      return
    }

    setSaving(true)
    try {
      const response = await adminAuthorizedFetch("/api/admin/users/create", user, {
        method: "POST",
        body: JSON.stringify({
          name,
          email,
          password,
        }),
      })

      const json = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(json?.error || `HTTP ${response.status}`)
      }

      setSuccess(`Contul pentru ${json?.user?.email || email} a fost creat cu succes.`)
      setName("")
      setEmail("")
      setPassword("")
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Nu am putut crea contul angajatului.")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>Se verifică permisiunile...</span>
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <Alert variant="destructive">
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>Acces restricționat</AlertTitle>
        <AlertDescription>Pagina de creare conturi este disponibilă doar pentru administratori.</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Creare cont angajat Entries/Exits
          </CardTitle>
          <CardDescription>
            Contul nou primește automat rolul de operator Intrări/Ieșiri și va putea accesa doar pagina
            ` Entries/Exits`.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {error ? (
            <Alert variant="destructive">
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>Crearea contului a eșuat</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {success ? (
            <Alert>
              <UserPlus className="h-4 w-4" />
              <AlertTitle>Cont creat</AlertTitle>
              <AlertDescription>{success}</AlertDescription>
            </Alert>
          ) : null}

          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="employee-name">Nume angajat</Label>
              <Input
                id="employee-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ex: Ion Popescu"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="employee-email">Email</Label>
              <Input
                id="employee-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="angajat@exemplu.ro"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="employee-password">Parolă inițială</Label>
              <Input
                id="employee-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Minimum 6 caractere"
                minLength={6}
                required
              />
            </div>

            <Button type="submit" disabled={saving} className="w-full sm:w-auto">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Creează contul
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
