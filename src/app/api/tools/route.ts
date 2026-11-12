// GET /api/tools — lists Maya's tools with their JSON Schemas.

import { NextResponse } from "next/server";
import { toolDefinitions } from "@/lib/clinic/tools";

export function GET() {
  return NextResponse.json({ tools: toolDefinitions() });
}
