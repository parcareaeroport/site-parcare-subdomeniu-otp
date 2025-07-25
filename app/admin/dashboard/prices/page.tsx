"use client"

import { useState, useEffect } from "react"
import { collection, getDocs, doc, updateDoc, addDoc, deleteDoc, query, orderBy, writeBatch } from "firebase/firestore"
import { db } from "@/lib/firebase" // Importă instanța db
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Pencil, Save, Plus, Trash2, AlertCircle, Loader2, ToggleLeft, ToggleRight, Upload, FileSpreadsheet } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { useToast } from "@/components/ui/use-toast"
import { useAuth } from "@/context/auth-context" // Pentru a verifica dacă adminul e logat
import * as XLSX from 'xlsx'

interface PriceEntry {
  id: string // Firestore document ID
  days: number
  standardPrice: number
  discountedPrice: number // Va fi calculat
  discountPercentage: number // Calculat din reducereAplicata
  reducereAplicata: number // Suma în LEI - sursa principală
}

interface ExcelRow {
  zile: number
  sumaInitiala: number
  procentReducere: number
  reducereAplicata: number
  sumaFinalaRedusa: number
}

export default function PricesPage() {
  const { toast } = useToast()
  const { user, loading: authLoading } = useAuth() // Verifică starea de autentificare
  const [prices, setPrices] = useState<PriceEntry[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValues, setEditValues] = useState({ standardPrice: 0, discountPercentage: 0, reducereAplicata: 0 })
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false)
  const [newPrice, setNewPrice] = useState({ days: 1, standardPrice: 50, discountPercentage: 0, reducedPrice: 50 })
  const [inputMode, setInputMode] = useState<'discount' | 'reduced'>('discount') // Mod de input: discount sau preț redus
  const [globalDiscount, setGlobalDiscount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [isImporting, setIsImporting] = useState(false)
  const [importPreview, setImportPreview] = useState<ExcelRow[]>([])

  const pricesCollectionRef = collection(db, "prices")

  // Funcție pentru calculul automat
  const calculateFromDiscount = (standardPrice: number, discountPercentage: number) => {
    return standardPrice * (1 - discountPercentage / 100)
  }

  const calculateDiscountFromReduced = (standardPrice: number, reducedPrice: number) => {
    if (standardPrice <= 0) return 0
    return Math.max(0, Math.min(100, ((standardPrice - reducedPrice) / standardPrice) * 100))
  }

  // Handler pentru schimbarea prețului standard - recalculează automat
  const handleStandardPriceChange = (value: number) => {
    if (inputMode === 'discount') {
      const reducedPrice = calculateFromDiscount(value, newPrice.discountPercentage)
      setNewPrice({ ...newPrice, standardPrice: value, reducedPrice })
    } else {
      const discountPercentage = calculateDiscountFromReduced(value, newPrice.reducedPrice)
      setNewPrice({ ...newPrice, standardPrice: value, discountPercentage })
    }
  }

  // Handler pentru schimbarea discountului - calculează prețul redus
  const handleDiscountChange = (value: number) => {
    const reducedPrice = calculateFromDiscount(newPrice.standardPrice, value)
    setNewPrice({ ...newPrice, discountPercentage: value, reducedPrice })
  }

  // Handler pentru schimbarea prețului redus - calculează discountul
  const handleReducedPriceChange = (value: number) => {
    const discountPercentage = calculateDiscountFromReduced(newPrice.standardPrice, value)
    setNewPrice({ ...newPrice, reducedPrice: value, discountPercentage })
  }

  // Handler pentru schimbarea modului de input
  const toggleInputMode = () => {
    setInputMode(inputMode === 'discount' ? 'reduced' : 'discount')
  }

  // Helper pentru rotunjirea inteligentă a procentelor (doar pentru afișare)
  const roundPercentageForDisplay = (percentage: number): number => {
    const fractionalPart = percentage % 1
    
    // Dacă este foarte aproape de .5, rotunjește la .5
    if (Math.abs(fractionalPart - 0.5) <= 0.1) {
      return Math.floor(percentage) + 0.5
    }
    
    // Altfel, rotunjește la cel mai apropiat întreg
    return Math.round(percentage)
  }

  // Helper pentru conversie procente
  const parsePercentage = (value: any): number => {
    if (typeof value === 'number') {
      // Dacă este între 0 și 1, probabil e fracție din Excel (0.3 = 30%)
      if (value >= 0 && value <= 1) {
        return value * 100
      }
      // Dacă e mai mare ca 1, e deja în procente (30)
      return value
    }
    if (typeof value === 'string') {
      // Elimină simbolul % și convertește la număr
      const cleanValue = value.replace(/[%\s]/g, '')
      const parsed = parseFloat(cleanValue)
      if (isNaN(parsed)) return 0
      
      // Același logic pentru string-uri
      if (parsed >= 0 && parsed <= 1) {
        return parsed * 100
      }
      return parsed
    }
    return 0
  }

  // Helper pentru conversie numere
  const parseNumber = (value: any): number => {
    if (typeof value === 'number') return value
    if (typeof value === 'string') {
      const parsed = parseFloat(value.replace(/[^\d.-]/g, ''))
      return isNaN(parsed) ? 0 : parsed
    }
    return 0
  }

  // Handler pentru fișierul Excel
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = e.target?.result
        const workbook = XLSX.read(data, { type: 'binary' })
        const sheetName = workbook.SheetNames[0]
        const sheet = workbook.Sheets[sheetName]
        const jsonData = XLSX.utils.sheet_to_json(sheet)

        // Procesează și validează datele cu conversie automată
        const validData = jsonData.map((row: any) => {
          const zile = parseNumber(row.zile)
          const sumaInitiala = parseNumber(row.sumaInitiala)
          const reducereAplicata = parseNumber(row.reducereAplicata || 0)
          const sumaFinalaRedusa = parseNumber(row.sumaFinalaRedusa || 0)
          
          // Calculez procentul în funcție de ce date sunt disponibile
          let procentReducere = 0
          
          // Prioritate 1: Dacă există procentReducere în Excel
          if (row.procentReducere !== undefined && row.procentReducere !== null && row.procentReducere !== '') {
            procentReducere = parsePercentage(row.procentReducere)
          }
          // Prioritate 2: Calculez din reducereAplicata dacă există
          else if (reducereAplicata > 0 && sumaInitiala > 0) {
            procentReducere = (reducereAplicata / sumaInitiala) * 100
          }
          // Prioritate 3: Calculez din diferența de preț dacă există sumaFinalaRedusa
          else if (sumaFinalaRedusa > 0 && sumaInitiala > 0) {
            const calculatedReduction = sumaInitiala - sumaFinalaRedusa
            procentReducere = (calculatedReduction / sumaInitiala) * 100
          }
          
          const processedRow = {
            zile,
            sumaInitiala,
            procentReducere: Math.max(0, Math.min(100, procentReducere)), // Limitez între 0-100%
            reducereAplicata,
            sumaFinalaRedusa
          }
          
          // Debug pentru primul rând pentru a verifica conversia
          if (processedRow.zile === 1) {
            console.log('Excel data conversion example:', {
              original: {
                procentReducere: row.procentReducere,
                reducereAplicata: row.reducereAplicata,
                sumaInitiala: row.sumaInitiala,
                sumaFinalaRedusa: row.sumaFinalaRedusa
              },
              calculated: {
                procentReducere: processedRow.procentReducere,
                method: row.procentReducere ? 'from_percentage' : 
                       reducereAplicata > 0 ? 'from_reduction' : 
                       sumaFinalaRedusa > 0 ? 'from_final_price' : 'default_zero'
              }
            })
          }
          
          return processedRow
        }).filter(row => 
          row.zile > 0 && 
          row.sumaInitiala > 0 && 
          row.procentReducere >= 0
        ) as ExcelRow[]

        if (validData.length === 0) {
          toast({
            title: "Eroare",
            description: "Fișierul Excel nu conține date valide. Verifică coloanele: zile, sumaInitiala, procentReducere.",
            variant: "destructive",
          })
          return
        }

        setImportPreview(validData)
        toast({
          title: "Fișier încărcat",
          description: `S-au găsit ${validData.length} rânduri valide pentru import.`,
        })
      } catch (error) {
        console.error("Error reading Excel file:", error)
        toast({
          title: "Eroare",
          description: "Nu s-a putut citi fișierul Excel. Verifică formatul.",
          variant: "destructive",
        })
      }
    }
    reader.readAsBinaryString(file)
  }

  // Funcție pentru importul în masă
  const handleBulkImport = async () => {
    if (!user || importPreview.length === 0) return
    
    setIsImporting(true)
    try {
      const batch = writeBatch(db)
      let addedCount = 0
      let skippedCount = 0

      // Verifică ce prețuri există deja
      const existingPrices = prices.map(p => p.days)

      for (const row of importPreview) {
        // Skip dacă există deja un preț pentru acest număr de zile
        if (existingPrices.includes(row.zile)) {
          skippedCount++
          continue
        }

        // Calculez reducerea aplicată din datele disponibile
        let reducereAplicata = 0
        
        if (row.reducereAplicata > 0) {
          reducereAplicata = row.reducereAplicata
        } else if (row.procentReducere > 0) {
          reducereAplicata = row.sumaInitiala * (row.procentReducere / 100)
        } else if (row.sumaFinalaRedusa > 0) {
          reducereAplicata = row.sumaInitiala - row.sumaFinalaRedusa
        }

        // Creează un document nou
        const newDocRef = doc(pricesCollectionRef)
        batch.set(newDocRef, {
          days: row.zile,
          standardPrice: row.sumaInitiala,
          reducereAplicata: reducereAplicata,
          discountPercentage: row.sumaInitiala > 0 ? (reducereAplicata / row.sumaInitiala) * 100 : 0,
        })
        addedCount++
      }

      if (addedCount > 0) {
        await batch.commit()
        toast({
          title: "Import realizat cu succes",
          description: `S-au adăugat ${addedCount} prețuri noi${skippedCount > 0 ? `, ${skippedCount} au fost omise (există deja)` : ''}.`,
        })
        fetchPrices() // Reîncarcă prețurile
      } else {
        toast({
          title: "Niciun preț nou",
          description: "Toate prețurile din fișier există deja în sistem.",
          variant: "destructive",
        })
      }

      setIsImportDialogOpen(false)
      setImportPreview([])
    } catch (error) {
      console.error("Error importing prices:", error)
      toast({
        title: "Eroare la import",
        description: "Nu s-au putut importa prețurile. Încearcă din nou.",
        variant: "destructive",
      })
    } finally {
      setIsImporting(false)
    }
  }

  const fetchPrices = async () => {
    setIsLoading(true)
    try {
      const q = query(pricesCollectionRef, orderBy("days"))
      const data = await getDocs(q)
      const fetchedPrices: PriceEntry[] = data.docs.map((doc) => {
        const priceData = doc.data()
        const discountPercentage = priceData.discountPercentage || 0
        const standardPrice = priceData.standardPrice || 0
        const reducereAplicata = priceData.reducereAplicata || (standardPrice * discountPercentage / 100)
        
        return {
          id: doc.id,
          days: priceData.days,
          standardPrice,
          discountPercentage,
          reducereAplicata,
          discountedPrice: standardPrice - reducereAplicata,
        }
      })
      setPrices(fetchedPrices)
    } catch (error) {
      console.error("Error fetching prices:", error)
      toast({ title: "Eroare", description: "Nu s-au putut încărca prețurile.", variant: "destructive" })
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (!authLoading && user) {
      // Doar dacă adminul e logat
      fetchPrices()
    } else if (!authLoading && !user) {
      setIsLoading(false) // Oprește loading dacă nu e logat
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading])

  const handleEdit = (price: PriceEntry) => {
    setEditingId(price.id)
    setEditValues({
      standardPrice: price.standardPrice,
      discountPercentage: price.discountPercentage,
      reducereAplicata: price.reducereAplicata,
    })
  }

  // Handler pentru editarea prețului standard în tabel
  const handleEditStandardPriceChange = (value: number) => {
    // Recalculează procentul bazat pe reducerea existentă
    const newPercentage = value > 0 ? (editValues.reducereAplicata / value) * 100 : 0
    setEditValues({
      ...editValues,
      standardPrice: value,
      discountPercentage: newPercentage,
    })
  }

  // Handler pentru editarea procentului în tabel
  const handleEditDiscountChange = (value: number) => {
    // Calculează reducerea din procent
    const newReduction = editValues.standardPrice * (value / 100)
    setEditValues({
      ...editValues,
      discountPercentage: value,
      reducereAplicata: newReduction,
    })
  }

  // Handler pentru editarea reducerii aplicate în tabel
  const handleEditReductionChange = (value: number) => {
    // Calculează procentul din reducere
    const newPercentage = editValues.standardPrice > 0 ? (value / editValues.standardPrice) * 100 : 0
    setEditValues({
      ...editValues,
      reducereAplicata: value,
      discountPercentage: newPercentage,
    })
  }

  const handleSave = async (id: string) => {
    if (!user) return // Doar adminul poate salva
    const priceDoc = doc(db, "prices", id)
    const updatedPriceData = {
      standardPrice: editValues.standardPrice,
      reducereAplicata: editValues.reducereAplicata,
      discountPercentage: editValues.standardPrice > 0 ? (editValues.reducereAplicata / editValues.standardPrice) * 100 : 0,
    }
    try {
      await updateDoc(priceDoc, updatedPriceData)
      setEditingId(null)
      fetchPrices() // Reîncarcă prețurile
      toast({ title: "Preț actualizat", description: "Prețul a fost actualizat cu succes." })
    } catch (error) {
      console.error("Error updating price:", error)
      toast({ title: "Eroare", description: "Actualizarea prețului a eșuat.", variant: "destructive" })
    }
  }

  const handleAddPrice = async () => {
    if (!user) return
    // Verifică dacă există deja un preț pentru acest număr de zile
    if (prices.some((p) => p.days === newPrice.days)) {
      toast({
        title: "Eroare",
        description: `Există deja un preț pentru ${newPrice.days} zile. Editați intrarea existentă.`,
        variant: "destructive",
      })
      return
    }
    const newPriceData = {
      days: newPrice.days,
      standardPrice: newPrice.standardPrice,
      discountPercentage: newPrice.discountPercentage,
    }
    try {
      await addDoc(pricesCollectionRef, newPriceData)
      setIsAddDialogOpen(false)
      setNewPrice({ days: Math.max(...prices.map((p) => p.days), 0) + 1, standardPrice: 50, discountPercentage: 0, reducedPrice: 50 }) // Reset form
      setInputMode('discount') // Reset input mode
      fetchPrices()
      toast({ title: "Preț adăugat", description: "Noul preț a fost adăugat cu succes." })
    } catch (error) {
      console.error("Error adding price:", error)
      toast({ title: "Eroare", description: "Adăugarea prețului a eșuat.", variant: "destructive" })
    }
  }

  const handleDeletePrice = async (id: string) => {
    if (!user) return
    const priceDoc = doc(db, "prices", id)
    try {
      await deleteDoc(priceDoc)
      fetchPrices()
      toast({ title: "Preț șters", description: "Prețul a fost șters cu succes." })
    } catch (error) {
      console.error("Error deleting price:", error)
      toast({ title: "Eroare", description: "Ștergerea prețului a eșuat.", variant: "destructive" })
    }
  }

  const applyGlobalDiscount = async () => {
    if (!user) return
    const batch = writeBatch(db)
    prices.forEach((price) => {
      const priceRef = doc(db, "prices", price.id)
      batch.update(priceRef, { discountPercentage: globalDiscount })
    })
    try {
      await batch.commit()
      fetchPrices()
      toast({ title: "Discount global aplicat", description: `Discountul de ${globalDiscount}% a fost aplicat.` })
    } catch (error) {
      console.error("Error applying global discount:", error)
      toast({ title: "Eroare", description: "Aplicarea discountului global a eșuat.", variant: "destructive" })
    }
  }

  if (authLoading || isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" /> <p className="ml-2">Se încarcă datele...</p>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="text-center p-8">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Acces Neautorizat</AlertTitle>
          <AlertDescription>
            Trebuie să fiți autentificat ca administrator pentru a accesa această pagină.
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold tracking-tight">Gestionare Prețuri</h1>
        <div className="flex space-x-2">
          {/* Dialog pentru Import Excel */}
          <Dialog open={isImportDialogOpen} onOpenChange={setIsImportDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="border-green-500 text-green-600 hover:bg-green-50">
                <FileSpreadsheet className="mr-2 h-4 w-4" /> Import Excel
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl">
              <DialogHeader>
                <DialogTitle>Import Prețuri din Excel</DialogTitle>
                <DialogDescription>
                  Încarcă un fișier Excel cu coloanele: zile, sumaInitiala, procentReducere, reducereAplicata, sumaFinalaRedusa
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                {/* Upload Section */}
                <div className="space-y-2">
                  <Label htmlFor="excel-file">Selectează fișierul Excel (.xlsx, .xls)</Label>
                  <Input
                    id="excel-file"
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleFileUpload}
                    className="cursor-pointer"
                  />
                </div>

                {/* Preview Section */}
                {importPreview.length > 0 && (
                  <div className="space-y-2">
                    <Label>Preview Date ({importPreview.length} rânduri)</Label>
                    <div className="max-h-60 overflow-y-auto border rounded-md">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Zile</TableHead>
                            <TableHead>Preț Standard</TableHead>
                            <TableHead>Discount (%)</TableHead>
                            <TableHead>Reducere Aplicată</TableHead>
                            <TableHead>Preț Final</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {importPreview.slice(0, 10).map((row, index) => {
                            // Calculez reducerea aplicată din procent sau din datele existente
                            const calculatedReduction = row.reducereAplicata > 0 
                              ? row.reducereAplicata 
                              : (row.sumaInitiala * row.procentReducere / 100)
                            
                            const calculatedFinalPrice = row.sumaFinalaRedusa > 0 
                              ? row.sumaFinalaRedusa 
                              : (row.sumaInitiala - calculatedReduction)
                            
                            return (
                              <TableRow key={index}>
                                <TableCell>{row.zile}</TableCell>
                                <TableCell>{row.sumaInitiala.toFixed(2)} RON</TableCell>
                                <TableCell>{roundPercentageForDisplay(row.procentReducere)}%</TableCell>
                                <TableCell className="text-red-600 font-medium">{calculatedReduction.toFixed(2)} RON</TableCell>
                                <TableCell className="text-green-600 font-medium">{calculatedFinalPrice.toFixed(2)} RON</TableCell>
                              </TableRow>
                            )
                          })}
                          {importPreview.length > 10 && (
                            <TableRow>
                              <TableCell colSpan={5} className="text-center text-gray-500">
                                ... și încă {importPreview.length - 10} rânduri
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}

                {/* Format Instructions */}
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Format Excel Necesar</AlertTitle>
                  <AlertDescription className="space-y-3">
                    <p>Fișierul Excel trebuie să aibă coloanele: <strong>zile</strong>, <strong>sumaInitiala</strong> și cel puțin una dintre: <strong>procentReducere</strong>, <strong>reducereAplicata</strong>, <strong>sumaFinalaRedusa</strong></p>
                    
                    <p>
                      <a 
                        href="/exemplu-preturi.csv" 
                        download="exemplu-preturi.csv"
                        className="text-blue-600 hover:text-blue-800 underline inline-flex items-center"
                      >
                        <FileSpreadsheet className="mr-1 h-3 w-3" />
                        Descarcă exemplu CSV
                      </a> (poți deschide în Excel)
                    </p>
                  </AlertDescription>
                </Alert>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsImportDialogOpen(false)}>
                  Anulează
                </Button>
                <Button 
                  onClick={handleBulkImport} 
                  disabled={importPreview.length === 0 || isImporting}
                  className="bg-green-600 hover:bg-green-700"
                >
                  {isImporting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Se importă...
                    </>
                  ) : (
                    <>
                      <Upload className="mr-2 h-4 w-4" />
                      Importă {importPreview.length} prețuri
                    </>
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Dialog pentru Adăugare Individual */}
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gradient-bg">
                <Plus className="mr-2 h-4 w-4" /> Adaugă Preț
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Adaugă Preț Nou</DialogTitle>
                <DialogDescription>Adaugă un preț nou pentru un număr specific de zile.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="days" className="text-right">
                    Zile
                  </Label>
                  <Input
                    id="days"
                    type="number"
                    min="1"
                    value={newPrice.days}
                    onChange={(e) => setNewPrice({ ...newPrice, days: Number(e.target.value) })}
                    className="col-span-3"
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="standardPrice" className="text-right">
                    Preț Standard (RON)
                  </Label>
                  <Input
                    id="standardPrice"
                    type="number"
                    step="0.01"
                    min="0"
                    value={newPrice.standardPrice}
                    onChange={(e) => handleStandardPriceChange(Number(e.target.value))}
                    className="col-span-3"
                  />
                </div>

                {/* Toggle pentru selectarea modului de input */}
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label className="text-right">
                    Mod Introducere
                  </Label>
                  <div className="col-span-3 flex items-center space-x-3">
                    <Button 
                      type="button"
                      variant={inputMode === 'discount' ? 'default' : 'outline'} 
                      size="sm"
                      onClick={() => setInputMode('discount')}
                      className="flex-1"
                    >
                      Discount (%)
                    </Button>
                    <Button 
                      type="button"
                      variant={inputMode === 'reduced' ? 'default' : 'outline'} 
                      size="sm"
                      onClick={() => setInputMode('reduced')}
                      className="flex-1"
                    >
                      Preț Redus
                    </Button>
                  </div>
                </div>

                {/* Input pentru discount sau preț redus în funcție de mod */}
                {inputMode === 'discount' ? (
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="discountPercentage" className="text-right">
                    Discount (%)
                  </Label>
                  <Input
                    id="discountPercentage"
                    type="number"
                      step="0.01"
                    min="0"
                    max="100"
                    value={newPrice.discountPercentage}
                      onChange={(e) => handleDiscountChange(Number(e.target.value))}
                      className="col-span-3"
                      placeholder="Introdu discount-ul în %"
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="reducedPrice" className="text-right">
                      Preț Redus (RON)
                    </Label>
                    <Input
                      id="reducedPrice"
                      type="number"
                      step="0.01"
                      min="0"
                      max={newPrice.standardPrice}
                      value={newPrice.reducedPrice.toFixed(2)}
                      onChange={(e) => handleReducedPriceChange(Number(e.target.value))}
                    className="col-span-3"
                      placeholder="Introdu prețul redus"
                  />
                  </div>
                )}

                {/* Afișare rezultat calculat */}
                <div className="grid grid-cols-4 items-center gap-4 bg-gray-50 p-3 rounded-lg">
                  <Label className="text-right text-sm font-medium text-gray-600">
                    Rezultat
                  </Label>
                  <div className="col-span-3 space-y-1">
                    <div className="flex justify-between text-sm">
                      <span>Discount calculat:</span>
                      <span className="font-medium text-green-600">{roundPercentageForDisplay(newPrice.discountPercentage)}%</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span>Preț final:</span>
                      <span className="font-medium text-blue-600">{newPrice.reducedPrice.toFixed(2)} RON</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span>Economie:</span>
                      <span className="font-medium text-red-600">{(newPrice.standardPrice - newPrice.reducedPrice).toFixed(2)} RON</span>
                    </div>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                  Anulează
                </Button>
                <Button onClick={handleAddPrice}>Adaugă</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Tabs defaultValue="prices" className="space-y-4">
        <TabsList>
          <TabsTrigger value="prices">Prețuri Individuale</TabsTrigger>
          <TabsTrigger value="discounts">Discount Global</TabsTrigger>
        </TabsList>
        <TabsContent value="prices" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Lista Prețurilor</CardTitle>
              <CardDescription>
                Gestionează prețurile pentru fiecare număr de zile de parcare. 
                <br />În modul editare poți modifica fie <strong>Discount (%)</strong> fie <strong>Reducere Aplicată (RON)</strong> - celelalte se calculează automat.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Zile</TableHead>
                    <TableHead>Preț Standard (RON)</TableHead>
                    <TableHead>
                      Discount (%)
                      <div className="text-xs text-gray-500 font-normal">editabil ↔</div>
                    </TableHead>
                    <TableHead>
                      Reducere Aplicată (RON)
                      <div className="text-xs text-gray-500 font-normal">editabil ↔</div>
                    </TableHead>
                    <TableHead>Preț Final (RON)</TableHead>
                    <TableHead className="text-right">Acțiuni</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {prices.map((price) => {
                    // Calculez reducerea aplicată pentru afișare
                    const currentStandardPrice = editingId === price.id ? editValues.standardPrice : price.standardPrice
                    const currentDiscountPercentage = editingId === price.id ? editValues.discountPercentage : price.discountPercentage
                    const currentReduction = editingId === price.id ? editValues.reducereAplicata : price.reducereAplicata
                    const currentFinalPrice = currentStandardPrice - currentReduction
                    
                    return (
                    <TableRow key={price.id}>
                      <TableCell className="font-medium">{price.days}</TableCell>
                      <TableCell>
                        {editingId === price.id ? (
                          <Input
                            type="number"
                            step="0.01"
                            value={editValues.standardPrice}
                              onChange={(e) => handleEditStandardPriceChange(Number(e.target.value))}
                            className="w-24"
                              placeholder="Preț standard"
                          />
                        ) : (
                          price.standardPrice.toFixed(2)
                        )}
                      </TableCell>
                      <TableCell>
                        {editingId === price.id ? (
                          <Input
                            type="number"
                              step="0.1"
                              min="0"
                              max="100"
                              value={editValues.discountPercentage.toFixed(1)}
                              onChange={(e) => handleEditDiscountChange(Number(e.target.value))}
                              className="w-20"
                              placeholder="Procent"
                            />
                          ) : (
                            `${roundPercentageForDisplay(price.discountPercentage)}%`
                          )}
                        </TableCell>
                        <TableCell className="text-red-600 font-medium">
                          {editingId === price.id ? (
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              max={editValues.standardPrice}
                              value={editValues.reducereAplicata.toFixed(2)}
                              onChange={(e) => handleEditReductionChange(Number(e.target.value))}
                            className="w-20"
                              placeholder="Reducere"
                          />
                        ) : (
                            currentReduction.toFixed(2)
                        )}
                      </TableCell>
                        <TableCell className="text-green-600 font-medium">
                          {currentFinalPrice.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">
                        {editingId === price.id ? (
                          <Button variant="outline" size="icon" onClick={() => handleSave(price.id)}>
                            <Save className="h-4 w-4" />
                          </Button>
                        ) : (
                          <div className="flex justify-end space-x-2">
                            <Button variant="outline" size="icon" onClick={() => handleEdit(price)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="outline" size="icon" onClick={() => handleDeletePrice(price.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="discounts" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Discount Global</CardTitle>
              <CardDescription>Setează un discount global pentru toate prețurile.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Atenție</AlertTitle>
                <AlertDescription>
                  Aplicarea unui discount global va suprascrie toate discounturile individuale.
                </AlertDescription>
              </Alert>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="globalDiscount" className="text-right">
                  Discount Global (%)
                </Label>
                <Input
                  id="globalDiscount"
                  type="number"
                  min="0"
                  max="100"
                  value={globalDiscount}
                  onChange={(e) => setGlobalDiscount(Number(e.target.value))}
                  className="col-span-3"
                />
              </div>
            </CardContent>
            <CardFooter className="flex justify-end">
              <Button onClick={applyGlobalDiscount}>Aplică Discount Global</Button>
            </CardFooter>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
