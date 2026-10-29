import { NextRequest, NextResponse } from "next/server";
import { handleLprEvent } from "@/lib/lpr-service";
import { cameraConfiguration, validSecret } from "@/lib/lpr-camera-config.server";

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
  if (!process.env.LPR_AUTH_SECRET || !process.env.LPR_DEVICES_JSON) return NextResponse.json({error:"Camera ingestion is not configured"},{status:503});
  if (!validSecret(req.headers.get("authorization"),process.env.LPR_AUTH_SECRET)) return NextResponse.json({error:"Unauthorized"},{status:401});
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

  const camera = cameraConfiguration(event.deviceId);
  if (!camera) return NextResponse.json({error:"Unknown device"},{status:403});
  try {
    const result = await handleLprEvent({ ...event, direction:camera.direction, timestampMode:camera.timestampMode,maxEventAgeMinutes:camera.maxEventAgeMinutes ?? 1440,
      // Preserve diagnostic metadata, not camera images/base64 or credentials.
      raw:{Plate:body.Picture?.Plate || null,SnapInfo:body.Picture?.SnapInfo || null},
    });
    return NextResponse.json({status:result.degraded ? "pending" : "ok",...result}, {status:result.savedEventId === "degraded_no_persist" ? 503 : 200});
  } catch(error) {
    console.error("LPR ingestion failed",error);
    return NextResponse.json({error:"Processing unavailable; retry the same event"},{status:503});
  }
}

export function GET() {
  // Dispozitivul nu ar trebui să cheme GET, îl blocăm explicit.
  return new NextResponse("Method Not Allowed", { status: 405 });
}
