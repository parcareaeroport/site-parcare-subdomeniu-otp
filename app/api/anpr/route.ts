import { withLprRequest, lprLog, lprFields, lprError } from "@/lib/lpr-log.server"
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs"; // avem nevoie de Node, nu Edge
export const dynamic = "force-dynamic"; // fără cache

type FormDataPart = {
  field: string;
  type: "file" | "text";
  name?: string;
  mime?: string;
  size?: number;
  value?: string;
};

async function POSTHandler(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const qs = Object.fromEntries(url.searchParams.entries());
    lprFields({outcome:"receipt_only"})
    const contentType = req.headers.get("content-type") || "";

    lprFields({contentType})

    if (contentType.includes("multipart/form-data")) {
      let form: FormData;
      try {
        form = await req.formData();
      } catch (e) {
        lprFields({reason:"invalid_multipart"})

        return NextResponse.json(
          { ok: false, error: "Invalid multipart form data" },
          { status: 400 }
        );
      }

      const summary: FormDataPart[] = [];

      for (const [key, value] of form.entries()) {
        if (typeof value === "object" && "name" in value && "type" in value) {
          const file = value as File;
          summary.push({
            field: key,
            type: "file",
            name: file.name,
            mime: file.type,
            size: file.size, // bytes
          });
        } else {
          summary.push({
            field: key,
            type: "text",
            value: String(value),
          });
        }
      }

      lprLog("anpr_parsed",{outcome:"receipt_only",textFieldCount:summary.filter(p=>p.type === "text").length,imageCount:summary.filter(p=>p.type === "file").length})
      return NextResponse.json({ ok: true, mode: "multipart", query: qs, parts: summary });
    }

    if (contentType.includes("application/json")) {
      const body = await req.json().catch(() => null);

      return NextResponse.json({ ok: true, mode: "json", query: qs, body });
    }

    if (contentType.includes("application/xml") || contentType.includes("text/xml")) {
      const xml = await req.text();

      return NextResponse.json({ ok: true, mode: "xml", query: qs, length: xml.length });
    }

    // fallback: orice alt tip (text/plain etc.)
    const text = await req.text();

    return NextResponse.json({ ok: true, mode: "raw", query: qs, length: text.length });
  } catch (err: unknown) {
    lprError("anpr_failed",err)
    const message = err instanceof Error ? err.message : "Unknown error";

    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

async function GETHandler(req: NextRequest) {
  // util pentru test rapid din browser
  const url = new URL(req.url);

  return NextResponse.json({ ok: true, message: "ANPR endpoint alive" });
}

export const POST = withLprRequest(POSTHandler)
export const GET = withLprRequest(GETHandler)
