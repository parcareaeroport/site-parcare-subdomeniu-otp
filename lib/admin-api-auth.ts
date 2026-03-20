import { NextResponse } from "next/server"
import { adminAuth } from "@/lib/firebase-admin"
import { normalizeAdminRole, type AdminRole } from "@/lib/admin-roles"

type AuthorizedUser = {
  uid: string
  email: string | null
  role: AdminRole
}

export async function authorizeAdminRequest(
  request: Request,
  allowedRoles: AdminRole[],
): Promise<{ ok: true; user: AuthorizedUser } | { ok: false; response: NextResponse }> {
  const authHeader = request.headers.get("authorization") || request.headers.get("Authorization")
  const bearerMatch = authHeader?.match(/^Bearer\s+(.+)$/i)
  if (!bearerMatch) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Missing bearer token" }, { status: 401 }),
    }
  }

  const idToken = bearerMatch[1].trim().replace(/^"|"$/g, "")
  if (!idToken) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Missing bearer token" }, { status: 401 }),
    }
  }

  try {
    const decoded = await adminAuth.verifyIdToken(idToken)
    const role = normalizeAdminRole(decoded.role, decoded.email)
    if (!allowedRoles.includes(role)) {
      return {
        ok: false,
        response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
      }
    }

    return {
      ok: true,
      user: {
        uid: decoded.uid,
        email: decoded.email || null,
        role,
      },
    }
  } catch (error) {
    console.error("[admin-api-auth] Failed to verify token.", error)
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid token" }, { status: 401 }),
    }
  }
}
