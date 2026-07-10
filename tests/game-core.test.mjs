import test from "node:test";
import assert from "node:assert/strict";

import {
  autoFillRemainingTricks,
  biddingOrderForRound,
  buildRoundSchedule,
  createGame,
  maxCardsForPlayers,
  penaltyPointsForRound,
  pointsForRound,
  roundPoints,
  scoreboardForGame,
  validateBids,
  validateTricks,
  winnersForGame,
} from "../game-core.js";

test("maximale Kartenanzahl folgt Deckgröße und Hauslimit", () => {
  assert.equal(maxCardsForPlayers(3), 11);
  assert.equal(maxCardsForPlayers(5), 11);
  assert.equal(maxCardsForPlayers(6), 10);
  assert.equal(maxCardsForPlayers(7), 9);
  assert.equal(maxCardsForPlayers(10), 6);
});

test("Rundenfolge enthält den Höchstwert genau einmal", () => {
  assert.deepEqual(buildRoundSchedule(5), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  assert.deepEqual(buildRoundSchedule(6), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
});

test("Mischer rotiert und die Person danach beginnt die Ansage", () => {
  assert.deepEqual(biddingOrderForRound(0, 5), [1, 2, 3, 4, 0]);
  assert.deepEqual(biddingOrderForRound(1, 5), [2, 3, 4, 0, 1]);
  assert.deepEqual(biddingOrderForRound(0, 5, 2), [3, 4, 0, 1, 2]);
  assert.deepEqual(biddingOrderForRound(3, 5, 2), [1, 2, 3, 4, 0]);
});

test("Ansagensumme darf nicht der Anzahl möglicher Stiche entsprechen", () => {
  const ids = ["p1", "p2", "p3"];
  assert.deepEqual(validateBids({ p1: 0, p2: 1, p3: 1 }, ids, 2), { valid: false, reason: "equal", total: 2 });
  assert.equal(validateBids({ p1: 0, p2: 0, p3: 1 }, ids, 2).valid, true);
  assert.equal(validateBids({ p1: 1, p2: 1 }, ids, 2).reason, "missing");
});

test("Tatsächliche Ergebnisse müssen alle verfügbaren Stiche verteilen", () => {
  const ids = ["p1", "p2", "p3"];
  assert.equal(validateTricks({ p1: 0, p2: 1, p3: 1 }, ids, 2).valid, true);
  assert.deepEqual(validateTricks({ p1: 0, p2: 0, p3: 1 }, ids, 2), { valid: false, reason: "total", total: 1 });
  assert.deepEqual(validateTricks({ p1: 1, p2: 1, p3: 1 }, ids, 2), { valid: false, reason: "total", total: 3 });
  assert.equal(validateTricks({ p1: 0, p2: 0 }, ids, 2).reason, "missing");
});

test("Sind alle Stiche verteilt, werden offene Ergebnisse automatisch 0", () => {
  const ids = ["p1", "p2", "p3", "p4"];
  assert.deepEqual(autoFillRemainingTricks({ p1: 1, p2: 1 }, ids, 1, 2), {
    tricks: { p1: 1, p2: 1, p3: 0, p4: 0 },
    filledPlayerIds: ["p3", "p4"],
  });
  assert.deepEqual(autoFillRemainingTricks({ p1: 1 }, ids, 0, 2), {
    tricks: { p1: 1 },
    filledPlayerIds: [],
  });
});

test("Treffer und Abweichungen werden korrekt bepunktet", () => {
  assert.equal(pointsForRound(0, 0), 10);
  assert.equal(pointsForRound(1, 1), 12);
  assert.equal(pointsForRound(2, 2), 14);
  assert.equal(pointsForRound(11, 11), 32);
  assert.equal(pointsForRound(2, 1), -2);
  assert.equal(pointsForRound(3, 1), -4);
});

test("Strafen werden zusätzlich zu den Rundepunkten abgezogen", () => {
  const round = {
    bids: { p1: 1 },
    tricks: { p1: 1 },
    penalties: { p1: { notTrump: true, tooEarly: true } },
  };
  assert.equal(penaltyPointsForRound(round, "p1"), -22);
  assert.equal(roundPoints(round, "p1"), -10);
});

test("Gesamtstand und Gleichstand werden korrekt ermittelt", () => {
  const game = createGame(["Anna", "Ben", "Cem"], { gameId: "test", now: "2026-07-10T00:00:00.000Z" });
  game.rounds[0].bids = { p1: 0, p2: 0, p3: 1 };
  game.rounds[0].tricks = { p1: 0, p2: 1, p3: 0 };
  const scores = scoreboardForGame(game);
  assert.deepEqual(scores.map((entry) => entry.score), [10, -2, -2]);
  assert.deepEqual(winnersForGame(game).map((entry) => entry.name), ["Anna"]);
});

test("ausgewählter erster Mischer wird im Spiel gespeichert und rotiert", () => {
  const game = createGame(["Anna", "Ben", "Cem"], {
    gameId: "mischer-test",
    now: "2026-07-10T00:00:00.000Z",
    startingDealerIndex: 2,
  });
  assert.equal(game.startingDealerIndex, 2);
  assert.deepEqual(game.rounds.slice(0, 4).map((round) => round.dealerIndex), [2, 0, 1, 2]);
});

test("dauerhafte Spielerprofile werden in die Partie übernommen", () => {
  const game = createGame(["Beni", "Kevin", "Gast"], {
    gameId: "profile-test",
    profileIds: ["fixed:beni", "fixed:kevin", "guest:gast"],
  });
  assert.deepEqual(game.players.map((player) => player.profileId), ["fixed:beni", "fixed:kevin", "guest:gast"]);
});
