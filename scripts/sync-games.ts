/**
 * Syncs real Miami Marlins home games from the MLB Stats API into the database.
 * Run manually: npx ts-node scripts/sync-games.ts
 * Or wire up as a Railway cron job at the start of each season.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const MLB_TEAM_ID = 146; // Miami Marlins

async function syncGames(season = new Date().getFullYear().toString()) {
  const url = `https://statsapi.mlb.com/api/v1/schedule?teamId=${MLB_TEAM_ID}&season=${season}&gameType=R&sportId=1&hydrate=venue`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`MLB API error: ${res.status}`);

  const data = (await res.json()) as {
    dates: Array<{
      games: Array<{
        gamePk: number;
        gameDate: string;
        teams: {
          home: { team: { id: number; name: string } };
          away: { team: { name: string } };
        };
        venue: { name: string };
        status: { abstractGameState: string };
      }>;
    }>;
  };

  const team = await prisma.team.findUniqueOrThrow({ where: { slug: "marlins" } });

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
