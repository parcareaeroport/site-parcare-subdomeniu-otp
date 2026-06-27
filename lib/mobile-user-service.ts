import {
  collection,
  db,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "@/lib/server-firestore"

export type MobileUserCar = {
  id: string
  plate: string
  model: string
  type: string
}

export type MobileUserBilling = {
  type: "individual" | "company"
  individual?: {
    address?: string
    city?: string
    county?: string
    country?: string
    postalCode?: string
  }
  company?: {
    name?: string
    vat?: string
    reg?: string
    address?: string
  }
}

export type MobileUserProfile = {
  uid: string
  email: string | null
  firstName?: string
  lastName?: string
  phone?: string
  billing?: MobileUserBilling
  cars: MobileUserCar[]
  loyalty?: {
    points: number
    reservationsCount: number
    freeDaysAvailable?: number
  }
  createdAt?: unknown
  updatedAt?: unknown
}

export type ProfileCollection = "users" | "guests"

function profileDocRef(uid: string, col: ProfileCollection = "users") {
  return doc(db, col, uid)
}

export async function getMobileUserProfile(
  uid: string,
  col: ProfileCollection = "users"
): Promise<MobileUserProfile | null> {
  const snap = await getDoc(profileDocRef(uid, col))
  if (!snap.exists()) return null
  const data = snap.data() as MobileUserProfile
  return {
    ...data,
    uid,
    cars: Array.isArray(data.cars) ? data.cars : [],
  }
}

export async function ensureMobileUserProfile(
  uid: string,
  email: string | null,
  partial?: Partial<MobileUserProfile>,
  col: ProfileCollection = "users"
): Promise<MobileUserProfile> {
  const existing = await getMobileUserProfile(uid, col)
  if (existing) return existing

  const profile: MobileUserProfile = {
    uid,
    email,
    firstName: partial?.firstName,
    lastName: partial?.lastName,
    phone: partial?.phone,
    billing: partial?.billing || { type: "individual" },
    cars: partial?.cars || [],
    loyalty: { points: 0, reservationsCount: 0, freeDaysAvailable: 0 },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }

  await setDoc(profileDocRef(uid, col), profile)
  return profile
}

export async function updateMobileUserProfile(
  uid: string,
  patch: Partial<MobileUserProfile>,
  col: ProfileCollection = "users"
): Promise<MobileUserProfile> {
  const existing = await ensureMobileUserProfile(uid, patch.email ?? null, undefined, col)
  const next = {
    ...existing,
    ...patch,
    uid,
    cars: patch.cars ?? existing.cars,
    updatedAt: serverTimestamp(),
  }
  await updateDoc(profileDocRef(uid, col), next)
  return next
}

export type AllowedProfilePatch = Pick<
  MobileUserProfile,
  "firstName" | "lastName" | "phone" | "billing"
>

export async function patchMobileUserProfileAllowed(
  uid: string,
  email: string | null,
  patch: Partial<AllowedProfilePatch>,
  col: ProfileCollection = "users"
): Promise<MobileUserProfile> {
  const allowed: Partial<AllowedProfilePatch> = {}
  if (patch.firstName !== undefined) allowed.firstName = String(patch.firstName)
  if (patch.lastName !== undefined) allowed.lastName = String(patch.lastName)
  if (patch.phone !== undefined) allowed.phone = String(patch.phone)
  if (patch.billing !== undefined) allowed.billing = patch.billing

  return updateMobileUserProfile(uid, {
    ...allowed,
    email,
  }, col)
}

export async function listMobileUserCars(
  uid: string,
  col: ProfileCollection = "users"
): Promise<MobileUserCar[]> {
  const profile = await getMobileUserProfile(uid, col)
  return profile?.cars || []
}

export async function addMobileUserCar(
  uid: string,
  car: Omit<MobileUserCar, "id">,
  col: ProfileCollection = "users"
): Promise<MobileUserCar[]> {
  const profile = await ensureMobileUserProfile(uid, null, undefined, col)
  const newCar: MobileUserCar = {
    id: `car_${Date.now()}`,
    ...car,
  }
  const cars = [...(profile.cars || []), newCar]
  await updateMobileUserProfile(uid, { cars }, col)
  return cars
}

export async function removeMobileUserCar(
  uid: string,
  carId: string,
  col: ProfileCollection = "users"
): Promise<MobileUserCar[]> {
  const profile = await ensureMobileUserProfile(uid, null, undefined, col)
  const cars = (profile.cars || []).filter((c) => c.id !== carId)
  await updateMobileUserProfile(uid, { cars }, col)
  return cars
}

export async function updateMobileUserCar(
  uid: string,
  carId: string,
  patch: Partial<Omit<MobileUserCar, "id">>,
  col: ProfileCollection = "users"
): Promise<MobileUserCar[]> {
  const profile = await ensureMobileUserProfile(uid, null, undefined, col)
  const cars = (profile.cars || []).map((car) => {
    if (car.id !== carId) return car
    return {
      ...car,
      ...(patch.plate !== undefined ? { plate: String(patch.plate) } : {}),
      ...(patch.model !== undefined ? { model: String(patch.model) } : {}),
      ...(patch.type !== undefined ? { type: String(patch.type) } : {}),
    }
  })

  const exists = (profile.cars || []).some((c) => c.id === carId)
  if (!exists) {
    throw new Error("Car not found")
  }

  await updateMobileUserProfile(uid, { cars }, col)
  return cars
}

export async function queryBookingsByContact(
  email: string | null,
  phone: string | null
) {
  if (!email && !phone) return []

  const bookingsRef = collection(db, "bookings")
  const results = new Map<string, { id: string; [key: string]: unknown }>()

  const collectSnap = async (snap: any) => {
    snap.docs.forEach((d: { id: string; data: () => Record<string, unknown> }) => {
      const data = d.data()
      if (data.bookingOrigin !== "mobile-app") return
      results.set(d.id, { id: d.id, ...data })
    })
  }

  if (email) {
    try {
      const q = query(bookingsRef, where("clientEmail", "==", email))
      await collectSnap(await getDocs(q))
    } catch (error) {
      console.warn("[mobile-user-service] clientEmail query failed:", error)
    }
  }

  if (phone) {
    try {
      const q = query(bookingsRef, where("clientPhone", "==", phone))
      await collectSnap(await getDocs(q))
    } catch (error) {
      console.warn("[mobile-user-service] clientPhone query failed:", error)
    }
  }

  return Array.from(results.values()).sort((a, b) => {
    const aMs = (a.createdAt as any)?.toMillis?.() ?? 0
    const bMs = (b.createdAt as any)?.toMillis?.() ?? 0
    return bMs - aMs
  })
}

export async function queryMobileUserBookings(
  uid: string,
  email: string | null,
  paymentIntentId?: string
) {
  const bookingsRef = collection(db, "bookings")

  if (paymentIntentId) {
    const q = query(bookingsRef, where("paymentIntentId", "==", paymentIntentId))
    const snap = await getDocs(q)
    return snap.docs.map((d: { id: string; data: () => Record<string, unknown> }) => ({
      id: d.id,
      ...d.data(),
    }))
  }

  let results: Array<{ id: string; [key: string]: unknown }> = []

  try {
    const byUser = query(bookingsRef, where("userId", "==", uid))
    const userSnap = await getDocs(byUser)
    results = userSnap.docs.map((d: { id: string; data: () => Record<string, unknown> }) => ({
      id: d.id,
      ...d.data(),
    }))
  } catch (error) {
    console.warn("[mobile-user-service] userId query failed:", error)
  }

  if (results.length === 0 && email) {
    const byEmail = query(bookingsRef, where("clientEmail", "==", email))
    const emailSnap = await getDocs(byEmail)
    results = emailSnap.docs
      .map((d: { id: string; data: () => Record<string, unknown> }) => ({
        id: d.id,
        ...d.data(),
      }))
      .filter(
        (b: Record<string, unknown>) =>
          b.bookingOrigin === "mobile-app" || b.userId === uid
      )
  }

  return results.sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
    const aMs = (a.createdAt as any)?.toMillis?.() ?? 0
    const bMs = (b.createdAt as any)?.toMillis?.() ?? 0
    return bMs - aMs
  })
}
