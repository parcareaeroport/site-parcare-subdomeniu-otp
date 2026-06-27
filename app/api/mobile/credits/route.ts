import { verifyMobileUser } from "@/lib/mobile-api-auth"
import { mobileJsonResponse, mobileOptionsResponse } from "@/lib/mobile-cors"
import { getUserCreditBalance } from "@/lib/user-credits"

export async function OPTIONS() {
  return mobileOptionsResponse()
}

export async function GET(request: Request) {
  const auth = await verifyMobileUser(request)
  if (!auth.ok) return auth.response

  const balance = await getUserCreditBalance(auth.user.uid)
  return mobileJsonResponse({ success: true, balance })
}

