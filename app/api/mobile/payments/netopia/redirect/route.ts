export const dynamic = "force-dynamic"

const DEEP_LINK_SCHEME = "expomobileapp://booking/payment-return"

/**
 * NETOPIA redirects users here after payment in the hosted form.
 * We redirect to the Expo deep link so the mobile app picks it up
 * via WebBrowser.openAuthSessionAsync.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const orderId = searchParams.get("orderId") || ""

  const deepLink = `${DEEP_LINK_SCHEME}?orderId=${encodeURIComponent(orderId)}`

  return new Response(null, {
    status: 302,
    headers: { Location: deepLink },
  })
}

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url)
  const orderId = searchParams.get("orderId") || ""

  const deepLink = `${DEEP_LINK_SCHEME}?orderId=${encodeURIComponent(orderId)}`

  return new Response(
    `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="0;url=${deepLink}">
  <title>Redirectare...</title>
</head>
<body>
  <p>Se redirecționează la aplicație...</p>
  <script>window.location.href = "${deepLink}";</script>
</body>
</html>`,
    {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }
  )
}
