import ReviewForm from "@/components/review-form";
import { verifyReviewToken } from "@/lib/review-token";

export const metadata = {
  title: "Recenzie rezervare",
  description: "Lasa o recenzie pentru experienta ta la parcare.",
};

export default async function RecenziePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const sp = await searchParams;
  const token = String(sp?.token || "").trim();
  const secret = process.env.REVIEW_LINK_SECRET || "";

  if (!token || !secret) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-bold mb-3">Link invalid</h1>
        <p className="text-gray-700">
          Linkul de recenzie este invalid sau expirat.
        </p>
      </div>
    );
  }

  const verification = verifyReviewToken(token, secret);
  if (!verification.valid) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-bold mb-3">Link invalid</h1>
        <p className="text-gray-700">
          {verification.error}
        </p>
      </div>
    );
  }

  return (
    <ReviewForm
      token={token}
      bookingId={verification.payload.bookingId}
    />
  );
}
