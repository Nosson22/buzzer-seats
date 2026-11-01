/**
 * Syncs home games for all active teams into the database.
 *
 * Sources:
 *   Marlins  → MLB Stats API (statsapi.mlb.com)
 *   Heat     → ESPN API (site.api.espn.com/apis/site/v2/sports/basketball/nba)
 *   Dolphins → ESPN API (site.api.espn.com/apis/site/v2/sports/football/nfl)
 *   Bucs     → ESPN API (site.api.espn.com/apis/site/v2/sports/football/nfl)
 *
 * Run manually: npx ts-node scripts/sync-games.ts
 * Or wire as a Railway cron at season start.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ── MLB ──────────────────────────────────────────────────────────────────────

async function syncMarlins(teamId: string, season: string) {
  const MLB_TEAM_ID = 146;
  const url = `https://statsapi.mlb.com/api/v1/schedule?teamId=${MLB_TEAM_ID}&season=${season}&gameType=R&sportId=1&hydrate=venue`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MLB API error: ${res.status}`);

  const data = await res.json() as {
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

  let count = 0;
  for (const date of data.dates) {
    for (const game of date.games) {
      if (game.teams.home.team.id !== MLB_TEAM_ID || game.status.abstractGameState === "Final") continue;
      await prisma.game.upsert({
        where: { externalId: `mlb-${game.gamePk}` },
        update: { gameTime: new Date(game.gameDate), venue: game.venue.name, awayTeam: game.teams.away.team.name },
        create: {
          teamId,
          homeTeam: "Miami Marlins",
          awayTeam: game.teams.away.team.name,
          venue: game.venue.name,
          gameTime: new Date(game.gameDate),
          season,
          externalId: `mlb-${game.gamePk}`,
        },
      });
      count++;
    }
  }
  console.log(`✓ Marlins: ${count} home games (${season})`);
}

// ── ESPN helper ───────────────────────────────────────────────────────────────

interface ESPNEvent {
  id: string;
  date: string;
  name: string;
  competitions: Array<{
    venue: { fullName: string };
    competitors: Array<{ homeAway: string; team: { displayName: string } }>;
    status: { type: { completed: boolean } };
  }>;
}

async function fetchESPNSchedule(sport: string, league: string, teamId: string, season: string): Promise<ESPNEvent[]> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/teams/${teamId}/schedule?season=${season}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN API error (${url}): ${res.status}`);
  const data = await res.json() as { events: ESPNEvent[] };
  return data.events ?? [];
}

async function syncESPN(opts: {
  teamDbId: string;
  espnTeamId: string;
  sport: string;
  league: string;
  homeTeamName: string;
  externalPrefix: string;
  season: string;
}) {
  const { teamDbId, espnTeamId, sport, league, homeTeamName, externalPrefix, season } = opts;
  const events = await fetchESPNSchedule(sport, league, espnTeamId, season);

  let count = 0;
  for (const event of events) {
    const comp = event.competitions[0];
    if (!comp) continue;
    if (comp.status.type.completed) continue;

    const homeComp = comp.competitors.find((c) => c.homeAway === "home");
    const awayComp = comp.competitors.find((c) => c.homeAway === "away");

    // Only home games for our team
    if (!homeComp?.team.displayName.includes(homeTeamName.split(" ").at(-1)!)) continue;

    const awayTeam = awayComp?.team.displayName ?? "TBD";
    const venue = comp.venue?.fullName ?? "TBD";

    await prisma.game.upsert({
      where: { externalId: `${externalPrefix}-${event.id}` },
      update: { gameTime: new Date(event.date), venue, awayTeam },
      create: {
        teamId: teamDbId,
        homeTeam: homeTeamName,
        awayTeam,
        venue,
        gameTime: new Date(event.date),
        season,
        externalId: `${externalPrefix}-${event.id}`,
      },
    });
    count++;
  }
  console.log(`✓ ${homeTeamName}: ${count} home games (${season})`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const currentYear = new Date().getFullYear();
  const season = currentYear.toString();
  // NBA seasons span two years; ESPN labels the 2025-26 season as "2025"
  const nbaSeason = (currentYear - 1).toString();

  const [marlins, heat, dolphins, buccaneers] = await Promise.all([
    prisma.team.findUniqueOrThrow({ where: { slug: "marlins" } }),
    prisma.team.findUniqueOrThrow({ where: { slug: "heat" } }),
    prisma.team.findUniqueOrThrow({ where: { slug: "dolphins" } }),
    prisma.team.findUniqueOrThrow({ where: { slug: "buccaneers" } }),
  ]);

  await syncMarlins(marlins.id, season);

  await syncESPN({
    teamDbId: heat.id,
    espnTeamId: "14",       // ESPN team ID for Miami Heat
    sport: "basketball",
    league: "nba",
    homeTeamName: "Miami Heat",
    externalPrefix: "nba",
    season: nbaSeason,
  });

  await syncESPN({
    teamDbId: dolphins.id,
    espnTeamId: "15",       // ESPN team ID for Miami Dolphins
    sport: "football",
    league: "nfl",
    homeTeamName: "Miami Dolphins",
    externalPrefix: "nfl",
    season,
  });

  await syncESPN({
    teamDbId: buccaneers.id,
    espnTeamId: "27",       // ESPN team ID for Tampa Bay Buccaneers
    sport: "football",
    league: "nfl",
    homeTeamName: "Tampa Bay Buccaneers",
    externalPrefix: "nfl",
    season,
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
