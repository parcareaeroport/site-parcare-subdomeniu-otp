import { NextRequest, NextResponse } from "next/server"

import {
  sendCancellationRequestEmail,
  type CancellationEmailData,
  validateCancellationEmailData,
} from "@/lib/cancellation-email"

export async function POST(request: NextRequest) {
  try {
    const data: CancellationEmailData = await request.json()

    const validationError = validateCancellationEmailData(data)
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 })
    }

    const result = await sendCancellationRequestEmail(data)

    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    console.error("❌ CANCELLATION EMAIL FAILED!", error)

    const message = error instanceof Error ? error.message : "Unknown error"
    const status = message === "Configurație email lipsă" ? 500 : 500

    return NextResponse.json(
      {
        error:
          message === "Configurație email lipsă"
            ? message
            : "Eroare la trimiterea cererii de anulare",
        timestamp: new Date().toISOString(),
      },
      { status }
    )
  }
}
