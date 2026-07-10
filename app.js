import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  PENALTY_VALUES,
  autoFillRemainingTricks,
  biddingOrderForRound,
  createGame,
  isGameShapeValid,
  penaltyPointsForRound,
  pointsForRound,
  roundPoints,
  scoreboardForGame,
  sumValues,
  validateBids,
  validateTricks,
  winnersForGame,
} from "./game-core.js";

const STORAGE_KEY = "aufzug.game.v1";
const SETUP_KEY = "aufzug.setup.v1";
const ARCHIVE_KEY = "aufzug.archive.v1";
const ACCESS_SESSION_KEY = "aufzug.access.unlocked.v1";
const ACCESS_CODE_DIGEST = "35e52331b7fb9acc6006ffeb9f8226f8ed738c2b896032ab1a241da41694076e";
const ACCESS_CODE_SALT = "aufzug-shared-code-v1:";
const FIXED_PLAYERS = ["BP", "MR", "MA", "TB", "TS", "KS", "KK"];
const PENALTY_LABELS = {
  notTrump: "Nicht Trumpf gespielt",
  tooEarly: "Zu früh gespielt",
};
const BACKUP_VERSION = 2;

const app = document.querySelector("#app");
const wizardDialog = document.querySelector("#wizard-dialog");
const wizardContent = document.querySelector("#wizard-content");
const editDialog = document.querySelector("#edit-dialog");
const editContent = document.querySelector("#edit-content");
const menuDialog = document.querySelector("#menu-dialog");
const helpDialog = document.querySelector("#help-dialog");
const statsDialog = document.querySelector("#stats-dialog");
const statsContent = document.querySelector("#stats-content");
const detailsDialog = document.querySelector("#details-dialog");
const detailsContent = document.querySelector("#details-content");
const importFile = document.querySelector("#import-file");
const toast = document.querySelector("#toast");

let game = loadSavedGame();
let archivedGames = loadArchive();
const savedSetup = loadSetupState();
let setupPlayers = savedSetup.players;
let setupStartingMixerName = savedSetup.startingMixerName;
let bidWizard = null;
let trickWizard = null;
let editDraft = null;
let toastTimer = null;
let accessError = "";
let appUnlocked = readSessionUnlock();

if (game?.status === "finished") archiveCompletedGame(game);

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function initials(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toLocaleUpperCase("de-DE") ?? "").join("");
}

function pluralCards(cards) {
  return cards === 1 ? "Karte" : "Karten";
}

function signedPoints(points) {
  return points > 0 ? `+${points}` : String(points);
}

function penaltySummary(round, playerId) {
  const penalties = round?.penalties?.[playerId] ?? {};
  return Object.entries(PENALTY_LABELS)
    .filter(([key]) => penalties[key])
    .map(([key, label]) => `${label} (${signedPoints(-PENALTY_VALUES[key])})`)
    .join(" · ");
}

function clonePenalties(penalties = {}) {
  return Object.fromEntries(Object.entries(penalties).map(([playerId, values]) => [playerId, { ...values }]));
}

function readSessionUnlock() {
  try {
    return sessionStorage.getItem(ACCESS_SESSION_KEY) === ACCESS_CODE_DIGEST;
  } catch {
    return false;
  }
}

async function digestAccessCode(code) {
  const bytes = new TextEncoder().encode(`${ACCESS_CODE_SALT}${String(code).trim()}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function loadArchive() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ARCHIVE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((entry) => isGameShapeValid(entry) && entry.status === "finished") : [];
  } catch {
    return [];
  }
}

function persistArchive() {
  localStorage.setItem(ARCHIVE_KEY, JSON.stringify(archivedGames));
}

function normalizedProfileId(name) {
  const cleaned = String(name).trim();
  const fixed = FIXED_PLAYERS.find((entry) => entry.toLocaleLowerCase("de-DE") === cleaned.toLocaleLowerCase("de-DE"));
  if (fixed) return `fixed:${fixed.toLocaleLowerCase("de-DE")}`;
  return `guest:${encodeURIComponent(cleaned.toLocaleLowerCase("de-DE"))}`;
}

function canonicalPlayerName(name) {
  const cleaned = String(name).trim();
  return FIXED_PLAYERS.find((entry) => entry.toLocaleLowerCase("de-DE") === cleaned.toLocaleLowerCase("de-DE")) ?? cleaned;
}

function normalizeSetupPlayers(players) {
  const normalized = [];
  for (const name of Array.isArray(players) ? players : []) {
    const cleaned = canonicalPlayerName(name);
    const duplicate = normalized.some((entry) => entry.toLocaleLowerCase("de-DE") === cleaned.toLocaleLowerCase("de-DE"));
    if (!cleaned || duplicate) continue;
    normalized.push(cleaned);
    if (normalized.length === MAX_PLAYERS) break;
  }
  return normalized;
}

function archiveCompletedGame(completedGame) {
  if (!completedGame || completedGame.status !== "finished") return;
  const snapshot = structuredClone(completedGame);
  snapshot.finishedAt ??= new Date().toISOString();
  const existingIndex = archivedGames.findIndex((entry) => entry.gameId === snapshot.gameId);
  if (existingIndex === -1) archivedGames.push(snapshot);
  else archivedGames[existingIndex] = snapshot;
  archivedGames.sort((a, b) => String(b.finishedAt ?? b.updatedAt).localeCompare(String(a.finishedAt ?? a.updatedAt)));
  persistArchive();
}

function loadSavedGame() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (isGameShapeValid(parsed) && !Number.isInteger(parsed.startingDealerIndex)) {
      parsed.startingDealerIndex = parsed.rounds[0]?.dealerIndex ?? 0;
    }
    return isGameShapeValid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function loadSetupState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETUP_KEY) ?? "[]");
    const players = normalizeSetupPlayers(Array.isArray(parsed) ? parsed : parsed.players);
    const requestedMixer = Array.isArray(parsed) ? null : canonicalPlayerName(parsed.startingMixerName ?? "");
    return {
      players,
      startingMixerName: players.includes(requestedMixer) ? requestedMixer : (players[0] ?? null),
    };
  } catch {
    return { players: [], startingMixerName: null };
  }
}

function persistSetup() {
  localStorage.setItem(SETUP_KEY, JSON.stringify({
    players: setupPlayers,
    startingMixerName: setupStartingMixerName,
  }));
}

function persistGame() {
  if (!game) return;
  game.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(game));
}

function removeSavedGame() {
  localStorage.removeItem(STORAGE_KEY);
}

function currentRound() {
  return game?.rounds?.[game.currentRoundIndex] ?? null;
}

function playerIds() {
  return game.players.map((player) => player.id);
}

function biddingOrder(roundIndex) {
  return biddingOrderForRound(roundIndex, game.players.length, game.startingDealerIndex ?? 0);
}

function gameId() {
  if (globalThis.crypto?.getRandomValues) {
    const values = new Uint32Array(4);
    globalThis.crypto.getRandomValues(values);
    return `aufzug-${Array.from(values, (value) => value.toString(36)).join("")}`;
  }
  return `aufzug-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2600);
}

function openDialog(dialog) {
  if (dialog.open) return;
  dialog.showModal();
}

function closeDialog(dialog) {
  if (dialog.open) dialog.close();
}

