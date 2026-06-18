"use client"

import { useState, useEffect, type ChangeEvent } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Loader2, Save, Smartphone } from "lucide-react"
import { db } from "@/lib/firebase"
import { doc, setDoc, onSnapshot } from "firebase/firestore"
import { useToast } from "@/components/ui/use-toast"

type AppUpdateForm = {
  enabled: boolean
  forceUpdate: boolean
  minVersion: string
  latestVersion: string
  iosUrl: string
  androidUrl: string
  message: string
}

const DEFAULT_FORM: AppUpdateForm = {
  enabled: false,
  forceUpdate: false,
  minVersion: "1.0.0",
  latestVersion: "",
  iosUrl: "",
  androidUrl: "",
  message: "",
}

export function MobileAppSettingsManager() {
  const { toast } = useToast()
  const [form, setForm] = useState<AppUpdateForm>(DEFAULT_FORM)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "config", "mobileAppSettings"),
      (snap) => {
        const data = snap.data() || {}
        const appUpdate = (data.appUpdate || {}) as Partial<AppUpdateForm>
        setForm({
          enabled: !!appUpdate.enabled,
          forceUpdate: !!appUpdate.forceUpdate,
          minVersion: appUpdate.minVersion || "1.0.0",
          latestVersion: appUpdate.latestVersion || "",
          iosUrl: appUpdate.iosUrl || "",
          androidUrl: appUpdate.androidUrl || "",
          message: appUpdate.message || "",
        })
        setLoading(false)
      },
      (err) => {
        console.error(err)
        toast({
          title: "Eroare",
          description: "Nu s-au putut încărca setările aplicației mobile.",
          variant: "destructive",
        })
        setLoading(false)
      }
    )
    return () => unsub()
  }, [toast])

  const update = <K extends keyof AppUpdateForm>(key: K, value: AppUpdateForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const saveAll = async () => {
    setSaving(true)
    try {
      await setDoc(
        doc(db, "config", "mobileAppSettings"),
        {
          appUpdate: {
            enabled: form.enabled,
            forceUpdate: form.forceUpdate,
            minVersion: form.minVersion.trim() || "1.0.0",
            latestVersion: form.latestVersion.trim() || null,
            iosUrl: form.iosUrl.trim(),
            androidUrl: form.androidUrl.trim(),
            message: form.message.trim() || null,
          },
        },
        { merge: true }
      )
      toast({ title: "Salvat", description: "Setările aplicației mobile au fost actualizate." })
    } catch (err) {
      console.error(err)
      toast({
        title: "Eroare",
        description: "Salvarea a eșuat.",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const toggleField = (key: "enabled" | "forceUpdate") => async (value: boolean) => {
    update(key, value)
    setSaving(true)
    try {
      await setDoc(
        doc(db, "config", "mobileAppSettings"),
        { appUpdate: { [key]: value } },
        { merge: true }
      )
    } catch (err) {
      console.error(err)
      update(key, !value)
      toast({
        title: "Eroare",
        description: "Nu s-a putut actualiza setarea.",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Smartphone className="h-5 w-5" />
          Aplicație Mobilă — Notificare Actualizare
        </CardTitle>
        <CardDescription>
          Controlează modalul „Actualizează aplicația” afișat utilizatorilor pe iOS și Android.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label htmlFor="app-update-enabled">Notificare activă</Label>
            <p className="text-sm text-muted-foreground">
              Când e activă, aplicațiile cu versiune mai mică decât „Versiune minimă” văd modalul.
            </p>
          </div>
          <Switch
            id="app-update-enabled"
            checked={form.enabled}
            onCheckedChange={toggleField("enabled")}
            disabled={loading || saving}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label htmlFor="app-update-force">Actualizare obligatorie</Label>
            <p className="text-sm text-muted-foreground">
              Dacă e activă, utilizatorul nu poate închide modalul și nu mai poate folosi aplicația.
            </p>
          </div>
          <Switch
            id="app-update-force"
            checked={form.forceUpdate}
            onCheckedChange={toggleField("forceUpdate")}
            disabled={loading || saving}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="min-version">Versiune minimă (semver)</Label>
            <Input
              id="min-version"
              value={form.minVersion}
              onChange={(e: ChangeEvent<HTMLInputElement>) => update("minVersion", e.target.value)}
              placeholder="1.2.0"
              disabled={loading}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="latest-version">Versiune recentă (opțional)</Label>
            <Input
              id="latest-version"
              value={form.latestVersion}
              onChange={(e: ChangeEvent<HTMLInputElement>) => update("latestVersion", e.target.value)}
              placeholder="1.3.0"
              disabled={loading}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="ios-url">URL App Store</Label>
            <Input
              id="ios-url"
              type="url"
              value={form.iosUrl}
              onChange={(e: ChangeEvent<HTMLInputElement>) => update("iosUrl", e.target.value)}
              placeholder="https://apps.apple.com/..."
              disabled={loading}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="android-url">URL Google Play</Label>
            <Input
              id="android-url"
              type="url"
              value={form.androidUrl}
              onChange={(e: ChangeEvent<HTMLInputElement>) => update("androidUrl", e.target.value)}
              placeholder="https://play.google.com/store/apps/details?id=..."
              disabled={loading}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="message">Mesaj (opțional)</Label>
          <Textarea
            id="message"
            value={form.message}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => update("message", e.target.value)}
            placeholder="O versiune nouă a aplicației este disponibilă cu îmbunătățiri importante."
            rows={3}
            disabled={loading}
          />
        </div>

        <Button onClick={saveAll} disabled={loading || saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
          Salvează setările URL + mesaj
        </Button>
      </CardContent>
    </Card>
  )
}
