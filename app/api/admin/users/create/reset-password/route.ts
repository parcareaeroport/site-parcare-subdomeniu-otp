import { NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"
import { authorizeAdminRequest } from "@/lib/admin-api-auth"
import { adminAuth, adminDb } from "@/lib/firebase-admin"

type Body = {
  uid?: string
  password?: string
}

export async function POST(request: Request) {
  const authResult = await authorizeAdminRequest(request, ["admin"])
  if (!authResult.ok) {
    return authResult.response
  }

  try {
    const body = (await request.json().catch(() => ({}))) as Body
    const uid = String(body.uid || "").trim()
    const password = String(body.password || "").trim()

    if (!uid) {
      return NextResponse.json({ error: "UID-ul utilizatorului este obligatoriu." }, { status: 400 })
    }
    if (password.length < 6) {
      return NextResponse.json({ error: "Parola trebuie să aibă minimum 6 caractere." }, { status: 400 })
    }

    const userDocRef = adminDb.collection("users").doc(uid)
    const userDoc = await userDocRef.get()
    if (!userDoc.exists) {
      return NextResponse.json({ error: "Contul selectat nu există." }, { status: 404 })
    }

    const userData = userDoc.data() as { role?: string; email?: string; name?: string } | undefined
    if (userData?.role !== "entriesOperator") {
      return NextResponse.json({ error: "Poți reseta parola doar pentru conturi Entries/Exits." }, { status: 403 })
    }

    await adminAuth.updateUser(uid, { password })
    await adminAuth.revokeRefreshTokens(uid)

    await userDocRef.set(
      {
        passwordUpdatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedByUid: authResult.user.uid,
        updatedByEmail: authResult.user.email,
      },
      { merge: true },
    )

    return NextResponse.json({
      success: true,
      user: {
        uid,
        email: String(userData?.email || "").trim().toLowerCase(),
        name: String(userData?.name || "").trim(),
      },
    })
  } catch (error: any) {
    console.error("[admin/users/create/reset-password] Failed to reset password.", error)

    if (error?.code === "auth/user-not-found") {
      return NextResponse.json({ error: "Contul din Firebase Auth nu mai există." }, { status: 404 })
    }

    return NextResponse.json({ error: "Nu am putut reseta parola contului." }, { status: 500 })
  }
}
