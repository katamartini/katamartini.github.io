import { writeFile } from 'node:fs/promises';

const ANSWERS_URL = 'https://gist.githubusercontent.com/cfreshman/a03ef2cba789d8cf00c08f767e0fad7b/raw/5d752e5f0702da315298a6bb5a771586d6ff445c/wordle-answers-alphabetical.txt';
const EXTRA_GUESSES_URL = 'https://gist.githubusercontent.com/cfreshman/cdcdf777450c5b5301e439061d29694c/raw/de1df631b45492e0974f7affe266ec36fed736eb/wordle-allowed-guesses.txt';
const OUTPUT_PATH = new URL('../wurble-rarity.json', import.meta.url);
const EXPECTED_ANSWER_COUNT = 2315;
const EXPECTED_EXTRA_GUESS_COUNT = 10657;
const IMPOSSIBLE_PATTERNS = new Set(['YGGGG', 'GYGGG', 'GGYGG', 'GGGYG', 'GGGGY']);
const STATE_CHARACTERS = ['X', 'Y', 'G'];
const POSITION_WEIGHTS = [81, 27, 9, 3, 1];

async function loadWords(url, expectedCount) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download ${url}: ${response.status}`);
  const words = (await response.text()).trim().split(/\r?\n/);
  if (words.length !== expectedCount) {
    throw new Error(`Expected ${expectedCount} words from ${url}, received ${words.length}`);
  }
  if (words.some(word => !/^[a-z]{5}$/.test(word))) {
    throw new Error(`Invalid word in ${url}`);
  }
  return words;
}

function encodeWords(words) {
  const encoded = new Uint8Array(words.length * 5);
  words.forEach((word, wordIndex) => {
    for (let position = 0; position < 5; position += 1) {
      encoded[wordIndex * 5 + position] = word.charCodeAt(position) - 97;
    }
  });
  return encoded;
}

function patternForCode(code) {
  return POSITION_WEIGHTS
    .map(weight => STATE_CHARACTERS[Math.floor(code / weight) % 3])
    .join('');
}

function countPatterns(guesses, answers) {
  const counts = new Uint32Array(243);
  const remainingLetters = new Uint8Array(26);

  for (let answerOffset = 0; answerOffset < answers.length; answerOffset += 5) {
    for (let guessOffset = 0; guessOffset < guesses.length; guessOffset += 5) {
      const answer0 = answers[answerOffset];
      const answer1 = answers[answerOffset + 1];
      const answer2 = answers[answerOffset + 2];
      const answer3 = answers[answerOffset + 3];
      const answer4 = answers[answerOffset + 4];
      const guess0 = guesses[guessOffset];
      const guess1 = guesses[guessOffset + 1];
      const guess2 = guesses[guessOffset + 2];
      const guess3 = guesses[guessOffset + 3];
      const guess4 = guesses[guessOffset + 4];
      remainingLetters[answer0] = 0;
      remainingLetters[answer1] = 0;
      remainingLetters[answer2] = 0;
      remainingLetters[answer3] = 0;
      remainingLetters[answer4] = 0;
      remainingLetters[guess0] = 0;
      remainingLetters[guess1] = 0;
      remainingLetters[guess2] = 0;
      remainingLetters[guess3] = 0;
      remainingLetters[guess4] = 0;

      let patternCode = 0;
      let greenMask = 0;
      for (let position = 0; position < 5; position += 1) {
        const guessLetter = guesses[guessOffset + position];
        const answerLetter = answers[answerOffset + position];
        if (guessLetter === answerLetter) {
          patternCode += 2 * POSITION_WEIGHTS[position];
          greenMask |= 1 << position;
        } else {
          remainingLetters[answerLetter] += 1;
        }
      }

      for (let position = 0; position < 5; position += 1) {
        if (greenMask & (1 << position)) continue;
        const guessLetter = guesses[guessOffset + position];
        if (remainingLetters[guessLetter] > 0) {
          patternCode += POSITION_WEIGHTS[position];
          remainingLetters[guessLetter] -= 1;
        }
      }
      counts[patternCode] += 1;
    }
  }
  return counts;
}

const [answers, extraGuesses] = await Promise.all([
  loadWords(ANSWERS_URL, EXPECTED_ANSWER_COUNT),
  loadWords(EXTRA_GUESSES_URL, EXPECTED_EXTRA_GUESS_COUNT),
]);
const allGuesses = [...answers, ...extraGuesses];
if (new Set(allGuesses).size !== allGuesses.length) {
  throw new Error('The original answer and extra-guess lists overlap');
}

const totalPairs = allGuesses.length * answers.length;
const counts = countPatterns(encodeWords(allGuesses), encodeWords(answers));
const entries = Array.from(counts, (occurrences, code) => ({
  pattern: patternForCode(code),
  occurrences,
}))
  .filter(entry => !IMPOSSIBLE_PATTERNS.has(entry.pattern));

if (entries.length !== 238 || entries.some(entry => entry.occurrences === 0)) {
  throw new Error('The original Wordle lists did not produce all 238 valid patterns');
}
if (entries.reduce((sum, entry) => sum + entry.occurrences, 0) !== totalPairs) {
  throw new Error('Pattern counts do not add up to the expected guess/answer pairs');
}

entries.sort((first, second) => (
  first.occurrences - second.occurrences
  || first.pattern.localeCompare(second.pattern)
));
let rarityRank = 0;
let previousOccurrences = null;
const patternData = Object.fromEntries(entries.map((entry, index) => {
  if (entry.occurrences !== previousOccurrences) rarityRank = index + 1;
  previousOccurrences = entry.occurrences;
  return [
    entry.pattern,
    {
      rarity_rank: rarityRank,
      rarity_score: Math.round((100 - (rarityRank - 1) * 99 / (entries.length - 1)) * 10) / 10,
      occurrences: entry.occurrences,
      probability: entry.occurrences / totalPairs,
      one_in: totalPairs / entry.occurrences,
    },
  ];
}));

const output = {
  schema_version: 1,
  model: 'original-wordle-uniform-guess-answer',
  description: 'Every original valid Wordle guess paired uniformly with every original solution, using standard duplicate-letter scoring.',
  guess_count: allGuesses.length,
  answer_count: answers.length,
  total_pairs: totalPairs,
  source_urls: {
    answers: ANSWERS_URL,
    extra_guesses: EXTRA_GUESSES_URL,
  },
  patterns: patternData,
};

await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`Wrote ${entries.length} rarity rankings from ${totalPairs.toLocaleString('en-US')} pairs.`);
