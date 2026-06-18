import { verifyMobileUser } from "@/lib/mobile-api-auth"
import { mobileJsonResponse, mobileOptionsResponse } from "@/lib/mobile-cors"
import { removeMobileUserCar, updateMobileUserCar } from "@/lib/mobile-user-service"

export async function OPTIONS() {
  return mobileOptionsResponse()
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ carId: string }> }
) {
  const auth = await verifyMobileUser(request)
  if (!auth.ok) return auth.response

  const col = auth.user.isGuest ? "guests" as const : "users" as const

  try {
    const { carId } = await params
    const body = await request.json()
    const { plate, model, type } = body || {}

    if (!plate && !model && !type) {
      return mobileJsonResponse(
        { success: false, error: "At least one field required: plate, model, type" },
        400
      )
    }

    const cars = await updateMobileUserCar(auth.user.uid, carId, {
      ...(plate !== undefined ? { plate: String(plate) } : {}),
      ...(model !== undefined ? { model: String(model) } : {}),
      ...(type !== undefined ? { type: String(type) } : {}),
    }, col)

    return mobileJsonResponse({ success: true, cars })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    const status = message === "Car not found" ? 404 : 500
    return mobileJsonResponse({ success: false, error: message }, status)
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ carId: string }> }
) {
  const auth = await verifyMobileUser(request)
  if (!auth.ok) return auth.response

  const col = auth.user.isGuest ? "guests" as const : "users" as const

  try {
    const { carId } = await params
    const cars = await removeMobileUserCar(auth.user.uid, carId, col)
    return mobileJsonResponse({ success: true, cars })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return mobileJsonResponse({ success: false, error: message }, 500)
  }
}
