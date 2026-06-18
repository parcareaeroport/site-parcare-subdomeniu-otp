import { mobileJsonResponse, mobileOptionsResponse } from "@/lib/mobile-cors"

export async function OPTIONS() {
  return mobileOptionsResponse()
}

export async function POST() {
  return mobileJsonResponse(
    {
      success: false,
      error: "Netopia IPN handler is not yet activated",
    },
    501
  )
}
