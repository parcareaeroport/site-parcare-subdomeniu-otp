import type { User } from "firebase/auth"

export async function adminAuthorizedFetch(
  input: RequestInfo | URL,
  user: User | null,
  init: RequestInit = {},
) {
  if (!user) {
    throw new Error("Trebuie să fiți autentificat pentru această acțiune.")
  }

  const token = await user.getIdToken()
  const headers = new Headers(init.headers)
  headers.set("Authorization", `Bearer ${token}`)

  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }

  return fetch(input, {
    ...init,
    headers,
  })
}
