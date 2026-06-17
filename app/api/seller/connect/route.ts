import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";

// GET — return seller's current Connect status
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { stripeAccountId: true },
  });

  if (!user?.stripeAccountId) return NextResponse.json({ connected: false });

  const account = await stripe.accounts.retrieve(user.stripeAccountId);
  return NextResponse.json({
    connected: account.charges_enabled,
    payoutsEnabled: account.payouts_enabled,
    detailsSubmitted: account.details_submitted,
  });
}

// POST — create or retrieve a Connect account and return onboarding URL
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { stripeAccountId: true, email: true },
  });

  let accountId = user?.stripeAccountId;

  // Create a new Express account if the seller doesn't have one
  if (!accountId) {
    const account = await stripe.accounts.create({
      type: "express",
      email: user?.email,
      capabilities: { transfers: { requested: true } },
      business_type: "individual",
    });
    accountId = account.id;
    await prisma.user.update({
      where: { id: session.user.id },
      data: { stripeAccountId: accountId },
    });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${appUrl}/dashboard?connect=refresh`,
    return_url: `${appUrl}/dashboard?connect=success`,
    type: "account_onboarding",
  });

  return NextResponse.json({ url: accountLink.url });
}
