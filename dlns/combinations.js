(function (root, factory) {
  const combinations = factory();
  if (typeof module === 'object' && module.exports) module.exports = combinations;
  else root.DLNSCombinations = combinations;
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';

  const keyOf = heroes => heroes.slice().sort((a,b)=>a.localeCompare(b)).join('|');
  const compare = (a,b) => b.total-a.total || a.key.localeCompare(b.key);
  const leaderLimit = 20;

  function topList(seen, limit = leaderLimit) {
    const items = [];
    const couldEnter = total => items.length < limit || total >= items[items.length-1].total;
    return {
      items, couldEnter,
      consider(heroes,total) {
        if (!couldEnter(total)) return;
        const key = keyOf(heroes);
        if (seen.has(key) || items.some(item=>item.key === key)) return;
        items.push({key,heroes:Array.from(heroes),total});
        items.sort(compare);
        if (items.length > limit) items.pop();
      }
    };
  }

  function createBuilder(heroes, size, seen, score, limit = leaderLimit) {
    const top = topList(seen,limit), indices = Array.from({length:size},(_,i)=>i);
    let done = size < 1 || size > heroes.length, visited = 0, total = done ? 0 : 1;
    for (let i = 1; i <= size && !done; i++) total = total*(heroes.length-size+i)/i;
    total = Math.round(total);
    return {
      items:top.items, total,
      get done() { return done; },
      get visited() { return visited; },
      step(batchSize = 64) {
        for (let batch = 0; batch < batchSize && !done; batch++) {
          const combo = indices.map(index=>heroes[index]);
          top.consider(combo,score(combo));
          visited++;
          let i = size-1;
          while (i >= 0 && indices[i] === heroes.length-size+i) i--;
          if (i < 0) done = true;
          else {
            indices[i]++;
            for (let j = i+1; j < size; j++) indices[j] = indices[j-1]+1;
          }
        }
      }
    };
  }

  function possibility(heroes, state) {
    const slots = state?.slots || {}, left = (slots.left?.picks || []).filter(Boolean);
    const right = (slots.right?.picks || []).filter(Boolean);
    const banned = new Set([...(slots.left?.bans || []),...(slots.right?.bans || [])].filter(Boolean));
    const fits = (mine,other) => {
      const blocked = new Set([...banned,...other]);
      return heroes.every(hero=>!blocked.has(hero)) && new Set([...mine,...heroes]).size <= 6;
    };
    const leftPossible = fits(left,right), rightPossible = fits(right,left);
    const possible = leftPossible || rightPossible, picked = new Set([...left,...right]);
    return {possible,leftPossible,rightPossible,selected:possible ? heroes.filter(hero=>picked.has(hero)) : []};
  }

  return Object.freeze({leaderLimit,topList,createBuilder,possibility});
});
