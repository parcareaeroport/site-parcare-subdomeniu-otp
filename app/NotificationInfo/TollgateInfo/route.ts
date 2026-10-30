import { withLprRequest, lprLog, lprFields, lprError } from "@/lib/lpr-log.server"
import { NextRequest, NextResponse } from "next/server";
import { handleLprEvent } from "@/lib/lpr-service";
import { cameraConfiguration } from "@/lib/lpr-camera-config.server";

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

async function POSTHandler(req: NextRequest) {
  let body: LprPayload;

  try {

    body = (await req.json()) as LprPayload;

  } catch (error) {
    lprFields({reason:"invalid_json"}); lprLog("parse_rejected",{reason:"invalid_json"},"warn")

    return new NextResponse("Bad Request", { status: 400 });
  }

  const event = extractLprEvent(body);

  const camera = cameraConfiguration(event.deviceId);
  lprFields({deviceId:event.deviceId,receivedDirection:event.direction,configSource:camera ? "device_override" : "legacy_payload"})
  // Legacy cameras send no Authorization header. Configuration is optional:
  // without an override, the service resolves Direction/DeviceID from the payload
  // and uses the existing Romania civil-clock convention.
  try {
    const result = await handleLprEvent({ ...event, direction:camera?.direction ?? event.direction, timestampMode:camera?.timestampMode ?? "romania_wall_clock",maxEventAgeMinutes:camera?.maxEventAgeMinutes ?? 1440,
      // Preserve diagnostic metadata, not camera images/base64 or credentials.
      raw:{Plate:body.Picture?.Plate || null,SnapInfo:body.Picture?.SnapInfo || null},
    });
    lprLog("processing_result",{eventId:result.savedEventId,bookingId:result.matchedBookingId,reason:result.warning,outcome:result.savedEventId === "degraded_no_persist" ? "error" : result.degraded ? "pending" : result.warning ? "needs_review" : "processed"},result.degraded ? "warn" : "info")
    return NextResponse.json({status:result.degraded ? "pending" : "ok",...result}, {status:result.savedEventId === "degraded_no_persist" ? 503 : 200});
  } catch(error) {
    lprFields({reason:"processing_unavailable"}); lprError("processing_failed",error)

    return NextResponse.json({error:"Processing unavailable; retry the same event"},{status:503});
  }
}

function GETHandler() {
  // Dispozitivul nu ar trebui să cheme GET, îl blocăm explicit.
  return new NextResponse("Method Not Allowed", { status: 405 });
}

export const POST = withLprRequest(POSTHandler)
export const GET = withLprRequest(GETHandler)
