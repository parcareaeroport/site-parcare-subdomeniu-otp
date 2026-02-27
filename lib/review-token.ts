import crypto from "crypto";

export type ReviewTokenPayload = {
  bookingId: string;
  email: string;
  iat: number;
  exp: number;
};

export type ReviewTokenVerification =
  | { valid: true; payload: ReviewTokenPayload }
  | { valid: false; error: string };

function hmacSha256Hex(secret: string, data: string): string {
  return crypto.createHmac("sha256", secret).update(data).digest("hex");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

export function verifyReviewToken(
  token: string,
  secret: string
): ReviewTokenVerification {
  const rawToken = String(token || "").trim();
  if (!rawToken) return { valid: false, error: "Token lipsa" };

  const [payload64, sig] = rawToken.split(".");
  if (!payload64 || !sig) {
    return { valid: false, error: "Format token invalid" };
  }
  if (!/^[0-9a-f]+$/i.test(sig)) {
    return { valid: false, error: "Semnatura token invalida" };
  }

  const expectedSig = hmacSha256Hex(secret, payload64);
  if (!timingSafeEqualHex(expectedSig, sig.toLowerCase())) {
    return { valid: false, error: "Semnatura token invalida" };
  }

  let parsed: any;
  try {
    const json = Buffer.from(payload64, "base64url").toString("utf8");
    parsed = JSON.parse(json);
  } catch (_err) {
    return { valid: false, error: "Payload token invalid" };
  }

  const bookingId = String(parsed?.bookingId || "").trim();
  const email = String(parsed?.email || "").trim();
  const iat = Number(parsed?.iat);
  const exp = Number(parsed?.exp);

  if (!bookingId || !email || !Number.isFinite(iat) || !Number.isFinite(exp)) {
    return { valid: false, error: "Date token invalide" };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (exp <= nowSec) return { valid: false, error: "Token expirat" };

  return {
    valid: true,
    payload: {
      bookingId,
      email,
      iat,
      exp,
    },
  };
}
