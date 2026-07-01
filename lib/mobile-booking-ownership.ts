export type MobileAuthContext = {
  uid: string
  email: string | null
  isGuest?: boolean
}

export function normalizeEmailForAccess(email: unknown): string | null {
  if (typeof email !== "string" || !email.trim()) return null
  return email.trim().toLowerCase()
}

function getBookingSnapshot(booking: Record<string, unknown>) {
  return {
    clientEmail: booking.clientEmail != null ? String(booking.clientEmail) : null,
    apiBookingNumber: booking.apiBookingNumber || booking.bookingNumber || null,
  }
}

function buildOwnershipChecks(booking: Record<string, unknown>, auth: MobileAuthContext) {
  const snapshot = getBookingSnapshot(booking)
  const authEmailNormalized = normalizeEmailForAccess(auth.email)
  const bookingEmailNormalized = normalizeEmailForAccess(snapshot.clientEmail)
  const emailMatch = !!(
    authEmailNormalized &&
    bookingEmailNormalized &&
    authEmailNormalized === bookingEmailNormalized
  )

  return {
    snapshot,
    authEmailNormalized,
    bookingEmailNormalized,
    emailMatch,
  }
}

export function logMobileBookingAuthResolved(
  action: string,
  bookingId: string,
  auth: MobileAuthContext
) {
  console.info("[mobile-booking-ownership] auth_resolved", {
    action,
    bookingId,
    auth: {
      uid: auth.uid,
      email: auth.email,
      emailNormalized: normalizeEmailForAccess(auth.email),
      isGuest: auth.isGuest ?? false,
    },
  })
}

export function logMobileBookingOwnershipFailure(
  action: string,
  bookingId: string,
  auth: MobileAuthContext,
  booking: Record<string, unknown>
) {
  const checks = buildOwnershipChecks(booking, auth)

  let hint: string | undefined
  if (!auth.email) {
    hint = "Sesiunea guest nu are email."
  } else if (!checks.snapshot.clientEmail) {
    hint = "Rezervarea nu are clientEmail setat in Firestore."
  } else if (!checks.emailMatch) {
    hint = "clientEmail de pe rezervare difera de emailul guest din sesiune."
  }

  console.warn("[mobile-booking-ownership] access_denied", {
    action,
    bookingId,
    auth: {
      uid: auth.uid,
      email: auth.email,
      emailNormalized: checks.authEmailNormalized,
      isGuest: auth.isGuest ?? false,
    },
    booking: {
      ...checks.snapshot,
      clientEmailNormalized: checks.bookingEmailNormalized,
    },
    checks: {
      emailMatch: checks.emailMatch,
    },
    hint,
  })
}

/** Acces permis daca emailul guest coincide cu clientEmail (case-insensitive). */
export function canAccessMobileBooking(
  booking: Record<string, unknown>,
  auth: MobileAuthContext
): boolean {
  return buildOwnershipChecks(booking, auth).emailMatch
}

/** @deprecated Foloseste canAccessMobileBooking */
export function isMobileBookingOwnerForRead(
  booking: Record<string, unknown>,
  auth: MobileAuthContext
): boolean {
  return canAccessMobileBooking(booking, auth)
}

/** @deprecated Foloseste canAccessMobileBooking */
export function isMobileBookingOwnerForWrite(
  booking: Record<string, unknown>,
  auth: MobileAuthContext
): boolean {
  return canAccessMobileBooking(booking, auth)
}
