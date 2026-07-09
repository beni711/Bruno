import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  biddingOrderForRound,
  createGame,
  isGameShapeValid,
  maxCardsForPlayers,
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

const app = document.querySelector("#app");
const wizardDialog = document.querySelector("#wizard-dialog");
const wizardContent = document.querySelector("#wizard-content");
const editDialog = document.querySelector("#edit-dialog");
const editContent = document.querySelector("#edit-content");
const menuDialog = document.querySelector("#menu-dialog");
const helpDialog = document.querySelector("#help-dialog");
const importFile = document.querySelector("#import-file");
const toast = document.querySelector("#toast");

let game = loadSavedGame();
let setupPlayers = game ? [] : loadSetupPlayers();
let bidWizard = null;
let trickWizard = null;
let editDraft = null;
let toastTimer = null;

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

function loadSavedGame() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isGameShapeValid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function loadSetupPlayers() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETUP_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.map((name) => String(name)).filter(Boolean).slice(0, MAX_PLAYERS) : [];
  } catch {
    return [];
  }
}

function persistSetup() {
  localStorage.setItem(SETUP_KEY, JSON.stringify(setupPlayers));
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

function render() {
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
  const canStart = count >= MIN_PLAYERS && count <= MAX_PLAYERS;
  const peak = canStart ? maxCardsForPlayers(count) : null;
  const totalRounds = peak ? (peak * 2) - 1 : null;

  const playerRows = setupPlayers.map((name, index) => `
    <li class="player-row">
      <span class="player-number">${index + 1}</span>
      <span class="player-name">${escapeHtml(name)}</span>
      <span class="row-actions">
        <button class="mini-button" type="button" data-action="player-up" data-index="${index}" ${index === 0 ? "disabled" : ""} aria-label="${escapeHtml(name)} nach oben">↑</button>
        <button class="mini-button" type="button" data-action="player-down" data-index="${index}" ${index === count - 1 ? "disabled" : ""} aria-label="${escapeHtml(name)} nach unten">↓</button>
        <button class="mini-button" type="button" data-action="player-remove" data-index="${index}" aria-label="${escapeHtml(name)} entfernen">×</button>
      </span>
    </li>`).join("");

  app.innerHTML = `
    ${brandMarkup(false)}
    <main>
      <section class="setup-hero">
        <div class="elevator-art">hoch · runter</div>
        <h1>Euer Spielleiter für Aufzug.</h1>
        <p>Spieler eintragen, Stiche ansagen und Punkte automatisch zählen. Ohne Login, Werbung oder fremde Mitspieler.</p>
      </section>

      <section class="setup-panel">
        <div class="section-head">
          <div>
            <h2>Wer spielt mit?</h2>
            <p>${count} von maximal ${MAX_PLAYERS} Spielern</p>
          </div>
        </div>

        <form id="add-player-form" class="player-add-form" autocomplete="off">
          <label class="sr-only" for="player-name-input">Spielername</label>
          <input id="player-name-input" class="text-input" name="playerName" maxlength="24" placeholder="Name eingeben" ${count >= MAX_PLAYERS ? "disabled" : ""}>
          <button class="secondary-button" type="submit" ${count >= MAX_PLAYERS ? "disabled" : ""}>Hinzufügen</button>
        </form>

        ${count
          ? `<ol class="player-list">${playerRows}</ol>`
          : '<div class="empty-players">Noch keine Spieler eingetragen.</div>'}

        <div class="round-preview" aria-label="Spielübersicht">
          <div class="preview-stat"><strong>${count || "–"}</strong><span>Spieler</span></div>
          <div class="preview-stat"><strong>${peak ?? "–"}</strong><span>max. Karten</span></div>
          <div class="preview-stat"><strong>${totalRounds ?? "–"}</strong><span>Spielrunden</span></div>
        </div>

        <div class="setup-note">Die Reihenfolge ist die Sitzreihenfolge. Der erste Spieler ist zuerst Geber; danach wechselt der Geber jede Runde und sagt zuletzt an. Benötigt werden mindestens ${MIN_PLAYERS} Spieler.</div>
        <button class="primary-button full-width" type="button" data-action="start-game" ${canStart ? "" : "disabled"}>Partie starten</button>
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
  const order = biddingOrderForRound(game.currentRoundIndex, game.players.length);
  return order.map((playerIndex) => {
    const player = game.players[playerIndex];
    const bid = round.bids[player.id];
    const tricks = round.tricks[player.id];
    const isDealer = playerIndex === round.dealerIndex;

    if (round.phase === "result") {
      const points = roundPoints(round, player.id);
      const hit = bid === tricks;
      return `
        <li class="round-player">
          <span class="avatar">${escapeHtml(initials(player.name))}</span>
          <span class="round-player-main">
            <strong>${escapeHtml(player.name)}</strong>
            <small>Ansage ${bid} · gemacht ${tricks}${isDealer ? " · Geber" : ""}</small>
          </span>
          <span class="value-badge ${hit ? "hit" : "miss"}">${points > 0 ? `+${points}` : points}</span>
        </li>`;
    }

    return `
      <li class="round-player">
        <span class="avatar">${escapeHtml(initials(player.name))}</span>
        <span class="round-player-main">
          <strong>${escapeHtml(player.name)}</strong>
          <small>${isDealer ? "Geber · sagt zuletzt" : "Ansagereihenfolge"}</small>
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
      <button class="secondary-button" type="button" data-action="edit-current-result">Korrigieren</button>
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
    </section>`;
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

function renderGame() {
  const round = currentRound();
  const copy = phaseCopy(round);
  const progress = ((game.currentRoundIndex + (round.phase === "result" ? 1 : 0)) / game.rounds.length) * 100;
  const direction = game.currentRoundIndex < Math.floor(game.rounds.length / 2) ? "Aufwärts" : game.currentRoundIndex === Math.floor(game.rounds.length / 2) ? "Höchste Runde" : "Abwärts";
  const dealer = game.players[round.dealerIndex];
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
            <div class="instruction-chip">Geber: ${escapeHtml(dealer.name)}<span>sagt als Letztes an</span></div>
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
  const cleaned = String(name).trim();
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
    game = createGame(setupPlayers, { gameId: gameId() });
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
  const order = biddingOrderForRound(game.currentRoundIndex, game.players.length);
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
    const detail = type === "tricks" && Number.isInteger(value)
      ? `Ansage ${round.bids[player.id]} · ${value === round.bids[player.id] ? "richtig" : "daneben"}`
      : index === order.length - 1 ? "sagt zuletzt an" : "";
    return `
      <li class="${index === step ? "current" : ""}">
        <span>${escapeHtml(player.name)}${detail ? `<small> · ${detail}</small>` : ""}</span>
        <strong>${Number.isInteger(value) ? value : "–"}</strong>
      </li>`;
  }).join("");
}

function renderBidWizard() {
  const round = game.rounds[bidWizard.roundIndex];
  const order = biddingOrderForRound(bidWizard.roundIndex, game.players.length);
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
        <div class="bid-context"><span>${round.cards} ${pluralCards(round.cards)} auf der Hand</span><span>${playerIndex === round.dealerIndex ? "Geber · letzte Ansage" : `Geber: ${escapeHtml(game.players[round.dealerIndex].name)}`}</span></div>
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
  const order = biddingOrderForRound(game.currentRoundIndex, game.players.length);
  bidWizard = null;
  trickWizard = {
    roundIndex: game.currentRoundIndex,
    step: startAtBeginning ? 0 : firstMissingStep(round.tricks, order),
    restoreOnCancel: round.phase === "result",
    originalTricks: round.phase === "result" ? { ...round.tricks } : null,
  };
  renderTrickWizard();
  openDialog(wizardDialog);
}

function renderTrickWizard() {
  const round = game.rounds[trickWizard.roundIndex];
  const order = biddingOrderForRound(trickWizard.roundIndex, game.players.length);
  const playerIndex = order[trickWizard.step];
  const player = game.players[playerIndex];
  const selected = round.tricks[player.id];
  const isLast = trickWizard.step === order.length - 1;
  const othersTotal = playerIds().filter((id) => id !== player.id).reduce((sum, id) => sum + (Number.isInteger(round.tricks[id]) ? round.tricks[id] : 0), 0);
  const remaining = round.cards - othersTotal;
  const total = sumValues(round.tricks, playerIds());
  const validation = validateTricks(round.tricks, playerIds(), round.cards);
  const predictedPoints = Number.isInteger(selected) ? pointsForRound(round.bids[player.id], selected) : 0;
  const nextDisabled = !Number.isInteger(selected) || (isLast && !validation.valid);

  const numberButtons = Array.from({ length: round.cards + 1 }, (_, value) => {
    const exceedsTotal = !isLast && (othersTotal + value > round.cards);
    const notRemaining = isLast && value !== remaining;
    const disabled = exceedsTotal || notRemaining || remaining < 0;
    return `<button class="number-button ${selected === value ? "selected" : ""}" type="button" data-trick-value="${value}" ${disabled ? "disabled" : ""}>${value}</button>`;
  }).join("");

  const totalMessage = validation.valid
    ? '<div class="success-box">Alle Stiche sind vollständig verteilt.</div>'
    : total > round.cards
      ? `<div class="warning-box">Es sind ${total - round.cards} Stiche zu viel eingetragen.</div>`
      : `<div class="inline-notice">Noch ${round.cards - total} von ${round.cards} Stichen zu verteilen.</div>`;

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
          <div class="total-stat"><strong>${round.cards}</strong><span>Stiche vorhanden</span></div>
        </div>
        ${totalMessage}
        ${isLast && remaining >= 0 && remaining <= round.cards ? `<div class="inline-notice">Für ${escapeHtml(player.name)} bleiben automatisch <strong>${remaining}</strong> Stiche übrig.</div>` : ""}
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
  } else {
    game.currentRoundIndex += 1;
  }
  persistGame();
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

  const rows = game.players.map((player) => `
    <tr>
      <td><strong>${escapeHtml(player.name)}</strong></td>
      <td><select class="number-select" data-edit-bid="${player.id}" aria-label="Ansage von ${escapeHtml(player.name)}">${optionMarkup(round.cards, editDraft.bids[player.id])}</select></td>
      <td><select class="number-select" data-edit-trick="${player.id}" aria-label="Stiche von ${escapeHtml(player.name)}">${optionMarkup(round.cards, editDraft.tricks[player.id])}</select></td>
      <td><strong>${pointsForRound(editDraft.bids[player.id], editDraft.tricks[player.id])}</strong></td>
    </tr>`).join("");

  const issues = [
    !bidValidation.valid ? `Ansagen gesamt: ${bidValidation.total}. Die Summe darf nicht genau ${round.cards} sein.` : "",
    !trickValidation.valid ? `Gemachte Stiche: ${trickValidation.total}. Die Summe muss genau ${round.cards} sein.` : "",
  ].filter(Boolean).join(" ");

  editContent.innerHTML = `
    <div class="dialog-shell">
      <div class="dialog-head">
        <div><span class="eyebrow">Runde ${round.number}</span><h2 id="edit-title">Ergebnis korrigieren</h2></div>
        <button class="icon-button" type="button" data-action="close-editor" aria-label="Bearbeitung schließen">×</button>
      </div>
      <div class="dialog-content">
        <div class="bid-context"><span>${round.cards} ${pluralCards(round.cards)} je Spieler</span><span>Punkte werden neu berechnet</span></div>
        <div class="edit-table-wrap">
          <table class="edit-table">
            <thead><tr><th>Spieler</th><th>Ansage</th><th>Gemacht</th><th>Punkte</th></tr></thead>
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
  if (!game) return;
  const payload = JSON.stringify(game, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const date = new Date().toISOString().slice(0, 10);
  const link = document.createElement("a");
  link.href = url;
  link.download = `Aufzug-Partie_${date}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  closeDialog(menuDialog);
  showToast("Sicherung wurde erstellt.");
}

async function importGameFromFile(file) {
  try {
    const parsed = JSON.parse(await file.text());
    if (!isGameShapeValid(parsed)) throw new Error("Diese Datei enthält keine gültige Aufzug-Partie.");
    if (game && !window.confirm("Die aktuelle Partie durch die Sicherung ersetzen?")) return;
    game = parsed;
    persistGame();
    closeDialog(menuDialog);
    render();
    showToast("Partie erfolgreich wiederhergestellt.");
  } catch (error) {
    showToast(error.message || "Sicherung konnte nicht gelesen werden.");
  } finally {
    importFile.value = "";
  }
}

function resetToSetup(prefill = true) {
  if (prefill && game) setupPlayers = game.players.map((player) => player.name);
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

function startRematch() {
  const names = game.players.map((player) => player.name);
  game = createGame(names, { gameId: gameId() });
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

document.addEventListener("submit", (event) => {
  if (event.target.id !== "add-player-form") return;
  event.preventDefault();
  const input = event.target.elements.playerName;
  if (addPlayer(input.value)) {
    requestAnimationFrame(() => document.querySelector("#player-name-input")?.focus());
  }
});

document.addEventListener("change", (event) => {
  const bidPlayerId = event.target.dataset.editBid;
  const trickPlayerId = event.target.dataset.editTrick;
  if (bidPlayerId && editDraft) {
    editDraft.bids[bidPlayerId] = Number(event.target.value);
    renderRoundEditor();
  }
  if (trickPlayerId && editDraft) {
    editDraft.tricks[trickPlayerId] = Number(event.target.value);
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
    const order = biddingOrderForRound(bidWizard.roundIndex, game.players.length);
    const player = game.players[order[bidWizard.step]];
    round.bids[player.id] = Number(button.dataset.bidValue);
    persistGame();
    renderBidWizard();
    return;
  }

  if (button.dataset.trickValue !== undefined && trickWizard) {
    const round = game.rounds[trickWizard.roundIndex];
    const order = biddingOrderForRound(trickWizard.roundIndex, game.players.length);
    const player = game.players[order[trickWizard.step]];
    round.tricks[player.id] = Number(button.dataset.trickValue);
    persistGame();
    renderTrickWizard();
    return;
  }

  const action = button.dataset.action;
  const index = Number(button.dataset.index);

  switch (action) {
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
      setupPlayers.splice(index, 1);
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
      const order = biddingOrderForRound(bidWizard.roundIndex, game.players.length);
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
      const order = biddingOrderForRound(trickWizard.roundIndex, game.players.length);
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
      openTrickWizard(true);
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
        persistGame();
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
document.querySelector("#help-button").addEventListener("click", () => {
  closeDialog(menuDialog);
  openDialog(helpDialog);
});
document.querySelector("#new-game-button").addEventListener("click", requestNewGame);
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
