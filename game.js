// Secret Word: each player picks a five-letter word and takes turns guessing the other's.
// The computers talk directly over PeerJS. Each word stays on its owner's computer until the
// game ends, and each computer answers guesses against its own word.
const PREFIX = "secretword-v1-";
const ROOM_WORDS = ["QUILL", "INK", "PAGE", "NOTE", "RIBBON", "STAMP", "INDEX", "SERIF", "LETTER", "MARGIN"];
const SURPRISES = ("BRAIN CLOUD CHAIR PLANT STONE LIGHT RIVER SHORE GHOST FLAME TRAIN SUGAR PIANO HONEY CANDY MOUSE TIGER "
  + "WHALE EAGLE ROBIN OCEAN BEACH CLIFF FIELD FROST STORM NIGHT DREAM HEART SMILE LAUGH DANCE MUSIC STORY BREAD "
  + "TOAST LEMON PEACH GRAPE BERRY SPICE KNIFE SPOON PLATE CLOCK LUNCH PAINT BRUSH CHALK PAPER SHELF TOWER "
  + "BRIDE CROWN JEWEL MAGIC WITCH FAIRY ANGEL SAINT NURSE QUEEN PRINT WRITE SPELL ROUND SHARP QUIET").split(" ");
const LEXICON = new Set(WORDS.match(/.{5}/g));
const $ = id => document.getElementById(id);
const cleanWord = v => String(v).toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5);
const isWord = v => typeof v === "string" && /^[A-Z]{5}$/.test(v);
const allowed = v => LEXICON.has(v);

const S = {
  me: "", foe: "Your friend", host: false, code: "", started: false, over: false, turn: null,
  secret: "", iReady: false, foeReady: false, foeSecret: "", mine: [], theirs: [], pending: null,
  iSolved: false, foeSolved: false, iAgain: false, foeAgain: false, notes: {},
};
let peer = null, conn = null, retry = null, leaving = false, typing = null;

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

// ---------- connection ----------
function bind(c) {
  conn = c;
  c.on("open", () => {
    clearTimeout(retry);
    send({ t: "hello", name: S.me });
    if (S.iReady && !S.started) send({ t: "ready" });
    if (S.pending) send({ t: "guess", ...S.pending });
    showConn();
  });
  c.on("data", onMessage);
  c.on("close", dropped);
  c.on("error", dropped);
}

function dropped() {
  if (leaving) return;
  conn = null;
  showConn();
  if (S.started && !S.over) setStatus("Your friend has dropped out. Hold on, trying to reconnect…", "lost");
  if (!S.host) { clearTimeout(retry); retry = setTimeout(connectToHost, 3000); }
}

function connectToHost() {
  if (leaving || (conn && conn.open) || !peer || peer.destroyed) return;
  bind(peer.connect(PREFIX + S.code, { reliable: true, serialization: "json" }));
  clearTimeout(retry);
  retry = setTimeout(() => { if (!conn || !conn.open) connectToHost(); }, 6000);
}

const send = m => { if (conn && conn.open) conn.send(m); };

function hostRoom() {
  S.host = true;
  S.code = ROOM_WORDS[Math.floor(Math.random() * ROOM_WORDS.length)] + "-" + (10 + Math.floor(Math.random() * 90));
  peer = new Peer(PREFIX + S.code);
  peer.on("open", () => {
    $("codeOut").textContent = S.code;
    show("wait");
  });
  peer.on("connection", c => {
    if (conn && conn.open) { c.on("open", () => { c.send({ t: "full" }); setTimeout(() => c.close(), 300); }); return; }
    bind(c);
  });
  peer.on("disconnected", () => { if (!leaving && !peer.destroyed) peer.reconnect(); });
  peer.on("error", e => {
    if (e.type === "unavailable-id") { peer.destroy(); hostRoom(); }
    else if (e.type !== "peer-unavailable" && !S.started) homeError("Couldn't connect. Check your internet and try again.");
  });
}

function joinRoom(code) {
  S.host = false;
  S.code = code;
  $("waitTitle").textContent = "Joining…";
  $("codeOut").textContent = code;
  $("waitNote").textContent = "Looking for your friend's room…";
  $("copyBtn").hidden = true;
  show("wait");
  peer = new Peer();
  peer.on("open", connectToHost);
  peer.on("disconnected", () => { if (!leaving && !peer.destroyed) peer.reconnect(); });
  peer.on("error", e => {
    if (e.type === "peer-unavailable") {
      if (S.started) return;
      clearTimeout(retry);
      homeError("No room with that code. Check it with your friend.");
    } else if (!S.started) homeError("Couldn't connect. Check your internet and try again.");
  });
}

