import type { MobileBookingPayload } from "@/lib/mobile-booking-mapper"
import type { MobileBookingContext } from "@/lib/mobile-booking-mapper"

export async function createMobileNetopiaPaymentSession(
  _payload: MobileBookingPayload,
  _ctx: MobileBookingContext,
  _amount: number,
  _orderId: string
): Promise<{ paymentUrl?: string }> {
  const hasCredentials =
    !!process.env.NETOPIA_API_KEY &&
    !!process.env.NETOPIA_SIGNATURE_KEY &&
    !!process.env.NETOPIA_MERCHANT_ID

  if (!hasCredentials) {
    throw new Error("Netopia is not configured. Set NETOPIA_* environment variables.")
  }

  // Placeholder until Netopia merchant credentials and IPN are wired.
  throw new Error("Netopia mobile payments are not yet activated")
}
