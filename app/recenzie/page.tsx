import ReviewForm from "@/components/review-form";

export const metadata = {
  title: "Recenzie rezervare",
  description: "Lasa o recenzie pentru experienta ta la parcare.",
};

function bookingIdFromLegacyToken(tokenValue: string): string {
  const raw = String(tokenValue || "").trim();
  if (!raw) return "";

  try {
    const payload64 = raw.split(".")[0] || "";
    if (!payload64) return "";
    const json = Buffer.from(payload64, "base64url").toString("utf8");
    const payload = JSON.parse(json) as {bookingId?: string};
    return String(payload?.bookingId || "").trim();
  } catch (_err) {
    return "";
  }
}

export default async function RecenziePage({
  searchParams,
}: {
  searchParams: Promise<{ bookingId?: string; token?: string }>;
}) {
  const sp = await searchParams;
  const bookingIdDirect = String(sp?.bookingId || "").trim();
  const bookingId =
    bookingIdDirect || bookingIdFromLegacyToken(String(sp?.token || ""));

  if (!bookingId) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-bold mb-3">Link invalid</h1>
        <p className="text-gray-700">
          Linkul de recenzie este invalid sau expirat.
        </p>
      </div>
    );
  }

  return (
    <ReviewForm
      bookingId={bookingId}
    />
  );
}