function leave() {
  leaving = true;
  clearTimeout(retry);
  if (peer) peer.destroy();
  location.href = location.pathname;
}

function homeError(text) {
  clearTimeout(retry);
  if (peer) { leaving = true; peer.destroy(); leaving = false; peer = null; }
  conn = null;
  $("homeErr").textContent = text;
  show("home");
}

// ---------- messages from the other player ----------
function onMessage(m) {
  if (!m || typeof m !== "object") return;
  if (m.t === "hello") {
    S.foe = String(m.name || "").trim().slice(0, 16) || "Your friend";
    if ($("wait").classList.contains("on")) { resetRound(); show("pick"); }
    if (S.started && !S.over) refreshStatus();
    renderPlay();
    showConn();
  } else if (m.t === "full") {
    homeError("That room already has two players.");
  } else if (m.t === "ready") {
    S.foeReady = true;
    tryStart();
    renderPick();
  } else if (m.t === "start" && !S.host && !S.started) {
    begin(m.first === "guest" ? "me" : "foe");
  } else if (m.t === "guess" && isWord(m.word) && Number.isInteger(m.n)) {
    answerGuess(m.word, m.n);
  } else if (m.t === "answer" && isWord(m.word) && Number.isInteger(m.n)) {
    takeAnswer(m);
  } else if (m.t === "reveal" && isWord(m.word)) {
    S.foeSecret = m.word;
    if (S.over) showEnd();
  } else if (m.t === "again") {
    S.foeAgain = true;
    tryAgain();
  }
}

function tryStart() {
  if (!S.host || S.started || !S.iReady || !S.foeReady) return;
  const guestFirst = Math.random() < 0.5;
  send({ t: "start", first: guestFirst ? "guest" : "host" });
  begin(guestFirst ? "foe" : "me");
}

function begin(turn) {
  S.started = true;
  S.turn = turn;
  chime([392, 523]);
  show("play");
  refreshStatus();
  renderPlay();
}

// Letters the two words share, counting repeats: CRANE and CANOE share C, A, N and E, so 4.
function shared(a, b) {
  const left = [...b];
  let count = 0;
  for (const ch of a) {
    const at = left.indexOf(ch);
    if (at >= 0) { count++; left.splice(at, 1); }
  }
  return count;
}

function answerGuess(word, n) {
  const seen = S.theirs[n];
  if (!seen && (S.turn !== "foe" || n !== S.theirs.length)) return;
  const entry = seen || { word, count: shared(word, S.secret), right: word === S.secret };
  send({ t: "answer", word: entry.word, n, count: entry.count, right: entry.right });
  if (seen) return;
  S.theirs.push(entry);
  if (entry.right) S.foeSolved = true;
  afterTurn("me", entry.right ? `${S.foe} found your word!` : `${S.foe} guessed ${word}.`);
}

function takeAnswer(m) {
  if (!S.pending || S.pending.word !== m.word || S.pending.n !== m.n) return;
  const count = Number.isInteger(m.count) ? Math.max(0, Math.min(5, m.count)) : 0;
  S.pending = null;
  S.mine.push({ word: m.word, count, right: !!m.right });
  if (m.right) S.iSolved = true;
  afterTurn("foe", m.right ? `You found ${S.foe}’s word!` : `${m.word} shares ${count} ${count === 1 ? "letter" : "letters"}.`);
}

// Both players always get the same number of guesses, so going second is never a disadvantage.
function afterTurn(next, line) {
  const level = S.mine.length === S.theirs.length;
  if ((S.iSolved || S.foeSolved) && level) return finish();
  S.turn = next;
  const last = S.iSolved || S.foeSolved;
  ripple();
  setStatus(`${line} ${last ? (next === "me" ? "One last guess to draw." : `${S.foe} has one last guess.`) : turnLine()}`, next === "me" ? "mine" : "");
  renderPlay();
  if (next === "me") nudge();
}

function finish() {
  S.over = true;
  S.turn = null;
  send({ t: "reveal", word: S.secret });
  S.iSolved === S.foeSolved ? chime([523, 659]) : S.iSolved ? chime([523, 659, 784, 1047]) : chime([392, 330, 262]);
  $("againBtn").disabled = false;
  $("againBtn").textContent = "Play again";
  showEnd();
  $("end").classList.add("on");
  renderPlay();
}

