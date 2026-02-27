import { NextRequest, NextResponse } from "next/server";
import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { verifyReviewToken } from "@/lib/review-token";

type ReviewRequestBody = {
  token?: string;
  rating?: number;
  name?: string;
  comment?: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ReviewRequestBody;
    const token = String(body?.token || "").trim();
    const rating = Number(body?.rating);
    const name = String(body?.name || "").trim();
    const comment = String(body?.comment || "").trim();
    const secret = process.env.REVIEW_LINK_SECRET || "";

    if (!secret || !token) {
      return NextResponse.json(
        { success: false, error: "Token invalid." },
        { status: 400 }
      );
    }

    const verified = verifyReviewToken(token, secret);
    if (!verified.valid) {
      return NextResponse.json(
        { success: false, error: verified.error },
        { status: 400 }
      );
    }

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return NextResponse.json(
        { success: false, error: "Rating invalid." },
        { status: 400 }
      );
    }

    if (name.length > 120) {
      return NextResponse.json(
        { success: false, error: "Numele este prea lung." },
        { status: 400 }
      );
    }

    if (comment.length > 1000) {
      return NextResponse.json(
        { success: false, error: "Comentariul este prea lung." },
        { status: 400 }
      );
    }

    const bookingId = verified.payload.bookingId;
    const bookingRef = doc(db, "bookings", bookingId);
    const bookingSnap = await getDoc(bookingRef);
    if (!bookingSnap.exists()) {
      return NextResponse.json(
        { success: false, error: "Rezervarea nu exista." },
        { status: 404 }
      );
    }

    // Prevent duplicate review for the same booking.
    const reviewRef = doc(collection(db, "reviews"), bookingId);
    const reviewSnap = await getDoc(reviewRef);
    if (reviewSnap.exists()) {
      return NextResponse.json(
        { success: false, error: "Recenzia a fost deja trimisa." },
        { status: 409 }
      );
    }

    await setDoc(reviewRef, {
      bookingId,
      rating,
      name: name || null,
      comment: comment || null,
      email: verified.payload.email,
      source: "wp-card-booking",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await updateDoc(bookingRef, {
      reviewStatus: "submitted",
      reviewSubmittedAt: serverTimestamp(),
      reviewRating: rating,
      reviewComment: comment || null,
      lastUpdated: serverTimestamp(),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
