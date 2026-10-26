// "did you mean" — used wherever a name turns out not to be in scope.

// Damerau-Levenshtein (optimal string alignment): a transposition is one edit, not two, because
// that is the slip people actually make — `Lien` is one keystroke away from `Line`.
const editDistance = (a, b) => {
  let prev2 = [], prev = [...Array(b.length + 1).keys()];
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        row[j] = Math.min(row[j], prev2[j - 2] + 1);
      }
    }
    prev2 = prev; prev = row;
  }
  return prev[b.length];
};

// The closest name worth suggesting — within a third of the name's length, or two edits.
function nearest(name, pool) {
  let best = null, score = Infinity;
  for (const c of pool) {
    const d = editDistance(name.toLowerCase(), c.toLowerCase());
    if (d < score) { score = d; best = c; }
  }
  return score <= Math.max(2, Math.floor(name.length / 3)) ? best : null;
}

export { editDistance, nearest };
