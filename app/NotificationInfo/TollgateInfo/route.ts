import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const plateNumber = body?.Picture?.Plate?.PlateNumber ?? null;
    const laneNo = body?.Picture?.SnapInfo?.LanNo ?? null;
    const snapTime = body?.Picture?.SnapInfo?.SnapTime ?? null;
    const accurateTime = body?.Picture?.SnapInfo?.AccurateTime ?? null;
    const deviceId = body?.Picture?.SnapInfo?.DeviceID ?? null;
    const direction = body?.Picture?.SnapInfo?.Direction ?? null;

    // Aici doar logăm orice informație primim
    console.log("LPR EVENT >>>", {
      plateNumber,
      laneNo,
      snapTime,
      accurateTime,
      deviceId,
      direction,
      raw: body,
    });

    // TODO: salvează în DB (Postgres / Firestore etc.)

    return NextResponse.json({ status: "ok" });
  } catch (err) {
    console.error("Error parsing LPR payload:", err);
    return new NextResponse("Bad Request", { status: 400 });
  }
}

export function GET() {
  return new NextResponse("Method Not Allowed", { status: 405 });
}


