import { withLprRequest, lprFields } from "@/lib/lpr-log.server"
// app/NotificationInfo/KeepAlive/route.ts
import { NextResponse } from "next/server";

async function POSTHandler() {
  lprFields({outcome:"alive",explanation:"Semnal de conectivitate primit; fără modificarea ocupării."})
  return NextResponse.json({ status: "alive" });
}

export const POST = withLprRequest(POSTHandler)
