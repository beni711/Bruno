import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

test("Ansagen werden dauerhaft in der Rundenseite statt in einem Popup angezeigt", () => {
  assert.match(appSource, /function renderInlineBidPanel\(round\)/);
  assert.match(appSource, /round\.phase === "bidding"\s*\? renderInlineBidPanel\(round\)/);
  assert.doesNotMatch(appSource, /data-action="open-bids"/);
  assert.doesNotMatch(appSource, /function openBidWizard\(/);
  assert.match(styles, /\.inline-bid-panel\s*\{/);
});

test("Ansage und Auswertung zeigen Spielerwerte statt großer Summenfelder", () => {
  assert.doesNotMatch(appSource, /Stiche angesagt|Stiche möglich|Spieler offen/);
  assert.match(appSource, /class="value-badge bid-value-square/);
  assert.match(appSource, /const bidSquare = `<span class="bid-value-square/);
  assert.match(appSource, /<span class="made-value">gemacht/);
  assert.match(styles, /\.bid-value-square\s*\{/);
  assert.match(appSource, /ist <strong>\$\{forbidden\}<\/strong> gesperrt/);
});

test("Ein Zahlentipp bestätigt die Ansage 1,3 Sekunden und wechselt automatisch weiter", () => {
  assert.match(appSource, /const BID_CONFIRMATION_DURATION = 1300/);
  assert.match(appSource, /function showBidConfirmation\(/);
  assert.match(appSource, /showBidConfirmation\(player\.name, value, \(\) =>/);
  assert.match(appSource, /bidWizard\.step \+= 1/);
  assert.doesNotMatch(appSource, /data-action="bid-next"/);
  assert.match(styles, /\.bid-confirmation-card\s*\{/);
  assert.match(appSource, /const confirmationGameId = game\.gameId/);
  assert.match(appSource, /if \(lastBidIsValid\) round\.phase = "playing"/);
  assert.match(appSource, /game\.gameId !== confirmationGameId/);
  assert.match(appSource, /if \(onlineDialogsAreOpen\(\)\) return;/);
  assert.match(appSource, /window\.setTimeout\(\(\) => refreshOnlineSession\(\), BID_CONFIRMATION_DURATION \+ 200\)/);
  assert.doesNotMatch(appSource, /Ansage gespeichert|Nächster Spieler kommt gleich|Die Runde kann gleich beginnen/);
  assert.doesNotMatch(styles, /\.bid-confirmation-label|\.bid-confirmation-card small/);
});

test("Die Auswertung steht dauerhaft in der Rundenseite und öffnet kein Popup", () => {
  assert.match(appSource, /function renderInlineTrickPanel\(round\)/);
  assert.match(appSource, /round\.phase === "playing" && trickWizard\?\.gameId === game\.gameId/);
  assert.match(appSource, /data-action="back-to-bids"/);
  assert.match(appSource, /data-action="start-tricks"/);
  assert.match(appSource, /case "start-tricks"/);
  assert.match(appSource, /Auswertung fortsetzen/);
  assert.match(appSource, /Die Auswertung wurde bereits begonnen/);
  assert.doesNotMatch(appSource, /round\.tricks = \{\}/);
  assert.equal(appSource.match(/showBidConfirmation\(player\.name, value, \(\) =>/g)?.length, 1);
  assert.doesNotMatch(appSource, /data-action="open-tricks"|data-action="trick-next"|case "trick-next"/);
  assert.doesNotMatch(appSource, /wizardDialog|wizardContent|openTrickWizard|renderTrickWizard|cancelActiveWizard/);
  assert.doesNotMatch(html, /id="wizard-dialog"|id="wizard-content"/);
  assert.match(appSource, /if \(resultIsComplete\) round\.phase = "result"/);
  assert.match(appSource, /trickWizard\.step = Math\.min\(step \+ 1, order\.length - 1\)/);
  assert.match(appSource, /isLast && value !== maxAllowed/);
  assert.match(appSource, /autoFillRemainingTricks\(round\.tricks, orderedPlayerIds, trickWizard\.step - 1, round\.cards\)/);
  assert.match(appSource, /trickWizard\.step = Math\.min\(step \+ 1, order\.length - 1\);\s*render\(\)/);
});

test("Der erste Ansager wird bei einem lokalen Rundenstart dreimal vorgelesen", () => {
  assert.match(appSource, /function announceCurrentBidder\(\)/);
  assert.match(appSource, /\[spokenName, spokenName, spokenName\]\.join\("\. "\)/);
  assert.match(appSource, /=== "kevin" \? "Migräne" : cleaned/);
  assert.match(appSource, /utterance\.lang = "de-DE"/);
  assert.match(appSource, /window\.speechSynthesis\.speak\(utterance\)/);
  assert.equal(appSource.match(/announceCurrentBidder\(\);/g)?.length, 3);
});

test("Nach der Spielerauswahl werden nur mögliche höchste Kartenrunden angeboten", () => {
  assert.match(appSource, /id="max-round-select"/);
  assert.match(appSource, /Bis zu welcher Runde spielen\?/);
  assert.match(appSource, /const allowedMaximumCards = canStart \? maxCardsForPlayers\(count\) : 11/);
  assert.match(appSource, /Bis Runde \$\{cards\}/);
  assert.match(appSource, /Ablauf: 1 bis \$\{selectedMaxCards\}, danach/);
  assert.match(appSource, /Nur mit \$\{count\} Spielern mögliche Werte werden angeboten/);
  assert.match(appSource, /event\.target\.id === "max-round-select"/);
  assert.match(appSource, /maxCards: setupMaxCards/);
  assert.match(appSource, /const selectedMaxCards = effectiveSetupMaxCards\(\)/);
  assert.match(appSource, /const selectedRoundCount = selectedMaxCards \* 2 - 1/);
  assert.match(appSource, /maxCards: selectedMaxCards/);
  assert.match(appSource, /game\.rounds\.length !== selectedRoundCount/);
  assert.match(appSource, /Partie bis Runde \$\{selectedMaxCards\} gestartet/);
  assert.doesNotMatch(appSource, /round-count-select|setupRoundCount|active-max-cards-select|changeActiveMaxCards|Höchste Kartenrunde/);
});

test("Versionierte App-Dateien verhindern gemischte alte und neue Spielplanlogik", () => {
  assert.match(appSource, /from "\.\/game-core\.js\?v=1\.8\.1"/);
  assert.match(html, /styles\.css\?v=1\.8\.1/);
  assert.match(html, /app\.js\?v=1\.8\.1/);
});
