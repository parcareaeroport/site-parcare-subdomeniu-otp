export type NetopiaPaymentMethod = "card" | "google_pay" | "apple_pay"

export type NetopiaPaymentStatus = "pending" | "requires_action" | "paid" | "failed"

export type NetopiaSavedCard = {
  id: string
  paymentToken: string
  brand: "visa" | "mastercard" | "amex" | "unknown"
  last4: string
  isDefault: boolean
}
