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

  // Create a few upcoming games
  const now = new Date();
  const gameData = [
    { daysFromNow: 0, hoursFromNow: 1.5, away: "New York Mets" },
    { daysFromNow: 2, hoursFromNow: 19, away: "Atlanta Braves" },
    { daysFromNow: 5, hoursFromNow: 13, away: "Philadelphia Phillies" },
    { daysFromNow: 7, hoursFromNow: 19, away: "Washington Nationals" },
  ];

  for (const g of gameData) {
    const gameTime = new Date(now);
    gameTime.setDate(gameTime.getDate() + g.daysFromNow);
    gameTime.setHours(Math.floor(g.hoursFromNow), (g.hoursFromNow % 1) * 60, 0, 0);

    await prisma.game.upsert({
      where: { externalId: `seed-${g.away.replace(/\s/g, "-").toLowerCase()}` },
      update: {},
      create: {
        teamId: marlins.id,
        homeTeam: "Miami Marlins",
        awayTeam: g.away,
        venue: "loanDepot park, Miami, FL",
        gameTime,
        season: "2026",
        externalId: `seed-${g.away.replace(/\s/g, "-").toLowerCase()}`,
      },
    });
  }

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
