import { FieldPath, FieldValue } from "firebase-admin/firestore"
import { adminDb } from "@/lib/firebase-admin"

type WhereConstraint = {
  kind: "where"
  fieldPath: string | FieldPath
  opStr: FirebaseFirestore.WhereFilterOp
  value: any
}

type OrderByConstraint = {
  kind: "orderBy"
  fieldPath: string | FieldPath
  directionStr?: FirebaseFirestore.OrderByDirection
}

type SetDocOptions = {
  merge?: boolean
}

export const db = adminDb

function sanitizeFirestoreValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .map((entry) => sanitizeFirestoreValue(entry))
      .filter((entry) => entry !== undefined) as T
  }

  if (value && typeof value === "object") {
    const proto = Object.getPrototypeOf(value)
    const isPlainObject = proto === Object.prototype || proto === null

    if (!isPlainObject) {
      return value
    }

    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([key, entryValue]) => [key, sanitizeFirestoreValue(entryValue)])

    return Object.fromEntries(entries) as T
  }

  return value
}

export function serverTimestamp() {
  return FieldValue.serverTimestamp()
}

export function increment(value: number) {
  return FieldValue.increment(value)
}

export function collection(parent: any, path: string) {
  if (!parent || typeof parent.collection !== "function") {
    throw new Error(`Invalid collection parent for path "${path}"`)
  }
  return parent.collection(path)
}

export function doc(parent: any, ...pathSegments: string[]) {
  if (!parent || typeof parent.doc !== "function") {
    throw new Error(`Invalid doc parent for path "${pathSegments.join("/")}"`)
  }
  return parent.doc(pathSegments.join("/"))
}

export function where(
  fieldPath: string,
  opStr: FirebaseFirestore.WhereFilterOp,
  value: any,
): WhereConstraint {
  return {
    kind: "where",
    fieldPath: fieldPath === "__name__" ? FieldPath.documentId() : fieldPath,
    opStr,
    value,
  }
}

export function orderBy(
  fieldPath: string,
  directionStr: FirebaseFirestore.OrderByDirection = "asc"
): OrderByConstraint {
  return {
    kind: "orderBy",
    fieldPath: fieldPath === "__name__" ? FieldPath.documentId() : fieldPath,
    directionStr,
  }
}

export function query(base: any, ...constraints: Array<WhereConstraint | OrderByConstraint>) {
  let q = base
  for (const constraint of constraints) {
    if (constraint?.kind === "where") {
      q = q.where(constraint.fieldPath as any, constraint.opStr, constraint.value)
    } else if (constraint?.kind === "orderBy") {
      q = q.orderBy(constraint.fieldPath as any, constraint.directionStr)
    }
  }
  return q
}

export async function getDocs(q: any) {
  return await q.get()
}

export async function getDoc(ref: any) {
  const snap = await ref.get()
  return {
    id: snap.id,
    ref: snap.ref,
    data: () => snap.data(),
    exists: () => Boolean(snap.exists),
  }
}

export async function addDoc(ref: any, data: any) {
  return await ref.add(data)
}

export async function setDoc(ref: any, data: any, options?: SetDocOptions) {
  const sanitized = sanitizeFirestoreValue(data)
  if (options?.merge) {
    return await ref.set(sanitized, { merge: true })
  }
  return await ref.set(sanitized)
}

export async function updateDoc(ref: any, data: any) {
  return await ref.update(sanitizeFirestoreValue(data))
}

export async function runTransaction<T>(
  firestore: FirebaseFirestore.Firestore,
  updateFunction: (transaction: FirebaseFirestore.Transaction) => Promise<T>
): Promise<T> {
  return await firestore.runTransaction(updateFunction)
}
