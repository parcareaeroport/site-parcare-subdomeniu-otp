"use client"

import type React from "react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { CheckCircle2, Send, Loader2 } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"

export default function ContactForm() {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)
  const { toast } = useToast()

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setIsSubmitting(true)

    // Simulate form submission
    await new Promise((resolve) => setTimeout(resolve, 1500))

    setIsSubmitting(false)
    setIsSubmitted(true)
    toast({
      title: "Mesaj Trimis!",
      description: "Mulțumim! Am primit mesajul tău și vom reveni în cel mai scurt timp.",
    })
  }

  if (isSubmitted) {
    return (
      <section className="py-12 md:py-16 bg-slate-50">
        <div className="container mx-auto px-4">
          <div className="max-w-2xl mx-auto bg-white rounded-lg p-8 text-center border border-slate-200">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle2 className="h-8 w-8 text-green-600" />
            </div>
            <h3 className="text-2xl font-semibold mb-3 text-waze-blue">Mesaj trimis cu succes!</h3>
            <p className="text-slate-600 mb-8">
              Mulțumim pentru mesajul tău. Echipa noastră va reveni cu un răspuns în cel mai scurt timp posibil.
            </p>
            <Button onClick={() => setIsSubmitted(false)} variant="outline">
              Trimite un alt mesaj
            </Button>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="py-12 md:py-16 bg-slate-50">
      <div className="container mx-auto px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold mb-8 text-center text-waze-blue">Trimite-ne un mesaj</h2>

          <form onSubmit={handleSubmit} className="bg-white p-6 md:p-8 rounded-lg border border-slate-200">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
              <div className="space-y-2">
                <Label htmlFor="name">Nume complet *</Label>
                <Input id="name" name="name" required placeholder="Numele tău" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email *</Label>
                <Input id="email" name="email" type="email" required placeholder="exemplu@email.com" />
              </div>
            </div>

            <div className="space-y-2 mb-6">
              <Label htmlFor="phone">Telefon</Label>
              <Input id="phone" name="phone" type="tel" placeholder="07xx xxx xxx" />
            </div>

            <div className="space-y-2 mb-6">
              <Label htmlFor="subject">Subiect *</Label>
              <Input id="subject" name="subject" required placeholder="Motivul contactului" />
            </div>

            <div className="space-y-2 mb-6">
              <Label htmlFor="message">Mesaj *</Label>
              <Textarea
                id="message"
                name="message"
                required
                className="min-h-[150px]"
                placeholder="Scrie mesajul tău aici..."
              />
            </div>

            <div className="text-center">
              <Button type="submit" disabled={isSubmitting} className="px-8">
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Se trimite...
                  </>
                ) : (
                  <>
                    Trimite mesajul
                    <Send className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </section>
  )
}
