import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_PATH = path.join(ROOT, "tv-data.json");
const OUTPUT_PATH = path.join(ROOT, "tv-ratings.json");
const CACHE_DIR = path.join(ROOT, ".cache", "imdb");
const TITLE_EPISODE_URL = "https://datasets.imdbws.com/title.episode.tsv.gz";
const TITLE_RATINGS_URL = "https://datasets.imdbws.com/title.ratings.tsv.gz";

async function download(url, destination) {
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }

  const file = fs.createWriteStream(destination);
  await new Promise((resolve, reject) => {
    Readable.fromWeb(response.body).pipe(file);
    file.on("finish", resolve);
    file.on("error", reject);
  });
}

async function ensureDataset(url, filename) {
  const destination = path.join(CACHE_DIR, filename);
  try {
    const stats = await fs.promises.stat(destination);
    if (stats.size > 0) return destination;
  } catch {
    // Download below.
  }

  console.log(`Downloading ${filename}...`);
  await download(url, destination);
  return destination;
}

function loadTrackedShows() {
  const parsed = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  return (parsed.shows || [])
    .filter((show) => Number.isFinite(Number(show.id)))
    .map((show) => ({
      id: Number(show.id),
      name: show.name || `TVMaze ${show.id}`,
      episodes: (show.episodes || [])
        .filter((episode) => episode.season && episode.number)
        .map((episode) => ({
          season: Number(episode.season),
          number: Number(episode.number),
        })),
    }));
}

async function fetchShowImdbId(tvmazeId) {
  const response = await fetch(`https://api.tvmaze.com/shows/${tvmazeId}`);
  if (!response.ok) return "";
  const show = await response.json();
  return show?.externals?.imdb || "";
}

async function loadShowMappings(shows) {
  const mappings = new Map();
  for (const show of shows) {
    const imdbId = await fetchShowImdbId(show.id);
    if (imdbId) {
      mappings.set(imdbId, show);
      console.log(`${show.name}: ${imdbId}`);
    } else {
      console.warn(`${show.name}: no IMDb ID found in TVMaze`);
    }
  }
  return mappings;
}

async function readEpisodeMap(episodePath, showsByImdbId) {
  const wantedParents = new Set(showsByImdbId.keys());
  const episodeMap = new Map();
  const stream = fs.createReadStream(episodePath).pipe(createGunzip());
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of lines) {
    if (line.startsWith("tconst")) continue;
    const [tconst, parentTconst, seasonNumber, episodeNumber] = line.split("\t");
    if (!wantedParents.has(parentTconst) || seasonNumber === "\\N" || episodeNumber === "\\N") continue;
    const show = showsByImdbId.get(parentTconst);
    const key = `${show.id}:${seasonNumber}:${episodeNumber}`;
    episodeMap.set(tconst, {
      tvmazeShowId: show.id,
      season: Number(seasonNumber),
      episode: Number(episodeNumber),
      key,
    });
  }

  return episodeMap;
}

async function readRatings(ratingsPath, episodeMap) {
  const ratings = new Map();
  const stream = fs.createReadStream(ratingsPath).pipe(createGunzip());
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of lines) {
    if (line.startsWith("tconst")) continue;
    const [tconst, averageRating, numVotes] = line.split("\t");
    const episode = episodeMap.get(tconst);
    if (!episode) continue;
    ratings.set(episode.key, {
      imdbId: tconst,
      rating: Number(averageRating),
      votes: Number(numVotes),
    });
  }

  return ratings;
}

function buildOutput(shows, showsByImdbId, episodeMap, ratings) {
  const imdbIdByTvmaze = new Map([...showsByImdbId.entries()].map(([imdbId, show]) => [show.id, imdbId]));
  const output = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: "IMDb non-commercial datasets + TVMaze show IMDb IDs",
    shows: {},
  };

  for (const show of shows) {
    const showRatings = {};
    const knownEpisodes = [...episodeMap.values()].filter((episode) => episode.tvmazeShowId === show.id).length;
    for (const episode of show.episodes) {
      const key = `${show.id}:${episode.season}:${episode.number}`;
      const rating = ratings.get(key);
      if (rating) {
        showRatings[`${episode.season}:${episode.number}`] = rating;
      }
    }

    output.shows[String(show.id)] = {
      name: show.name,
      imdbId: imdbIdByTvmaze.get(show.id) || "",
      matchedEpisodes: Object.keys(showRatings).length,
      knownImdbEpisodes: knownEpisodes,
      episodes: showRatings,
    };
  }

  return output;
}

async function main() {
  const shows = loadTrackedShows();
  if (!shows.length) {
    throw new Error("No tracked shows found in tv-data.json.");
  }

  const [episodePath, ratingsPath] = await Promise.all([
    ensureDataset(TITLE_EPISODE_URL, "title.episode.tsv.gz"),
    ensureDataset(TITLE_RATINGS_URL, "title.ratings.tsv.gz"),
  ]);
  const showsByImdbId = await loadShowMappings(shows);
  const episodeMap = await readEpisodeMap(episodePath, showsByImdbId);
  const ratings = await readRatings(ratingsPath, episodeMap);
  const output = buildOutput(shows, showsByImdbId, episodeMap, ratings);

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Wrote ${path.relative(ROOT, OUTPUT_PATH)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
