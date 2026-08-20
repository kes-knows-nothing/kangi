#!/usr/bin/env node
/* ============================================================
   Kangi 데이터 검사 —  node tools/check.js
   ------------------------------------------------------------
   의존성 없음. index.html 하나만 읽는다.
   여기 있는 항목은 전부 **실제로 한 번 이상 터진 것들**이다.
   사람이 매번 기억할 일이 아니라서 파일로 고정했다.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'index.html');
const src = fs.readFileSync(FILE, 'utf8');

const err = [];   // 고쳐야 하는 것
const warn = [];  // 봐야 하는 것
const E = (m) => err.push(m);
const W = (m) => warn.push(m);

/* ---------- 1. <script> 블록 구문 ---------- */
const script = /<script>([\s\S]*)<\/script>/.exec(src);
if(!script) E('<script> 블록을 못 찾았다');
else {
  try { new Function(script[1]); }
  catch(e){ E('script 구문 오류 — ' + e.message); }
}

/* ---------- 2. DATA 꺼내기 ---------- */
const a = src.indexOf('const DATA = [');
const b = src.indexOf('\n];\n', a);
if(a < 0 || b < 0){ report(); process.exit(1); }
let DATA;
try {
  DATA = new Function('return ' + src.slice(a + 'const DATA = '.length, b + 2))();
} catch(e){
  E('DATA 파싱 실패 — ' + e.message); report(); process.exit(1);
}

/* ---------- 3. alignRuby를 index.html에서 그대로 빌려온다 ---------- */
// 다시 구현하면 본체와 어긋난다. 한 벌만 둔다.
let alignRuby = null;
{
  const ik = /const isKanji[^\n]*\n/.exec(src);
  const s0 = src.indexOf('function alignRuby');
  const s1 = src.indexOf('return pos === kana.length ? out : null;\n}', s0);
  if(ik && s0 > 0 && s1 > 0){
    const body = ik[0] + src.slice(s0, s1 + 'return pos === kana.length ? out : null;\n}'.length);
    alignRuby = new Function(body + '; return alignRuby;')();
  } else W('alignRuby를 못 꺼냈다 — 예문 정렬 검사를 건너뛴다');
}

/* ---------- 4. 항목별 검사 ---------- */
const KEY = (it, si, j) =>
    it.cover ? 'cover|' + si + '|' + j
  : it.note  ? 'note|'  + si + '|' + j
  : it.pair  ? 'pair|'  + it.a.w + '|' + it.b.w
  : it.adjc  ? 'adjc|'  + it.w + '|' + it.r + (it.tag ? '|' + it.tag : '')
  : it.conj  ? 'conj|'  + it.w + '|' + it.say + (it.tag ? '|' + it.tag : '')
  :            it.w + '|' + it.r;

const HANGUL = /[가-힣]/;
const LATIN  = /[A-Za-z]/;
const KANJI  = /[一-鿿々]/;
// 예문에 그대로 나와도 되는 로마자 (외래어 표기·단위)
const LATIN_OK = /^(https?:|[A-Z]{1,4}$)/;

const seen = new Map();
let n = { cover:0, note:0, conj:0, pair:0, adjc:0, word:0, ex:0, ex2:0 };

