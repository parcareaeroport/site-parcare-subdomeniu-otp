import { NextResponse } from "next/server"
import { adminAuth } from "@/lib/firebase-admin"
import { isAdminRole } from "@/lib/admin-roles"
import {
  collection,
  db,
  getDocs,
  query,
  where,
} from "@/lib/server-firestore"

export type MobileUser = {
  uid: string
  email: string | null
  isAnonymous: boolean
  isGuest: boolean
}

async function resolveGuestByEmail(
  email: string
): Promise<{ uid: string; email: string } | null> {
  const normalized = email.trim().toLowerCase()
  if (!normalized) return null

  const guestsRef = collection(db, "guests")
  const q = query(guestsRef, where("email", "==", normalized))
  const snap = await getDocs(q)

  if (snap.empty) return null

  const doc = snap.docs[0]
  return { uid: doc.id, email: normalized }
}

export async function verifyMobileUser(
  request: Request
): Promise<{ ok: true; user: MobileUser } | { ok: false; response: NextResponse }> {
  const authHeader =
    request.headers.get("authorization") || request.headers.get("Authorization")
  const bearerMatch = authHeader?.match(/^Bearer\s+(.+)$/i)

  if (bearerMatch) {
    const idToken = bearerMatch[1].trim().replace(/^"|"$/g, "")
    if (idToken) {
      try {
        const decoded = await adminAuth.verifyIdToken(idToken)

        if (isAdminRole(decoded.role)) {
          return {
            ok: false,
            response: NextResponse.json(
              { error: "Admin accounts cannot use mobile API" },
              { status: 403 }
            ),
          }
        }

        const signInProvider =
          (decoded.firebase as { sign_in_provider?: string } | undefined)?.sign_in_provider

        return {
          ok: true,
          user: {
            uid: decoded.uid,
            email: decoded.email || null,
            isAnonymous:
              signInProvider === "anonymous" ||
              (!decoded.email && signInProvider === undefined),
            isGuest: false,
          },
        }
      } catch (error) {
        console.error("[mobile-api-auth] Failed to verify bearer token.", {
          error: error instanceof Error ? error.message : error,
        })
        return {
          ok: false,
          response: NextResponse.json({ error: "Invalid token" }, { status: 401 }),
        }
      }
    }
  }

  const guestEmail = request.headers.get("x-guest-email")
  if (guestEmail) {
    try {
      const guest = await resolveGuestByEmail(guestEmail)
      if (!guest) {
        console.warn("[mobile-api-auth] Guest not found for email.", {
          guestEmail: guestEmail.trim().toLowerCase(),
        })
        return {
          ok: false,
          response: NextResponse.json(
            { error: "Guest not found for this email" },
            { status: 401 }
          ),
        }
      }
      return {
        ok: true,
        user: {
          uid: guest.uid,
          email: guest.email,
          isAnonymous: false,
          isGuest: true,
        },
      }
    } catch (error) {
      console.error("[mobile-api-auth] Guest lookup failed.", error)
      return {
        ok: false,
        response: NextResponse.json({ error: "Guest lookup failed" }, { status: 500 }),
      }
    }
  }

  return {
    ok: false,
    response: NextResponse.json(
      { error: "Missing authentication (bearer token or guest email)" },
      { status: 401 }
    ),
  }
}
