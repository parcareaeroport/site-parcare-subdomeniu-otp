import {
  canAccessMobileBooking,
  isMobileBookingOwnerForRead,
  isMobileBookingOwnerForWrite,
  normalizeEmailForAccess,
} from "@/lib/mobile-booking-ownership"

describe("mobile-booking-ownership", () => {
  const auth = {
    uid: "guest-123",
    email: "client@example.com",
    isGuest: true,
  }

  it("normalizes email for access checks", () => {
    expect(normalizeEmailForAccess("  Client@Example.COM ")).toBe("client@example.com")
    expect(normalizeEmailForAccess("")).toBeNull()
  })

  it("allows access when emails match case-insensitively", () => {
    const booking = { clientEmail: "Client@Example.com" }
    expect(canAccessMobileBooking(booking, auth)).toBe(true)
    expect(isMobileBookingOwnerForRead(booking, auth)).toBe(true)
    expect(isMobileBookingOwnerForWrite(booking, auth)).toBe(true)
  })

  it("denies access when email differs", () => {
    const booking = { clientEmail: "other@example.com" }
    expect(canAccessMobileBooking(booking, auth)).toBe(false)
  })

  it("denies access when booking has no clientEmail", () => {
    expect(canAccessMobileBooking({}, auth)).toBe(false)
  })

  it("denies access when auth has no email", () => {
    const booking = { clientEmail: "client@example.com" }
    expect(canAccessMobileBooking(booking, { uid: "guest-123", email: null })).toBe(false)
  })
})
