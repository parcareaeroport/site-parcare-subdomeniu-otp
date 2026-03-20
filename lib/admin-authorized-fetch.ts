import type { User } from "firebase/auth"

export async function adminAuthorizedFetch(
  input: RequestInfo | URL,
  user: User | null,
  init: RequestInit = {},
) {
  if (!user) {
    throw new Error("Trebuie să fiți autentificat pentru această acțiune.")
  }

  const createHeaders = (token: string) => {
    const headers = new Headers(init.headers)
    headers.set("Authorization", `Bearer ${token}`)

    if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json")
    }

    return headers
  }

  const token = await user.getIdToken()
  let response = await fetch(input, {
    ...init,
    headers: createHeaders(token),
  })

  if (response.status !== 401) {
    return response
  }

  const refreshedToken = await user.getIdToken(true)
  if (!refreshedToken) {
    return response
  }

  response = await fetch(input, {
    ...init,
    headers: createHeaders(refreshedToken),
  })

  return response
}
