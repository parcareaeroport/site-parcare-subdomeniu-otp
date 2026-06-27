"use client"

import { useState, useEffect, type ChangeEvent } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Loader2, Save, Smartphone, Gift, CreditCard } from "lucide-react"
import { db } from "@/lib/firebase"
import { doc, setDoc, onSnapshot } from "firebase/firestore"
import { useToast } from "@/components/ui/use-toast"
import { DEFAULT_LOYALTY_PROGRAM } from "@/lib/mobile-app-settings"

type AppUpdateForm = {
  enabled: boolean
  forceUpdate: boolean
  minVersion: string
  latestVersion: string
  iosUrl: string
  androidUrl: string
  message: string
}

type LoyaltyProgramForm = {
  enabled: boolean
  reservationsPerFreeDay: string
  freeDayHours: string
  maxBillableDaysForAutoRedeem: string
  homeMessageTemplate: string
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

const DEFAULT_LOYALTY_FORM: LoyaltyProgramForm = {
  enabled: DEFAULT_LOYALTY_PROGRAM.enabled,
  reservationsPerFreeDay: String(DEFAULT_LOYALTY_PROGRAM.reservationsPerFreeDay),
  freeDayHours: String(DEFAULT_LOYALTY_PROGRAM.freeDayHours),
  maxBillableDaysForAutoRedeem: String(DEFAULT_LOYALTY_PROGRAM.maxBillableDaysForAutoRedeem),
  homeMessageTemplate: "",
}

export function MobileAppSettingsManager() {
  const { toast } = useToast()
  const [form, setForm] = useState<AppUpdateForm>(DEFAULT_FORM)
  const [loyaltyForm, setLoyaltyForm] = useState<LoyaltyProgramForm>(DEFAULT_LOYALTY_FORM)
  const [testPaymentEnabled, setTestPaymentEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savingLoyalty, setSavingLoyalty] = useState(false)
  const [savingTestPayment, setSavingTestPayment] = useState(false)

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "config", "mobileAppSettings"),
      (snap) => {
        const data = snap.data() || {}
        const appUpdate = (data.appUpdate || {}) as Partial<AppUpdateForm>
        const loyaltyProgram = (data.loyaltyProgram || {}) as Partial<LoyaltyProgramForm & { enabled?: boolean }>
        setForm({
          enabled: !!appUpdate.enabled,
          forceUpdate: !!appUpdate.forceUpdate,
          minVersion: appUpdate.minVersion || "1.0.0",
          latestVersion: appUpdate.latestVersion || "",
          iosUrl: appUpdate.iosUrl || "",
          androidUrl: appUpdate.androidUrl || "",
          message: appUpdate.message || "",
        })
        setLoyaltyForm({
          enabled: loyaltyProgram.enabled !== false,
          reservationsPerFreeDay: String(
            loyaltyProgram.reservationsPerFreeDay ?? DEFAULT_LOYALTY_PROGRAM.reservationsPerFreeDay
          ),
          freeDayHours: String(loyaltyProgram.freeDayHours ?? DEFAULT_LOYALTY_PROGRAM.freeDayHours),
          maxBillableDaysForAutoRedeem: String(
            loyaltyProgram.maxBillableDaysForAutoRedeem ??
              DEFAULT_LOYALTY_PROGRAM.maxBillableDaysForAutoRedeem
          ),
          homeMessageTemplate: loyaltyProgram.homeMessageTemplate || "",
        })
        setTestPaymentEnabled(!!data.testPaymentEnabled)
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

  const updateLoyalty = <K extends keyof LoyaltyProgramForm>(
    key: K,
    value: LoyaltyProgramForm[K]
  ) => {
    setLoyaltyForm((prev) => ({ ...prev, [key]: value }))
  }

  const saveLoyalty = async () => {
    setSavingLoyalty(true)
    try {
      await setDoc(
        doc(db, "config", "mobileAppSettings"),
        {
          loyaltyProgram: {
            enabled: loyaltyForm.enabled,
            reservationsPerFreeDay:
              parseInt(loyaltyForm.reservationsPerFreeDay, 10) ||
              DEFAULT_LOYALTY_PROGRAM.reservationsPerFreeDay,
            freeDayHours:
              parseInt(loyaltyForm.freeDayHours, 10) || DEFAULT_LOYALTY_PROGRAM.freeDayHours,
            maxBillableDaysForAutoRedeem:
              parseInt(loyaltyForm.maxBillableDaysForAutoRedeem, 10) ||
              DEFAULT_LOYALTY_PROGRAM.maxBillableDaysForAutoRedeem,
            homeMessageTemplate: loyaltyForm.homeMessageTemplate.trim() || null,
          },
        },
        { merge: true }
      )
      toast({ title: "Salvat", description: "Programul de loialitate a fost actualizat." })
    } catch (err) {
      console.error(err)
      toast({
        title: "Eroare",
        description: "Salvarea programului de loialitate a eșuat.",
        variant: "destructive",
      })
    } finally {
      setSavingLoyalty(false)
    }
  }

  const toggleTestPaymentEnabled = async (value: boolean) => {
    setTestPaymentEnabled(value)
    setSavingTestPayment(true)
    try {
      await setDoc(
        doc(db, "config", "mobileAppSettings"),
        { testPaymentEnabled: value },
        { merge: true }
      )
      toast({
        title: value ? "Plată test activată" : "Plată test dezactivată",
        description: value
          ? "Aplicația mobilă poate confirma rezervări fără NETOPIA."
          : "Endpoint-ul demo-payment este blocat pe server.",
      })
    } catch (err) {
      console.error(err)
      setTestPaymentEnabled(!value)
      toast({
        title: "Eroare",
        description: "Nu s-a putut actualiza setarea de plată test.",
        variant: "destructive",
      })
    } finally {
      setSavingTestPayment(false)
    }
  }

  const toggleLoyaltyEnabled = async (value: boolean) => {
    updateLoyalty("enabled", value)
    setSavingLoyalty(true)
    try {
      await setDoc(
        doc(db, "config", "mobileAppSettings"),
        { loyaltyProgram: { enabled: value } },
        { merge: true }
      )
    } catch (err) {
      console.error(err)
      updateLoyalty("enabled", !value)
      toast({
        title: "Eroare",
        description: "Nu s-a putut actualiza programul de loialitate.",
        variant: "destructive",
      })
    } finally {
      setSavingLoyalty(false)
    }
  }

  return (
    <>
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-5 w-5" />
          Plată test — Aplicație mobilă
        </CardTitle>
        <CardDescription>
          Permite confirmarea rezervărilor fără redirect NETOPIA (rezervări marcate test_mode, fără
          factură Oblio). Dezactivează înainte de producție.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label htmlFor="test-payment-enabled">Plată test (bypass NETOPIA)</Label>
            <p className="text-sm text-muted-foreground">
              Necesită și EXPO_PUBLIC_DEMO_PAYMENT=true în build-ul app, sau doar acest switch pentru
              control server-side.
            </p>
          </div>
          <Switch
            id="test-payment-enabled"
            checked={testPaymentEnabled}
            onCheckedChange={toggleTestPaymentEnabled}
            disabled={loading || savingTestPayment}
          />
        </div>
      </CardContent>
    </Card>

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

    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gift className="h-5 w-5" />
          Program loialitate — Aplicație mobilă
        </CardTitle>
        <CardDescription>
          Configurează oferta de loialitate afișată și aplicată în aplicația mobilă (ex: 4 rezervări = 1
          zi gratuită).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label htmlFor="loyalty-enabled">Program activ</Label>
            <p className="text-sm text-muted-foreground">
              Când e activ, rezervările mobile confirmate acumulează progres spre zile gratuite.
            </p>
          </div>
          <Switch
            id="loyalty-enabled"
            checked={loyaltyForm.enabled}
            onCheckedChange={toggleLoyaltyEnabled}
            disabled={loading || savingLoyalty}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="loyalty-reservations">Rezervări pentru 1 zi gratuită</Label>
            <Input
              id="loyalty-reservations"
              type="number"
              min={1}
              value={loyaltyForm.reservationsPerFreeDay}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                updateLoyalty("reservationsPerFreeDay", e.target.value)
              }
              disabled={loading}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="loyalty-hours">Durată recompensă (ore)</Label>
            <Input
              id="loyalty-hours"
              type="number"
              min={1}
              value={loyaltyForm.freeDayHours}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                updateLoyalty("freeDayHours", e.target.value)
              }
              disabled={loading}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="loyalty-max-days">Zile max. pentru auto-redeem</Label>
            <Input
              id="loyalty-max-days"
              type="number"
              min={1}
              value={loyaltyForm.maxBillableDaysForAutoRedeem}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                updateLoyalty("maxBillableDaysForAutoRedeem", e.target.value)
              }
              disabled={loading}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="loyalty-message">Mesaj Home (opțional)</Label>
          <Textarea
            id="loyalty-message"
            value={loyaltyForm.homeMessageTemplate}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
              updateLoyalty("homeMessageTemplate", e.target.value)
            }
            placeholder="Încă {remaining} rezervări până la 1 zi gratuită"
            rows={2}
            disabled={loading}
          />
          <p className="text-xs text-muted-foreground">
            Placeholder-e: {"{remaining}"}, {"{freeDaysAvailable}"}, {"{reservationsPerFreeDay}"}
          </p>
        </div>

        <Button onClick={saveLoyalty} disabled={loading || savingLoyalty}>
          {savingLoyalty ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Salvează program loialitate
        </Button>
      </CardContent>
    </Card>
    </>
  )
}
