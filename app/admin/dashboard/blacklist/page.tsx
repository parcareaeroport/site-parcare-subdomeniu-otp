"use client"

import { useCallback, useEffect, useState, type FormEvent } from "react"
import { Loader2, Plus, ShieldBan, Trash2 } from "lucide-react"
import { useAuth } from "@/context/auth-context"
import { adminAuthorizedFetch } from "@/lib/admin-authorized-fetch"
import type { MobileBookingBlacklistEntry } from "@/lib/mobile-booking-blacklist"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

const endpoint = "/api/admin/blacklist"

export default function BlacklistPage() {
  const { user, loading: authLoading, isAdmin } = useAuth()
  const { toast } = useToast()
  const [entries, setEntries] = useState<MobileBookingBlacklistEntry[]>([])
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [licensePlate, setLicensePlate] = useState("")
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  const fetchEntries = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      const response = await adminAuthorizedFetch(endpoint, user, { cache: "no-store" })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      setEntries(data.entries)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    if (!authLoading && user && isAdmin) void fetchEntries()
  }, [authLoading, user, isAdmin, fetchEntries])

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    try {
      const response = await adminAuthorizedFetch(endpoint, user, {
        method: "POST", body: JSON.stringify({ name, email, licensePlate }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      setName("")
      setEmail("")
      setLicensePlate("")
      toast({ title: "Adăugat", description: "Persoana a fost adăugată în lista clienților blocați." })
      await fetchEntries()
    } catch (error) {
      toast({ title: "Eroare", description: error instanceof Error ? error.message : "Nu s-a putut salva persoana.", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(entry: MobileBookingBlacklistEntry) {
    if (deleting) return
    setDeleting(entry.id)
    try {
      const response = await adminAuthorizedFetch(endpoint, user, {
        method: "DELETE", body: JSON.stringify({ id: entry.id }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      setEntries(previous => previous.filter(item => item.id !== entry.id))
      toast({ title: "Șters", description: "Înregistrarea a fost eliminată din lista de blocare." })
    } catch (error) {
      toast({ title: "Eroare", description: error instanceof Error ? error.message : "Nu s-a putut șterge persoana.", variant: "destructive" })
    } finally {
      setDeleting(null)
    }
  }

  if (authLoading) return <div className="flex items-center gap-3"><Loader2 className="h-5 w-5 animate-spin" />Se verifică autentificarea...</div>
  if (!user || !isAdmin) return <p>Doar administratorii pot accesa lista clienților blocați.</p>

  return (
    <div className="min-w-0 space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><ShieldBan className="h-5 w-5 shrink-0 text-primary" />Clienți blocați</h1>
        <p className="mt-1 text-gray-600">Blochează rezervările noi din aplicația mobilă după email sau număr de înmatriculare.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Adaugă persoană</CardTitle>
          <CardDescription>Toate câmpurile sunt obligatorii. Este suficient să corespundă emailul sau numărul pentru a bloca o rezervare nouă.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAdd} className="grid grid-cols-1 items-end gap-4 xl:grid-cols-[1fr_1fr_1fr_auto]">
            <div className="min-w-0 space-y-2"><Label htmlFor="blacklist-name">Nume persoană</Label><Input id="blacklist-name" required maxLength={200} value={name} onChange={e => setName(e.target.value)} placeholder="Nume și prenume" /></div>
            <div className="min-w-0 space-y-2"><Label htmlFor="blacklist-email">Email</Label><Input id="blacklist-email" type="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} placeholder="email@exemplu.ro" /></div>
            <div className="min-w-0 space-y-2"><Label htmlFor="blacklist-plate">Număr înmatriculare</Label><Input id="blacklist-plate" required value={licensePlate} onChange={e => setLicensePlate(e.target.value)} placeholder="Ex: B-123-ABC" /></div>
            <Button type="submit" disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}{saving ? "Se salvează..." : "Adaugă"}</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Lista clienților blocați</CardTitle>
          <CardDescription>Ștergerea elimină această înregistrare. Alte înregistrări cu același email sau număr continuă să blocheze rezervările.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? <div className="flex items-center gap-3 text-gray-600"><Loader2 className="h-5 w-5 animate-spin" />Se încarcă lista...</div>
            : loadError ? <div role="alert" className="space-y-3"><p>Nu s-a putut încărca lista clienților blocați.</p><Button variant="outline" onClick={() => void fetchEntries()}>Încearcă din nou</Button></div>
            : entries.length === 0 ? <p className="text-gray-600">Nu există clienți blocați.</p>
            : <div className="overflow-x-auto"><Table>
              <TableHeader><TableRow><TableHead>Nume</TableHead><TableHead>Email</TableHead><TableHead>Număr</TableHead><TableHead>Adăugat</TableHead><TableHead>Acțiuni</TableHead></TableRow></TableHeader>
              <TableBody>{entries.map(entry => <TableRow key={entry.id}>
                <TableCell className="min-w-[130px] font-medium">{entry.name}</TableCell>
                <TableCell className="max-w-[280px] break-words">{entry.email}</TableCell>
                <TableCell className="whitespace-nowrap">{entry.licensePlate}</TableCell>
                <TableCell className="whitespace-nowrap text-sm text-gray-600">{entry.createdAt ? new Date(entry.createdAt).toLocaleString("ro-RO") : "—"}</TableCell>
                <TableCell><Button variant="ghost" size="icon" disabled={deleting !== null} onClick={() => void handleDelete(entry)} aria-label={`Șterge ${entry.name} (${entry.licensePlate})`}>{deleting === entry.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}</Button></TableCell>
              </TableRow>)}</TableBody>
            </Table></div>}
        </CardContent>
      </Card>
    </div>
  )
}
