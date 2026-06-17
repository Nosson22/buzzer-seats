import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

// GET /api/games — upcoming games with active/upcoming listings
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const teamSlug = searchParams.get("team") || "marlins";
  const upcoming = searchParams.get("upcoming") === "true";

  const games = await prisma.game.findMany({
    where: {
      team: { slug: teamSlug },
      ...(upcoming ? { gameTime: { gt: new Date() }, status: { in: ["UPCOMING", "LIVE"] } } : {}),
    },
    include: {
      team: { select: { name: true, slug: true, sport: true } },
      _count: { select: { listings: { where: { status: "LIVE" } } } },
    },
    orderBy: { gameTime: "asc" },
  });

  return NextResponse.json(games);
}

// POST /api/games — admin only: create a game
const gameSchema = z.object({
  teamId: z.string(),
  homeTeam: z.string(),
  awayTeam: z.string(),
  venue: z.string(),
  gameTime: z.string().datetime(),
  season: z.string(),
  externalId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const data = gameSchema.parse(body);
    const game = await prisma.game.create({ data: { ...data, gameTime: new Date(data.gameTime) } });
    return NextResponse.json(game, { status: 201 });
  } catch (err: any) {
    if (err.name === "ZodError") return NextResponse.json({ error: err.errors }, { status: 400 });
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
