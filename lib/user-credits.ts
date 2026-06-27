import { FieldValue } from "firebase-admin/firestore"
import { adminDb } from "@/lib/firebase-admin"

type CreditTransactionInput = {
  userId: string
  amount: number
  source: string
  bookingId?: string
  modificationRequestId?: string
  orderId?: string
  message?: string
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

export async function getUserCreditBalance(userId?: string | null): Promise<number> {
  if (!userId) return 0
  const snap = await adminDb.collection("userCredits").doc(userId).get()
  const balance = Number((snap.data() || {}).balance || 0)
  return Number.isFinite(balance) && balance > 0 ? roundMoney(balance) : 0
}

export async function addUserCredit(input: CreditTransactionInput): Promise<number> {
  const amount = roundMoney(input.amount)
  if (!input.userId || amount <= 0) return getUserCreditBalance(input.userId)

  const creditRef = adminDb.collection("userCredits").doc(input.userId)
  const txRef = creditRef.collection("transactions").doc()

  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(creditRef)
    const current = Number((snap.data() || {}).balance || 0)
    const nextBalance = roundMoney(current + amount)

    tx.set(
      creditRef,
      {
        userId: input.userId,
        balance: nextBalance,
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: snap.exists ? snap.data()?.createdAt || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
    tx.set(txRef, {
      type: "credit",
      amount,
      balanceAfter: nextBalance,
      source: input.source,
      bookingId: input.bookingId || null,
      modificationRequestId: input.modificationRequestId || null,
      orderId: input.orderId || null,
      message: input.message || null,
      createdAt: FieldValue.serverTimestamp(),
    })
  })

  return getUserCreditBalance(input.userId)
}

export async function consumeUserCredit(input: CreditTransactionInput): Promise<number> {
  const amount = roundMoney(input.amount)
  if (!input.userId || amount <= 0) return getUserCreditBalance(input.userId)

  const creditRef = adminDb.collection("userCredits").doc(input.userId)
  const txRef = creditRef.collection("transactions").doc()

  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(creditRef)
    const current = Number((snap.data() || {}).balance || 0)
    if (current + 0.001 < amount) {
      throw new Error("Credit insuficient")
    }
    const nextBalance = roundMoney(current - amount)

    tx.set(
      creditRef,
      {
        userId: input.userId,
        balance: nextBalance,
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: snap.exists ? snap.data()?.createdAt || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
    tx.set(txRef, {
      type: "debit",
      amount,
      balanceAfter: nextBalance,
      source: input.source,
      bookingId: input.bookingId || null,
      modificationRequestId: input.modificationRequestId || null,
      orderId: input.orderId || null,
      message: input.message || null,
      createdAt: FieldValue.serverTimestamp(),
    })
  })

  return getUserCreditBalance(input.userId)
}