DATA.forEach((sec, si) => {
  const where = (sec.t || '섹션 ' + si);
  if(!Array.isArray(sec.items)) return E(where + ' — items가 없다');

  sec.items.forEach((it, j) => {
    const kind = it.cover ? 'cover' : it.note ? 'note' : it.conj ? 'conj'
               : it.pair ? 'pair' : it.adjc ? 'adjc' : 'word';
    n[kind]++;
    const tag = where + ' / ' + (it.t || it.w || (it.a && it.a.w) || j);

    /* key 중복 */
    const k = KEY(it, si, j);
    if(seen.has(k)) E('key 중복 — ' + k + '\n    ' + seen.get(k) + '\n    ' + tag);
    else seen.set(k, tag);

    /* 필수 칸 */
    const need = kind === 'cover' ? ['no','t','lead']
               : kind === 'note'  ? ['t','p']
               : kind === 'pair'  ? ['la','lb','a','b']
               : kind === 'conj'  ? ['w','r','k','g','steps','say','e','ek','eo']
               : kind === 'adjc'  ? ['w','r','k','g','forms','e','ek','eo']
               :                    ['w','r','k','p','e','ek','eo'];
    need.forEach(f => { if(it[f] === undefined || it[f] === '') E('칸 누락 ' + f + ' — ' + tag); });
    if(kind === 'pair') ['w','r','k','e','ek','eo'].forEach(f => {
      ['a','b'].forEach(side => { if(!it[side] || !it[side][f]) E('칸 누락 ' + side + '.' + f + ' — ' + tag); });
    });

    /* 예문 2개는 셋 다 있거나 셋 다 없거나 */
    const half = ['e2','ek2','eo2'].filter(f => it[f]).length;
    if(half > 0 && half < 3) E('둘째 예문이 반만 있다 — ' + tag);

    /* 일본어 칸에 한글·로마자가 새지 않았는지 */
    const jpFields = [];
    if(kind === 'pair') ['a','b'].forEach(s2 => jpFields.push([s2+'.w', it[s2].w], [s2+'.e', it[s2].e], [s2+'.ek', it[s2].ek]));
    else { ['w','e','ek','e2','ek2','say'].forEach(f => it[f] && jpFields.push([f, it[f]])); }
    if(it.steps) it.steps.forEach((st, si2) => jpFields.push(['steps['+si2+'].t', st.t]));
    if(it.forms) it.forms.forEach((f, fi) => jpFields.push(['forms['+fi+'][1]', f[1]], ['forms['+fi+'][2]', f[2]]));
    jpFields.forEach(([f, v]) => {
      if(HANGUL.test(v)) E('일본어 칸에 한글 — ' + f + ' = 「' + v + '」\n    ' + tag);
      if(LATIN.test(v) && !LATIN_OK.test(v) && !/^[ァ-ヶー]+$/.test(v)){
        const only = String(v).replace(/[^A-Za-z]/g, '');
        if(only.length > 2) W('일본어 칸에 로마자 — ' + f + ' = 「' + v + '」\n    ' + tag);
      }
    });

    /* rows에 화살표를 직접 적었는지 (렌더러가 넣는다) */
    (it.rows || []).forEach(row => row.forEach(c => {
      if(String(c).trim() === '→') W('rows에 → 를 직접 적었다 — ' + tag);
    }));

    /* **강조**는 note.p에서만 렌더된다 */
    const starOutside = [];
    if(kind === 'note'){
      (it.p || []).forEach(t => {
        if(((t.match(/\*\*/g) || []).length) % 2) E('**강조** 짝이 안 맞는다 — 「' + t.slice(0, 40) + '…」\n    ' + tag);
      });
      (it.rows || []).forEach(row => row.forEach(c => { if(String(c).includes('**')) starOutside.push('rows'); }));
    }
    ['lead','sub','meta','k','g','hint'].forEach(f => { if(it[f] && String(it[f]).includes('**')) starOutside.push(f); });
    (it.bullets || []).forEach(v => { if(String(v).includes('**')) starOutside.push('bullets'); });
    if(starOutside.length) W('note.p 밖에 ** 가 있다 (그대로 별표로 찍힌다) — ' + [...new Set(starOutside)].join(',') + '\n    ' + tag);

    /* 명사는 예문 안에서 읽기가 그대로 나와야 한다.
       alignRuby는 「가나를 기준으로 쪼갤 수 있는가」만 보므로 읽기가 틀려도 통과한다.
       실제로 年下(としした)를 としたと 한 글자 빠뜨린 적이 있다.
       동사·형용사는 예문에서 활용되므로 이 검사에서 뺀다. */
    if(kind === 'word' && /명사/.test(it.p || '') && !/동사|형용사/.test(it.p || '')){
      [['ek', it.e, it.ek], ['ek2', it.e2, it.ek2]].forEach(([f, e, ek]) => {
        if(!e || !ek) return;
        if(e.includes(it.w) && !ek.includes(it.r))
          E('명사의 읽기가 예문 읽기에 안 나온다 — ' + it.w + ' = 「' + it.r + '」' + '\n    ' + ek + '\n    ' + tag);
      });
    }

    /* 예문 루비 정렬 */
    const exs = kind === 'pair' ? [[it.a.e, it.a.ek], [it.b.e, it.b.ek]]
                                : [[it.e, it.ek], [it.e2, it.ek2]];
    exs.forEach(([e, ek]) => {
      if(!e) return;
      n.ex++;
      if(!KANJI.test(e)) return;
      if(alignRuby && !alignRuby(e, ek))
        E('예문 루비 정렬 실패 — 한자와 읽기가 안 맞는다\n    ' + e + '\n    ' + ek + '\n    ' + tag);
    });
    if(it.e2) n.ex2++;
  });

  /* ---------- 5. 표지의 카드 수가 실제와 맞는지 ---------- */
  const cover = sec.items.find(i => i.cover && i.meta);
  if(cover){
    const c = { note:0, conj:0, pair:0, adjc:0 };
    sec.items.forEach(i => { for(const key in c) if(i[key]) c[key]++; });
    const claim = (re) => { const m = re.exec(cover.meta); return m ? +m[1] : null; };
    [['설명', /설명\s*(\d+)/, c.note], ['활용', /활용\s*(\d+)/, c.conj],
     ['짝', /짝\s*(\d+)/, c.pair],    ['표', /표\s*(\d+)/, c.adjc]].forEach(([label, re, real]) => {
      const said = claim(re);
      if(said !== null && said !== real)
        W('표지의 카드 수가 실제와 다르다 — ' + label + ' ' + said + ' 라고 적었는데 실제 ' + real
          + '\n    ' + sec.t + '  「' + cover.meta + '」');
    });
  }
});

