import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app"
import { getAuth, type Auth } from "firebase/auth"
import { getFirestore, type Firestore } from "firebase/firestore"

const verboseFirebaseLogs =
  process.env.NODE_ENV !== "production" && process.env.FIREBASE_VERBOSE_LOGS === "1"

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

if (verboseFirebaseLogs) {
  console.log("[lib/firebase.ts] Constructed firebaseConfig:", {
    ...firebaseConfig,
    apiKey: firebaseConfig.apiKey ? "[set]" : "[missing]",
  })
}

let app: FirebaseApp
let authInstance: Auth
let db: Firestore

if (!firebaseConfig.apiKey) {
  console.error(
    "CRITICAL ERROR [lib/firebase.ts]: Firebase API Key is MISSING in firebaseConfig. This will cause major issues.",
  )
  // Poți chiar să arunci o eroare aici pentru a opri execuția dacă cheia este absolut necesară imediat
  // throw new Error("Firebase API Key is missing, cannot initialize Firebase.");
}

try {
  if (!getApps().length) {
    if (verboseFirebaseLogs) console.log("[lib/firebase.ts] Initializing Firebase app...")
    app = initializeApp(firebaseConfig)
    if (verboseFirebaseLogs) console.log("[lib/firebase.ts] Firebase app initialized.")
  } else {
    if (verboseFirebaseLogs) console.log("[lib/firebase.ts] Getting existing Firebase app...")
    app = getApp()
    if (verboseFirebaseLogs) console.log("[lib/firebase.ts] Existing Firebase app retrieved.")
  }

  if (verboseFirebaseLogs) console.log("[lib/firebase.ts] Getting Auth instance...")
  authInstance = getAuth(app)
  if (verboseFirebaseLogs) console.log("[lib/firebase.ts] Auth instance retrieved.")

  if (verboseFirebaseLogs) console.log("[lib/firebase.ts] Getting Firestore instance...")
  db = getFirestore(app)
  if (verboseFirebaseLogs) console.log("[lib/firebase.ts] Firestore instance retrieved.")
} catch (error) {
  console.error("[lib/firebase.ts] CRITICAL ERROR during Firebase initialization:", error)
  // Asigură-te că variabilele sunt exportate chiar și în caz de eroare,
  // deși vor fi probabil nefuncționale sau undefined.
  // @ts-ignore
  app = app || null
  // @ts-ignore
  authInstance = authInstance || null
  // @ts-ignore
  db = db || null
}

export { app, authInstance as auth, db }