function brandMarkup(withMenu = false) {
  return `
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
            <path d="m12 3-4 4h2v4h4V7h2l-4-4Z"></path>
            <path d="m12 21 4-4h-2v-4h-4v4H8l4 4Z"></path>
          </svg>
        </span>
        <span>Aufzug</span>
      </div>
      ${withMenu
        ? '<button class="icon-button" type="button" data-action="open-menu" aria-label="Partie-Menü öffnen">•••</button>'
        : '<button class="icon-button" type="button" data-action="open-help" aria-label="Regeln anzeigen">?</button>'}
    </header>`;
}

function renderLock() {
  app.innerHTML = `
    ${brandMarkup(false)}
    <main class="lock-main">
      <section class="lock-card">
        <span class="lock-symbol" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
            <path d="m12 3-4 4h2v4h4V7h2l-4-4Z"></path>
            <path d="m12 21 4-4h-2v-4h-4v4H8l4 4Z"></path>
          </svg>
        </span>
        <span class="eyebrow">Geschützte Spielrunde</span>
        <h1>Gemeinsamen Code eingeben</h1>
        <p>Danach wird eine laufende Partie auf diesem Gerät automatisch an derselben Stelle fortgesetzt.</p>
        <form id="access-code-form" class="access-form">
          <label class="sr-only" for="access-code-input">Gemeinsamer App-Code</label>
          <input id="access-code-input" class="text-input access-input" name="accessCode" type="password" inputmode="numeric" autocomplete="current-password" placeholder="App-Code" autofocus>
          ${accessError ? `<div class="warning-box">${escapeHtml(accessError)}</div>` : ""}
          <button class="primary-button full-width" type="submit">App öffnen</button>
        </form>
        <small>Der Code schützt vor zufälligem Zugriff. Die Daten bleiben ausschließlich in diesem Browser gespeichert.</small>
      </section>
    </main>`;
}

function render() {
  if (!appUnlocked) {
    renderLock();
    return;
  }
  if (!game) {
    renderSetup();
    return;
  }

  if (game.status === "finished") {
    renderFinished();
    return;
  }

  renderGame();
}

function renderSetup() {
  const count = setupPlayers.length;
  if (!setupPlayers.includes(setupStartingMixerName)) {
    setupStartingMixerName = setupPlayers[0] ?? null;
  }
  const canStart = count >= MIN_PLAYERS && count <= MAX_PLAYERS;

  const playerRows = setupPlayers.map((name, index) => {
    const fixed = FIXED_PLAYERS.includes(name);
    return `
      <li class="player-row">
        <span class="player-number">${index + 1}</span>
        <span class="player-name">${escapeHtml(name)}</span>
        <span class="row-actions">
          <button class="mini-button" type="button" data-action="player-up" data-index="${index}" ${index === 0 ? "disabled" : ""} aria-label="${escapeHtml(name)} nach oben">↑</button>
          <button class="mini-button" type="button" data-action="player-down" data-index="${index}" ${index === count - 1 ? "disabled" : ""} aria-label="${escapeHtml(name)} nach unten">↓</button>
          <button class="mini-button" type="button" data-action="player-remove" data-index="${index}" aria-label="${escapeHtml(name)} ${fixed ? "für heute abwählen" : "entfernen"}">×</button>
        </span>
      </li>`;
  }).join("");

  const mixerOptions = setupPlayers.map((name) => `
    <option value="${escapeHtml(name)}" ${name === setupStartingMixerName ? "selected" : ""}>${escapeHtml(name)}</option>`).join("");

  const fixedPlayerButtons = FIXED_PLAYERS.map((name) => {
    const selected = setupPlayers.includes(name);
    return `<button class="roster-chip ${selected ? "selected" : ""}" type="button" data-action="toggle-fixed-player" data-name="${name}" aria-pressed="${selected}">${name}<span>${selected ? "✓" : "+"}</span></button>`;
  }).join("");

  app.innerHTML = `
    ${brandMarkup(true)}
    <main>
      <section class="setup-panel">
        <h2 class="setup-title">Spieler auswählen</h2>

        <div class="fixed-roster">
          <span class="field-label">Feste Spieler</span>
          <div class="roster-chips">${fixedPlayerButtons}</div>
        </div>

        <form id="add-player-form" class="player-add-form" autocomplete="off">
          <label class="sr-only" for="player-name-input">Gastname</label>
          <input id="player-name-input" class="text-input" name="playerName" maxlength="24" placeholder="Gastname" ${count >= MAX_PLAYERS ? "disabled" : ""}>
          <button class="secondary-button" type="submit" ${count >= MAX_PLAYERS ? "disabled" : ""}>Gast hinzufügen</button>
        </form>

        <span class="field-label selected-players-label">Heute dabei</span>
        ${count
          ? `<ol class="player-list">${playerRows}</ol>`
          : ""}

        ${count ? `
          <div class="mixer-picker">
            <label for="starting-mixer-select">Wer mischt zuerst?</label>
            <select id="starting-mixer-select" class="text-input">${mixerOptions}</select>
          </div>` : ""}

        <div class="action-row">
          <button class="primary-button full-width" type="button" data-action="start-game" ${canStart ? "" : "disabled"}>Partie starten</button>
        </div>
      </section>
    </main>`;
}

function phaseCopy(round) {
  if (round.phase === "bidding") {
    const entered = playerIds().filter((id) => Number.isInteger(round.bids[id])).length;
    return {
      title: entered ? "Ansagen fortsetzen" : "Stiche ansagen",
      copy: entered ? `${entered} von ${game.players.length} Ansagen sind gespeichert.` : "Jeder sagt vor Rundenbeginn seine erwarteten Stiche an.",
      button: entered ? "Ansagen fortsetzen" : "Ansagen eingeben",
    };
  }
  if (round.phase === "playing") {
    return {
      title: "Runde läuft",
      copy: "Alle Ansagen stehen fest. Nach dem letzten Stich tragt ihr das Ergebnis ein.",
      button: "Runde auswerten",
    };
  }
  return {
    title: "Runde ausgewertet",
    copy: "Die Punkte sind eingerechnet. Ihr könnt das Ergebnis noch korrigieren.",
    button: game.currentRoundIndex === game.rounds.length - 1 ? "Spiel beenden" : "Nächste Runde",
  };
}

function renderRoundPlayers(round) {
  const order = biddingOrder(game.currentRoundIndex);
  return order.map((playerIndex) => {
    const player = game.players[playerIndex];
    const bid = round.bids[player.id];
    const tricks = round.tricks[player.id];
    const isDealer = playerIndex === round.dealerIndex;
    const startsBidding = playerIndex === order[0];

    if (round.phase === "result") {
      const points = roundPoints(round, player.id);
      const hit = bid === tricks;
      const penalty = penaltySummary(round, player.id);
      return `
        <li class="round-player">
          <span class="avatar">${escapeHtml(initials(player.name))}</span>
          <span class="round-player-main">
            <strong>${escapeHtml(player.name)}</strong>
            <small>Ansage ${bid} · gemacht ${tricks}${isDealer ? " · mischt" : ""}${startsBidding ? " · begann Ansage" : ""}</small>
            ${penalty ? `<small class="penalty-copy">${escapeHtml(penalty)}</small>` : ""}
          </span>
          <span class="value-badge ${hit && !penalty ? "hit" : "miss"}">${signedPoints(points)}</span>
        </li>`;
    }

    return `
      <li class="round-player">
        <span class="avatar">${escapeHtml(initials(player.name))}</span>
        <span class="round-player-main">
          <strong>${escapeHtml(player.name)}</strong>
          <small>${isDealer ? "Mischt · sagt zuletzt" : startsBidding ? "Beginnt mit dem Ansagen" : "Ansagereihenfolge"}</small>
        </span>
        <span class="value-badge ${Number.isInteger(bid) ? "" : "empty"}">${Number.isInteger(bid) ? bid : "–"}</span>
      </li>`;
  }).join("");
}

