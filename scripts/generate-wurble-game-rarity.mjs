import { writeFile } from 'node:fs/promises';

const ANSWERS_URL = 'https://gist.githubusercontent.com/cfreshman/a03ef2cba789d8cf00c08f767e0fad7b/raw/5d752e5f0702da315298a6bb5a771586d6ff445c/wordle-answers-alphabetical.txt';
const EXTRA_GUESSES_URL = 'https://gist.githubusercontent.com/cfreshman/cdcdf777450c5b5301e439061d29694c/raw/de1df631b45492e0974f7affe266ec36fed736eb/wordle-allowed-guesses.txt';
const OUTPUT_PATH = new URL('../wurble-game-rarity.json', import.meta.url);
const EXPECTED_ANSWER_COUNT = 2315;
const EXPECTED_EXTRA_GUESS_COUNT = 10657;
const MAX_TURNS = 6;
const SMOOTHING_PRIOR_ROWS = 238;
const UNIFORM_PRIOR_SHARE = 0.5;
const ALL_GREEN_CODE = 242;
const IMPOSSIBLE_PATTERNS = new Set(['YGGGG', 'GYGGG', 'GGYGG', 'GGGYG', 'GGGGY']);
const STATE_CHARACTERS = ['X', 'Y', 'G'];
const POSITION_WEIGHTS = [81, 27, 9, 3, 1];
const STRATEGY_TEMPLATES = [
  { id: 'entropy-unrestricted-best', objective: 'entropy', guessPool: 'all_words', openingRank: 0 },
  { id: 'entropy-unrestricted-runner-up', objective: 'entropy', guessPool: 'all_words', openingRank: 1 },
  { id: 'remaining-unrestricted', objective: 'expected_remaining', guessPool: 'all_words', openingRank: 0 },
  { id: 'entropy-candidate-only', objective: 'entropy', guessPool: 'remaining_answers', openingRank: 0 },
  { id: 'remaining-candidate-only', objective: 'expected_remaining', guessPool: 'remaining_answers', openingRank: 0 },
];

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

function buildFeedbackMatrix(guesses, answers) {
  const guessCount = guesses.length / 5;
  const answerCount = answers.length / 5;
  const matrix = new Uint8Array(guessCount * answerCount);
  const mechanicsCounts = new Uint32Array(243);
  const remainingLetters = new Uint8Array(26);

  for (let guessIndex = 0; guessIndex < guessCount; guessIndex += 1) {
    const guessOffset = guessIndex * 5;
    const guess0 = guesses[guessOffset];
    const guess1 = guesses[guessOffset + 1];
    const guess2 = guesses[guessOffset + 2];
    const guess3 = guesses[guessOffset + 3];
    const guess4 = guesses[guessOffset + 4];
    const matrixOffset = guessIndex * answerCount;

    for (let answerIndex = 0; answerIndex < answerCount; answerIndex += 1) {
      const answerOffset = answerIndex * 5;
      const answer0 = answers[answerOffset];
      const answer1 = answers[answerOffset + 1];
      const answer2 = answers[answerOffset + 2];
      const answer3 = answers[answerOffset + 3];
      const answer4 = answers[answerOffset + 4];
      remainingLetters[guess0] = 0;
      remainingLetters[guess1] = 0;
      remainingLetters[guess2] = 0;
      remainingLetters[guess3] = 0;
      remainingLetters[guess4] = 0;
      remainingLetters[answer0] = 0;
      remainingLetters[answer1] = 0;
      remainingLetters[answer2] = 0;
      remainingLetters[answer3] = 0;
      remainingLetters[answer4] = 0;

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

      matrix[matrixOffset + answerIndex] = patternCode;
      mechanicsCounts[patternCode] += 1;
    }
  }
  return { matrix, mechanicsCounts };
}

