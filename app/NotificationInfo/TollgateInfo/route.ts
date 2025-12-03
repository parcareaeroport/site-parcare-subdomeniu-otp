import { NextRequest, NextResponse } from "next/server";
import { handleLprEvent } from "@/lib/lpr-service";

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

  try {
    console.log('[LPR API] Delegating to handleLprEvent...')
    const result = await handleLprEvent({
      ...event,
      raw: body
    });
    console.log('[LPR API] handleLprEvent result', result)
    return NextResponse.json({ status: "ok", ...result });
  } catch (e) {
    console.error("Failed to handle LPR event:", e);
    return new NextResponse("Internal Server Error", { status: 500 });
  }

  return NextResponse.json({ status: "ok" });
}

export function GET() {
  // Dispozitivul nu ar trebui să cheme GET, îl blocăm explicit.
  return new NextResponse("Method Not Allowed", { status: 405 });
}
