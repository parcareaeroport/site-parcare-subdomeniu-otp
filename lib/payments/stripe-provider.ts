import Stripe from "stripe"
import type { MobileBookingPayload } from "@/lib/mobile-booking-mapper"
import { buildStripeMetadataFromMobilePayload } from "@/lib/mobile-booking-mapper"
import type { MobileBookingContext } from "@/lib/mobile-booking-mapper"

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "")

export async function createMobileStripePaymentIntent(
  payload: MobileBookingPayload,
  ctx: MobileBookingContext,
  amount: number,
  orderId: string
) {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("Stripe secret key not configured")
  }

  const metadata = buildStripeMetadataFromMobilePayload(payload, ctx, orderId)

  const paymentIntent = await stripe.paymentIntents.create({
    amount: Math.round(amount * 100),
    currency: "ron",
    payment_method_types: ["card"],
    metadata,
    receipt_email: payload.email || undefined,
  })

  return {
    clientSecret: paymentIntent.client_secret,
    paymentIntentId: paymentIntent.id,
  }
}