function renderPhaseActions(round, copy) {
  if (round.phase === "bidding") {
    return `<button class="primary-button full-width" type="button" data-action="open-bids">${copy.button}</button>`;
  }
  if (round.phase === "playing") {
    return `<button class="primary-button full-width" type="button" data-action="open-tricks">${copy.button}</button>`;
  }
  return `
    <div class="action-row split">
      <button class="primary-button" type="button" data-action="next-round">${copy.button}</button>
      <button class="secondary-button" type="button" data-action="edit-current-result">Korrigieren & Strafen</button>
    </div>`;
}

function renderScoreboard() {
  const sorted = scoreboardForGame(game).sort((a, b) => b.score - a.score || a.seatIndex - b.seatIndex);
  let previousScore = null;
  let previousRank = 0;
  const rows = sorted.map((entry, index) => {
    const rank = previousScore === entry.score ? previousRank : index + 1;
    previousScore = entry.score;
    previousRank = rank;
    return `
      <tr>
        <td><span class="rank ${rank === 1 ? "first" : ""}">${rank}</span></td>
        <td><span class="score-name">${escapeHtml(entry.name)}</span></td>
        <td>${entry.exactRounds}</td>
        <td class="score-number">${entry.score}</td>
      </tr>`;
  }).join("");

  return `
    <section class="score-card">
      <div class="section-head">
        <div><h2>Punktestand</h2><p>Automatisch nach jeder Runde</p></div>
      </div>
      <table class="score-table">
        <thead><tr><th>Rang</th><th>Spieler</th><th>Treffer</th><th>Punkte</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <button class="secondary-button full-width details-button" type="button" data-action="open-details">Details</button>
    </section>`;
}

function roundsForDetailDocument() {
  let lastRoundWithData = -1;
  for (const [index, round] of game.rounds.entries()) {
    const hasData = Object.keys(round.bids ?? {}).length
      || Object.keys(round.tricks ?? {}).length
      || Object.keys(round.penalties ?? {}).length;
    if (hasData || round.phase === "result" || round.phase === "complete") lastRoundWithData = index;
  }
  return game.rounds.slice(0, Math.max(0, lastRoundWithData) + 1);
}

function detailCell(round, player) {
  const bid = round.bids?.[player.id];
  const tricks = round.tricks?.[player.id];
  if (!Number.isInteger(bid) || !Number.isInteger(tricks)) {
    return '<td class="detail-empty">—<small>offen</small></td>';
  }
  const penalty = penaltySummary(round, player.id);
  return `
    <td>
      <strong>${signedPoints(roundPoints(round, player.id))}</strong>
      <small>Ansage ${bid} · gemacht ${tricks}</small>
      ${penalty ? `<small class="penalty-copy">${escapeHtml(penalty)}</small>` : ""}
    </td>`;
}

function renderDetailsDocument() {
  const rounds = roundsForDetailDocument();
  const scoreboard = scoreboardForGame(game).sort((a, b) => a.seatIndex - b.seatIndex);
  const roundRows = rounds.map((round) => `
    <tr>
      <th scope="row"><strong>Karte ${round.cards}</strong><small>Runde ${round.number}</small></th>
      ${game.players.map((player) => detailCell(round, player)).join("")}
    </tr>`).join("");
  const totalCells = scoreboard.map((entry) => `<td><strong>${signedPoints(entry.score)}</strong><small>${entry.exactRounds} Treffer</small></td>`).join("");
  const date = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(game.createdAt));

  detailsContent.innerHTML = `
    <div class="dialog-shell detail-document">
      <div class="dialog-head">
        <div><span class="eyebrow">Dokumentation</span><h2 id="details-title">Spiel-Details</h2></div>
        <button class="icon-button" type="button" data-action="close-details" aria-label="Details schließen">×</button>
      </div>
      <div class="dialog-content">
        <div class="document-meta"><strong>Aufzug</strong><span>Beginn: ${escapeHtml(date)} · ${game.players.map((player) => escapeHtml(player.name)).join(" · ")}</span></div>
        <p class="document-legend"><strong>Punkte</strong> · Ansage · gemacht · Strafen</p>
        <div class="detail-table-wrap">
          <table class="detail-table">
            <thead><tr><th>Karte</th>${game.players.map((player) => `<th>${escapeHtml(player.name)}</th>`).join("")}</tr></thead>
            <tbody>${roundRows}</tbody>
            <tfoot><tr><th>Gesamt</th>${totalCells}</tr></tfoot>
          </table>
        </div>
      </div>
      <div class="dialog-footer detail-actions">
        <button class="secondary-button" type="button" data-action="print-details">Drucken / PDF</button>
        <button class="primary-button" type="button" data-action="close-details">Schließen</button>
      </div>
    </div>`;
}

function openDetailsDocument() {
  renderDetailsDocument();
  openDialog(detailsDialog);
}

function printDetailsDocument() {
  document.body.classList.add("printing-details");
  window.print();
}

function completedRoundEntries() {
  return game.rounds
    .map((round, index) => ({ round, index }))
    .filter(({ round }) => round.phase === "complete" || round.phase === "result");
}

function renderHistory() {
  const entries = completedRoundEntries();
  if (!entries.length) return "";

  const rows = entries.slice().reverse().map(({ round, index }) => {
    const totalPoints = game.players.reduce((sum, player) => sum + roundPoints(round, player.id), 0);
    return `
      <li class="history-row">
        <span><strong>Runde ${round.number} · ${round.cards} ${pluralCards(round.cards)}</strong><small>${totalPoints} Punkte insgesamt vergeben</small></span>
        <button class="text-button" type="button" data-action="edit-round" data-index="${index}">Bearbeiten</button>
      </li>`;
  }).join("");

  return `
    <details class="history-card">
      <summary>Rundenverlauf <small>${entries.length} abgeschlossen</small></summary>
      <ol class="history-list">${rows}</ol>
    </details>`;
}

function archiveStatistics() {
  const byProfile = new Map(FIXED_PLAYERS.map((name) => [normalizedProfileId(name), {
    profileId: normalizedProfileId(name),
    name,
    fixed: true,
    games: 0,
    wins: 0,
    points: 0,
    exactRounds: 0,
    rounds: 0,
    bestScore: null,
  }]));

  let totalRounds = 0;
  for (const archivedGame of archivedGames) {
    const scoreboard = scoreboardForGame(archivedGame);
    const bestScore = Math.max(...scoreboard.map((entry) => entry.score));
    totalRounds += archivedGame.rounds.length;
    for (const entry of scoreboard) {
      const player = archivedGame.players.find((candidate) => candidate.id === entry.id) ?? entry;
      const profileId = player.profileId ?? normalizedProfileId(player.name);
      if (!byProfile.has(profileId)) {
        byProfile.set(profileId, {
          profileId,
          name: player.name,
          fixed: profileId.startsWith("fixed:"),
          games: 0,
          wins: 0,
          points: 0,
          exactRounds: 0,
          rounds: 0,
          bestScore: null,
        });
      }
      const stats = byProfile.get(profileId);
      stats.games += 1;
      stats.wins += entry.score === bestScore ? 1 : 0;
      stats.points += entry.score;
      stats.exactRounds += entry.exactRounds;
      stats.rounds += archivedGame.rounds.length;
      stats.bestScore = stats.bestScore === null ? entry.score : Math.max(stats.bestScore, entry.score);
    }
  }

  return {
    totalRounds,
    players: [...byProfile.values()].sort((a, b) => {
      if (a.fixed !== b.fixed) return a.fixed ? -1 : 1;
      if (a.games !== b.games) return b.games - a.games;
      return a.name.localeCompare(b.name, "de");
    }),
  };
}

function formatGameDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "ohne Datum" : new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" }).format(date);
}

function renderStatsDialog() {
  const statistics = archiveStatistics();
  const activePlayers = statistics.players.filter((entry) => entry.games > 0).length;
  const rows = statistics.players.map((entry) => `
    <tr class="${entry.games ? "" : "muted-row"}">
      <td><strong>${escapeHtml(entry.name)}</strong>${entry.fixed ? "" : "<small>Gast</small>"}</td>
      <td>${entry.games}</td>
      <td>${entry.wins}</td>
      <td>${entry.points}</td>
      <td>${entry.games ? (entry.points / entry.games).toLocaleString("de-DE", { maximumFractionDigits: 1 }) : "–"}</td>
      <td>${entry.rounds ? `${Math.round((entry.exactRounds / entry.rounds) * 100)} %` : "–"}</td>
    </tr>`).join("");

  const games = archivedGames.map((archivedGame) => {
    const scoreboard = scoreboardForGame(archivedGame).sort((a, b) => b.score - a.score || a.seatIndex - b.seatIndex);
    const bestScore = Math.max(...scoreboard.map((entry) => entry.score));
    const winnerNames = scoreboard.filter((entry) => entry.score === bestScore).map((entry) => entry.name).join(" & ");
    return `
      <li class="archive-game">
        <div><strong>${escapeHtml(winnerNames)}${scoreboard.filter((entry) => entry.score === bestScore).length === 1 ? " gewinnt" : " gewinnen"}</strong><small>${formatGameDate(archivedGame.finishedAt ?? archivedGame.updatedAt)} · ${archivedGame.rounds.length} Runden</small></div>
        <span>${scoreboard.map((entry) => `${escapeHtml(entry.name)} ${entry.score}`).join(" · ")}</span>
      </li>`;
  }).join("");

  statsContent.innerHTML = `
    <div class="dialog-shell">
      <div class="dialog-head">
        <div><span class="eyebrow">Langzeitwertung</span><h2 id="stats-title">Alle Spiele</h2></div>
        <button class="icon-button" type="button" data-action="close-stats" aria-label="Statistik schließen">×</button>
      </div>
      <div class="dialog-content">
        <div class="stats-summary">
          <div class="preview-stat"><strong>${archivedGames.length}</strong><span>Spiele</span></div>
          <div class="preview-stat"><strong>${activePlayers}</strong><span>Spieler</span></div>
          <div class="preview-stat"><strong>${statistics.totalRounds}</strong><span>Runden</span></div>
        </div>
        <div class="stats-table-wrap">
          <table class="stats-table">
            <thead><tr><th>Spieler</th><th>Sp.</th><th>Siege</th><th>Punkte</th><th>Ø</th><th>Treffer</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <p class="scroll-hint">Auf kleinen Bildschirmen die Tabelle seitlich wischen.</p>
        <section class="archive-section">
          <h3>Abgeschlossene Partien</h3>
          ${games ? `<ol class="archive-list">${games}</ol>` : '<div class="empty-players">Noch keine Partie abgeschlossen.</div>'}
        </section>
      </div>
      <div class="dialog-footer">
        <button class="ghost-button" type="button" data-action="close-stats">Schließen</button>
        <button class="primary-button" type="button" data-action="export-backup">Gesamtsicherung</button>
      </div>
    </div>`;
}

function openStats() {
  renderStatsDialog();
  openDialog(statsDialog);
}

function renderGame() {
  const round = currentRound();
  const copy = phaseCopy(round);
  const progress = ((game.currentRoundIndex + (round.phase === "result" ? 1 : 0)) / game.rounds.length) * 100;
  const direction = game.currentRoundIndex < Math.floor(game.rounds.length / 2) ? "Aufwärts" : game.currentRoundIndex === Math.floor(game.rounds.length / 2) ? "Höchste Runde" : "Abwärts";
  const dealer = game.players[round.dealerIndex];
  const firstBidder = game.players[(round.dealerIndex + 1) % game.players.length];
  const trumpText = round.cards === 1 ? "Aufdeckkarte verdeckt" : "Trumpfkarte aufdecken";

  app.innerHTML = `
    ${brandMarkup(true)}
    <main>
      <div class="progress-wrap">
        <div class="progress-labels"><span>Runde ${round.number} von ${game.rounds.length}</span><span>${Math.round(progress)} %</span></div>
        <div class="progress-track"><div class="progress-bar" style="width: ${progress}%"></div></div>
      </div>

      <section class="round-card">
        <div class="round-hero">
          <div>
            <span class="eyebrow">${direction}</span>
            <h1>${round.cards} ${pluralCards(round.cards)}</h1>
            <p>Je Spieler austeilen. ${round.cards === 1 ? "Die oberste Karte bleibt verdeckt." : "Danach die oberste Karte aufdecken."}</p>
          </div>
          <div class="card-stack" aria-hidden="true">
            <span class="playing-card back">↕</span>
            <span class="playing-card front">${round.cards}</span>
          </div>
        </div>
        <div class="round-body">
          <div class="instruction-grid">
            <div class="instruction-chip">${trumpText}<span>${round.cards === 1 ? "nicht aufdecken" : "Farbe gilt als Trumpf"}</span></div>
            <div class="instruction-chip">Mischt: ${escapeHtml(dealer.name)}<span>${escapeHtml(firstBidder.name)} beginnt die Ansage</span></div>
          </div>
          <div class="phase-head"><h2>${copy.title}</h2><p>${copy.copy}</p></div>
          <ol class="round-player-list">${renderRoundPlayers(round)}</ol>
          ${renderPhaseActions(round, copy)}
        </div>
      </section>

      ${renderScoreboard()}
      ${renderHistory()}
    </main>`;
}

function renderFinished() {
  const winners = winnersForGame(game);
  const score = winners[0]?.score ?? 0;
  const title = winners.length === 1 ? `${escapeHtml(winners[0].name)} gewinnt!` : "Gleichstand!";
  const names = winners.map((winner) => escapeHtml(winner.name)).join(" & ");

  app.innerHTML = `
    ${brandMarkup(true)}
    <main>
      <section class="winner-card">
        <div class="winner-hero">
          <div class="trophy" aria-hidden="true">♛</div>
          <span class="eyebrow">Partie beendet</span>
          <h1>${title}</h1>
          <p>${score} Punkte nach ${game.rounds.length} Runden</p>
        </div>
        <div class="winner-body">
          <div class="winner-names">${names}</div>
          <div class="winner-actions">
            <button class="primary-button" type="button" data-action="rematch">Revanche</button>
            <button class="secondary-button" type="button" data-action="copy-result">Ergebnis kopieren</button>
          </div>
        </div>
      </section>
      ${renderScoreboard()}
      ${renderHistory()}
    </main>`;
}