function createGuessChooser(matrix, words, answerCount) {
  const guessCount = words.length;
  const bucketCounts = new Uint16Array(243);
  const touchedPatterns = new Uint16Array(243);
  const candidateMarkers = new Uint32Array(answerCount);
  const countLogCount = Array.from(
    { length: answerCount + 1 },
    (_, count) => count > 0 ? count * Math.log2(count) : 0,
  );
  let markerVersion = 0;

  function isBetter(cost, isCandidate, guessIndex, comparison) {
    if (!comparison) return true;
    if (cost < comparison.cost - 1e-10) return true;
    if (Math.abs(cost - comparison.cost) > 1e-10) return false;
    if (isCandidate !== comparison.isCandidate) return isCandidate;
    return words[guessIndex].localeCompare(words[comparison.guessIndex]) < 0;
  }

  return function chooseGuesses(candidates, strategy, choiceCount = 1) {
    markerVersion += 1;
    if (markerVersion === 0xffffffff) {
      candidateMarkers.fill(0);
      markerVersion = 1;
    }
    for (const candidate of candidates) candidateMarkers[candidate] = markerVersion;

    const candidateOnly = strategy.guessPool === 'remaining_answers' || candidates.length <= 2;
    const poolSize = candidateOnly ? candidates.length : guessCount;
    const choices = [];

    for (let poolIndex = 0; poolIndex < poolSize; poolIndex += 1) {
      const guessIndex = candidateOnly ? candidates[poolIndex] : poolIndex;
      const matrixOffset = guessIndex * answerCount;
      let touchedCount = 0;

      for (const answerIndex of candidates) {
        const patternCode = matrix[matrixOffset + answerIndex];
        if (bucketCounts[patternCode] === 0) {
          touchedPatterns[touchedCount] = patternCode;
          touchedCount += 1;
        }
        bucketCounts[patternCode] += 1;
      }

      let cost = 0;
      for (let index = 0; index < touchedCount; index += 1) {
        const patternCode = touchedPatterns[index];
        const count = bucketCounts[patternCode];
        cost += strategy.objective === 'entropy'
          ? countLogCount[count]
          : patternCode === ALL_GREEN_CODE ? 0 : count * count;
        bucketCounts[patternCode] = 0;
      }

      const isCandidate = guessIndex < answerCount && candidateMarkers[guessIndex] === markerVersion;
      let insertionIndex = choices.length;
      for (let index = 0; index < choices.length; index += 1) {
        if (isBetter(cost, isCandidate, guessIndex, choices[index])) {
          insertionIndex = index;
          break;
        }
      }
      if (insertionIndex < choiceCount) {
        choices.splice(insertionIndex, 0, { guessIndex, cost, isCandidate });
        if (choices.length > choiceCount) choices.pop();
      }
    }

    if (choices.length < choiceCount) throw new Error('Could not choose enough guesses');
    return choices.map(choice => choice.guessIndex);
  };
}

function simulateStrategy({ strategy, openingGuess, matrix, answerCount, chooseGuesses, patternCounts }) {
  let simulatedRows = 0;
  let solvedGames = 0;
  let failedGames = 0;

  function visit(candidates, turnIndex) {
    const guessIndex = turnIndex === 0
      ? openingGuess
      : candidates.length === 1 ? candidates[0] : chooseGuesses(candidates, strategy)[0];
    const matrixOffset = guessIndex * answerCount;
    const nextBuckets = new Array(243);

    for (const answerIndex of candidates) {
      const patternCode = matrix[matrixOffset + answerIndex];
      patternCounts[patternCode] += 1;
      simulatedRows += 1;
      if (patternCode === ALL_GREEN_CODE) {
        solvedGames += 1;
      } else if (turnIndex + 1 >= MAX_TURNS) {
        failedGames += 1;
      } else {
        if (!nextBuckets[patternCode]) nextBuckets[patternCode] = [];
        nextBuckets[patternCode].push(answerIndex);
      }
    }

    for (const bucket of nextBuckets) {
      if (bucket?.length) visit(bucket, turnIndex + 1);
    }
  }

  visit(Array.from({ length: answerCount }, (_, index) => index), 0);
  return { simulatedRows, solvedGames, failedGames };
}

const [answers, extraGuesses] = await Promise.all([
  loadWords(ANSWERS_URL, EXPECTED_ANSWER_COUNT),
  loadWords(EXTRA_GUESSES_URL, EXPECTED_EXTRA_GUESS_COUNT),
]);
const allGuesses = [...answers, ...extraGuesses];
if (new Set(allGuesses).size !== allGuesses.length) {
  throw new Error('The original answer and extra-guess lists overlap');
}

console.log('Building the exact Wordle feedback table…');
const { matrix, mechanicsCounts } = buildFeedbackMatrix(
  encodeWords(allGuesses),
  encodeWords(answers),
);
const answerCount = answers.length;
const totalMechanicsPairs = allGuesses.length * answerCount;
if (mechanicsCounts.reduce((sum, count) => sum + count, 0) !== totalMechanicsPairs) {
  throw new Error('Feedback matrix counts do not match the expected pair total');
}

const validEntries = Array.from(mechanicsCounts, (mechanicsOccurrences, code) => ({
  code,
  pattern: patternForCode(code),
  mechanicsOccurrences,
})).filter(entry => !IMPOSSIBLE_PATTERNS.has(entry.pattern));
if (validEntries.length !== 238 || validEntries.some(entry => entry.mechanicsOccurrences === 0)) {
  throw new Error('The feedback table did not produce all 238 possible patterns');
}
if (validEntries.reduce((sum, entry) => sum + entry.mechanicsOccurrences, 0) !== totalMechanicsPairs) {
  throw new Error('An impossible pattern appeared in the feedback table');
}