function showEnd() {
  const title = S.iSolved && S.foeSolved ? "A draw" : S.iSolved ? "You worked it out" : `${S.foe} worked it out`;
  const reveal = S.foeSecret ? `${S.foe}’s word was ${S.foeSecret}.` : "";
  const turns = `${S.mine.length} ${S.mine.length === 1 ? "guess" : "guesses"} each.`;
  $("endTitle").textContent = title;
  $("endNote").textContent = `${reveal} ${turns}`.trim();
  setStatus(`${title}. ${reveal}`.trim());
}

function tryAgain() {
  if (S.iAgain && S.foeAgain) { resetRound(); show("pick"); $("secretIn").focus(); }
  else if (S.foeAgain) $("endNote").textContent = `${S.foe} would like another round.`;
}

function resetRound() {
  Object.assign(S, {
    started: false, over: false, turn: null, secret: "", iReady: false, foeReady: false, foeSecret: "",
    mine: [], theirs: [], pending: null, iSolved: false, foeSolved: false, iAgain: false, foeAgain: false, notes: {},
  });
  $("secretIn").value = "";
  $("guessIn").value = "";
  $("pickErr").textContent = "";
  $("guessErr").textContent = "";
  $("end").classList.remove("on");
  renderPick();
  renderPlay();
}

// ---------- choosing a word ----------
function ready() {
  const word = cleanWord($("secretIn").value);
  if (word.length < 5) { $("pickErr").textContent = "Your word needs five letters."; return; }
  if (!allowed(word)) { $("pickErr").textContent = "That one isn't in the dictionary. Try another word."; return; }
  $("pickErr").textContent = "";
  S.secret = word;
  S.iReady = true;
  send({ t: "ready" });
  tryStart();
  renderPick();
}

function renderPick() {
  $("secretIn").disabled = $("readyBtn").disabled = $("surpriseBtn").disabled = S.iReady;
  $("pickNote").textContent = S.iReady ? `Waiting for ${S.foe} to choose…` : S.foeReady ? `${S.foe} is ready and waiting.` : "";
}

// ---------- guessing ----------
function sendGuess() {
  const word = cleanWord($("guessIn").value);
  const err = $("guessErr");
  if (S.turn !== "me" || S.pending || !conn || !conn.open) return;
  if (word.length < 5) { err.textContent = "Your guess needs five letters."; return; }
  if (!allowed(word)) { err.textContent = "That one isn't in the dictionary."; return; }
  if (S.mine.some(g => g.word === word)) { err.textContent = "You've already tried that one."; return; }
  err.textContent = "";
  S.pending = { word, n: S.mine.length };
  send({ t: "guess", ...S.pending });
  $("guessIn").value = "";
  renderPlay();
}

function logRows(list, emptyText) {
  if (!list.length) {
    const row = document.createElement("div");
    row.className = "empty";
    row.textContent = emptyText;
    return [row];
  }
  return [...list].reverse().map(g => {
    const row = document.createElement("div");
    const word = document.createElement("span");
    const count = document.createElement("span");
    word.textContent = g.word;
    count.textContent = g.right ? "found" : g.count;
    if (g.right) count.className = "right";
    row.append(word, count);
    return row;
  });
}

function renderPlay() {
  const myGo = S.turn === "me" && !S.pending;
  $("guessIn").disabled = $("sendBtn").disabled = !myGo;
  if (myGo && $("play").classList.contains("on")) $("guessIn").focus();
  $("mySecret").textContent = S.secret;
  $("foeHead").textContent = `${S.foe}’s guesses`;
  $("myLog").replaceChildren(...logRows(S.mine, "None yet"));
  $("foeLog").replaceChildren(...logRows(S.theirs, "None yet"));
  $("alpha").replaceChildren(...[..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map(ch => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = ch;
    b.className = ["", "out", "sure"][S.notes[ch] || 0];
    b.onclick = () => { S.notes[ch] = ((S.notes[ch] || 0) + 1) % 3; renderPlay(); };
    return b;
  }));
}

// ---------- screen text ----------
const stillMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const turnLine = () => S.turn === "me" ? "Your turn. Guess a word." : `${S.foe} is thinking…`;

