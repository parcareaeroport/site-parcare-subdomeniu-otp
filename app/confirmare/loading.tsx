import { Loader2 } from "lucide-react"

export default function Loading() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground">
      <Loader2 className="h-16 w-16 text-primary animate-spin mb-6" />
      <h1 className="text-2xl font-semibold mb-2">Se încarcă detaliile confirmării...</h1>
      <p className="text-muted-foreground">Vă rugăm așteptați.</p>
    </div>
  )
}
