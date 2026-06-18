import { verifyMobileUser } from "@/lib/mobile-api-auth"
import { mobileJsonResponse, mobileOptionsResponse } from "@/lib/mobile-cors"
import {
  ensureMobileUserProfile,
  getMobileUserProfile,
  patchMobileUserProfileAllowed,
} from "@/lib/mobile-user-service"

export async function OPTIONS() {
  return mobileOptionsResponse()
}

export async function GET(request: Request) {
  const auth = await verifyMobileUser(request)
  if (!auth.ok) return auth.response

  const col = auth.user.isGuest ? "guests" as const : "users" as const

  try {
    const profile =
      (await getMobileUserProfile(auth.user.uid, col)) ||
      (await ensureMobileUserProfile(auth.user.uid, auth.user.email, undefined, col))

    return mobileJsonResponse({ success: true, profile })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return mobileJsonResponse({ success: false, error: message }, 500)
  }
}

export async function POST(request: Request) {
  const auth = await verifyMobileUser(request)
  if (!auth.ok) return auth.response

  const col = auth.user.isGuest ? "guests" as const : "users" as const

  try {
    const body = await request.json()
    const profile = await ensureMobileUserProfile(auth.user.uid, auth.user.email, body, col)
    return mobileJsonResponse({ success: true, profile }, 201)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return mobileJsonResponse({ success: false, error: message }, 500)
  }
}

export async function PATCH(request: Request) {
  const auth = await verifyMobileUser(request)
  if (!auth.ok) return auth.response

  const col = auth.user.isGuest ? "guests" as const : "users" as const

  try {
    const body = await request.json()
    const profile = await patchMobileUserProfileAllowed(
      auth.user.uid,
      auth.user.email,
      body,
      col
    )
    return mobileJsonResponse({ success: true, profile })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return mobileJsonResponse({ success: false, error: message }, 500)
  }
}
