import { NextRequest, NextResponse } from "next/server";
import { generateMultiparkQRBuffer } from "@/lib/qr-generator";
import { verifyQrBookingNumberSig } from "@/lib/qr-link";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const bookingNumber = String(searchParams.get("bookingNumber") || "").trim();
  const sig = String(searchParams.get("sig") || "").trim();

  if (!bookingNumber || !sig) {
    return NextResponse.json(
      { success: false, error: "Missing bookingNumber or sig" },
      { status: 400 }
    );
  }

  const secret = process.env.QR_LINK_SECRET;
  if (!secret) {
    return NextResponse.json(
      {
        success: false,
        error: "Server misconfigured: QR_LINK_SECRET not set",
      },
      { status: 500 }
    );
  }

  if (!verifyQrBookingNumberSig(bookingNumber, sig, secret)) {
    return NextResponse.json({ success: false, error: "Invalid signature" }, { status: 401 });
  }

  try {
    const buf = await generateMultiparkQRBuffer(bookingNumber);
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        // Safe caching: URL is signed; bookingNumber is stable; avoids hammering QR generation
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Disposition": `inline; filename="qr-${bookingNumber}.png"`,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}


