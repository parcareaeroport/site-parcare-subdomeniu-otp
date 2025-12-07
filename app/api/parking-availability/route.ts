import { NextResponse } from "next/server";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getMaxTotalReservations } from "@/lib/admin-stats";

const corsHeaders = {
  "Access-Control-Allow-Origin": process.env.WP_ALLOWED_ORIGIN || "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Auth-Token, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET() {
  const reqId = `parking-availability-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  console.log(`[PARKING-AVAIL][${reqId}] New GET request received.`);

  try {
    // 1) Citim numărul maxim de locuri configurat
    const totalSpots = await getMaxTotalReservations();

    // 2) Citim din Firestore câte rezervări active sunt (contorul menținut de createBookingWithFirestore / cleanupExpiredBookings)
    const statsRef = doc(db, "config", "reservationStats");
    const statsSnap = await getDoc(statsRef);

    const activeBookings = statsSnap.exists()
      ? Math.max(0, Number(statsSnap.data().activeBookingsCount || 0))
      : 0;

    const availableSpots = Math.max(0, totalSpots - activeBookings);
    const isFull = totalSpots > 0 ? availableSpots <= 0 : false;

    let status: "full" | "limited" | "available" = "available";
    if (isFull) {
      status = "full";
    } else if (availableSpots <= Math.max(1, Math.round(totalSpots * 0.1))) {
      status = "limited";
    }

    const message = isFull
      ? "Nu mai sunt locuri disponibile."
      : `Mai sunt ${availableSpots} locuri disponibile.`;

    console.log(`[PARKING-AVAIL][${reqId}] Computed availability:`, {
      totalSpots,
      activeBookings,
      availableSpots,
      isFull,
      status,
    });

    return NextResponse.json(
      {
        success: true,
        isFull,
        availableSpots,
        totalSpots,
        activeBookings,
        status,
        message,
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error) {
    console.error(
      `[PARKING-AVAIL][${reqId}] ERROR while computing availability:`,
      error
    );

    return NextResponse.json(
      {
        success: false,
        isFull: false,
        availableSpots: null,
        totalSpots: null,
        activeBookings: null,
        status: "available",
        message:
          "Nu am putut determina disponibilitatea parcării în acest moment.",
      },
      { status: 500, headers: corsHeaders }
    );
  }
}


