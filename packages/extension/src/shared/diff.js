/**
 * Line diff (longest common subsequence). Returns [{type: 'same'|'add'|'del', text}].
 * Very large inputs fall back to "everything removed, everything added".
 */
export function diffLines(a, b) {
  const x = a.split('\n');
  const y = b.split('\n');
  let s = 0;
  while (s < x.length && s < y.length && x[s] === y[s]) s++;
  let e = 0;
  while (e < x.length - s && e < y.length - s && x[x.length - 1 - e] === y[y.length - 1 - e]) e++;
  const head = x.slice(0, s).map((text) => ({ type: 'same', text }));
  const tail = x.slice(x.length - e).map((text) => ({ type: 'same', text }));
  const xm = x.slice(s, x.length - e);
  const ym = y.slice(s, y.length - e);
  const mid = [];
  if (xm.length * ym.length > 4_000_000) {
    mid.push(...xm.map((text) => ({ type: 'del', text })), ...ym.map((text) => ({ type: 'add', text })));
  } else {
    const w = ym.length + 1;
    const t = new Uint32Array((xm.length + 1) * w);
    for (let i = xm.length - 1; i >= 0; i--) {
      for (let j = ym.length - 1; j >= 0; j--) {
        t[i * w + j] = xm[i] === ym[j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < xm.length && j < ym.length) {
      if (xm[i] === ym[j]) {
        mid.push({ type: 'same', text: xm[i] });
        i++;
        j++;
      } else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) mid.push({ type: 'del', text: xm[i++] });
      else mid.push({ type: 'add', text: ym[j++] });
    }
    while (i < xm.length) mid.push({ type: 'del', text: xm[i++] });
    while (j < ym.length) mid.push({ type: 'add', text: ym[j++] });
  }
  return [...head, ...mid, ...tail];
}
