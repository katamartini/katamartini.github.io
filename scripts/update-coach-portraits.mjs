import fs from "node:fs/promises";
import path from "node:path";

const coaches = [
  ["Arizona Cardinals", "Mike LaFleur", "mike-lafleur", "https://www.azcardinals.com/team/coaches-roster/"],
  ["Atlanta Falcons", "Kevin Stefanski", "kevin-stefanski", "https://www.atlantafalcons.com/team/coaches-roster/"],
  ["Baltimore Ravens", "Jesse Minter", "jesse-minter", "https://www.baltimoreravens.com/team/coaches-roster/"],
  ["Buffalo Bills", "Joe Brady", "joe-brady", "https://www.buffalobills.com/team/coaches-roster/"],
  ["Carolina Panthers", "Dave Canales", "dave-canales", "https://www.panthers.com/team/coaches-roster/"],
  ["Chicago Bears", "Ben Johnson", "ben-johnson", "https://www.chicagobears.com/team/coaches/"],
  ["Cincinnati Bengals", "Zac Taylor", "zac-taylor", "https://www.bengals.com/team/coaches-roster/"],
  ["Cleveland Browns", "Todd Monken", "todd-monken", "https://www.clevelandbrowns.com/team/coaches-roster/"],
  ["Dallas Cowboys", "Brian Schottenheimer", "brian-schottenheimer", "https://www.dallascowboys.com/team/coaches-roster/"],
  ["Denver Broncos", "Sean Payton", "sean-payton", "https://www.denverbroncos.com/team/coaches-roster/"],
  ["Detroit Lions", "Dan Campbell", "dan-campbell", "https://www.detroitlions.com/team/coaches-roster/"],
  ["Green Bay Packers", "Matt LaFleur", "matt-lafleur", "https://www.packers.com/team/coaches-roster/"],
  ["Houston Texans", "DeMeco Ryans", "demeco-ryans", "https://www.houstontexans.com/team/coaches-roster/"],
  ["Indianapolis Colts", "Shane Steichen", "shane-steichen", "https://www.colts.com/team/coaches-roster/"],
  ["Jacksonville Jaguars", "Liam Coen", "liam-coen", "https://www.jaguars.com/team/coaches-roster/"],
  ["Kansas City Chiefs", "Andy Reid", "andy-reid", "https://www.chiefs.com/team/coaches-roster/"],
  ["Las Vegas Raiders", "Klint Kubiak", "klint-kubiak", "https://www.raiders.com/team/coaches-roster/"],
  ["Los Angeles Chargers", "Jim Harbaugh", "jim-harbaugh", "https://www.chargers.com/team/coaches-roster/"],
  ["Los Angeles Rams", "Sean McVay", "sean-mcvay", "https://www.therams.com/team/coaches-roster/"],
  ["Miami Dolphins", "Jeff Hafley", "jeff-hafley", "https://www.miamidolphins.com/team/coaches-roster/"],
  ["Minnesota Vikings", "Kevin O'Connell", "kevin-oconnell", "https://www.vikings.com/team/coaches-roster/"],
  ["New England Patriots", "Mike Vrabel", "mike-vrabel", "https://www.patriots.com/team/coaches-roster/"],
  ["New Orleans Saints", "Kellen Moore", "kellen-moore", "https://www.neworleanssaints.com/team/coaches-roster/"],
  ["New York Giants", "John Harbaugh", "john-harbaugh", "https://www.giants.com/team/coaches-roster/"],
  ["New York Jets", "Aaron Glenn", "aaron-glenn", "https://www.newyorkjets.com/team/coaches-roster/"],
  ["Philadelphia Eagles", "Nick Sirianni", "nick-sirianni", "https://www.philadelphiaeagles.com/team/coaches/"],
  ["Pittsburgh Steelers", "Mike McCarthy", "mike-mccarthy", "https://www.steelers.com/team/coaches-roster/"],
  ["San Francisco 49ers", "Kyle Shanahan", "kyle-shanahan", "https://www.49ers.com/team/coaches-roster/"],
  ["Seattle Seahawks", "Mike Macdonald", "mike-macdonald", "https://www.seahawks.com/team/coaches-roster/"],
  ["Tampa Bay Buccaneers", "Todd Bowles", "todd-bowles", "https://www.buccaneers.com/team/coaches-roster/"],
  ["Tennessee Titans", "Robert Saleh", "robert-saleh", "https://www.tennesseetitans.com/team/coaches-roster/"],
  ["Washington Commanders", "Dan Quinn", "dan-quinn", "https://www.commanders.com/team/coaches-roster/"],
];

const outputDir = path.resolve("images/coaches");
await fs.mkdir(outputDir, { recursive: true });

