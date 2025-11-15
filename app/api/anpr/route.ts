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

export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const qs = Object.fromEntries(url.searchParams.entries());
    const contentType = req.headers.get("content-type") || "";

    console.log("=== [ANPR] NEW EVENT ===");
    console.log("[URL]", url.pathname);
    console.log("[QUERY]", qs);
    // Logăm doar headere non-sensibile
    const headersToLog = {
      "content-type": contentType,
      "user-agent": req.headers.get("user-agent") || undefined,
      "x-forwarded-for": req.headers.get("x-forwarded-for") || undefined,
    };
    console.log("[HEADERS]", headersToLog);
    console.log("[CONTENT-TYPE]", contentType);

    if (contentType.includes("multipart/form-data")) {
      let form: FormData;
      try {
        form = await req.formData();
      } catch (e) {
        console.error("[FORM-DATA PARSE ERROR]", e);
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

      console.log("[FORM-DATA PARTS]", summary);
      return NextResponse.json({ ok: true, mode: "multipart", query: qs, parts: summary });
    }

    if (contentType.includes("application/json")) {
      const body = await req.json().catch(() => null);
      console.log("[JSON BODY]", body);
      return NextResponse.json({ ok: true, mode: "json", query: qs, body });
    }

    if (contentType.includes("application/xml") || contentType.includes("text/xml")) {
      const xml = await req.text();
      console.log("[XML BODY]", xml);
      return NextResponse.json({ ok: true, mode: "xml", query: qs, length: xml.length });
    }

    // fallback: orice alt tip (text/plain etc.)
    const text = await req.text();
    console.log("[RAW BODY]", text);
    return NextResponse.json({ ok: true, mode: "raw", query: qs, length: text.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[ANPR] ERROR:", err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  // util pentru test rapid din browser
  const url = new URL(req.url);
  console.log("=== [ANPR] GET PING ===", Object.fromEntries(url.searchParams.entries()));
  return NextResponse.json({ ok: true, message: "ANPR endpoint alive" });
}