/* ---------- 5-2. 같은 예문을 두 곳에 쓰지 않았는지 ---------- */
// 카드마다 예문이 따로여야 한다. 같은 문장이 두 번 나오면 한 카드는 새로 보여주는 것이 없다.
{
  const ex = new Map();
  DATA.forEach((sec, si) => sec.items.forEach(it => {
    const who = sec.t + ' / ' + (it.t || it.w || (it.a && it.a.w) || '');
    const add = (e) => {
      if(!e) return;
      if(ex.has(e)) W('예문이 겹친다 — 「' + e + '」' + '\n    ' + ex.get(e) + '\n    ' + who);
      else ex.set(e, who);
    };
    if(it.pair){ add(it.a.e); add(it.b.e); return; }
    if(it.cover || it.note) return;
    add(it.e); add(it.e2);
  }));
}

/* ---------- 6. 결과 ---------- */
function report(){
  const total = n.cover + n.note + n.conj + n.pair + n.adjc + n.word;
  console.log('');
  console.log('  섹션 ' + DATA.length + ' · 항목 ' + total);
  console.log('  표지 ' + n.cover + ' · 설명 ' + n.note + ' · 활용 ' + n.conj +
              ' · 짝 ' + n.pair + ' · 표 ' + n.adjc + ' · 단어 ' + n.word);
  console.log('  예문 ' + n.ex + ' (둘째 예문이 있는 항목 ' + n.ex2 + ')');
  console.log('');
  if(warn.length){
    console.log('  ⚠ 볼 것 ' + warn.length + '건');
    warn.forEach(m => console.log('    · ' + m));
    console.log('');
  }
  if(err.length){
    console.log('  ✗ 고칠 것 ' + err.length + '건');
    err.forEach(m => console.log('    · ' + m));
    console.log('');
  } else {
    console.log('  ✓ 통과');
    console.log('');
  }
}
report();
process.exit(err.length ? 1 : 0);
