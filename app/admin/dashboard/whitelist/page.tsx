"use client"

import { useEffect, useState } from "react"
import { collection, deleteDoc, doc, getDocs, serverTimestamp, setDoc } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { normalizeLicensePlate } from "@/lib/utils"
import { useAuth } from "@/context/auth-context"
import { useToast } from "@/components/ui/use-toast"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Loader2, Trash2, Plus, ShieldCheck } from "lucide-react"

interface WhitelistEntry {
  id: string
  createdAt?: string
}

export default function WhitelistPage() {
  const { user, loading: authLoading } = useAuth()
  const { toast } = useToast()

  const [entries, setEntries] = useState<WhitelistEntry[]>([])
  const [newPlate, setNewPlate] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState<string | null>(null)

  const whitelistCol = collection(db, "lpr_whitelist")

  const fetchEntries = async () => {
    setIsLoading(true)
    try {
      const snap = await getDocs(whitelistCol)
      const data: WhitelistEntry[] = snap.docs
        .map((d) => {
          const docData = d.data() as any
          const createdAt = docData?.createdAt?.toDate ? docData.createdAt.toDate().toISOString() : undefined
          return { id: d.id, createdAt }
        })
        .sort((a, b) => a.id.localeCompare(b.id))
      setEntries(data)
    } catch (e) {
      console.error("Failed to fetch whitelist", e)
      toast({ title: "Eroare", description: "Nu s-au putut încărca numerele whitelist.", variant: "destructive" })
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (!authLoading && user) {
      fetchEntries()
    } else if (!authLoading && !user) {
      setIsLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user || isSaving) return

    const normalized = normalizeLicensePlate(newPlate)
    if (!normalized) {
      toast({ title: "Număr invalid", description: "Introdu un număr de înmatriculare.", variant: "destructive" })
      return
    }

    setIsSaving(true)
    try {
      await setDoc(doc(db, "lpr_whitelist", normalized), {
        plate: normalized,
        createdAt: serverTimestamp(),
      })
      toast({ title: "Adăugat", description: `${normalized} a fost adăugat în whitelist.` })
      setNewPlate("")
      fetchEntries()
    } catch (e) {
      console.error("Failed to add plate to whitelist", e)
      toast({ title: "Eroare", description: "Nu s-a putut adăuga numărul.", variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async (plate: string) => {
    if (!user) return
    setIsDeleting(plate)
    try {
      await deleteDoc(doc(db, "lpr_whitelist", plate))
      toast({ title: "Șters", description: `${plate} a fost eliminat din whitelist.` })
      setEntries((prev) => prev.filter((e) => e.id !== plate))
    } catch (e) {
      console.error("Failed to delete plate from whitelist", e)
      toast({ title: "Eroare", description: "Nu s-a putut șterge numărul.", variant: "destructive" })
    } finally {
      setIsDeleting(null)
    }
  }

  if (authLoading) {
    return (
      <div className="flex items-center gap-3 text-gray-600">
        <Loader2 className="h-5 w-5 animate-spin" />
        Se verifică autentificarea...
      </div>
    )
  }

  if (!user) {
    return <div className="text-gray-700">Trebuie să fii autentificat pentru a accesa whitelist-ul.</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Numere whitelist
          </h1>
          <p className="text-gray-600">Numerele de mai jos sunt exceptate complet din procesarea LPR.</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Adaugă număr</CardTitle>
          <CardDescription>
            Plăcuța va fi normalizată automat (litere mari, fără spații sau simboluri). Evenimentele LPR pentru aceste
            numere vor fi ignorate complet.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-end">
            <div className="space-y-2">
              <Label htmlFor="plate">Număr înmatriculare</Label>
              <Input
                id="plate"
                value={newPlate}
                onChange={(e) => setNewPlate(e.target.value)}
                placeholder="Ex: B-123-ABC"
              />
            </div>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Se salvează...
                </>
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" />
                  Adaugă
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lista whitelist</CardTitle>
          <CardDescription>{isLoading ? "Se încarcă..." : `${entries.length} numere în whitelist.`}</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-3 text-gray-600">
              <Loader2 className="h-5 w-5 animate-spin" />
              Se încarcă lista...
            </div>
          ) : entries.length === 0 ? (
            <div className="text-gray-600">Nu există numere în whitelist încă.</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Număr</TableHead>
                    <TableHead>Adăugat</TableHead>
                    <TableHead className="w-[80px]">Acțiuni</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="font-medium">{entry.id}</TableCell>
                      <TableCell className="text-sm text-gray-600">
                        {entry.createdAt ? new Date(entry.createdAt).toLocaleString("ro-RO") : "n/a"}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(entry.id)}
                          disabled={isDeleting === entry.id}
                          aria-label={`Șterge ${entry.id}`}
                        >
                          {isDeleting === entry.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

