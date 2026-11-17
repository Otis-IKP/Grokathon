import { ImageResponse } from "next/og";
import { AppIcon } from "@/components/app/AppIcon";

/** Home-screen icons for the web manifest. Static artwork, no data, so no session is needed. */
export async function GET(_req: Request, ctx: { params: Promise<{ size: string }> }) {
  const { size: raw } = await ctx.params;
  const size = raw === "512" ? 512 : 192;
  return new ImageResponse(<AppIcon size={size} />, { width: size, height: size });
}
