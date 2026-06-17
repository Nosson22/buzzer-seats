import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  // Create Marlins team
  const marlins = await prisma.team.upsert({
    where: { slug: "marlins" },
    update: {},
    create: {
      name: "Miami Marlins",
      slug: "marlins",
      sport: "baseball",
      city: "Miami",
    },
  });

  // Sync real Marlins home games from the MLB Stats API
  const MLB_TEAM_ID = 146; // Miami Marlins
  const season = new Date().getFullYear().toString();
  const url = `https://statsapi.mlb.com/api/v1/schedule?teamId=${MLB_TEAM_ID}&season=${season}&gameType=R&sportId=1&hydrate=venue`;

  const res = await fetch(url);
  const data = (await res.json()) as {
    dates: Array<{
      games: Array<{
        gamePk: number;
        gameDate: string;
        teams: { home: { team: { id: number; name: string } }; away: { team: { name: string } } };
        venue: { name: string };
        status: { abstractGameState: string };
      }>;
    }>;
  };

  let synced = 0;
  for (const date of data.dates) {
    for (const game of date.games) {
      // Only Marlins home games that haven't been cancelled
      if (
        game.teams.home.team.id !== MLB_TEAM_ID ||
        game.status.abstractGameState === "Final"
      ) continue;

      await prisma.game.upsert({
        where: { externalId: `mlb-${game.gamePk}` },
        update: {
          gameTime: new Date(game.gameDate),
          venue: game.venue.name,
          awayTeam: game.teams.away.team.name,
        },
        create: {
          teamId: marlins.id,
          homeTeam: "Miami Marlins",
          awayTeam: game.teams.away.team.name,
          venue: game.venue.name,
          gameTime: new Date(game.gameDate),
          season,
          externalId: `mlb-${game.gamePk}`,
        },
      });
      synced++;
    }
  }
  console.log(`Synced ${synced} Marlins home games from MLB Stats API.`);

  // Create admin user
  const adminPass = await bcrypt.hash("admin1234", 12);
  await prisma.user.upsert({
    where: { email: "admin@marlinstickets.com" },
    update: {},
    create: {
      email: "admin@marlinstickets.com",
      name: "Admin",
      password: adminPass,
      role: "ADMIN",
      verified: true,
    },
  });

  // Create a test seller
  const sellerPass = await bcrypt.hash("seller1234", 12);
  await prisma.user.upsert({
    where: { email: "seller@example.com" },
    update: {},
    create: {
      email: "seller@example.com",
      name: "Test Seller",
      password: sellerPass,
      role: "SELLER",
      verified: true,
    },
  });

  // Create a test buyer
  const buyerPass = await bcrypt.hash("buyer1234", 12);
  await prisma.user.upsert({
    where: { email: "buyer@example.com" },
    update: {},
    create: {
      email: "buyer@example.com",
      name: "Test Buyer",
      password: buyerPass,
      role: "BUYER",
      verified: true,
    },
  });

  console.log("Seed complete.");
}

main().catch(console.error).finally(() => prisma.$disconnect());
