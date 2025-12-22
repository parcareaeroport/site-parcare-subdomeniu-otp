import crypto from "crypto";

function hmacSha256Hex(secret: string, data: string): string {
  return crypto.createHmac("sha256", secret).update(data).digest("hex");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  // Avoid throwing when lengths differ
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

export function signQrBookingNumber(bookingNumber: string, secret: string): string {
  const bn = String(bookingNumber || "").trim();
  return hmacSha256Hex(secret, bn);
}

export function verifyQrBookingNumberSig(
  bookingNumber: string,
  sig: string,
  secret: string
): boolean {
  const expected = signQrBookingNumber(bookingNumber, secret);
  const provided = String(sig || "").trim().toLowerCase();
  // expected is hex; if provided isn't hex, timingSafeEqual will throw, so check length only
  if (!/^[0-9a-f]+$/i.test(provided)) return false;
  return timingSafeEqualHex(expected, provided);
}

export function getSiteBaseUrl(): string {
  // Keep consistent with usage elsewhere in server code
  if (process.env.NODE_ENV === "development") return "http://localhost:3000";
  return "https://rezervari.otp-parking.ro";
}

export function buildSignedQrUrl(bookingNumber: string): string | undefined {
  const bn = String(bookingNumber || "").trim();
  if (!bn) return undefined;

  const secret = process.env.QR_LINK_SECRET;
  if (!secret) return undefined;

  const sig = signQrBookingNumber(bn, secret);
  const base = getSiteBaseUrl();
  return `${base}/api/qr?bookingNumber=${encodeURIComponent(bn)}&sig=${encodeURIComponent(sig)}`;
}