function setStatus(text, kind = "") {
  const el = $("status");
  el.className = "status " + kind;
  clearTimeout(typing);
  if (stillMotion || document.hidden) { el.textContent = text; return; }
  let n = 0;
  (function type() {
    el.textContent = text.slice(0, ++n);
    if (n < text.length) typing = setTimeout(type, 16);
  })();
}

function refreshStatus() {
  if (!S.over) setStatus(turnLine(), S.turn === "me" ? "mine" : "");
}

function nudge() {
  if (document.hidden) document.title = "Your turn! Secret Word";
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) document.title = "Secret Word"; });

function showConn() {
  const on = conn && conn.open;
  document.querySelectorAll("[data-conn]").forEach(e => {
    const dot = document.createElement("i");
    dot.className = "dot" + (on ? "" : " off");
    e.replaceChildren(dot, on ? `With ${S.foe}` : "Reconnecting…");
  });
}

function show(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.toggle("on", s.id === id));
  window.scrollTo(0, 0);
}

// ---------- sound ----------
let audio = null, muted = store.get("secretword-muted") === "1";
function sound() {
  if (muted) return null;
  audio = audio || new (window.AudioContext || window.webkitAudioContext)();
  audio.resume();
  return audio;
}
function note(freq, at, length, level) {
  const ctx = sound();
  if (!ctx) return;
  const osc = ctx.createOscillator(), gain = ctx.createGain(), t = ctx.currentTime + at;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(level, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + length);
}
function ripple() {   // a single typewriter key
  const ctx = sound();
  if (!ctx) return;
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.05, ctx.sampleRate);
  buffer.getChannelData(0).forEach((_, i, d) => { d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 3; });
  const src = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
  src.buffer = buffer;
  filter.type = "bandpass";
  filter.frequency.value = 1800;
  gain.gain.value = 0.3;
  src.connect(filter).connect(gain).connect(ctx.destination);
  src.start();
}
const chime = notes => { ripple(); notes.forEach((f, i) => note(f * 2, i * 0.12, 0.7, 0.05)); };   // key, then the carriage bell
const soundLabel = () => { $("soundBtn").textContent = muted ? "Sound off" : "Sound on"; };

// ---------- buttons ----------
const myName = () => { S.me = $("nameIn").value.trim().slice(0, 16); store.set("secretword-name", S.me); $("homeErr").textContent = ""; };
$("hostBtn").onclick = () => { myName(); hostRoom(); };
$("joinBtn").onclick = () => {
  myName();
  const code = $("codeIn").value.trim().toUpperCase();
  if (!/^[A-Z]+-\d{2}$/.test(code)) { $("homeErr").textContent = "Room codes look like QUILL-42."; return; }
  joinRoom(code);
};
$("codeIn").onkeydown = e => { if (e.key === "Enter") $("joinBtn").click(); };
$("copyBtn").onclick = async () => {
  const link = location.origin + location.pathname + "#" + S.code;
  try { await navigator.clipboard.writeText(link); $("copyBtn").textContent = "Copied!"; }
  catch { $("copyBtn").textContent = link; }
};
document.querySelectorAll("[data-leave]").forEach(b => { b.onclick = leave; });
for (const id of ["secretIn", "guessIn"]) $(id).oninput = e => { e.target.value = cleanWord(e.target.value); };
$("secretIn").onkeydown = e => { if (e.key === "Enter") ready(); };
$("readyBtn").onclick = ready;
$("surpriseBtn").onclick = () => {
  const options = SURPRISES.filter(w => w.length === 5 && allowed(w));
  $("secretIn").value = options[Math.floor(Math.random() * options.length)];
  $("pickErr").textContent = "";
};
$("guessForm").onsubmit = e => { e.preventDefault(); sendGuess(); };
$("againBtn").onclick = () => {
  S.iAgain = true;
  send({ t: "again" });
  $("againBtn").disabled = true;
  $("againBtn").textContent = "Waiting…";
  tryAgain();
};
$("lookBtn").onclick = () => $("end").classList.remove("on");
$("soundBtn").onclick = () => { muted = !muted; store.set("secretword-muted", muted ? "1" : "0"); soundLabel(); };

// ---------- start ----------
$("nameIn").value = store.get("secretword-name") || "";
const invite = decodeURIComponent(location.hash.slice(1)).toUpperCase();
if (/^[A-Z]+-\d{2}$/.test(invite)) $("codeIn").value = invite;
soundLabel();
renderPlay();
