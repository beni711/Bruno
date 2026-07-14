import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");

test("Ansagen werden dauerhaft in der Rundenseite statt in einem Popup angezeigt", () => {
  assert.match(appSource, /function renderInlineBidPanel\(round\)/);
  assert.match(appSource, /round\.phase === "bidding"\s*\? renderInlineBidPanel\(round\)/);
  assert.doesNotMatch(appSource, /data-action="open-bids"/);
  assert.doesNotMatch(appSource, /function openBidWizard\(/);
  assert.match(styles, /\.inline-bid-panel\s*\{/);
});

test("Dauerhafte Ansage zeigt Stichsumme, offene Spieler und den gesperrten Wert", () => {
  assert.match(appSource, /Stiche angesagt/);
  assert.match(appSource, /Stiche möglich/);
  assert.match(appSource, /Spieler offen/);
  assert.match(appSource, /ist <strong>\$\{forbidden\}<\/strong> gesperrt/);
});

test("Ein Zahlentipp bestätigt die Ansage zwei Sekunden und wechselt automatisch weiter", () => {
  assert.match(appSource, /const BID_CONFIRMATION_DURATION = 2000/);
  assert.match(appSource, /function showBidConfirmation\(/);
  assert.match(appSource, /showBidConfirmation\(player\.name, value, isLast/);
  assert.match(appSource, /bidWizard\.step \+= 1/);
  assert.doesNotMatch(appSource, /data-action="bid-next"/);
  assert.match(styles, /\.bid-confirmation-card\s*\{/);
  assert.match(appSource, /const confirmationGameId = game\.gameId/);
  assert.match(appSource, /if \(lastBidIsValid\) round\.phase = "playing"/);
  assert.match(appSource, /game\.gameId !== confirmationGameId/);
  assert.match(appSource, /if \(onlineDialogsAreOpen\(\)\) return;/);
  assert.match(appSource, /window\.setTimeout\(\(\) => refreshOnlineSession\(\), BID_CONFIRMATION_DURATION \+ 200\)/);
});
