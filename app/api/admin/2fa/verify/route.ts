import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import * as OTPAuth from "otpauth";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { code } = await req.json();
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user?.totpSecret) {
    return NextResponse.json({ error: "2FA not set up" }, { status: 400 });
  }

  const totp = new OTPAuth.TOTP({
    issuer: "BuzzerSeats",
    label: user.email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(user.totpSecret),
  });

  const delta = totp.validate({ token: code, window: 1 });
  if (delta === null) {
    return NextResponse.json({ error: "Invalid code" }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
