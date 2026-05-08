import { NextRequest, NextResponse } from "next/server";
import { handleLprEvent } from "@/lib/lpr-service";
import { isTollgateWhitelistedPlate } from "@/lib/lpr-tollgate-whitelist";
import { db, doc, getDoc } from "@/lib/server-firestore";
import { normalizeLicensePlate } from "@/lib/utils";

type Nullable<T> = T | null;

interface PlateData {
  PlateNumber: string;
  PlateColor?: string;
  IsExist?: boolean;
  Channel?: number;
  BoundingBox?: number[];
  PlateType?: string;
  Region?: string;
  UploadNum?: number;
}

interface SnapInfoData {
  AccurateTime?: string;
  SnapTime?: string;
  LanNo?: number;
  Direction?: string | null;
  DeviceID?: string;
  TimeZone?: number;
  [key: string]: unknown;
}

interface VehicleData {
  VehicleBoundingBox?: number[];
  VehicleColor?: string;
  VehicleSeries?: string;
  VehicleSign?: string;
  VehicleType?: string;
  [key: string]: unknown;
}

interface LprPayload {
  Picture?: {
    Plate?: PlateData;
    SnapInfo?: SnapInfoData;
    Vehicle?: VehicleData;
  };
  [key: string]: unknown;
}

interface LprEvent {
  plateNumber: Nullable<string>;
  laneNo: Nullable<number>;
  snapTime: Nullable<string>;
  accurateTime: Nullable<string>;
  deviceId: Nullable<string>;
  direction: Nullable<string>;
}

/**
 * Extrage în siguranță informațiile utile din payload-ul LPR.
 */
function extractLprEvent(payload: LprPayload): LprEvent {
  const plate = payload?.Picture?.Plate;
  const snapInfo = payload?.Picture?.SnapInfo;

  return {
    plateNumber: plate?.PlateNumber ?? null,
    laneNo: snapInfo?.LanNo ?? null,
    snapTime: snapInfo?.SnapTime ?? null,
    accurateTime: snapInfo?.AccurateTime ?? null,
    deviceId: snapInfo?.DeviceID ?? null,
    direction: (snapInfo?.Direction as string | undefined) ?? null,
  };
}

export async function POST(req: NextRequest) {
  let body: LprPayload;

  try {
    console.log('[LPR API] Incoming POST - parsing JSON body...')
    body = (await req.json()) as LprPayload;
    console.log('[LPR API] JSON parsed OK')
  } catch (error) {
    console.error("Error parsing LPR payload:", error);
    return new NextResponse("Bad Request", { status: 400 });
  }

  const event = extractLprEvent(body);

  console.log("LPR EVENT >>>", {
    ...event,
    raw: body,
  });

  // IMPORTANT: Hard short-circuit (NO Firebase) for whitelisted plates.
  // This bypasses handleLprEvent entirely, so we do not touch Firestore at all for these numbers.
  if (isTollgateWhitelistedPlate(event.plateNumber)) {
    try {
      console.log("[LPR API] Plate is in Tollgate whitelist - skipping ALL processing", {
        plateNumber: event.plateNumber,
        deviceId: event.deviceId,
        direction: event.direction,
      })
    } catch {}
    return NextResponse.json({ status: "ok", skipped: "tollgate_whitelist" })
  }

  // IMPORTANT: Admin whitelist (Firestore `lpr_whitelist`) short-circuit:
  // If the plate exists in `/admin/dashboard/whitelist`, we skip ALL processing and do NOT write anything.
  // (We still do a single read to check the whitelist entry.)
  const normalized = normalizeLicensePlate(event.plateNumber || "")
  if (normalized) {
    try {
      const whitelistDoc = await getDoc(doc(db, "lpr_whitelist", normalized))
      if (whitelistDoc.exists()) {
        try {
          console.log("[LPR API] Plate is in Firestore whitelist - skipping ALL processing", {
            plateNumber: event.plateNumber,
            normalizedPlate: normalized,
            deviceId: event.deviceId,
            direction: event.direction,
          })
        } catch {}
        return NextResponse.json({ status: "ok", skipped: "firestore_whitelist" })
      }
    } catch (e) {
      console.error("[LPR API] Failed to check Firestore whitelist, continuing processing", e)
    }
  }

  try {
    console.log('[LPR API] Delegating to handleLprEvent...')
    const result = await handleLprEvent({
      ...event,
      raw: body
    });
    console.log('[LPR API] handleLprEvent result', result)
    return NextResponse.json({ status: "ok", ...result });
  } catch (e) {
    // Fail-open in production-intensive flow: avoid hard 500 loops from camera retries.
    console.error("[LPR API] Failed to handle LPR event, returning degraded response:", e);
    return NextResponse.json({
      status: "ok",
      degraded: true,
      warning: "lpr_processing_failed",
    });
  }

  return NextResponse.json({ status: "ok" });
}

export function GET() {
  // Dispozitivul nu ar trebui să cheme GET, îl blocăm explicit.
  return new NextResponse("Method Not Allowed", { status: 405 });
}
