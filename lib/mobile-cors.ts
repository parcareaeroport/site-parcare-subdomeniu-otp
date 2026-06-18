import { NextResponse } from "next/server"

export const mobileCorsHeaders = {
  "Access-Control-Allow-Origin": process.env.MOBILE_ALLOWED_ORIGIN || "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Guest-Email",
}

export function mobileOptionsResponse() {
  return new NextResponse(null, { status: 204, headers: mobileCorsHeaders })
}

export function mobileJsonResponse(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: mobileCorsHeaders })
}
