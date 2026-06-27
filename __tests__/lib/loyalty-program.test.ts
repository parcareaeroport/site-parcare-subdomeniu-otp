/**
 * Pure loyalty logic tests (mirrors expo-mobile-app/__tests__/lib/loyaltyProgram.test.ts).
 * Run via expo-mobile-app Jest suite; next-js has no Jest runner configured yet.
 */
import {
  DEFAULT_LOYALTY_PROGRAM,
  advanceLoyaltyAfterBooking,
  applyLoyaltyDiscountToAmount,
  canAutoRedeemFreeDay,
  computeLoyaltyProgress,
  formatLoyaltyHomeMessage,
  isMobileLoyaltyEligibleBooking,
} from "@/lib/loyalty-program"

describe("loyalty-program (server)", () => {
  it("computes remaining reservations until free day", () => {
    expect(computeLoyaltyProgress({ reservationsCount: 0, freeDaysAvailable: 0, points: 0 }).remaining).toBe(4)
    expect(computeLoyaltyProgress({ reservationsCount: 3, freeDaysAvailable: 0, points: 3 }).remaining).toBe(1)
  })

  it("awards one free day after four bookings", () => {
    let loyalty = { reservationsCount: 0, freeDaysAvailable: 0, points: 0 }
    for (let i = 0; i < 4; i += 1) {
      loyalty = advanceLoyaltyAfterBooking(loyalty)
    }
    expect(loyalty.freeDaysAvailable).toBe(1)
    expect(loyalty.reservationsCount).toBe(0)
  })

  it("allows auto redeem for 1-day booking with credit", () => {
    expect(canAutoRedeemFreeDay({ reservationsCount: 0, freeDaysAvailable: 1, points: 0 }, 1)).toBe(true)
    expect(canAutoRedeemFreeDay({ reservationsCount: 0, freeDaysAvailable: 1, points: 0 }, 2)).toBe(false)
  })

  it("applies one-day discount when eligible", () => {
    const result = applyLoyaltyDiscountToAmount(100, 40, { reservationsCount: 0, freeDaysAvailable: 1, points: 0 }, 1)
    expect(result.applied).toBe(true)
    expect(result.finalAmount).toBe(60)
  })

  it("counts only confirmed mobile-app bookings", () => {
    expect(
      isMobileLoyaltyEligibleBooking({
        bookingOrigin: "mobile-app",
        userId: "u1",
        apiSuccess: true,
        status: "confirmed_paid",
      })
    ).toBe(true)
    expect(
      isMobileLoyaltyEligibleBooking({
        bookingOrigin: "wordpress",
        userId: "u1",
        apiSuccess: true,
        status: "confirmed_paid",
      })
    ).toBe(false)
  })

  it("formats default home message", () => {
    const message = formatLoyaltyHomeMessage(
      computeLoyaltyProgress({ reservationsCount: 2, freeDaysAvailable: 0, points: 2 }),
      DEFAULT_LOYALTY_PROGRAM
    )
    expect(message).toBe("Încă 2 rezervări până la 1 zi gratuită")
  })
})
