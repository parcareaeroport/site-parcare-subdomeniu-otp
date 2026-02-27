import {NextRequest, NextResponse} from "next/server";
import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import {db} from "@/lib/firebase";

type ReviewRequestBody = {
  bookingId?: string;
  email?: string;
  rating?: number;
  name?: string;
  comment?: string;
};

function normalizeBookingId(value: unknown): string {
  return String(value || "").trim();
}

function normalizeEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

export async function GET(request: NextRequest) {
  try {
    const bookingId = normalizeBookingId(
        request.nextUrl.searchParams.get("bookingId"),
    );
    if (!bookingId) {
      return NextResponse.json(
          {success: false, error: "Linkul de recenzie este invalid."},
          {status: 400},
      );
    }

    const reviewRef = doc(collection(db, "reviews"), bookingId);
    const reviewSnap = await getDoc(reviewRef);

    return NextResponse.json({
      success: true,
      alreadySubmitted: reviewSnap.exists(),
    });
  } catch (error) {
    return NextResponse.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        },
        {status: 500},
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ReviewRequestBody;
    const bookingId = normalizeBookingId(body?.bookingId);
    const rating = Number(body?.rating);
    const name = String(body?.name || "").trim();
    const comment = String(body?.comment || "").trim();
    const bodyEmail = normalizeEmail(body?.email);

    if (!bookingId) {
      return NextResponse.json(
          {success: false, error: "Date invalide."},
          {status: 400},
      );
    }

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return NextResponse.json(
          {success: false, error: "Rating invalid."},
          {status: 400},
      );
    }

    if (name.length > 120) {
      return NextResponse.json(
          {success: false, error: "Numele este prea lung."},
          {status: 400},
      );
    }

    if (comment.length > 1000) {
      return NextResponse.json(
          {success: false, error: "Comentariul este prea lung."},
          {status: 400},
      );
    }

    const reviewRef = doc(collection(db, "reviews"), bookingId);
    const existingReviewSnap = await getDoc(reviewRef);
    if (existingReviewSnap.exists()) {
      return NextResponse.json({success: true, alreadySubmitted: true});
    }

    const bookingRef = doc(db, "bookings", bookingId);
    const bookingSnap = await getDoc(bookingRef);
    const bookingData = bookingSnap.exists() ?
      (bookingSnap.data() || {}) as Record<string, unknown> :
      {};
    const bookingEmail = normalizeEmail(bookingData.clientEmail);
    const finalEmail = bodyEmail || bookingEmail || null;
    const source =
      String(bookingData.bookingOrigin || bookingData.source || "") ||
      "wp-card-booking";

    await setDoc(reviewRef, {
      bookingId,
      rating,
      name: name || null,
      comment: comment || null,
      email: finalEmail,
      source,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    if (bookingSnap.exists()) {
      await updateDoc(bookingRef, {
        reviewStatus: "submitted",
        reviewSubmittedAt: serverTimestamp(),
        reviewRating: rating,
        reviewComment: comment || null,
        reviewLinkConsumedAt: serverTimestamp(),
        reviewLinkUsedByEmail: finalEmail,
        lastUpdated: serverTimestamp(),
      });
    }

    return NextResponse.json({success: true});
  } catch (error) {
    return NextResponse.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        },
        {status: 500},
    );
  }
}
