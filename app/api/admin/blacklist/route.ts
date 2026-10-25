import { createHash } from "node:crypto"
import { FieldValue } from "firebase-admin/firestore"
import { NextResponse } from "next/server"
import { authorizeAdminRequest } from "@/lib/admin-api-auth"
import { adminDb } from "@/lib/firebase-admin"
import { MOBILE_BOOKING_BLACKLIST_COLLECTION } from "@/lib/mobile-booking-blacklist"
import { normalizeLicensePlate } from "@/lib/utils"

export async function GET(request: Request) {
  const auth = await authorizeAdminRequest(request, ["admin"])
  if (!auth.ok) return auth.response
  try {
    const snapshot = await adminDb.collection(MOBILE_BOOKING_BLACKLIST_COLLECTION).get()
    const entries = snapshot.docs.map(doc => {
      const data = doc.data()
      return {
        id: doc.id,
        name: String(data.name || ""),
        email: String(data.email || ""),
        licensePlate: String(data.licensePlate || ""),
        createdAt: data.createdAt?.toDate?.().toISOString() || null,
      }
    }).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
    return NextResponse.json({ success: true, entries }, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return NextResponse.json({ error: "Nu s-a putut încărca lista clienților blocați." }, { status: 503 })
  }
}

export async function POST(request: Request) {
  const auth = await authorizeAdminRequest(request, ["admin"])
  if (!auth.ok) return auth.response
  const body = await request.json().catch(() => null)
  const name = typeof body?.name === "string" ? body.name.trim() : ""
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : ""
  const licensePlate = typeof body?.licensePlate === "string" ? normalizeLicensePlate(body.licensePlate) : ""
  if (!name || name.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !licensePlate || licensePlate.length > 32) {
    return NextResponse.json({ error: "Completează numele, un email valid și numărul de înmatriculare." }, { status: 400 })
  }
  // One atomic create per normalized email/plate pair prevents duplicate concurrent submissions.
  const id = createHash("sha256").update(JSON.stringify([email, licensePlate])).digest("hex")
  try {
    await adminDb.collection(MOBILE_BOOKING_BLACKLIST_COLLECTION).doc(id).create({
      name, email, licensePlate,
      createdAt: FieldValue.serverTimestamp(),
      createdByUid: auth.user.uid,
    })
    return NextResponse.json({ success: true, id }, { status: 201 })
  } catch (error) {
    if ((error as { code?: unknown })?.code === 6) {
      return NextResponse.json({ error: "Acest email și număr de înmatriculare sunt deja în listă." }, { status: 409 })
    }
    return NextResponse.json({ error: "Nu s-a putut adăuga persoana. Încearcă din nou." }, { status: 503 })
  }
}

export async function DELETE(request: Request) {
  const auth = await authorizeAdminRequest(request, ["admin"])
  if (!auth.ok) return auth.response
  const body = await request.json().catch(() => null)
  if (typeof body?.id !== "string" || !/^[a-f0-9]{64}$/.test(body.id)) {
    return NextResponse.json({ error: "Înregistrare invalidă." }, { status: 400 })
  }
  try {
    await adminDb.collection(MOBILE_BOOKING_BLACKLIST_COLLECTION).doc(body.id).delete()
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: "Nu s-a putut șterge persoana. Încearcă din nou." }, { status: 503 })
  }
}