function decodeHtml(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&#39;", "'")
    .replaceAll("&#x27;", "'")
    .replaceAll("&#X27;", "'")
    .replaceAll("&quot;", '"')
    .replace(/^\/\//, "https://");
}

function imageCandidatesForCoachCard(html, coach, slug) {
  const matches = [...html.matchAll(/<a\b([^>]*?)>([\s\S]*?)<\/a>/gi)];
  const candidates = [];
  const normalize = (value) => decodeHtml(value).replace(/<[^>]*>/g, '').replaceAll('’', "'").replace(/\s+/g, ' ').trim().toLowerCase();
  for (const match of matches) {
    const attributes = match[1];
    const body = match[2];
    const aria = /aria-label=["']([^"']+)["']/i.exec(attributes)?.[1];
    const href = /href=["']([^"']+)["']/i.exec(attributes)?.[1] || '';
    const cardName = /d3-o-person-card__name[^>]*>([^<]+)/i.exec(body)?.[1];
    const profileSlug = href.split(/[?#]/)[0].replace(/\/$/, '').split('/').pop()?.toLowerCase();
    const matchesCoach = [aria, cardName].some((value) => value && normalize(value) === normalize(coach)) ||
      /\/team\/coaches(?:-roster)?\//i.test(href) && profileSlug === slug;
    if (!matchesCoach) continue;
    const image = /<img\b[^>]*?data-src=["']([^"']+)["'][^>]*>/i.exec(body) ||
      /<img\b[^>]*?src=["']([^"']+)["'][^>]*>/i.exec(body);
    if (!image) continue;
    const url = decodeHtml(image[1]);
    if (/static\.(?:clubs\.)?nfl\.com\/image\/(?:upload|private)\//i.test(url)) candidates.push(url);
  }
  // Featured head-coach cards place a profile link *inside* the card rather
  // than making the card itself an anchor. Match the exact card heading, then
  // take the image immediately preceding that heading in the same card.
  if (!candidates.length) {
    for (const title of html.matchAll(/<h3\b[^>]*class=["'][^"']*d3-o-media-object__title[^"']*["'][^>]*>([\s\S]*?)<\/h3>/gi)) {
      if (normalize(title[1]) !== normalize(coach)) continue;
      const before = html.slice(Math.max(0, title.index - 4000), title.index);
      const images = [...before.matchAll(/<img\b[^>]*>/gi)];
      const imageTag = images.at(-1)?.[0] || '';
      const source = /data-src=["']([^"']+)["']/i.exec(imageTag)?.[1] ||
        /src=["']([^"']+)["']/i.exec(imageTag)?.[1];
      if (!source) continue;
      const url = decodeHtml(source);
      if (/static\.(?:clubs\.)?nfl\.com\/image\/(?:upload|private)\//i.test(url)) candidates.push(url);
    }
  }
  return [...new Set(candidates)];
}

function normalizeCloudinary(url) {
  const match = url.match(/^(https:\/\/static\.(?:clubs\.)?nfl\.com\/image\/(?:upload|private)\/)(?:.*?\/)?((?:cardinals|falcons|ravens|bills|panthers|bears|bengals|browns|cowboys|broncos|lions|packers|texans|colts|jaguars|chiefs|raiders|chargers|rams|dolphins|vikings|patriots|saints|giants|jets|eagles|steelers|49ers|seahawks|buccaneers|titans|commanders)\/[^?\s"']+)$/i);
  if (!match) return url;
  const asset = match[2].replace(/\.(?:webp|png)$/i, ".jpg");
  return `${match[1]}c_fill,g_face,w_320,h_400,q_auto,f_jpg/${asset}`;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 coach-portrait-updater/1.0" },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`page returned ${response.status}`);
  return response.text();
}

async function download(url, destination) {
  const response = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 coach-portrait-updater/1.0" },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`image returned ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) throw new Error(`unexpected content type ${contentType}`);
  await fs.writeFile(destination, Buffer.from(await response.arrayBuffer()));
  return contentType;
}

const results = await Promise.all(coaches.map(async ([team, coach, slug, page]) => {
  try {
    const html = await fetchText(page);
    const candidates = imageCandidatesForCoachCard(html, coach, slug);
    if (!candidates.length) throw new Error("no image in a card matched to this coach");
    const sourceImage = normalizeCloudinary(candidates[0]);
    const file = `${slug}.jpg`;
    const contentType = await download(sourceImage, path.join(outputDir, file));
    console.log(`OK   ${team}: ${coach}`);
    return { team, coach, file, page, sourceImage, contentType };
  } catch (error) {
    console.error(`FAIL ${team}: ${coach} — ${error.message}`);
    return { team, coach, page, error: error.message };
  }
}));

await fs.writeFile(
  path.join(outputDir, "sources.json"),
  `${JSON.stringify({ updated: new Date().toISOString(), results }, null, 2)}\n`,
  "utf8",
);
const portraits = Object.fromEntries(results.filter((result) => result.file).map((result) => [result.coach, {
  file: result.file,
  page: result.page,
  sourceImage: result.sourceImage,
}]));
await fs.writeFile(path.join(outputDir, "portraits.js"), `window.COACH_PORTRAITS = ${JSON.stringify(portraits, null, 2)};\n`, "utf8");

const failures = results.filter((result) => result.error);
console.log(`\nDownloaded ${results.length - failures.length}/${results.length} official portraits.`);
if (failures.length) process.exitCode = 1;
