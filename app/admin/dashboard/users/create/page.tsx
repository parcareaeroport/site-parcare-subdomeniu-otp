"use client"

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Loader2, Plus, ShieldAlert, UserPlus } from "lucide-react"
import { useAuth } from "@/context/auth-context"
import { adminAuthorizedFetch } from "@/lib/admin-authorized-fetch"

type EntriesUser = {
  uid: string
  name: string
  email: string
  active: boolean
  createdAt: string | null
  createdByEmail: string | null
}

function generateTemporaryPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%"
  let password = ""

  for (let index = 0; index < 12; index += 1) {
    const randomIndex = Math.floor(Math.random() * alphabet.length)
    password += alphabet[randomIndex]
  }

  return password
}

function formatDate(value: string | null) {
  if (!value) {
    return "-"
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return "-"
  }

  return new Intl.DateTimeFormat("ro-RO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

export default function CreateEmployeePage() {
  const { user, loading, isAdmin } = useAuth()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [error, setError] = useState("")
  const [listError, setListError] = useState("")
  const [resetError, setResetError] = useState("")
  const [success, setSuccess] = useState("")
  const [actionLoadingUid, setActionLoadingUid] = useState<string | null>(null)
  const [toggleTargetUser, setToggleTargetUser] = useState<EntriesUser | null>(null)
  const [toggleTargetActive, setToggleTargetActive] = useState(false)
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false)
  const [resetTargetUser, setResetTargetUser] = useState<EntriesUser | null>(null)
  const [resetPassword, setResetPassword] = useState("")
  const [resetSaving, setResetSaving] = useState(false)
  const [users, setUsers] = useState<EntriesUser[]>([])

  const loadUsers = useCallback(async () => {
    if (!isAdmin || !user) {
      return
    }

    setLoadingUsers(true)
    setListError("")
    try {
      const response = await adminAuthorizedFetch("/api/admin/users/create", user)
      const json = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(json?.error || `HTTP ${response.status}`)
      }

      setUsers(Array.isArray(json?.users) ? json.users : [])
    } catch (loadError) {
      setListError(loadError instanceof Error ? loadError.message : "Nu am putut încărca lista de conturi.")
    } finally {
      setLoadingUsers(false)
    }
  }, [isAdmin, user])

  useEffect(() => {
    if (loading || !isAdmin || !user) {
      return
    }

    void loadUsers()
  }, [loading, isAdmin, user, loadUsers])

  const openToggleDialog = (entryUser: EntriesUser) => {
    setToggleTargetUser(entryUser)
    setToggleTargetActive(!entryUser.active)
  }

  const confirmToggleActive = async () => {
    const entryUser = toggleTargetUser
    const nextActive = toggleTargetActive

    if (!entryUser) {
      return
    }

    if (!user) {
      setListError("Trebuie să fiți autentificat pentru această acțiune.")
      return
    }

    setListError("")
    setSuccess("")
    setActionLoadingUid(entryUser.uid)

    try {
      const response = await adminAuthorizedFetch("/api/admin/users/create", user, {
        method: "PATCH",
        body: JSON.stringify({
          uid: entryUser.uid,
          active: nextActive,
        }),
      })

      const json = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(json?.error || `HTTP ${response.status}`)
      }

      setSuccess(`Contul ${entryUser.email} a fost ${nextActive ? "activat" : "dezactivat"}.`)
      await loadUsers()
    } catch (toggleError) {
      setListError(toggleError instanceof Error ? toggleError.message : "Nu am putut actualiza statusul contului.")
    } finally {
      setActionLoadingUid(null)
      setToggleTargetUser(null)
    }
  }

  const openResetDialog = (entryUser: EntriesUser) => {
    setResetTargetUser(entryUser)
    setResetError("")
    setResetPassword(generateTemporaryPassword())
    setIsResetDialogOpen(true)
  }

  const handleResetPassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!user) {
      setResetError("Trebuie să fiți autentificat pentru această acțiune.")
      return
    }
    if (!resetTargetUser) {
      setResetError("Nu a fost selectat niciun utilizator.")
      return
    }
    if (resetPassword.trim().length < 6) {
      setResetError("Parola trebuie să aibă minimum 6 caractere.")
      return
    }

    setResetSaving(true)
    setResetError("")
    setSuccess("")

    try {
      const response = await adminAuthorizedFetch("/api/admin/users/create/reset-password", user, {
        method: "POST",
        body: JSON.stringify({
          uid: resetTargetUser.uid,
          password: resetPassword.trim(),
        }),
      })

      const json = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(json?.error || `HTTP ${response.status}`)
      }

      setSuccess(`Parola pentru ${resetTargetUser.email} a fost resetată cu succes.`)
      setIsResetDialogOpen(false)
      setResetTargetUser(null)
      setResetPassword("")
      await loadUsers()
    } catch (submitError) {
      setResetError(submitError instanceof Error ? submitError.message : "Nu am putut reseta parola contului.")
    } finally {
      setResetSaving(false)
    }
  }

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
      setIsDialogOpen(false)
      await loadUsers()
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
    <div className="max-w-5xl space-y-6">
      {success ? (
        <Alert>
          <UserPlus className="h-4 w-4" />
          <AlertTitle>Cont creat</AlertTitle>
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5" />
              Conturi angajați Entries/Exits
            </CardTitle>
            <CardDescription>
              Gestionezi operatorii Intrări/Ieșiri. Apasă `+` pentru a crea un cont nou.
            </CardDescription>
          </div>

          <Dialog
            open={isDialogOpen}
            onOpenChange={(open) => {
              setIsDialogOpen(open)
              if (open) {
                setError("")
                setName("")
                setEmail("")
                setPassword("")
              }
            }}
          >
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Creare cont
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[540px]">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <UserPlus className="h-5 w-5" />
                  Creare cont angajat Entries/Exits
                </DialogTitle>
                <DialogDescription asChild>
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    <li>Contul nou primește automat rolul de operator Intrări/Ieșiri.</li>
                    <li>Utilizatorul va putea accesa doar pagina `Entries/Exits`.</li>
                  </ul>
                </DialogDescription>
              </DialogHeader>

              {error ? (
                <Alert variant="destructive">
                  <ShieldAlert className="h-4 w-4" />
                  <AlertTitle>Crearea contului a eșuat</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}

              <form className="space-y-4" id="create-entries-user-form" onSubmit={handleSubmit}>
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
              </form>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)} disabled={saving}>
                  Anulează
                </Button>
                <Button type="submit" form="create-entries-user-form" disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Creează contul
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent className="space-y-6">
          {listError ? (
            <Alert variant="destructive">
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>Nu am putut încărca lista</AlertTitle>
              <AlertDescription>{listError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="overflow-x-auto rounded-md border bg-white">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Nume</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Creat la</th>
                  <th className="px-4 py-3 font-medium">Creat de</th>
                  <th className="px-4 py-3 font-medium">Acțiuni</th>
                </tr>
              </thead>
              <tbody>
                {loadingUsers ? (
                  <tr>
                    <td className="px-4 py-8 text-muted-foreground" colSpan={6}>
                      <div className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Se încarcă lista de conturi...
                      </div>
                    </td>
                  </tr>
                ) : users.length === 0 ? (
                  <tr>
                    <td className="px-4 py-8 text-muted-foreground" colSpan={6}>
                      Nu există încă conturi Entries/Exits.
                    </td>
                  </tr>
                ) : (
                  users.map((entryUser) => (
                    <tr key={entryUser.uid} className="border-t">
                      <td className="px-4 py-3">{entryUser.name || "-"}</td>
                      <td className="px-4 py-3">{entryUser.email || "-"}</td>
                      <td className="px-4 py-3">{entryUser.active ? "Activ" : "Inactiv"}</td>
                      <td className="px-4 py-3">{formatDate(entryUser.createdAt)}</td>
                      <td className="px-4 py-3">{entryUser.createdByEmail || "-"}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => openToggleDialog(entryUser)}
                            disabled={Boolean(actionLoadingUid) || resetSaving}
                          >
                            {actionLoadingUid === entryUser.uid ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            {entryUser.active ? "Dezactivează" : "Activează"}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => openResetDialog(entryUser)}
                            disabled={Boolean(actionLoadingUid) || resetSaving}
                          >
                            Resetează parola
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <AlertDialog
        open={Boolean(toggleTargetUser)}
        onOpenChange={(open) => {
          if (!open) {
            setToggleTargetUser(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{toggleTargetActive ? "Activezi contul?" : "Dezactivezi contul?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {toggleTargetActive
                ? `Contul ${toggleTargetUser?.email || "-"} va putea să se autentifice din nou.`
                : `Contul ${toggleTargetUser?.email || "-"} nu se va mai putea autentifica până la reactivare.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(actionLoadingUid)}>Renunță</AlertDialogCancel>
            <AlertDialogAction onClick={confirmToggleActive} disabled={Boolean(actionLoadingUid)}>
              {actionLoadingUid === toggleTargetUser?.uid ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Se procesează...
                </>
              ) : toggleTargetActive ? (
                "Activează"
              ) : (
                "Dezactivează"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={isResetDialogOpen}
        onOpenChange={(open) => {
          setIsResetDialogOpen(open)
          if (!open) {
            setResetError("")
            setResetTargetUser(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Resetare parolă operator</DialogTitle>
            <DialogDescription>
              Setează o parolă nouă pentru contul {resetTargetUser?.email || "-"}.
            </DialogDescription>
          </DialogHeader>

          {resetError ? (
            <Alert variant="destructive">
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>Resetarea parolei a eșuat</AlertTitle>
              <AlertDescription>{resetError}</AlertDescription>
            </Alert>
          ) : null}

          <form className="space-y-4" id="reset-password-form" onSubmit={handleResetPassword}>
            <div className="space-y-2">
              <Label htmlFor="reset-password">Parolă nouă</Label>
              <Input
                id="reset-password"
                type="text"
                value={resetPassword}
                onChange={(event) => setResetPassword(event.target.value)}
                placeholder="Introdu parola nouă"
                minLength={6}
                required
              />
            </div>
          </form>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setResetPassword(generateTemporaryPassword())}
              disabled={resetSaving}
            >
              Generează parolă
            </Button>
            <Button type="button" variant="outline" onClick={() => setIsResetDialogOpen(false)} disabled={resetSaving}>
              Anulează
            </Button>
            <Button type="submit" form="reset-password-form" disabled={resetSaving}>
              {resetSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Salvează parola
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