function addPlayer(name) {
  const cleaned = canonicalPlayerName(name);
  if (!cleaned) {
    showToast("Bitte einen Namen eingeben.");
    return false;
  }
  if (setupPlayers.some((player) => player.toLocaleLowerCase("de-DE") === cleaned.toLocaleLowerCase("de-DE"))) {
    showToast("Dieser Name ist bereits eingetragen.");
    return false;
  }
  if (setupPlayers.length >= MAX_PLAYERS) {
    showToast(`Maximal ${MAX_PLAYERS} Spieler möglich.`);
    return false;
  }
  setupPlayers.push(cleaned);
  if (!setupStartingMixerName) setupStartingMixerName = cleaned;
  persistSetup();
  render();
  return true;
}

function startGame() {
  if (setupPlayers.length < MIN_PLAYERS) {
    showToast(`Bitte mindestens ${MIN_PLAYERS} Spieler eintragen.`);
    return;
  }
  try {
    const startingDealerIndex = setupPlayers.indexOf(setupStartingMixerName);
    game = createGame(setupPlayers, {
      gameId: gameId(),
      startingDealerIndex,
      profileIds: setupPlayers.map(normalizedProfileId),
    });
    persistGame();
    navigator.storage?.persist?.().catch(() => {});
    render();
    showToast("Partie angelegt und automatisch gespeichert.");
  } catch (error) {
    showToast(error.message);
  }
}

function firstMissingStep(values, order) {
  const missing = order.findIndex((playerIndex) => !Number.isInteger(values[game.players[playerIndex].id]));
  return missing === -1 ? order.length - 1 : missing;
}

function openBidWizard() {
  const round = currentRound();
  if (!round || round.phase !== "bidding") return;
  const order = biddingOrder(game.currentRoundIndex);
  trickWizard = null;
  bidWizard = { roundIndex: game.currentRoundIndex, step: firstMissingStep(round.bids, order) };
  renderBidWizard();
  openDialog(wizardDialog);
}

function wizardProgress(order, values, step) {
  return order.map((playerIndex, index) => {
    const playerId = game.players[playerIndex].id;
    const done = Number.isInteger(values[playerId]) || index < step;
    return `<span class="${done ? "done" : ""}"></span>`;
  }).join("");
}

function previousValuesList(order, values, step, type, round) {
  return order.map((playerIndex, index) => {
    const player = game.players[playerIndex];
    const value = values[player.id];
    const wasAutoFilled = type === "tricks" && trickWizard?.autoFilledPlayerIds?.includes(player.id);
    const detail = type === "tricks" && Number.isInteger(value)
      ? `Ansage ${round.bids[player.id]} · ${value === round.bids[player.id] ? "richtig" : "daneben"}${wasAutoFilled ? " · automatisch 0" : ""}`
      : index === 0 ? "beginnt die Ansage" : index === order.length - 1 ? "mischt · sagt zuletzt an" : "";
    return `
      <li class="${index === step ? "current" : ""}">
        <span>${escapeHtml(player.name)}${detail ? `<small> · ${detail}</small>` : ""}</span>
        <strong>${Number.isInteger(value) ? value : "–"}</strong>
      </li>`;
  }).join("");
}

function renderBidWizard() {
  const round = game.rounds[bidWizard.roundIndex];
  const order = biddingOrder(bidWizard.roundIndex);
  const playerIndex = order[bidWizard.step];
  const player = game.players[playerIndex];
  const selected = round.bids[player.id];
  const isLast = bidWizard.step === order.length - 1;
  const othersTotal = playerIds().filter((id) => id !== player.id).reduce((sum, id) => sum + (Number.isInteger(round.bids[id]) ? round.bids[id] : 0), 0);
  const forbidden = isLast ? round.cards - othersTotal : null;
  const total = sumValues(round.bids, playerIds());
  const validation = validateBids(round.bids, playerIds(), round.cards);
  const allComplete = validation.reason !== "missing";
  const invalidTotal = allComplete && validation.reason === "equal";
  const nextDisabled = !Number.isInteger(selected) || (isLast && !validation.valid);
  const bidRole = playerIndex === round.dealerIndex
    ? "Mischt · letzte Ansage"
    : bidWizard.step === 0
      ? "Beginnt mit dem Ansagen"
      : `Mischt: ${game.players[round.dealerIndex].name}`;

  const numberButtons = Array.from({ length: round.cards + 1 }, (_, value) => {
    const isForbidden = isLast && forbidden >= 0 && forbidden <= round.cards && value === forbidden;
    return `<button class="number-button ${selected === value ? "selected" : ""}" type="button" data-bid-value="${value}" ${isForbidden ? "disabled" : ""} aria-label="${value} Stiche${isForbidden ? ", nicht erlaubt" : ""}">${value}</button>`;
  }).join("");

  wizardContent.innerHTML = `
    <div class="dialog-shell">
      <div class="dialog-head">
        <div><span class="eyebrow">Ansage ${bidWizard.step + 1} von ${order.length}</span><h2 id="wizard-title">Stiche ansagen</h2></div>
        <button class="icon-button" type="button" data-action="cancel-wizard" aria-label="Ansagen schließen">×</button>
      </div>
      <div class="dialog-content">
        <div class="wizard-progress">${wizardProgress(order, round.bids, bidWizard.step)}</div>
        <p class="wizard-question">Wie viele Stiche sagst du an?</p>
        <h3 class="wizard-player">${escapeHtml(player.name)}</h3>
        <div class="bid-context"><span>${round.cards} ${pluralCards(round.cards)} auf der Hand</span><span>${escapeHtml(bidRole)}</span></div>
        <div class="number-grid">${numberButtons}</div>
        <div class="total-panel">
          <div class="total-stat"><strong>${total}</strong><span>Ansagen gesamt</span></div>
          <div class="total-stat"><strong>${round.cards}</strong><span>mögliche Stiche</span></div>
        </div>
        ${invalidTotal ? '<div class="warning-box">Genau diese Gesamtsumme ist nicht erlaubt. Die letzte Ansage muss höher oder niedriger sein.</div>' : ""}
        ${isLast && Number.isInteger(forbidden) && forbidden >= 0 && forbidden <= round.cards ? `<div class="inline-notice">Für die letzte Ansage ist <strong>${forbidden}</strong> gesperrt, damit die Gesamtsumme nicht genau ${round.cards} ergibt.</div>` : ""}
        <ul class="previous-values">${previousValuesList(order, round.bids, bidWizard.step, "bids", round)}</ul>
      </div>
      <div class="dialog-footer three">
        <button class="ghost-button" type="button" data-action="cancel-wizard">Abbrechen</button>
        <button class="secondary-button" type="button" data-action="bid-back" ${bidWizard.step === 0 ? "disabled" : ""}>Zurück</button>
        <button class="primary-button" type="button" data-action="bid-next" ${nextDisabled ? "disabled" : ""}>${isLast ? "Ansagen bestätigen" : "Weiter"}</button>
      </div>
    </div>`;
}

function openTrickWizard(startAtBeginning = false) {
  const round = currentRound();
  if (!round || (round.phase !== "playing" && round.phase !== "result")) return;
  const order = biddingOrder(game.currentRoundIndex);
  bidWizard = null;
  trickWizard = {
    roundIndex: game.currentRoundIndex,
    step: startAtBeginning ? 0 : firstMissingStep(round.tricks, order),
    restoreOnCancel: round.phase === "result",
    originalTricks: round.phase === "result" ? { ...round.tricks } : null,
    autoFilledPlayerIds: [],
  };
  renderTrickWizard();
  openDialog(wizardDialog);
}

