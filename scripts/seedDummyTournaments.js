require("dotenv").config();

const pool = require("../src/db");

const TOTAL_TOURNAMENTS = 18;
const MIN_PLAYERS = 16;
const MAX_PLAYERS = 22;
const TARGET_YEARS = [2024, 2025, 2026];

const PAUPER_DECKS = [
  "Grixis Affinity",
  "Mono-Blue Terror",
  "Kuldotha Red",
  "Dimir Terror",
  "Boros Synthesizer",
  "Caw Gates",
  "Azorius Affinity",
  "Orzhov Blade",
  "Jund Wildfire",
  "Mono-White Aggro",
  "Familiars",
  "Bogles",
  "Elves",
  "Walls Combo",
  "Burn",
  "Mardu Synthesizer",
  "Mono-Black Midrange",
  "Tron",
  "Rakdos Madness",
  "Gruul Ramp",
  "Izzet Faeries",
  "Dimir Faeries",
  "Boros Bully",
  "Slivers",
  "Poison Storm",
  "Infect",
  "Mono-Green Stompy",
  "UW Ephemerate",
];

const PLAYER_NAMES = [
  "Aco", "Lena", "Milo", "Kira", "Niko", "Jana", "Rex", "Timo", "Sven", "Mara",
  "Eli", "Noah", "Tara", "Pia", "Luca", "Mina", "Dario", "Lea", "Jonas", "Zoe",
  "Mia", "Kai", "Nina", "Rafa", "Ben", "Lina", "Ivo", "Sara", "Nora", "Leo",
  "Iris", "Pavel", "MinaG", "Rico", "Tobi", "Emma", "Maja", "David", "Anja", "Sofi",
  "Nils", "Aria", "Finn", "Mert", "Dina", "Luka", "Aylin", "Sia", "Omar", "Vera",
];

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sample(arr) {
  return arr[randomInt(0, arr.length - 1)];
}

function makeTournamentName(index, year) {
  const labels = [
    "Weekly Pauper",
    "Friday Night Pauper",
    "Regional Pauper Cup",
    "Pauper League",
    "Store Championship",
    "Monthly Pauper Clash",
  ];

  return `${labels[index % labels.length]} ${year} #${index + 1}`;
}

function randomDateInYear(year, slot) {
  // Spread events per year by assigning each one a target month bucket.
  const month = Math.min(11, Math.max(0, slot * 2 + randomInt(0, 1)));
  const day = randomInt(3, 26);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function buildRecord(maxRounds) {
  const wins = randomInt(0, maxRounds);
  const remaining = maxRounds - wins;
  const draws = remaining > 0 ? randomInt(0, Math.min(2, remaining)) : 0;
  const losses = remaining - draws;
  return { wins, losses, draws };
}

async function insertTournament(connection, name, playedOn) {
  const [result] = await connection.query(
    "INSERT INTO tournaments (name, played_on) VALUES (?, ?)",
    [name, playedOn]
  );
  return Number(result.insertId);
}

async function insertEntry(connection, entry) {
  await connection.query(
    `
    INSERT INTO entries (tournament_id, player_name, user_id, decklist_id, deck, wins, losses, draws)
    VALUES (?, ?, NULL, NULL, ?, ?, ?, ?)
    `,
    [
      entry.tournamentId,
      entry.playerName,
      entry.deck,
      entry.wins,
      entry.losses,
      entry.draws,
    ]
  );
}

async function seedDummyTournaments() {
  const connection = await pool.getConnection();

  let tournamentsCreated = 0;
  let entriesCreated = 0;

  try {
    await connection.beginTransaction();

    const tournamentsPerYear = Math.floor(TOTAL_TOURNAMENTS / TARGET_YEARS.length);
    const extra = TOTAL_TOURNAMENTS % TARGET_YEARS.length;

    let globalIndex = 0;

    for (let i = 0; i < TARGET_YEARS.length; i += 1) {
      const year = TARGET_YEARS[i];
      const countForYear = tournamentsPerYear + (i < extra ? 1 : 0);

      for (let slot = 0; slot < countForYear; slot += 1) {
        const tournamentName = makeTournamentName(globalIndex, year);
        const playedOn = randomDateInYear(year, slot);

        const tournamentId = await insertTournament(connection, tournamentName, playedOn);
        tournamentsCreated += 1;

        const players = randomInt(MIN_PLAYERS, MAX_PLAYERS);
        const rounds = randomInt(4, 6);

        for (let p = 0; p < players; p += 1) {
          const playerName = sample(PLAYER_NAMES);
          const deck = sample(PAUPER_DECKS);
          const { wins, losses, draws } = buildRecord(rounds);

          await insertEntry(connection, {
            tournamentId,
            playerName,
            deck,
            wins,
            losses,
            draws,
          });

          entriesCreated += 1;
        }

        globalIndex += 1;
      }
    }

    await connection.commit();

    console.log(`Seed complete: ${tournamentsCreated} tournaments, ${entriesCreated} entries.`);
    console.log(`Years covered: ${TARGET_YEARS.join(", ")}`);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
    await pool.end();
  }
}

seedDummyTournaments().catch((error) => {
  console.error("Failed to seed dummy tournaments:", error.message);
  process.exitCode = 1;
});