const chooseGuesses = createGuessChooser(matrix, allGuesses, answerCount);
const initialCandidates = Array.from({ length: answerCount }, (_, index) => index);
const openingCache = new Map();
const strategies = STRATEGY_TEMPLATES.map(template => {
  const cacheKey = `${template.objective}:${template.guessPool}`;
  const requiredCount = Math.max(
    ...STRATEGY_TEMPLATES
      .filter(candidate => `${candidate.objective}:${candidate.guessPool}` === cacheKey)
      .map(candidate => candidate.openingRank + 1),
  );
  if (!openingCache.has(cacheKey)) {
    openingCache.set(cacheKey, chooseGuesses(initialCandidates, template, requiredCount));
  }
  return { ...template, openingGuess: openingCache.get(cacheKey)[template.openingRank] };
});

const simulationCounts = new Uint32Array(243);
const strategyResults = [];
for (const strategy of strategies) {
  console.log(`Simulating ${strategy.id} from ${allGuesses[strategy.openingGuess].toLocaleUpperCase()}…`);
  const result = simulateStrategy({
    strategy,
    openingGuess: strategy.openingGuess,
    matrix,
    answerCount,
    chooseGuesses,
    patternCounts: simulationCounts,
  });
  strategyResults.push({
    id: strategy.id,
    objective: strategy.objective,
    guess_pool: strategy.guessPool,
    opening_word: allGuesses[strategy.openingGuess],
    opening_rank: strategy.openingRank + 1,
    games: answerCount,
    simulated_rows: result.simulatedRows,
    solved_games: result.solvedGames,
    failed_games: result.failedGames,
    average_rows: result.simulatedRows / answerCount,
  });
}

const simulatedGames = strategyResults.reduce((sum, strategy) => sum + strategy.games, 0);
const simulatedRows = strategyResults.reduce((sum, strategy) => sum + strategy.simulated_rows, 0);
const solvedGames = strategyResults.reduce((sum, strategy) => sum + strategy.solved_games, 0);
const failedGames = strategyResults.reduce((sum, strategy) => sum + strategy.failed_games, 0);
if (simulationCounts.reduce((sum, count) => sum + count, 0) !== simulatedRows) {
  throw new Error('Simulation row counts do not match the recorded total');
}
if (solvedGames + failedGames !== simulatedGames) {
  throw new Error('Simulation outcomes do not match the game total');
}

const rankedEntries = validEntries.map(entry => {
  const simulatedOccurrences = simulationCounts[entry.code];
  const mechanicsProbability = entry.mechanicsOccurrences / totalMechanicsPairs;
  const priorProbability = (
    UNIFORM_PRIOR_SHARE / validEntries.length
    + (1 - UNIFORM_PRIOR_SHARE) * mechanicsProbability
  );
  const smoothedOccurrences = simulatedOccurrences + SMOOTHING_PRIOR_ROWS * priorProbability;
  const smoothedProbability = smoothedOccurrences / (simulatedRows + SMOOTHING_PRIOR_ROWS);
  return {
    ...entry,
    simulatedOccurrences,
    mechanicsProbability,
    smoothedProbability,
    oneIn: 1 / smoothedProbability,
  };
}).sort((first, second) => (
  first.smoothedProbability - second.smoothedProbability
  || first.pattern.localeCompare(second.pattern)
));

let rarityRank = 0;
let previousProbability = null;
const patternData = Object.fromEntries(rankedEntries.map((entry, index) => {
  if (entry.smoothedProbability !== previousProbability) rarityRank = index + 1;
  previousProbability = entry.smoothedProbability;
  return [
    entry.pattern,
    {
      rarity_rank: rarityRank,
      rarity_score: Math.round((100 - (rarityRank - 1) * 99 / (rankedEntries.length - 1)) * 10) / 10,
      simulated_occurrences: entry.simulatedOccurrences,
      simulated_probability: entry.simulatedOccurrences / simulatedRows,
      smoothed_probability: entry.smoothedProbability,
      one_in: entry.oneIn,
      mechanics_probability: entry.mechanicsProbability,
    },
  ];
}));

const output = {
  schema_version: 2,
  model: 'full-game-information-ensemble-v1',
  description: 'Complete six-turn Wordle games played by an ensemble of greedy information-seeking solvers. A small mechanics prior gives never-generated patterns finite estimates.',
  guess_count: allGuesses.length,
  answer_count: answerCount,
  max_turns: MAX_TURNS,
  simulated_games: simulatedGames,
  simulated_rows: simulatedRows,
  solved_games: solvedGames,
  failed_games: failedGames,
  average_rows_per_game: simulatedRows / simulatedGames,
  smoothing: {
    prior_weight_rows: SMOOTHING_PRIOR_ROWS,
    prior_model: 'half-uniform-patterns-half-uniform-original-valid-guess-answer-pairs',
    uniform_pattern_share: UNIFORM_PRIOR_SHARE,
    mechanics_pair_count: totalMechanicsPairs,
  },
  strategies: strategyResults,
  source_urls: {
    answers: ANSWERS_URL,
    extra_guesses: EXTRA_GUESSES_URL,
  },
  patterns: patternData,
};

await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(
  `Wrote ${rankedEntries.length} full-game rarity rankings from ${simulatedGames.toLocaleString('en-US')} games and ${simulatedRows.toLocaleString('en-US')} rows.`,
);
