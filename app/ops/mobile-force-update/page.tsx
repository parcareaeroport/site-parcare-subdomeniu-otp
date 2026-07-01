"use client"

import { useState } from "react"
import { Loader2, Save, ShieldAlert, Smartphone } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
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

const EMPTY_FORM: AppUpdateForm = {
  enabled: false,
  forceUpdate: false,
  minVersion: "1",
  latestVersion: "",
  iosUrl: "",
  androidUrl: "",
  message: "",
}

export default function MobileForceUpdateOpsPage() {
  const { toast } = useToast()
  const [password, setPassword] = useState("")
  const [authenticated, setAuthenticated] = useState(false)
  const [form, setForm] = useState<AppUpdateForm>(EMPTY_FORM)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const callApi = async (action: "get" | "save", appUpdate?: AppUpdateForm) => {
    const response = await fetch("/api/ops/mobile-force-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, action, appUpdate }),
    })
    const data = await response.json()
    if (!response.ok || !data.success) {
      throw new Error(data.error || "Request failed")
    }
    return data
  }

  const handleLogin = async () => {
    setLoading(true)
    try {
      const data = await callApi("get")
      const appUpdate = data.appUpdate || {}
      setForm({
        enabled: !!appUpdate.enabled,
        forceUpdate: !!appUpdate.forceUpdate,
        minVersion: appUpdate.minVersion || "1",
        latestVersion: appUpdate.latestVersion || "",
        iosUrl: appUpdate.iosUrl || "",
        androidUrl: appUpdate.androidUrl || "",
        message: appUpdate.message || "",
      })
      setAuthenticated(true)
    } catch {
      toast({
        title: "Acces refuzat",
        description: "Parola este incorectă.",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const data = await callApi("save", form)
      const appUpdate = data.appUpdate || {}
      setForm({
        enabled: !!appUpdate.enabled,
        forceUpdate: !!appUpdate.forceUpdate,
        minVersion: appUpdate.minVersion || form.minVersion,
        latestVersion: appUpdate.latestVersion || "",
        iosUrl: appUpdate.iosUrl || "",
        androidUrl: appUpdate.androidUrl || "",
        message: appUpdate.message || "",
      })
      toast({
        title: "Salvat",
        description: "Setările de update forțat au fost actualizate.",
      })
    } catch (error) {
      toast({
        title: "Eroare",
        description: error instanceof Error ? error.message : "Nu s-a putut salva.",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const update = <K extends keyof AppUpdateForm>(key: K, value: AppUpdateForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-10">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-orange-100">
            <Smartphone className="h-7 w-7 text-orange-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Update forțat app mobil</h1>
          <p className="mt-2 text-sm text-slate-600">
            Pagină ascunsă — nu apare în meniul admin. La fiecare build EAS, numărul de build nativ
            (iOS/Android) crește automat (`autoIncrement` + `appVersionSource: remote`).
          </p>
        </div>

        {!authenticated ? (
          <Card>
            <CardHeader>
              <CardTitle>Autentificare</CardTitle>
              <CardDescription>Introdu parola de acces pentru a gestiona update-ul forțat.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">Parolă</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleLogin()
                  }}
                  autoComplete="current-password"
                />
              </div>
              <Button onClick={() => void handleLogin()} disabled={loading || !password.trim()}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Intră
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card className="border-orange-200 bg-orange-50/60">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-orange-900">
                  <ShieldAlert className="h-5 w-5" />
                  Cum funcționează
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-orange-950">
                <p>
                  1. Fiecare build EAS incrementează automat build number-ul nativ (vezi build logs sau
                  expo.dev → Builds).
                </p>
                <p>
                  2. Activează update-ul și setează versiunea minimă = acel build number (ex: 8).
                  Utilizatorii cu build mai mic văd modalul.
                </p>
                <p>
                  3. Cu „Forțat” activ, modalul nu se poate închide — doar actualizare din App Store /
                  Google Play.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Setări update</CardTitle>
                <CardDescription>
                  Valoarea minimă se compară cu build number-ul din app (EAS autoIncrement).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <Label htmlFor="enabled">Update activ</Label>
                    <p className="text-sm text-muted-foreground">
                      Pornește verificarea versiunii în aplicația mobilă.
                    </p>
                  </div>
                  <Switch
                    id="enabled"
                    checked={form.enabled}
                    onCheckedChange={(checked) => update("enabled", checked)}
                  />
                </div>

                <div className="flex items-center justify-between gap-4">
                  <div>
                    <Label htmlFor="forceUpdate">Update forțat</Label>
                    <p className="text-sm text-muted-foreground">
                      Blochează aplicația până la actualizare din magazin.
                    </p>
                  </div>
                  <Switch
                    id="forceUpdate"
                    checked={form.forceUpdate}
                    disabled={!form.enabled}
                    onCheckedChange={(checked) => update("forceUpdate", checked)}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="minVersion">Versiune minimă (cod build)</Label>
                    <Input
                      id="minVersion"
                      value={form.minVersion}
                      onChange={(e) => update("minVersion", e.target.value)}
                      placeholder="2"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="latestVersion">Versiune recomandată (opțional)</Label>
                    <Input
                      id="latestVersion"
                      value={form.latestVersion}
                      onChange={(e) => update("latestVersion", e.target.value)}
                      placeholder="2.0.0"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="iosUrl">Link App Store</Label>
                  <Input
                    id="iosUrl"
                    value={form.iosUrl}
                    onChange={(e) => update("iosUrl", e.target.value)}
                    placeholder="https://apps.apple.com/app/..."
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="androidUrl">Link Google Play</Label>
                  <Input
                    id="androidUrl"
                    value={form.androidUrl}
                    onChange={(e) => update("androidUrl", e.target.value)}
                    placeholder="https://play.google.com/store/apps/details?id=..."
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="message">Mesaj personalizat (opțional)</Label>
                  <Textarea
                    id="message"
                    value={form.message}
                    onChange={(e) => update("message", e.target.value)}
                    rows={3}
                    placeholder="Te rugăm să actualizezi aplicația pentru a continua."
                  />
                </div>

                <Button onClick={() => void handleSave()} disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Salvează setările
                </Button>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}
