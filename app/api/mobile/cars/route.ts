import { verifyMobileUser } from "@/lib/mobile-api-auth"
import { mobileJsonResponse, mobileOptionsResponse } from "@/lib/mobile-cors"
import { addMobileUserCar, listMobileUserCars } from "@/lib/mobile-user-service"

export async function OPTIONS() {
  return mobileOptionsResponse()
}

export async function GET(request: Request) {
  const auth = await verifyMobileUser(request)
  if (!auth.ok) return auth.response

  const col = auth.user.isGuest ? "guests" as const : "users" as const

  try {
    const cars = await listMobileUserCars(auth.user.uid, col)
    return mobileJsonResponse({ success: true, cars })
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
    const { plate, model, type } = body || {}

    if (!plate || !model) {
      return mobileJsonResponse(
        { success: false, error: "Missing required fields: plate, model" },
        400
      )
    }

    const cars = await addMobileUserCar(auth.user.uid, {
      plate: String(plate),
      model: String(model),
      type: type ? String(type) : "Standard",
    }, col)

    return mobileJsonResponse({ success: true, cars }, 201)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return mobileJsonResponse({ success: false, error: message }, 500)
  }
}
