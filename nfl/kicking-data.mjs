import { TEAMS } from './divstreaks-data.mjs';
import { normalizeTeam } from './franchise-leaders-data.mjs';

export const FIRST_SEASON = 1999;
export const KICKING_VIEWS = {
  fg: { label: 'Field goals', minimum: 20, combined: false },
  all: { label: 'Field goals + extra points', minimum: 40, combined: true },
  'near-fg': { label: 'Field-goal near-streaks', minimum: 20, combined: false, near: true, limit: 100 },
  'near-all': { label: 'FG + extra-point near-streaks', minimum: 40, combined: true, near: true, limit: 100 },
};
export const kickingView = hash => Object.hasOwn(KICKING_VIEWS, hash.slice(1)) ? hash.slice(1) : 'fg';
export const KICK_COLUMNS = ['play_id', 'game_id', 'season', 'season_type', 'week', 'game_date', 'posteam',
  'defteam', 'play_type', 'field_goal_attempt', 'extra_point_attempt', 'field_goal_result',
  'extra_point_result', 'kicker_player_id', 'kicker_player_name', 'kick_distance'];

// Project a streamed CSV onto a few columns, without retaining the full PBP.
// Quoted commas, escaped quotes, newlines, and chunk boundaries are preserved.
export async function readProjectedCsv(chunks, columns, onRow) {
  let headers = null, wanted = new Map(), row = {}, field = '', column = 0;
  let quoted = false, afterQuote = false, skipLF = false, started = false;
  const header = [];
  const finishField = () => {
    if (!headers) header.push(field);
    else if (wanted.has(column)) row[wanted.get(column)] = field;
    field = ''; column++;
  };
  const finishRow = () => {
    finishField();
    if (!headers) {
      headers = [...header];
      for (const key of columns) {
        const index = headers.indexOf(key);
        if (index < 0) throw new Error(`Missing CSV column: ${key}`);
        wanted.set(index, key);
      }
    } else {
      if (column !== headers.length) throw new Error(`Incomplete CSV row: ${column}/${headers.length}`);
      onRow(row);
    }
    row = {}; column = 0; started = false;
  };
  for await (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      const char = chunk[i];
      if (skipLF) { skipLF = false; if (char === '\n') continue; }
      const capture = !headers || wanted.has(column);
      if (afterQuote) {
        afterQuote = false;
        if (char === '"') { if (capture) field += char; continue; }
        quoted = false;
      }
      if (quoted) {
        if (char === '"') afterQuote = true;
        else if (capture) field += char;
        continue;
      }
      if (char === '"') { quoted = true; started = true; }
      else if (char === ',') { finishField(); started = true; }
      else if (char === '\r' || char === '\n') {
        if (started || column || field) finishRow();
        if (char === '\r') skipLF = true;
      } else { if (capture) field += char; started = true; }
    }
  }
  if (quoted && !afterQuote) throw new Error('Unclosed CSV quote');
  if (started || column || field) finishRow();
  if (!headers) throw new Error('Empty CSV');
}

export function kickFromPlay(row) {
  if (row.season_type !== 'REG' || row.no_play === '1' || row.play_type === 'no_play') return null;
  const fg = row.field_goal_attempt === '1', xp = row.extra_point_attempt === '1';
  if (!fg && !xp) return null;
  if (fg && xp) throw new Error(`Ambiguous kick: ${row.game_id}:${row.play_id}`);
  const result = fg ? row.field_goal_result : row.extra_point_result;
  // A fake/aborted try has no kicked attempt; it is not a missed kick.
  if (result === 'aborted') return null;
  if (!['good', 'made', 'missed', 'failed', 'blocked'].includes(result)) throw new Error(`Unknown kick result: ${row.game_id}:${row.play_id}: ${result}`);
  const team = normalizeTeam(row.posteam), opponent = normalizeTeam(row.defteam);
  if (!row.kicker_player_id || !row.kicker_player_name || !TEAMS[team] || !TEAMS[opponent] ||
    !/^\d{4}-\d{2}-\d{2}$/.test(row.game_date) || !Number.isFinite(Number(row.play_id)) ||
    !Number.isInteger(Number(row.season)) || Number(row.season) < FIRST_SEASON) throw new Error(`Incomplete kick: ${row.game_id}:${row.play_id}`);
  return { id: row.kicker_player_id, shortName: row.kicker_player_name, season: Number(row.season), week: Number(row.week),
    date: row.game_date, game: row.game_id, play: Number(row.play_id), team, opponent,
    type: fg ? 'FG' : 'XP', made: result === 'good' || result === 'made', result,
    distance: row.kick_distance ? Number(row.kick_distance) : null };
}

