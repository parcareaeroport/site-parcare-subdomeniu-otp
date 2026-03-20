import { NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"
import { authorizeAdminRequest } from "@/lib/admin-api-auth"
import { adminAuth, adminDb } from "@/lib/firebase-admin"

type Body = {
  name?: string
  email?: string
  password?: string
}

type PatchBody = {
  uid?: string
  active?: boolean
}

type DeleteBody = {
  uid?: string
}

async function authorizeAdminOnly(request: Request) {
  const authResult = await authorizeAdminRequest(request, ["admin"])
  if (!authResult.ok) {
    return authResult
  }

  return authResult
}

export async function GET(request: Request) {
  const authResult = await authorizeAdminOnly(request)
  if (!authResult.ok) {
    return authResult.response
  }

  try {
    const snapshot = await adminDb.collection("users").where("role", "==", "entriesOperator").get()

    const users = snapshot.docs
      .map((doc) => {
        const data = doc.data() as {
          uid?: string
          name?: string
          email?: string
          active?: boolean
          createdAt?: { toDate?: () => Date }
          createdByEmail?: string | null
        }

        const createdAtDate =
          typeof data?.createdAt?.toDate === "function" ? data.createdAt.toDate() : null

        return {
          uid: data.uid || doc.id,
          name: String(data.name || "").trim(),
          email: String(data.email || "").trim().toLowerCase(),
          active: data.active !== false,
          createdAt: createdAtDate ? createdAtDate.toISOString() : null,
          createdByEmail: data.createdByEmail || null,
        }
      })
      .sort((a, b) => {
        const aTs = a.createdAt ? Date.parse(a.createdAt) : 0
        const bTs = b.createdAt ? Date.parse(b.createdAt) : 0
        return bTs - aTs
      })

    return NextResponse.json({ success: true, users })
  } catch (error) {
    console.error("[admin/users/create] Failed to load entries operators.", error)
    return NextResponse.json({ error: "Nu am putut încărca lista de conturi Entries/Exits." }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const authResult = await authorizeAdminOnly(request)
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

export async function PATCH(request: Request) {
  const authResult = await authorizeAdminOnly(request)
  if (!authResult.ok) {
    return authResult.response
  }

  try {
    const body = (await request.json().catch(() => ({}))) as PatchBody
    const uid = String(body.uid || "").trim()
    const active = body.active

    if (!uid) {
      return NextResponse.json({ error: "UID-ul utilizatorului este obligatoriu." }, { status: 400 })
    }
    if (typeof active !== "boolean") {
      return NextResponse.json({ error: "Câmpul active trebuie să fie true sau false." }, { status: 400 })
    }

    const userDocRef = adminDb.collection("users").doc(uid)
    const userDoc = await userDocRef.get()
    if (!userDoc.exists) {
      return NextResponse.json({ error: "Contul selectat nu există." }, { status: 404 })
    }

    const userData = userDoc.data() as { role?: string; email?: string; name?: string } | undefined
    if (userData?.role !== "entriesOperator") {
      return NextResponse.json({ error: "Poți modifica doar conturi Entries/Exits." }, { status: 403 })
    }

    await adminAuth.updateUser(uid, { disabled: !active })

    await userDocRef.set(
      {
        active,
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
        active,
        email: String(userData?.email || "").trim().toLowerCase(),
        name: String(userData?.name || "").trim(),
      },
    })
  } catch (error: any) {
    console.error("[admin/users/create] Failed to update user status.", error)

    if (error?.code === "auth/user-not-found") {
      return NextResponse.json({ error: "Contul din Firebase Auth nu mai există." }, { status: 404 })
    }

    return NextResponse.json({ error: "Nu am putut actualiza statusul contului." }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const authResult = await authorizeAdminOnly(request)
  if (!authResult.ok) {
    return authResult.response
  }

  try {
    const body = (await request.json().catch(() => ({}))) as DeleteBody
    const uid = String(body.uid || "").trim()

    if (!uid) {
      return NextResponse.json({ error: "UID-ul utilizatorului este obligatoriu." }, { status: 400 })
    }

    const userDocRef = adminDb.collection("users").doc(uid)
    const userDoc = await userDocRef.get()
    if (!userDoc.exists) {
      return NextResponse.json({ error: "Contul selectat nu există." }, { status: 404 })
    }

    const userData = userDoc.data() as { role?: string; email?: string; name?: string } | undefined
    if (userData?.role !== "entriesOperator") {
      return NextResponse.json({ error: "Poți șterge doar conturi Entries/Exits." }, { status: 403 })
    }

    try {
      await adminAuth.deleteUser(uid)
    } catch (error: any) {
      if (error?.code !== "auth/user-not-found") {
        throw error
      }
    }

    await userDocRef.delete()

    return NextResponse.json({
      success: true,
      user: {
        uid,
        email: String(userData?.email || "").trim().toLowerCase(),
        name: String(userData?.name || "").trim(),
      },
    })
  } catch (error) {
    console.error("[admin/users/create] Failed to delete user.", error)
    return NextResponse.json({ error: "Nu am putut șterge contul angajatului." }, { status: 500 })
  }
}
