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

const STORAGE_KEY = "bruno.game.v1";
const SETUP_KEY = "bruno.setup.v1";
const ARCHIVE_KEY = "bruno.archive.v1";
const ACCESS_SESSION_KEY = "bruno.access.unlocked.v1";
const ACCESS_CODE_DIGEST = "5e92aa39e70cb2253bcd77f2b0000e9a764124460c48e8fffc7457f7d7b880d4";
const ACCESS_CODE_SALT = "bruno-shared-code-v1:";
const FIXED_PLAYERS = ["Beni", "Kevin", "Keven", "Tobi B.", "Tobi S.", "Max", "Michi"];
const LEGACY_STORAGE_KEYS = {
  game: "aufzug.game.v1",
  setup: "aufzug.setup.v1",
  archive: "aufzug.archive.v1",
  access: "aufzug.access.unlocked.v1",
};
const LEGACY_ACCESS_DIGEST = "35e52331b7fb9acc6006ffeb9f8226f8ed738c2b896032ab1a241da41694076e";
const LEGACY_PLAYER_NAMES = new Map([
  ["bp", "Beni"],
  ["mr", "Kevin"],
  ["ma", "Keven"],
  ["tb", "Tobi B."],
  ["ts", "Tobi S."],
  ["ks", "Max"],
  ["kk", "Michi"],
]);
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
  if (parts.length === 1) return parts[0].toLocaleUpperCase("de-DE");
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
    if (sessionStorage.getItem(ACCESS_SESSION_KEY) === ACCESS_CODE_DIGEST) return true;
    if (sessionStorage.getItem(LEGACY_STORAGE_KEYS.access) === LEGACY_ACCESS_DIGEST) {
      sessionStorage.setItem(ACCESS_SESSION_KEY, ACCESS_CODE_DIGEST);
      return true;
    }
    return false;
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
    const raw = localStorage.getItem(ARCHIVE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEYS.archive) ?? "[]";
    const parsed = JSON.parse(raw);
    const migrated = Array.isArray(parsed) ? parsed.map(migrateGameRoster) : [];
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify(migrated));
    return migrated.filter((entry) => isGameShapeValid(entry) && entry.status === "finished");
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
  const migrated = LEGACY_PLAYER_NAMES.get(cleaned.toLocaleLowerCase("de-DE")) ?? cleaned;
  return FIXED_PLAYERS.find((entry) => entry.toLocaleLowerCase("de-DE") === migrated.toLocaleLowerCase("de-DE")) ?? migrated;
}