function renderTrickWizard() {
  const round = game.rounds[trickWizard.roundIndex];
  const order = biddingOrder(trickWizard.roundIndex);
  const playerIndex = order[trickWizard.step];
  const player = game.players[playerIndex];
  const selected = round.tricks[player.id];
  const isLast = trickWizard.step === order.length - 1;
  const orderedPlayerIds = order.map((index) => game.players[index].id);
  const otherTotal = orderedPlayerIds
    .filter((playerId) => playerId !== player.id)
    .reduce((sum, playerId) => sum + (Number.isInteger(round.tricks[playerId]) ? round.tricks[playerId] : 0), 0);
  const maxAllowed = round.cards - otherTotal;
  const total = sumValues(round.tricks, orderedPlayerIds);
  const remaining = round.cards - total;
  const validation = validateTricks(round.tricks, playerIds(), round.cards);
  const predictedPoints = Number.isInteger(selected) ? pointsForRound(round.bids[player.id], selected) : 0;
  const nextDisabled = !Number.isInteger(selected) || (isLast && !validation.valid);

  const numberButtons = Array.from(
    { length: round.cards + 1 },
    (_, value) => {
      const disabled = value > maxAllowed;
      return `<button class="number-button ${selected === value ? "selected" : ""}" type="button" data-trick-value="${value}" ${disabled ? "disabled" : ""} aria-label="${value} Stiche${disabled ? ", nicht mehr verfügbar" : ""}">${value}</button>`;
    },
  ).join("");

  wizardContent.innerHTML = `
    <div class="dialog-shell">
      <div class="dialog-head">
        <div><span class="eyebrow">Ergebnis ${trickWizard.step + 1} von ${order.length}</span><h2 id="wizard-title">Runde auswerten</h2></div>
        <button class="icon-button" type="button" data-action="cancel-wizard" aria-label="Auswertung schließen">×</button>
      </div>
      <div class="dialog-content">
        <div class="wizard-progress">${wizardProgress(order, round.tricks, trickWizard.step)}</div>
        <p class="wizard-question">Wie viele Stiche wurden tatsächlich gemacht?</p>
        <h3 class="wizard-player">${escapeHtml(player.name)}</h3>
        <div class="bid-context"><span>Ansage: ${round.bids[player.id]}</span><span>${Number.isInteger(selected) ? (selected === round.bids[player.id] ? `Treffer · +${predictedPoints}` : `Daneben · ${predictedPoints}`) : "Ergebnis wählen"}</span></div>
        <div class="number-grid">${numberButtons}</div>
        <div class="total-panel">
          <div class="total-stat"><strong>${total}</strong><span>Stiche eingetragen</span></div>
          <div class="total-stat"><strong>${Math.max(0, remaining)}</strong><span>Stiche noch offen</span></div>
        </div>
        ${total === round.cards
          ? '<div class="success-box">Alle Stiche sind verteilt. Noch offene Spieler wurden automatisch mit 0 Stichen eingetragen.</div>'
          : `<div class="inline-notice">Noch <strong>${Math.max(0, remaining)}</strong> ${remaining === 1 ? "Stich muss" : "Stiche müssen"} auf die offenen Spieler verteilt werden.</div>`}
        ${validation.reason === "total" && isLast ? `<div class="warning-box">Insgesamt müssen genau ${round.cards} Stiche eingetragen sein.</div>` : ""}
        <ul class="previous-values">${previousValuesList(order, round.tricks, trickWizard.step, "tricks", round)}</ul>
      </div>
      <div class="dialog-footer three">
        <button class="ghost-button" type="button" data-action="cancel-wizard">Abbrechen</button>
        <button class="secondary-button" type="button" data-action="trick-back" ${trickWizard.step === 0 ? "disabled" : ""}>Zurück</button>
        <button class="primary-button" type="button" data-action="trick-next" ${nextDisabled ? "disabled" : ""}>${isLast ? "Ergebnis speichern" : "Weiter"}</button>
      </div>
    </div>`;
}

