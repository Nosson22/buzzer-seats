/**
 * Syncs real Miami Marlins home games from the MLB Stats API.
 * Run from Railway console: node scripts/sync-games.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const MLB_TEAM_ID = 146; // Miami Marlins

async function syncGames() {
  const season = new Date().getFullYear().toString();
  const url = `https://statsapi.mlb.com/api/v1/schedule?teamId=${MLB_TEAM_ID}&season=${season}&gameType=R&sportId=1&hydrate=venue`;

  console.log(`Fetching Marlins ${season} schedule from MLB Stats API...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MLB API error: ${res.status}`);
  const data = await res.json();

  const team = await prisma.team.findFirst({ where: { slug: "marlins" } });
  if (!team) throw new Error("Marlins team not found. Run prisma db seed first.");

  let synced = 0;
  for (const date of data.dates) {
    for (const game of date.games) {
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
          teamId: team.id,
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

  console.log(`✓ Synced ${synced} Marlins home games (season ${season}).`);
}

syncGames().catch(console.error).finally(() => prisma.$disconnect());
