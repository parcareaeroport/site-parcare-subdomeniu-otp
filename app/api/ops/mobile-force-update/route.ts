import { NextResponse } from "next/server"

import {
  getForceUpdateSettings,
  saveForceUpdateSettings,
  verifyOpsForceUpdatePassword,
} from "@/lib/ops-force-update"

function unauthorized() {
  return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    if (!body || !verifyOpsForceUpdatePassword(body.password)) {
      return unauthorized()
    }

    if (body.action === "get") {
      const appUpdate = await getForceUpdateSettings()
      return NextResponse.json({ success: true, appUpdate })
    }

    if (body.action === "save") {
      const raw = body.appUpdate
      if (!raw || typeof raw !== "object") {
        return NextResponse.json({ success: false, error: "Invalid payload" }, { status: 400 })
      }

      const appUpdate = await saveForceUpdateSettings({
        enabled: !!raw.enabled,
        forceUpdate: !!raw.forceUpdate,
        minVersion: typeof raw.minVersion === "string" ? raw.minVersion : undefined,
        latestVersion: typeof raw.latestVersion === "string" ? raw.latestVersion : undefined,
        iosUrl: typeof raw.iosUrl === "string" ? raw.iosUrl : undefined,
        androidUrl: typeof raw.androidUrl === "string" ? raw.androidUrl : undefined,
        message: typeof raw.message === "string" ? raw.message : undefined,
      })

      return NextResponse.json({ success: true, appUpdate })
    }

    return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
