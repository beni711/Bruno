export const DECK_SIZE = 64;
export const MAX_HAND_CARDS = 11;
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 10;
export const SCHEMA_VERSION = 1;

export function maxCardsForPlayers(playerCount) {
  if (!Number.isInteger(playerCount) || playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new RangeError(`Es werden ${MIN_PLAYERS} bis ${MAX_PLAYERS} Spieler unterstützt.`);
  }

  // Eine Karte bleibt für den Aufdeckstapel übrig.
  return Math.min(MAX_HAND_CARDS, Math.floor((DECK_SIZE - 1) / playerCount));
}

export function buildRoundSchedule(playerCount) {
  const peak = maxCardsForPlayers(playerCount);
  const ascending = Array.from({ length: peak }, (_, index) => index + 1);
  const descending = Array.from({ length: peak - 1 }, (_, index) => peak - index - 1);
  return [...ascending, ...descending];
}

export function dealerForRound(roundIndex, playerCount, startingDealerIndex = 0) {
  if (!Number.isInteger(roundIndex) || roundIndex < 0) {
    throw new RangeError("Die Rundennummer muss positiv sein.");
  }
  if (!Number.isInteger(startingDealerIndex) || startingDealerIndex < 0 || startingDealerIndex >= playerCount) {
    throw new RangeError("Der erste Mischer ist ungültig.");
  }
  return (startingDealerIndex + roundIndex) % playerCount;
}

export function biddingOrderForRound(roundIndex, playerCount, startingDealerIndex = 0) {
  const dealerIndex = dealerForRound(roundIndex, playerCount, startingDealerIndex);
  return Array.from(
    { length: playerCount },
    (_, offset) => (dealerIndex + 1 + offset) % playerCount,
  );
}

export function pointsForRound(bid, tricks) {
  if (!Number.isInteger(bid) || !Number.isInteger(tricks) || bid < 0 || tricks < 0) {
    return 0;
  }
  return bid === tricks ? 10 + (2 * bid) : -2 * Math.abs(bid - tricks);
}

export function sumValues(values, playerIds) {
  return playerIds.reduce((sum, playerId) => {
    const value = values?.[playerId];
    return Number.isInteger(value) ? sum + value : sum;
  }, 0);
}

export function valuesAreComplete(values, playerIds, maxValue) {
  return playerIds.every((playerId) => {
    const value = values?.[playerId];
    return Number.isInteger(value) && value >= 0 && value <= maxValue;
  });
}

export function validateBids(bids, playerIds, cards) {
  if (!valuesAreComplete(bids, playerIds, cards)) {
    return { valid: false, reason: "missing", total: sumValues(bids, playerIds) };
  }

  const total = sumValues(bids, playerIds);
  if (total === cards) {
    return { valid: false, reason: "equal", total };
  }

  return { valid: true, reason: null, total };
}

export function validateTricks(tricks, playerIds, cards) {
  if (!valuesAreComplete(tricks, playerIds, cards)) {
    return { valid: false, reason: "missing", total: sumValues(tricks, playerIds) };
  }

  const total = sumValues(tricks, playerIds);
  return { valid: true, reason: null, total };
}

export function createGame(playerNames, options = {}) {
  const cleanedNames = playerNames.map((name) => String(name).trim()).filter(Boolean);
  if (cleanedNames.length < MIN_PLAYERS || cleanedNames.length > MAX_PLAYERS) {
    throw new RangeError(`Bitte ${MIN_PLAYERS} bis ${MAX_PLAYERS} Spieler eintragen.`);
  }

  const normalizedNames = cleanedNames.map((name) => name.toLocaleLowerCase("de-DE"));
  if (new Set(normalizedNames).size !== normalizedNames.length) {
    throw new Error("Jeder Spielername darf nur einmal vorkommen.");
  }

  const now = options.now ?? new Date().toISOString();
  const gameId = options.gameId ?? `aufzug-${Date.now().toString(36)}`;
  const profileIds = Array.isArray(options.profileIds) && options.profileIds.length === cleanedNames.length
    ? options.profileIds
    : cleanedNames.map((name) => `name:${name.toLocaleLowerCase("de-DE")}`);
  const players = cleanedNames.map((name, index) => ({
    id: `p${index + 1}`,
    profileId: String(profileIds[index]),
    name,
  }));
  const startingDealerIndex = options.startingDealerIndex ?? 0;
  if (!Number.isInteger(startingDealerIndex) || startingDealerIndex < 0 || startingDealerIndex >= players.length) {
    throw new RangeError("Bitte einen gültigen ersten Mischer auswählen.");
  }
  const schedule = buildRoundSchedule(players.length);

  return {
    schemaVersion: SCHEMA_VERSION,
    gameId,
    createdAt: now,
    updatedAt: now,
    status: "active",
    currentRoundIndex: 0,
    startingDealerIndex,
    players,
    rounds: schedule.map((cards, index) => ({
      number: index + 1,
      cards,
      dealerIndex: dealerForRound(index, players.length, startingDealerIndex),
      phase: "bidding",
      bids: {},
      tricks: {},
    })),
  };
}

export function roundPoints(round, playerId) {
  const bid = round?.bids?.[playerId];
  const tricks = round?.tricks?.[playerId];
  if (!Number.isInteger(bid) || !Number.isInteger(tricks)) {
    return 0;
  }
  return pointsForRound(bid, tricks);
}

export function scoreboardForGame(game) {
  return game.players.map((player, seatIndex) => {
    const score = game.rounds.reduce((sum, round) => sum + roundPoints(round, player.id), 0);
    const exactRounds = game.rounds.reduce((sum, round) => {
      const bid = round?.bids?.[player.id];
      const tricks = round?.tricks?.[player.id];
      return sum + (Number.isInteger(bid) && bid === tricks ? 1 : 0);
    }, 0);
    return { ...player, seatIndex, score, exactRounds };
  });
}

export function winnersForGame(game) {
  const scoreboard = scoreboardForGame(game);
  const bestScore = Math.max(...scoreboard.map((entry) => entry.score));
  return scoreboard.filter((entry) => entry.score === bestScore);
}

export function isGameShapeValid(game) {
  if (!game || game.schemaVersion !== SCHEMA_VERSION || !Array.isArray(game.players)) {
    return false;
  }
  if (game.players.length < MIN_PLAYERS || game.players.length > MAX_PLAYERS) {
    return false;
  }
  if (!Array.isArray(game.rounds) || game.rounds.length !== buildRoundSchedule(game.players.length).length) {
    return false;
  }
  return Number.isInteger(game.currentRoundIndex)
    && game.currentRoundIndex >= 0
    && game.currentRoundIndex < game.rounds.length;
}
