import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";

// GET — generate a new TOTP secret and return QR code
export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const totp = new OTPAuth.TOTP({
    issuer: "BuzzerSeats",
    label: session.user.email ?? "admin",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
  });

  const secret = totp.secret.base32;
  const uri = totp.toString();
  const qrCode = await QRCode.toDataURL(uri);

  // Store secret temporarily — confirmed on POST
  await prisma.user.update({
    where: { id: session.user.id },
    data: { totpSecret: secret },
  });

  return NextResponse.json({ secret, qrCode });
}

// POST — verify the code the user typed to confirm setup
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { code } = await req.json();
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user?.totpSecret) {
    return NextResponse.json({ error: "No secret found, start setup again" }, { status: 400 });
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
    return NextResponse.json({ error: "Invalid code — try again" }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
