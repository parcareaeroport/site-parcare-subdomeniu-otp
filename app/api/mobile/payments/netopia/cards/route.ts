import { verifyMobileUser } from "@/lib/mobile-api-auth"
import { mobileJsonResponse, mobileOptionsResponse } from "@/lib/mobile-cors"

export async function OPTIONS() {
  return mobileOptionsResponse()
}

/** Lists NETOPIA tokenized cards — populated after tokenization is enabled. */
export async function GET(request: Request) {
  const auth = await verifyMobileUser(request)
  if (!auth.ok) return auth.response

  if (auth.user.isGuest) {
    return mobileJsonResponse({ success: true, cards: [] })
  }

  // TODO: load saved NETOPIA tokens from user profile (saveNetopiaCardToken backend).
  return mobileJsonResponse({ success: true, cards: [] })
}
