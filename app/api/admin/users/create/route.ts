import { NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"
import { authorizeAdminRequest } from "@/lib/admin-api-auth"
import { adminAuth, adminDb } from "@/lib/firebase-admin"

type Body = {
  name?: string
  email?: string
  password?: string
}

export async function POST(request: Request) {
  const authResult = await authorizeAdminRequest(request, ["admin"])
  if (!authResult.ok) {
    return authResult.response
  }

  try {
    const body = (await request.json().catch(() => ({}))) as Body
    const name = String(body.name || "").trim()
    const email = String(body.email || "")
      .trim()
      .toLowerCase()
    const password = String(body.password || "").trim()

    if (!name) {
      return NextResponse.json({ error: "Numele este obligatoriu." }, { status: 400 })
    }
    if (!email) {
      return NextResponse.json({ error: "Emailul este obligatoriu." }, { status: 400 })
    }
    if (password.length < 6) {
      return NextResponse.json({ error: "Parola trebuie să aibă minimum 6 caractere." }, { status: 400 })
    }

    try {
      await adminAuth.getUserByEmail(email)
      return NextResponse.json({ error: "Există deja un cont cu acest email." }, { status: 409 })
    } catch (error: any) {
      if (error?.code !== "auth/user-not-found") {
        throw error
      }
    }

    const createdUser = await adminAuth.createUser({
      displayName: name,
      email,
      password,
      emailVerified: false,
    })

    await adminAuth.setCustomUserClaims(createdUser.uid, { role: "entriesOperator" })

    await adminDb.collection("users").doc(createdUser.uid).set(
      {
        uid: createdUser.uid,
        name,
        email,
        role: "entriesOperator",
        active: true,
        createdAt: FieldValue.serverTimestamp(),
        createdByUid: authResult.user.uid,
        createdByEmail: authResult.user.email,
      },
      { merge: true },
    )

    return NextResponse.json({
      success: true,
      user: {
        uid: createdUser.uid,
        email,
        name,
        role: "entriesOperator",
      },
    })
  } catch (error: any) {
    console.error("[admin/users/create] Failed to create employee account.", error)

    if (error?.code === "auth/email-already-exists") {
      return NextResponse.json({ error: "Există deja un cont cu acest email." }, { status: 409 })
    }

    return NextResponse.json({ error: "Nu am putut crea contul angajatului." }, { status: 500 })
  }
}