function migrateGameRoster(savedGame) {
  if (!savedGame || !Array.isArray(savedGame.players)) return savedGame;
  for (const player of savedGame.players) {
    const migratedName = canonicalPlayerName(player.name);
    const oldProfileName = String(player.profileId ?? "").replace(/^fixed:/, "");
    const profileName = LEGACY_PLAYER_NAMES.get(oldProfileName.toLocaleLowerCase("de-DE"));
    player.name = migratedName;
    if (profileName) player.profileId = normalizedProfileId(profileName);
    else if (FIXED_PLAYERS.includes(migratedName)) player.profileId = normalizedProfileId(migratedName);
  }
  return savedGame;
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
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEYS.game);
    if (!raw) return null;
    const parsed = migrateGameRoster(JSON.parse(raw));
    if (isGameShapeValid(parsed) && !Number.isInteger(parsed.startingDealerIndex)) {
      parsed.startingDealerIndex = parsed.rounds[0]?.dealerIndex ?? 0;
    }
    if (isGameShapeValid(parsed)) localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    return isGameShapeValid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function loadSetupState() {
  try {
    const raw = localStorage.getItem(SETUP_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEYS.setup) ?? "[]";
    const parsed = JSON.parse(raw);
    const players = normalizeSetupPlayers(Array.isArray(parsed) ? parsed : parsed.players);
    const requestedMixer = Array.isArray(parsed) ? null : canonicalPlayerName(parsed.startingMixerName ?? "");
    const migrated = {
      players,
      startingMixerName: players.includes(requestedMixer) ? requestedMixer : (players[0] ?? null),
    };
    localStorage.setItem(SETUP_KEY, JSON.stringify(migrated));
    return migrated;
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
    return `bruno-${Array.from(values, (value) => value.toString(36)).join("")}`;
  }
  return `bruno-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
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
        <span>Bruno</span>
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
      <section class="setup-panel ${count >= 6 ? "many-players" : ""}">
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

function runningScoreAfterRound(roundIndex, playerId) {
  return game.rounds.slice(0, roundIndex + 1).reduce((sum, round) => sum + roundPoints(round, playerId), 0);
}

function penaltyEntriesForRound(round) {
  return game.players.flatMap((player) => {
    const penalties = round?.penalties?.[player.id] ?? {};
    return Object.entries(PENALTY_LABELS)
      .filter(([key]) => penalties[key])
      .map(([key]) => `${player.name} ${signedPoints(key === "notTrump" ? -20 : -2)}`);
  });
}

function detailPlayerCells(round, player) {
  const bid = round.bids?.[player.id];
  const tricks = round.tricks?.[player.id];
  if (!Number.isInteger(bid) || !Number.isInteger(tricks)) {
    return '<td class="detail-bid detail-empty">—</td><td class="detail-score">—</td>';
  }
  const roundIndex = game.rounds.indexOf(round);
  const hit = bid === tricks;
  return `
    <td class="detail-bid ${hit ? "detail-hit" : ""}">${bid}</td>
    <td class="detail-score">${runningScoreAfterRound(roundIndex, player.id)}</td>`;
}

function renderDetailsDocument() {
  const rounds = roundsForDetailDocument();
  const scoreboard = scoreboardForGame(game).sort((a, b) => a.seatIndex - b.seatIndex);
  const roundRows = rounds.map((round) => `
    <tr>
      <th scope="row">${round.cards}</th>
      ${game.players.map((player) => detailPlayerCells(round, player)).join("")}
      <td class="detail-penalties">${escapeHtml(penaltyEntriesForRound(round).join(" · "))}</td>
    </tr>`).join("");
  const totalCells = scoreboard.map((entry) => `<td class="detail-total" colspan="2">${entry.score}</td>`).join("");

  detailsContent.innerHTML = `
    <div class="dialog-shell detail-document player-count-${game.players.length}">
      <div class="dialog-head">
        <div><h2 id="details-title">Details</h2></div>
        <button class="icon-button" type="button" data-action="close-details" aria-label="Details schließen">×</button>
      </div>
      <div class="dialog-content">
        <div class="detail-table-wrap">
          <table class="detail-table">
            <thead><tr><th>Karte</th>${game.players.map((player) => `<th class="detail-player-head" colspan="2">${escapeHtml(initials(player.name))}</th>`).join("")}<th>Strafen</th></tr></thead>
            <tbody>${roundRows}</tbody>
            <tfoot><tr><th>Gesamt</th>${totalCells}<td></td></tr></tfoot>
          </table>
        </div>
      </div>
      <div class="dialog-footer detail-actions">
        <button class="secondary-button" type="button" data-action="open-pdf">PDF öffnen</button>
        <button class="primary-button" type="button" data-action="close-details">Schließen</button>
      </div>
    </div>`;
}

function openDetailsDocument() {
  renderDetailsDocument();
  openDialog(detailsDialog);
}

function pdfSafeText(value) {
  return String(value)
    .replaceAll("ß", "ss")
    .replaceAll("Ä", "Ae")
    .replaceAll("Ö", "Oe")
    .replaceAll("Ü", "Ue")
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue")
    .replaceAll("−", "-")
    .replaceAll("·", " | ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/([\\()])/g, "\\$1");
}

function pdfTruncate(value, maxLength) {
  const text = pdfSafeText(value);
  return text.length > maxLength ? `${text.slice(0, Math.max(1, maxLength - 1))}.` : text;
}

function buildLegacyGamePdf() {
  const pageWidth = 842;
  const pageHeight = 595;
  const margin = 26;
  const firstColumn = 66;
  const rounds = roundsForDetailDocument();
  const scores = scoreboardForGame(game).sort((a, b) => a.seatIndex - b.seatIndex);
  const playerColumn = (pageWidth - (margin * 2) - firstColumn) / game.players.length;
  const playerFontSize = game.players.length >= 8 ? 5.4 : game.players.length >= 6 ? 5.9 : 6.5;
  const rows = [
    ...rounds.map((round) => ({ type: "round", round })),
    { type: "total" },
  ];
  const tableTop = 538;
  const tableHeaderHeight = 16;
  const rowHeight = Math.max(18, Math.min(28, Math.floor((tableTop - 26 - tableHeaderHeight) / rows.length)));
  const pageRows = [rows];
  const text = (commands, value, x, y, size) => {
    commands.push(`BT /F1 ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${pdfSafeText(value)}) Tj ET`);
  };
  const line = (commands, x1, y1, x2, y2) => commands.push(`${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
  const cellLines = (round, player) => {
    const bid = round.bids?.[player.id];
    const tricks = round.tricks?.[player.id];
    if (!Number.isInteger(bid) || !Number.isInteger(tricks)) return ["offen"];
    const penalties = round.penalties?.[player.id] ?? {};
    const penaltyLine = [penalties.notTrump ? "-20 T" : "", penalties.tooEarly ? "-2 F" : ""].filter(Boolean).join(" ");
    return [
      `P ${signedPoints(roundPoints(round, player.id))} | A ${bid}`,
      `G ${tricks}${penaltyLine ? ` | ${penaltyLine}` : ""}`,
    ].filter(Boolean);
  };
  const pageStreams = pageRows.map((pageRowsForDocument, pageIndex) => {
    const commands = ["1 g", `0 0 ${pageWidth} ${pageHeight} re f`, "0 g", "0.18 w", "0.12 0.23 0.20 RG"];
    const date = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(game.createdAt));
    text(commands, "Bruno - Spielprotokoll", margin, pageHeight - 28, 13);
    text(commands, pdfTruncate(`Beginn: ${date} | Spieler: ${game.players.map((player) => player.name).join(", ")}`, 160), margin, pageHeight - 41, 7);
    text(commands, "DIN A4 quer - Punkte | Ansage | gemacht | Strafen", pageWidth - margin - 204, pageHeight - 28, 7);

    const top = tableTop;
    commands.push("0.92 g");
    commands.push(`${margin} ${top - tableHeaderHeight} ${pageWidth - (margin * 2)} ${tableHeaderHeight} re f`);
    commands.push("0 g", "0.12 0.23 0.20 RG");
    text(commands, "Karte", margin + 3, top - 11, 7);
    game.players.forEach((player, index) => {
      const x = margin + firstColumn + (index * playerColumn);
      text(commands, pdfTruncate(player.name, Math.max(4, Math.floor(playerColumn / 4.8))), x + 3, top - 11, 7);
    });
    line(commands, margin, top, pageWidth - margin, top);
    line(commands, margin, top - tableHeaderHeight, pageWidth - margin, top - tableHeaderHeight);
    line(commands, margin + firstColumn, top, margin + firstColumn, top - tableHeaderHeight - (pageRowsForDocument.length * rowHeight));
    game.players.forEach((_, index) => {
      const x = margin + firstColumn + ((index + 1) * playerColumn);
      line(commands, x, top, x, top - tableHeaderHeight - (pageRowsForDocument.length * rowHeight));
    });

    let y = top - tableHeaderHeight;
    pageRowsForDocument.forEach((entry) => {
      const isTotal = entry.type === "total";
      if (isTotal) commands.push("0.94 g", `${margin} ${y - rowHeight} ${pageWidth - (margin * 2)} ${rowHeight} re f`, "0 g");
      const rowLabel = isTotal ? "Gesamt" : `Karte ${entry.round.cards}`;
      const subLabel = isTotal ? "Endstand" : `Runde ${entry.round.number}`;
      text(commands, rowLabel, margin + 3, y - Math.min(9, rowHeight * 0.45), 6.8);
      text(commands, subLabel, margin + 3, y - Math.min(17, rowHeight * 0.82), 5.4);
      game.players.forEach((player, index) => {
        const x = margin + firstColumn + (index * playerColumn);
        const lines = isTotal
          ? [`P ${signedPoints(scores[index].score)}`, `${scores[index].exactRounds} Treffer`]
          : cellLines(entry.round, player);
        lines.slice(0, 2).forEach((value, lineIndex) => text(commands, pdfTruncate(value, Math.max(5, Math.floor((playerColumn - 6) / (playerFontSize * 0.52)))), x + 3, y - Math.min(9, rowHeight * 0.45) - (lineIndex * Math.min(9, rowHeight * 0.4)), playerFontSize));
      });
      line(commands, margin, y - rowHeight, pageWidth - margin, y - rowHeight);
      y -= rowHeight;
    });
    return commands.join("\n");
  });

  const pageCount = pageStreams.length;
  const fontId = 3 + (pageCount * 2);
  const objects = new Array(fontId + 1);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageStreams.map((_, index) => `${3 + (index * 2)} 0 R`).join(" ")}] /Count ${pageCount} >>`;
  pageStreams.forEach((stream, index) => {
    const pageId = 3 + (index * 2);
    const contentId = pageId + 1;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}\nendstream`;
  });
  objects[fontId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 1; index < objects.length; index += 1) {
    offsets[index] = new TextEncoder().encode(pdf).length;
    pdf += `${index} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = new TextEncoder().encode(pdf).length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new Blob([pdf], { type: "application/pdf" });
}

function buildGamePdf() {
  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 20;
  const cardWidth = 24;
  const penaltyWidth = 92;
  const pairedColumns = game.players.length <= 7;
  const bidWidth = pairedColumns ? 16 : 36;
  const scoreWidth = pairedColumns ? 27 : 0;
  const playerWidth = bidWidth + scoreWidth;
  const rounds = roundsForDetailDocument();
  const scores = scoreboardForGame(game).sort((a, b) => a.seatIndex - b.seatIndex);
  const paymentByPlayerId = new Map(scores.map((entry) => [
    entry.id,
    scores.filter((other) => other.score > entry.score).length * 5,
  ]));
  const totalPayments = [...paymentByPlayerId.values()].reduce((sum, value) => sum + value, 0);
  const averagePayment = totalPayments / game.players.length;
  const activeFixedPlayers = new Set(game.players
    .map((player) => canonicalPlayerName(player.name))
    .filter((name) => FIXED_PLAYERS.includes(name)));
  const absentFixedPlayers = FIXED_PLAYERS.filter((name) => !activeFixedPlayers.has(name));
  const euroText = (value) => `${Number.isInteger(value) ? value : value.toFixed(2).replace(".", ",")} EUR`;
  const rows = [
    ...rounds.map((round) => ({ type: "round", round })),
    { type: "total" },
    { type: "payment" },
  ];
  const top = 822;
  const headerHeight = 16;
  const footerSpace = absentFixedPlayers.length ? 22 : 8;
  const rowHeight = Math.max(18, Math.min(34, Math.floor((top - 22 - footerSpace - headerHeight) / rows.length)));
  const valueFont = pairedColumns ? 5.6 : 4.9;
  const commands = ["1 g", `0 0 ${pageWidth} ${pageHeight} re f`, "0 g", "0.16 w", "0.12 0.23 0.20 RG"];
  const text = (value, x, y, size) => commands.push(`BT /F1 ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${pdfSafeText(value)}) Tj ET`);
  const centeredText = (value, x, width, y, size) => {
    const estimatedWidth = pdfSafeText(value).length * size * 0.52;
    text(value, x + Math.max(2, (width - estimatedWidth) / 2), y, size);
  };
  const line = (x1, y1, x2, y2) => commands.push(`${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
  const crown = (centerX, baseY) => commands.push(
    "0.82 0.57 0.08 rg",
    `${(centerX - 6).toFixed(2)} ${baseY.toFixed(2)} m ${(centerX - 6).toFixed(2)} ${(baseY + 5).toFixed(2)} l ${(centerX - 2).toFixed(2)} ${(baseY + 2).toFixed(2)} l ${centerX.toFixed(2)} ${(baseY + 7).toFixed(2)} l ${(centerX + 2).toFixed(2)} ${(baseY + 2).toFixed(2)} l ${(centerX + 6).toFixed(2)} ${(baseY + 5).toFixed(2)} l ${(centerX + 6).toFixed(2)} ${baseY.toFixed(2)} l h f`,
    `${(centerX - 6).toFixed(2)} ${(baseY - 1.2).toFixed(2)} 12 1.2 re f`,
    "0 g",
  );
  const tableBottom = top - headerHeight - (rows.length * rowHeight);
  const playerStart = margin + cardWidth;
  const playerEnd = playerStart + (game.players.length * playerWidth);
  const penaltiesStart = playerEnd;

  commands.push(
    "0.92 g",
    `${margin} ${top - headerHeight} ${playerEnd - margin} ${headerHeight} re f`,
    `${penaltiesStart} ${top - headerHeight} ${penaltyWidth} ${headerHeight} re f`,
    "0 g",
  );
  centeredText("Karte", margin, cardWidth, top - 11, 7);
  game.players.forEach((player, index) => {
    const x = playerStart + (index * playerWidth);
    centeredText(initials(player.name), x, playerWidth, top - 11, 6.4);
  });
  centeredText("Strafen", penaltiesStart, penaltyWidth, top - 11, 7);
  line(margin, top, playerEnd, top);
  line(penaltiesStart, top, pageWidth - margin, top);
  line(margin, top - headerHeight, playerEnd, top - headerHeight);
  line(penaltiesStart, top - headerHeight, pageWidth - margin, top - headerHeight);
  line(margin, top, margin, tableBottom);
  line(playerStart, top, playerStart, tableBottom);
  for (let index = 1; index <= game.players.length; index += 1) {
    const x = playerStart + (index * playerWidth);
    if (pairedColumns) line(x - scoreWidth, top - headerHeight, x - scoreWidth, tableBottom);
    line(x, top, x, tableBottom);
  }
  line(penaltiesStart, top, penaltiesStart, tableBottom);
  line(pageWidth - margin, top, pageWidth - margin, tableBottom);

  let y = top - headerHeight;
  rows.forEach((entry) => {
    const total = entry.type === "total";
    const payment = entry.type === "payment";
    if (total || payment) commands.push(
      payment ? "0.97 0.93 0.81 rg" : "0.94 g",
      `${margin} ${y - rowHeight} ${playerEnd - margin} ${rowHeight} re f`,
      `${penaltiesStart} ${y - rowHeight} ${penaltyWidth} ${rowHeight} re f`,
      "0 g",
    );
    if (total) {
      centeredText("Gesamt", margin, cardWidth, y - (rowHeight * 0.62), 6.6);
    } else if (payment) {
      centeredText("EUR", margin, cardWidth, y - (rowHeight * 0.62), 6.2);
    } else {
      centeredText(String(entry.round.cards), margin, cardWidth, y - (rowHeight * 0.62), 7);
    }

    game.players.forEach((player, index) => {
      const playerX = playerStart + (index * playerWidth);
      if (total) {
        const totalText = String(scores[index].score);
        centeredText(totalText, playerX, playerWidth, y - (rowHeight * 0.62), valueFont + 0.5);
        return;
      }
      if (payment) {
        const amount = paymentByPlayerId.get(player.id);
        if (amount === 0) {
          crown(playerX + (playerWidth / 2), y - (rowHeight * 0.58));
        } else {
          centeredText(euroText(amount), playerX, playerWidth, y - (rowHeight * 0.62), 4.8);
        }
        return;
      }
      const bid = entry.round.bids?.[player.id];
      const tricks = entry.round.tricks?.[player.id];
      const runningScore = runningScoreAfterRound(game.rounds.indexOf(entry.round), player.id);
      const hit = Number.isInteger(bid) && bid === tricks;
      if (pairedColumns) {
        if (hit) commands.push("0.85 0.94 0.89 rg", `${playerX + 1} ${y - rowHeight + 1} ${bidWidth - 2} ${rowHeight - 2} re f`, "0 g");
        centeredText(Number.isInteger(bid) ? String(bid) : "-", playerX, bidWidth, y - (rowHeight * 0.62), valueFont + 0.5);
        centeredText(String(runningScore), playerX + bidWidth, scoreWidth, y - (rowHeight * 0.62), valueFont + 0.5);
      } else {
        if (hit) commands.push("0.85 0.94 0.89 rg", `${playerX + 1} ${y - rowHeight + 1} ${playerWidth - 2} ${rowHeight - 2} re f`, "0 g");
        centeredText(`${Number.isInteger(bid) ? bid : "-"}/${runningScore}`, playerX, playerWidth, y - (rowHeight * 0.62), valueFont);
      }
    });
    if (!total && !payment) {
      const penaltyText = penaltyEntriesForRound(entry.round).join(" | ");
      text(pdfTruncate(penaltyText, Math.max(5, Math.floor(penaltyWidth / 4.2))), penaltiesStart + 3, y - (rowHeight * 0.62), 5.4);
    }
    line(margin, y - rowHeight, playerEnd, y - rowHeight);
    line(penaltiesStart, y - rowHeight, pageWidth - margin, y - rowHeight);
    y -= rowHeight;
  });

  if (absentFixedPlayers.length) {
    const absentPayments = absentFixedPlayers.map((name) => `${name} ${euroText(averagePayment)}`).join(" | ");
    text(pdfTruncate(`Nicht dabei: ${absentPayments} | Durchschnitt ${euroText(averagePayment)}`, 150), margin + 2, tableBottom - 14, 5.8);
  }

  const stream = commands.join("\n");
  const objects = [
    null,
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 1; index < objects.length; index += 1) {
    offsets[index] = new TextEncoder().encode(pdf).length;
    pdf += `${index} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = new TextEncoder().encode(pdf).length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new Blob([pdf], { type: "application/pdf" });
}

function openGamePdf() {
  const blob = buildGamePdf();
  const url = URL.createObjectURL(blob);
  const opened = window.open(url, "_blank");
  if (!opened) {
    const link = document.createElement("a");
    link.href = url;
    link.download = `Bruno-Spielprotokoll_${new Date().toISOString().slice(0, 10)}.pdf`;
    document.body.append(link);
    link.click();
    link.remove();
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
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
    type: "bruno-full-backup",
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
  link.download = `Bruno-Gesamtsicherung_${date}.json`;
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
    const migratedStandalone = migrateGameRoster(parsed);
    if (parsed?.type === "bruno-full-backup" || parsed?.type === "aufzug-full-backup") {
      const incomingActive = migrateGameRoster(parsed.activeGame);
      const incomingArchive = Array.isArray(parsed.archivedGames) ? parsed.archivedGames.map(migrateGameRoster) : [];
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
    } else if (isGameShapeValid(migratedStandalone)) {
      if (migratedStandalone.status === "finished") {
        archiveCompletedGame(migratedStandalone);
      } else {
        if (game && !window.confirm("Die aktuelle Partie durch die Sicherung ersetzen?")) return;
        game = migratedStandalone;
        if (!Number.isInteger(game.startingDealerIndex)) game.startingDealerIndex = game.rounds[0]?.dealerIndex ?? 0;
        persistGame();
      }
    } else {
      throw new Error("Diese Datei enthält keine gültige Bruno-Sicherung.");
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
    sessionStorage.removeItem(LEGACY_STORAGE_KEYS.access);
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
  const lines = ["Bruno – Endstand", ...sorted.map((entry, index) => `${index + 1}. ${entry.name}: ${entry.score} Punkte`)];
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
    case "open-pdf":
      openGamePdf();
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
importFile.addEventListener("change", () => {
  const [file] = importFile.files;
  if (file) importGameFromFile(file);
});

wizardDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  cancelActiveWizard();
});

if ("serviceWorker" in navigator) {
  let refreshingForUpdate = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshingForUpdate) return;
    refreshingForUpdate = true;
    window.location.reload();
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js")
      .then((registration) => registration.update())
      .catch(() => {});
  });
}

render();