export function calculateKickingStreaks(attempts, players = new Map(), currentIds = new Set(), gaps = []) {
  const keys = new Set();
  const ordered = [...attempts, ...gaps].sort((a, b) => a.date.localeCompare(b.date) || a.game.localeCompare(b.game) || a.play - b.play);
  for (const kick of ordered) {
    const key = `${kick.game}:${kick.play}`;
    if (keys.has(key)) throw new Error(`Duplicate kick: ${key}`);
    keys.add(key);
  }
  const result = {};
  const point = kick => ({ date: kick.date, team: kick.team, opponent: kick.opponent, game: kick.game, play: kick.play, type: kick.type, distance: kick.distance });
  for (const [view, config] of Object.entries(KICKING_VIEWS)) {
    const states = new Map(), streaks = [];
    const save = (state, miss = null, gap = null) => {
      const before = config.near ? state.beforeMiss : null;
      // The lone miss must be internal: retain the entire make-run on each side.
      // Adjacent misses and a miss at the end of the feed are not near-streaks.
      if (config.near && (!before?.length || !state.length)) return;
      const length = state.length + (before ? before.length + 1 : 0);
      if (length < config.minimum) return;
      const start = before ? before.start : state.start;
      const knownStart = before ? before.knownStart : state.knownStart;
      streaks.push({ id: `${view}:${state.id}:${start.game}:${start.play}`, playerId: state.id,
        name: players.get(state.id)?.name || state.name, length, fieldGoals: state.fg + (before?.fg || 0), extraPoints: state.xp + (before?.xp || 0),
        teams: before ? [...new Set([...before.teams, state.miss.team, ...state.teams])] : [...state.teams],
        start, last: state.last, endedBy: miss ? { ...point(miss), result: miss.result } : null,
        active: !miss && !gap && currentIds.has(state.id), startUnknown: !knownStart,
        lowerBound: !knownStart || !!gap, gapAfter: gap ? { date: gap.date, game: gap.game, source: gap.source } : null,
        ...(config.near ? { missed: state.miss, beforeMiss: before.length, afterMiss: state.length } : {}) });
    };
    for (const kick of ordered) {
      if (!config.combined && kick.type !== 'FG' && kick.type !== 'gap') continue;
      if (!states.has(kick.id)) states.set(kick.id, { id: kick.id, name: kick.shortName, length: 0,
        knownStart: Number(players.get(kick.id)?.rookieSeason || 0) >= FIRST_SEASON, teams: new Set(), fg: 0, xp: 0 });
      const state = states.get(kick.id);
      if (kick.type === 'gap') {
        save(state, null, kick);
        state.length = 0; state.fg = 0; state.xp = 0; state.teams = new Set(); state.knownStart = false;
        state.beforeMiss = null; state.miss = null;
        continue;
      }
      if (!kick.made) {
        save(state, kick);
        if (config.near) {
          state.beforeMiss = { length: state.length, start: state.start, knownStart: state.knownStart,
            fg: state.fg, xp: state.xp, teams: [...state.teams] };
          state.miss = { ...point(kick), result: kick.result };
        }
        state.length = 0; state.fg = 0; state.xp = 0; state.teams = new Set(); state.knownStart = true;
        continue;
      }
      if (!state.length) state.start = point(kick);
      state.length++; state[kick.type === 'FG' ? 'fg' : 'xp']++;
      state.teams.add(kick.team); state.last = point(kick);
    }
    for (const state of states.values()) save(state);
    result[view] = streaks.sort((a, b) => b.length - a.length || a.start.date.localeCompare(b.start.date) || a.name.localeCompare(b.name))
      .slice(0, config.limit);
  }
  return result;
}