function advanceRound() {
  const round = currentRound();
  if (!round || round.phase !== "result") return;
  round.phase = "complete";
  if (game.currentRoundIndex === game.rounds.length - 1) {
    game.status = "finished";
    game.finishedAt = new Date().toISOString();
  } else {
    game.currentRoundIndex += 1;
  }
  persistGame();
  if (game.status === "finished") archiveCompletedGame(game);
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function cancelActiveWizard() {
  if (trickWizard?.restoreOnCancel) {
    game.rounds[trickWizard.roundIndex].tricks = { ...trickWizard.originalTricks };
    persistGame();
  }
  bidWizard = null;
  trickWizard = null;
  closeDialog(wizardDialog);
  render();
}

function openRoundEditor(roundIndex) {
  const round = game.rounds[roundIndex];
  if (!round || (round.phase !== "complete" && round.phase !== "result")) return;
  editDraft = {
    roundIndex,
    bids: { ...round.bids },
    tricks: { ...round.tricks },
    penalties: clonePenalties(round.penalties),
  };
  renderRoundEditor();
  openDialog(editDialog);
}

function optionMarkup(max, selected) {
  return Array.from({ length: max + 1 }, (_, value) => `<option value="${value}" ${selected === value ? "selected" : ""}>${value}</option>`).join("");
}

function renderRoundEditor() {
  const round = game.rounds[editDraft.roundIndex];
  const bidValidation = validateBids(editDraft.bids, playerIds(), round.cards);
  const trickValidation = validateTricks(editDraft.tricks, playerIds(), round.cards);
  const valid = bidValidation.valid && trickValidation.valid;

  const rows = game.players.map((player) => {
    const penalties = editDraft.penalties[player.id] ?? {};
    const basePoints = pointsForRound(editDraft.bids[player.id], editDraft.tricks[player.id]);
    const penaltyPoints = penaltyPointsForRound({ penalties: editDraft.penalties }, player.id);
    return `
      <tr>
        <td><strong>${escapeHtml(player.name)}</strong></td>
        <td><select class="number-select" data-edit-bid="${player.id}" aria-label="Ansage von ${escapeHtml(player.name)}">${optionMarkup(round.cards, editDraft.bids[player.id])}</select></td>
        <td><select class="number-select" data-edit-trick="${player.id}" aria-label="Stiche von ${escapeHtml(player.name)}">${optionMarkup(round.cards, editDraft.tricks[player.id])}</select></td>
        <td class="penalty-options">
          <label><input type="checkbox" data-edit-penalty-player="${player.id}" data-edit-penalty-type="notTrump" ${penalties.notTrump ? "checked" : ""}> −20 Trumpf</label>
          <label><input type="checkbox" data-edit-penalty-player="${player.id}" data-edit-penalty-type="tooEarly" ${penalties.tooEarly ? "checked" : ""}> −2 zu früh</label>
        </td>
        <td><strong>${signedPoints(basePoints + penaltyPoints)}</strong></td>
      </tr>`;
  }).join("");

  const issues = [
    !bidValidation.valid ? `Ansagen gesamt: ${bidValidation.total}. Die Summe darf nicht genau ${round.cards} sein.` : "",
    trickValidation.reason === "missing" ? "Bitte für jeden Spieler das tatsächliche Ergebnis eintragen." : "",
    trickValidation.reason === "total" ? `Tatsächliche Stiche gesamt: ${trickValidation.total}. Es müssen genau ${round.cards} sein.` : "",
  ].filter(Boolean).join(" ");

  editContent.innerHTML = `
    <div class="dialog-shell">
      <div class="dialog-head">
        <div><span class="eyebrow">Runde ${round.number}</span><h2 id="edit-title">Ergebnis korrigieren</h2></div>
        <button class="icon-button" type="button" data-action="close-editor" aria-label="Bearbeitung schließen">×</button>
      </div>
      <div class="dialog-content">
        <div class="bid-context"><span>${round.cards} ${pluralCards(round.cards)} je Spieler</span><span>Strafen werden sofort eingerechnet</span></div>
        <div class="edit-table-wrap">
          <table class="edit-table">
            <thead><tr><th>Spieler</th><th>Ansage</th><th>Gemacht</th><th>Strafen</th><th>Punkte</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div class="edit-summary">${valid ? '<div class="success-box">Die Eingaben sind gültig.</div>' : `<div class="warning-box">${issues}</div>`}</div>
      </div>
      <div class="dialog-footer">
        <button class="ghost-button" type="button" data-action="close-editor">Abbrechen</button>
        <button class="primary-button" type="button" data-action="save-editor" ${valid ? "" : "disabled"}>Änderungen speichern</button>
      </div>
    </div>`;
}

function exportGame() {
  const backup = {
    type: "aufzug-full-backup",
    backupVersion: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    activeGame: game,
    archivedGames,
    setup: {
      players: setupPlayers,
      startingMixerName: setupStartingMixerName,
    },
  };
  const payload = JSON.stringify(backup, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const date = new Date().toISOString().slice(0, 10);
  const link = document.createElement("a");
  link.href = url;
  link.download = `Aufzug-Gesamtsicherung_${date}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  closeDialog(menuDialog);
  showToast("Gesamtsicherung wurde erstellt.");
}

function mergeArchivedGames(incomingGames) {
  const merged = new Map(archivedGames.map((entry) => [entry.gameId, entry]));
  for (const incoming of incomingGames) {
    const existing = merged.get(incoming.gameId);
    if (!existing || String(incoming.updatedAt ?? "") >= String(existing.updatedAt ?? "")) {
      merged.set(incoming.gameId, incoming);
    }
  }
  archivedGames = [...merged.values()].sort((a, b) => String(b.finishedAt ?? b.updatedAt).localeCompare(String(a.finishedAt ?? a.updatedAt)));
  persistArchive();
}

async function importGameFromFile(file) {
  try {
    const parsed = JSON.parse(await file.text());
    if (parsed?.type === "aufzug-full-backup") {
      const incomingActive = parsed.activeGame;
      const incomingArchive = Array.isArray(parsed.archivedGames) ? parsed.archivedGames : [];
      if (incomingActive && !isGameShapeValid(incomingActive)) throw new Error("Die laufende Partie in der Sicherung ist ungültig.");
      if (!incomingArchive.every((entry) => isGameShapeValid(entry) && entry.status === "finished")) throw new Error("Das Spielearchiv in der Sicherung ist ungültig.");
      if (game && incomingActive && !window.confirm("Die aktuelle Partie durch die laufende Partie aus der Sicherung ersetzen?")) return;

      mergeArchivedGames(incomingArchive);
      if (incomingActive) {
        game = incomingActive;
        if (!Number.isInteger(game.startingDealerIndex)) game.startingDealerIndex = game.rounds[0]?.dealerIndex ?? 0;
        persistGame();
        if (game.status === "finished") archiveCompletedGame(game);
      }
      if (parsed.setup && Array.isArray(parsed.setup.players)) {
        setupPlayers = normalizeSetupPlayers(parsed.setup.players);
        const requestedMixer = canonicalPlayerName(parsed.setup.startingMixerName ?? "");
        setupStartingMixerName = setupPlayers.includes(requestedMixer) ? requestedMixer : (setupPlayers[0] ?? null);
        persistSetup();
      }
    } else if (isGameShapeValid(parsed)) {
      if (parsed.status === "finished") {
        archiveCompletedGame(parsed);
      } else {
        if (game && !window.confirm("Die aktuelle Partie durch die Sicherung ersetzen?")) return;
        game = parsed;
        if (!Number.isInteger(game.startingDealerIndex)) game.startingDealerIndex = game.rounds[0]?.dealerIndex ?? 0;
        persistGame();
      }
    } else {
      throw new Error("Diese Datei enthält keine gültige Aufzug-Sicherung.");
    }
    closeDialog(menuDialog);
    closeDialog(statsDialog);
    render();
    showToast("Sicherung erfolgreich wiederhergestellt.");
  } catch (error) {
    showToast(error.message || "Sicherung konnte nicht gelesen werden.");
  } finally {
    importFile.value = "";
  }
}

function resetToSetup(prefill = true) {
  if (prefill && game) {
    setupPlayers = game.players.map((player) => player.name);
    setupStartingMixerName = game.players[game.startingDealerIndex ?? 0]?.name ?? setupPlayers[0] ?? null;
  }
  game = null;
  removeSavedGame();
  persistSetup();
  closeDialog(menuDialog);
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function requestNewGame() {
  if (game?.status === "active" && !window.confirm("Die laufende Partie wirklich beenden? Eine exportierte Sicherung bleibt erhalten.")) return;
  resetToSetup(true);
}

function lockApp() {
  try {
    sessionStorage.removeItem(ACCESS_SESSION_KEY);
  } catch {}
  appUnlocked = false;
  accessError = "";
  closeDialog(menuDialog);
  render();
}

function startRematch() {
  const names = game.players.map((player) => player.name);
  game = createGame(names, {
    gameId: gameId(),
    startingDealerIndex: game.startingDealerIndex ?? 0,
    profileIds: game.players.map((player) => player.profileId ?? normalizedProfileId(player.name)),
  });
  persistGame();
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
  showToast("Revanche ist bereit.");
}

async function copyResult() {
  const sorted = scoreboardForGame(game).sort((a, b) => b.score - a.score || a.seatIndex - b.seatIndex);
  const lines = ["Aufzug – Endstand", ...sorted.map((entry, index) => `${index + 1}. ${entry.name}: ${entry.score} Punkte`)];
  try {
    await navigator.clipboard.writeText(lines.join("\n"));
    showToast("Endstand wurde kopiert.");
  } catch {
    showToast("Kopieren wurde vom Browser verhindert.");
  }
}

document.addEventListener("submit", async (event) => {
  if (event.target.id === "access-code-form") {
    event.preventDefault();
    const submitButton = event.target.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    try {
      const digest = await digestAccessCode(event.target.elements.accessCode.value);
      if (digest !== ACCESS_CODE_DIGEST) {
        accessError = "Der eingegebene Code ist nicht richtig.";
        renderLock();
        return;
      }
      appUnlocked = true;
      accessError = "";
      try {
        sessionStorage.setItem(ACCESS_SESSION_KEY, ACCESS_CODE_DIGEST);
      } catch {}
      render();
      showToast(game?.status === "active" ? "Laufende Partie wurde fortgesetzt." : "App wurde geöffnet.");
    } catch {
      accessError = "Der Code konnte in diesem Browser nicht geprüft werden.";
      renderLock();
    }
    return;
  }

  if (event.target.id !== "add-player-form") return;
  event.preventDefault();
  const input = event.target.elements.playerName;
  if (addPlayer(input.value)) {
    requestAnimationFrame(() => document.querySelector("#player-name-input")?.focus());
  }
});

document.addEventListener("change", (event) => {
  if (event.target.id === "starting-mixer-select") {
    setupStartingMixerName = event.target.value;
    persistSetup();
    render();
    return;
  }
  const bidPlayerId = event.target.dataset.editBid;
  const trickPlayerId = event.target.dataset.editTrick;
  const penaltyPlayerId = event.target.dataset.editPenaltyPlayer;
  const penaltyType = event.target.dataset.editPenaltyType;
  if (bidPlayerId && editDraft) {
    editDraft.bids[bidPlayerId] = Number(event.target.value);
    renderRoundEditor();
  }
  if (trickPlayerId && editDraft) {
    editDraft.tricks[trickPlayerId] = Number(event.target.value);
    renderRoundEditor();
  }
  if (penaltyPlayerId && penaltyType && editDraft) {
    editDraft.penalties[penaltyPlayerId] ??= {};
    editDraft.penalties[penaltyPlayerId][penaltyType] = event.target.checked;
    renderRoundEditor();
  }
});

document.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;

  if (button.dataset.closeDialog) {
    closeDialog(document.querySelector(`#${button.dataset.closeDialog}`));
    return;
  }

  if (button.dataset.bidValue !== undefined && bidWizard) {
    const round = game.rounds[bidWizard.roundIndex];
    const order = biddingOrder(bidWizard.roundIndex);
    const player = game.players[order[bidWizard.step]];
    round.bids[player.id] = Number(button.dataset.bidValue);
    persistGame();
    renderBidWizard();
    return;
  }

  if (button.dataset.trickValue !== undefined && trickWizard) {
    const round = game.rounds[trickWizard.roundIndex];
    const order = biddingOrder(trickWizard.roundIndex);
    const player = game.players[order[trickWizard.step]];
    const orderedPlayerIds = order.map((playerIndex) => game.players[playerIndex].id);

    const autoFilled = new Set(trickWizard.autoFilledPlayerIds ?? []);
    for (const playerId of orderedPlayerIds.slice(trickWizard.step + 1)) {
      if (!autoFilled.has(playerId)) continue;
      delete round.tricks[playerId];
      autoFilled.delete(playerId);
    }
    autoFilled.delete(player.id);
    round.tricks[player.id] = Number(button.dataset.trickValue);

    const completed = autoFillRemainingTricks(round.tricks, orderedPlayerIds, trickWizard.step, round.cards);
    round.tricks = completed.tricks;
    for (const playerId of completed.filledPlayerIds) autoFilled.add(playerId);
    trickWizard.autoFilledPlayerIds = [...autoFilled];
    if (completed.filledPlayerIds.length) trickWizard.step = order.length - 1;

    persistGame();
    renderTrickWizard();
    return;
  }

  const action = button.dataset.action;
  const index = Number(button.dataset.index);

  switch (action) {
    case "toggle-fixed-player": {
      const name = button.dataset.name;
      const existingIndex = setupPlayers.indexOf(name);
      if (existingIndex >= 0) {
        if (setupStartingMixerName === name) setupStartingMixerName = null;
        setupPlayers.splice(existingIndex, 1);
        if (!setupStartingMixerName) setupStartingMixerName = setupPlayers[0] ?? null;
        persistSetup();
        render();
      } else {
        addPlayer(name);
      }
      break;
    }
    case "player-up":
      if (index > 0) [setupPlayers[index - 1], setupPlayers[index]] = [setupPlayers[index], setupPlayers[index - 1]];
      persistSetup();
      render();
      break;
    case "player-down":
      if (index < setupPlayers.length - 1) [setupPlayers[index], setupPlayers[index + 1]] = [setupPlayers[index + 1], setupPlayers[index]];
      persistSetup();
      render();
      break;
    case "player-remove":
      if (setupPlayers[index] === setupStartingMixerName) setupStartingMixerName = null;
      setupPlayers.splice(index, 1);
      if (!setupStartingMixerName) setupStartingMixerName = setupPlayers[0] ?? null;
      persistSetup();
      render();
      break;
    case "start-game":
      startGame();
      break;
    case "open-menu":
      openDialog(menuDialog);
      break;
    case "open-help":
      openDialog(helpDialog);
      break;
    case "open-stats":
      openStats();
      break;
    case "open-details":
      openDetailsDocument();
      break;
    case "close-details":
      closeDialog(detailsDialog);
      break;
    case "print-details":
      printDetailsDocument();
      break;
    case "close-stats":
      closeDialog(statsDialog);
      break;
    case "export-backup":
      exportGame();
      break;
    case "open-bids":
      openBidWizard();
      break;
    case "open-tricks":
      openTrickWizard();
      break;
    case "cancel-wizard":
      cancelActiveWizard();
      break;
    case "bid-back":
      if (bidWizard.step > 0) bidWizard.step -= 1;
      renderBidWizard();
      break;
    case "bid-next": {
      const round = game.rounds[bidWizard.roundIndex];
      const order = biddingOrder(bidWizard.roundIndex);
      if (bidWizard.step < order.length - 1) {
        bidWizard.step += 1;
        renderBidWizard();
      } else if (validateBids(round.bids, playerIds(), round.cards).valid) {
        round.phase = "playing";
        persistGame();
        bidWizard = null;
        closeDialog(wizardDialog);
        render();
        showToast("Ansagen gespeichert. Die Runde kann beginnen.");
      }
      break;
    }
    case "trick-back":
      if (trickWizard.step > 0) trickWizard.step -= 1;
      renderTrickWizard();
      break;
    case "trick-next": {
      const round = game.rounds[trickWizard.roundIndex];
      const order = biddingOrder(trickWizard.roundIndex);
      if (trickWizard.step < order.length - 1) {
        trickWizard.step += 1;
        renderTrickWizard();
      } else if (validateTricks(round.tricks, playerIds(), round.cards).valid) {
        round.phase = "result";
        persistGame();
        trickWizard = null;
        closeDialog(wizardDialog);
        render();
        showToast("Punkte wurden automatisch berechnet.");
      }
      break;
    }
    case "edit-current-result":
      openRoundEditor(game.currentRoundIndex);
      break;
    case "next-round":
      advanceRound();
      break;
    case "edit-round":
      openRoundEditor(index);
      break;
    case "close-editor":
      closeDialog(editDialog);
      editDraft = null;
      break;
    case "save-editor": {
      const round = game.rounds[editDraft.roundIndex];
      const bidsValid = validateBids(editDraft.bids, playerIds(), round.cards).valid;
      const tricksValid = validateTricks(editDraft.tricks, playerIds(), round.cards).valid;
      if (bidsValid && tricksValid) {
        round.bids = { ...editDraft.bids };
        round.tricks = { ...editDraft.tricks };
        round.penalties = clonePenalties(editDraft.penalties);
        persistGame();
        if (game.status === "finished") archiveCompletedGame(game);
        closeDialog(editDialog);
        editDraft = null;
        render();
        showToast("Runde und Gesamtstand wurden korrigiert.");
      }
      break;
    }
    case "rematch":
      startRematch();
      break;
    case "copy-result":
      copyResult();
      break;
    default:
      break;
  }
});

document.querySelector("#export-game-button").addEventListener("click", exportGame);
document.querySelector("#import-game-button").addEventListener("click", () => importFile.click());
document.querySelector("#stats-button").addEventListener("click", () => {
  closeDialog(menuDialog);
  openStats();
});
document.querySelector("#help-button").addEventListener("click", () => {
  closeDialog(menuDialog);
  openDialog(helpDialog);
});
document.querySelector("#new-game-button").addEventListener("click", requestNewGame);
document.querySelector("#lock-button").addEventListener("click", lockApp);
window.addEventListener("afterprint", () => document.body.classList.remove("printing-details"));
importFile.addEventListener("change", () => {
  const [file] = importFile.files;
  if (file) importGameFromFile(file);
});

wizardDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  cancelActiveWizard();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

render();
