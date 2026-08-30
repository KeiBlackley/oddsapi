// --- Upcoming/recent results rendering and prediction model ---
function escapeHtml(value) {
	return String(value)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/\"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function clampNumber(value, min, max) {
	if (!Number.isFinite(value)) {
		return min;
	}
	return Math.min(Math.max(value, min), max);
}

function formatDateTime(value) {
	const date = new Date(value);
	if (!Number.isFinite(date.getTime())) {
		return String(value || "");
	}
	const day = String(date.getDate()).padStart(2, '0');
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const year = date.getFullYear();
	const hours = String(date.getHours()).padStart(2, '0');
	const minutes = String(date.getMinutes()).padStart(2, '0');
	return `${day}/${month}/${year} ${hours}:${minutes}`;
}

const SPORTSBOOK_KEY = "sportsbet";
const HISTORY_LOOKBACK_DAYS = 365;
const RECENT_RESULTS_LOOKBACK_DAYS = 2;
const ROLLING_HISTORY_MAX_ROWS = 900;
const ROLLING_HISTORY_MAX_AGE_DAYS = 365;
const PREGAME_PREDICTION_STORE_KEY = "keieye_pregame_predictions_v1";
const PREGAME_PREDICTION_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

function clonePredictionPayload(prediction) {
	if (!prediction || typeof prediction !== 'object') {
		return null;
	}
	const copied = { ...prediction };
	if (Array.isArray(prediction.topBets)) {
		copied.topBets = prediction.topBets.map((item) => ({ ...item }));
	}
	return copied;
}

function getPregamePredictionEntryKey(eventRow, sportKey = "") {
	if (!eventRow || typeof eventRow !== 'object') {
		return "";
	}
	const eventId = eventRow && eventRow.id ? String(eventRow.id).trim() : "";
	const sport = String(sportKey || eventRow.sport_key || "").trim().toLowerCase();
	if (eventId) {
		return "id:" + (sport ? sport + ":" : "") + eventId;
	}
	const home = normalizeTeamName(eventRow && eventRow.home_team ? eventRow.home_team : "");
	const away = normalizeTeamName(eventRow && eventRow.away_team ? eventRow.away_team : "");
	const commence = eventRow && eventRow.commence_time ? String(eventRow.commence_time).trim() : "";
	if (!home && !away && !commence) {
		return "";
	}
	return "fallback:" + (sport ? sport + ":" : "") + home + "|" + away + "|" + commence;
}

function readPregamePredictionStore() {
	try {
		const raw = localStorage.getItem(PREGAME_PREDICTION_STORE_KEY);
		if (!raw) {
			return {};
		}
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}

function writePregamePredictionStore(store) {
	if (!store || typeof store !== 'object') {
		return;
	}
	const now = Date.now();
	for (const [key, entry] of Object.entries(store)) {
		if (!entry || typeof entry !== 'object') {
			delete store[key];
			continue;
		}
		const commenceTimeMs = Number(entry.commenceTimeMs);
		if (Number.isFinite(commenceTimeMs) && (now - commenceTimeMs) > PREGAME_PREDICTION_RETENTION_MS) {
			delete store[key];
		}
	}
	try {
		localStorage.setItem(PREGAME_PREDICTION_STORE_KEY, JSON.stringify(store));
	} catch {
		// Ignore local storage write failures for prediction snapshots.
	}
}

function getPredictionLockTimestamp(eventRow) {
	const startTs = getEventStartTimestamp(eventRow);
	if (!Number.isFinite(startTs)) {
		return NaN;
	}
	return startTs - GAME_START_BUFFER_MS;
}

function getLockedPregamePrediction(eventRow, sportKey = "") {
	const key = getPregamePredictionEntryKey(eventRow, sportKey);
	if (!key) {
		return null;
	}
	const lockTs = getPredictionLockTimestamp(eventRow);
	if (!Number.isFinite(lockTs) || Date.now() < lockTs) {
		return null;
	}
	const store = readPregamePredictionStore();
	const entry = store[key];
	if (!entry || typeof entry !== 'object') {
		return null;
	}
	if (entry.lockedPrediction && entry.lockedPrediction.predictedTeam) {
		return clonePredictionPayload(entry.lockedPrediction);
	}
	if (entry.latestPrediction && entry.latestPrediction.predictedTeam) {
		entry.lockedPrediction = clonePredictionPayload(entry.latestPrediction);
		entry.lockedAt = Date.now();
		writePregamePredictionStore(store);
		return clonePredictionPayload(entry.lockedPrediction);
	}
	return null;
}

function capturePregamePredictionSnapshot(eventRow, prediction, sportKey = "") {
	if (!eventRow || !prediction || !prediction.predictedTeam) {
		return;
	}
	const key = getPregamePredictionEntryKey(eventRow, sportKey);
	if (!key) {
		return;
	}
	const lockTs = getPredictionLockTimestamp(eventRow);
	if (!Number.isFinite(lockTs)) {
		return;
	}

	const now = Date.now();
	const store = readPregamePredictionStore();
	const existing = store[key] && typeof store[key] === 'object' ? store[key] : {};
	const entry = {
		...existing,
		sportKey: String(sportKey || existing.sportKey || ""),
		commenceTime: eventRow && eventRow.commence_time ? String(eventRow.commence_time) : String(existing.commenceTime || ""),
		commenceTimeMs: Number.isFinite(getEventStartTimestamp(eventRow)) ? getEventStartTimestamp(eventRow) : Number(existing.commenceTimeMs) || NaN
	};

	if (now < lockTs) {
		entry.latestPrediction = clonePredictionPayload(prediction);
		entry.latestObservedAt = now;
	} else if (!entry.lockedPrediction || !entry.lockedPrediction.predictedTeam) {
		entry.lockedPrediction = entry.latestPrediction && entry.latestPrediction.predictedTeam
			? clonePredictionPayload(entry.latestPrediction)
			: clonePredictionPayload(prediction);
		entry.lockedAt = now;
	}

	store[key] = entry;
	writePregamePredictionStore(store);
}

function getHistoryRowIdentity(row) {
	if (!row || typeof row !== "object") {
		return "";
	}
	const id = row && row.id ? String(row.id).trim() : "";
	if (id) {
		return "id:" + id;
	}
	const home = normalizeTeamName(row && row.home_team ? row.home_team : "");
	const away = normalizeTeamName(row && row.away_team ? row.away_team : "");
	const commence = row && row.commence_time ? String(row.commence_time) : "";
	if (!home && !away && !commence) {
		return "";
	}
	return "fallback:" + home + "|" + away + "|" + commence;
}

function mergeRollingHistoryRows(existingRows, incomingRows, maxRows = ROLLING_HISTORY_MAX_ROWS, maxAgeDays = ROLLING_HISTORY_MAX_AGE_DAYS) {
	const combined = [];
	if (Array.isArray(existingRows)) {
		combined.push(...existingRows);
	}
	if (Array.isArray(incomingRows)) {
		combined.push(...incomingRows);
	}
	if (!combined.length) {
		return [];
	}

	const nowMs = Date.now();
	const minTs = nowMs - (maxAgeDays * 24 * 60 * 60 * 1000);
	const deduped = [];
	const seen = new Set();

	for (const row of combined) {
		if (!row || typeof row !== "object") {
			continue;
		}
		const ts = getRowTimestamp(row);
		if (Number.isFinite(ts) && ts < minTs) {
			continue;
		}
		const key = getHistoryRowIdentity(row);
		if (!key || seen.has(key)) {
			continue;
		}
		seen.add(key);
		deduped.push(row);
	}

	deduped.sort((a, b) => {
		const aTs = getRowTimestamp(a);
		const bTs = getRowTimestamp(b);
		if (!Number.isFinite(aTs) && !Number.isFinite(bTs)) {
			return 0;
		}
		if (!Number.isFinite(aTs)) {
			return 1;
		}
		if (!Number.isFinite(bTs)) {
			return -1;
		}
		return bTs - aTs;
	});

	if (deduped.length > maxRows) {
		return deduped.slice(0, maxRows);
	}
	return deduped;
}

function formatPct(value) {
	if (!Number.isFinite(value)) {
		return "N/A";
	}
	return (value * 100).toFixed(1) + "%";
}

function getRate(numerator, denominator) {
	if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
		return NaN;
	}
	return numerator / denominator;
}

function getConservativeLikelihood(rawLikelihood, sampleSize, neutral = 0.5, maxDistance = 0.2) {
	if (!Number.isFinite(rawLikelihood)) {
		return NaN;
	}
	const clamped = clampNumber(rawLikelihood, 0.05, 0.95);
	const trust = clampNumber((Number(sampleSize) - 2) / 18, 0.15, 0.72);
	const blended = neutral + ((clamped - neutral) * trust);
	const floor = neutral - maxDistance;
	const cap = neutral + maxDistance;
	return clampNumber(blended, floor, cap);
}

function getLikelihoodTierClass(likelihoodPct) {
	if (!Number.isFinite(likelihoodPct)) {
		return "tier-neutral";
	}
	if (likelihoodPct < 45) {
		return "tier-red";
	}
	if (likelihoodPct < 58) {
		return "tier-orange";
	}
	if (likelihoodPct <= 72) {
		return "tier-green";
	}
	return "tier-gold";
}

function getHistoryBaseline(historyMap) {
	if (!historyMap || typeof historyMap !== "object" || Array.isArray(historyMap)) {
		return null;
	}

	const profiles = Object.values(historyMap).filter((profile) => profile && Number(profile.matches) > 0);
	if (!profiles.length) {
		return null;
	}

	const totalTeams = profiles.length;
	const sum = (selector) => profiles.reduce((acc, profile) => acc + Number(selector(profile) || 0), 0);

	const totalMatches = sum((profile) => profile.matches);
	const totalWins = sum((profile) => profile.wins);
	const totalDraws = sum((profile) => profile.draws);
	const totalScoredMatches = sum((profile) => profile.scoredMatches);
	const totalConcededMatches = sum((profile) => profile.concededMatches);
	const totalHomeMatches = sum((profile) => profile.homeMatches);
	const totalHomeWins = sum((profile) => profile.homeWins);
	const totalAwayMatches = sum((profile) => profile.awayMatches);
	const totalAwayWins = sum((profile) => profile.awayWins);

	const avgMatches = totalMatches > 0 ? totalMatches / totalTeams : 0;

	return {
		totalTeams,
		totalMatches,
		sampleSize: Math.max(1, Math.round(avgMatches)),
		winRate: getRate(totalWins, totalMatches),
		drawRate: getRate(totalDraws, totalMatches),
		scoreRate: getRate(totalScoredMatches, totalMatches),
		concedeRate: getRate(totalConcededMatches, totalMatches),
		homeWinRate: getRate(totalHomeWins, totalHomeMatches),
		awayWinRate: getRate(totalAwayWins, totalAwayMatches)
	};
}

function buildGameInsightStats(eventRow, prediction, historyMap, oddsRow) {
	if (!eventRow) {
		return null;
	}
	const effectiveHistoryMap = Array.isArray(historyMap)
		? buildPriorHistoryMapForEvent(historyMap, eventRow)
		: historyMap;

	const home = eventRow && eventRow.home_team ? String(eventRow.home_team) : "Home";
	const away = eventRow && eventRow.away_team ? String(eventRow.away_team) : "Away";
	const homeNorm = normalizeTeamName(home);
	const awayNorm = normalizeTeamName(away);
	const homeStats = getHistoryProfileForTeam(homeNorm, effectiveHistoryMap);
	const awayStats = getHistoryProfileForTeam(awayNorm, effectiveHistoryMap);

	const homeMatches = Number(homeStats && homeStats.matches);
	const awayMatches = Number(awayStats && awayStats.matches);
	const hasHomeHistory = Number.isFinite(homeMatches) && homeMatches >= 1;
	const hasAwayHistory = Number.isFinite(awayMatches) && awayMatches >= 1;

	const predictionOddsText = getDisplayOddsForEvent(eventRow, oddsRow, prediction);
	const predictionOdds = Number(predictionOddsText);
	const impliedByOdds = Number.isFinite(predictionOdds) && predictionOdds > 1 ? (1 / predictionOdds) : NaN;
	const modelWinLikelihood = Number.isFinite(Number(prediction && prediction.leanPct))
		? Number(prediction.leanPct) / 100
		: NaN;

	const predictedTeam = prediction && prediction.predictedTeam ? String(prediction.predictedTeam) : "";
	const predictedNorm = normalizeTeamName(predictedTeam);

	if (!hasHomeHistory && !hasAwayHistory) {
		const baseline = getHistoryBaseline(effectiveHistoryMap);
		if (!baseline) {
			const hasOddsSignal = Number.isFinite(impliedByOdds) || Number.isFinite(modelWinLikelihood);
			if (!hasOddsSignal) {
				return null;
			}

			const fallbackSignalRaw = Number.isFinite(impliedByOdds)
				? impliedByOdds
				: modelWinLikelihood;
			const fallbackSignal = getConservativeLikelihood(fallbackSignalRaw, 2, 0.5, 0.1);
			const strictHistoricalWinLikelihood = clampNumber(fallbackSignal, 0.3, 0.7);
			const strictModelWinLikelihood = Number.isFinite(modelWinLikelihood)
				? clampNumber(getConservativeLikelihood(modelWinLikelihood, 2, 0.5, 0.1), 0.3, 0.7)
				: strictHistoricalWinLikelihood;
			const strictImpliedByOdds = Number.isFinite(impliedByOdds)
				? clampNumber(getConservativeLikelihood(impliedByOdds, 4, 0.5, 0.12), 0.28, 0.72)
				: strictHistoricalWinLikelihood;

			let strictLikelyHomeToScore = 0.47;
			let strictLikelyAwayToScore = 0.47;
			if (predictedNorm === homeNorm) {
				strictLikelyHomeToScore = 0.52;
				strictLikelyAwayToScore = 0.44;
			} else if (predictedNorm === awayNorm) {
				strictLikelyHomeToScore = 0.44;
				strictLikelyAwayToScore = 0.52;
			}
			const strictLikelyBothToScore = clampNumber((strictLikelyHomeToScore * strictLikelyAwayToScore) * 0.86, 0.16, 0.56);

			const homeWinRate = predictedNorm === awayNorm ? 0.44 : predictedNorm === homeNorm ? 0.52 : 0.47;
			const awayWinRate = predictedNorm === awayNorm ? 0.52 : predictedNorm === homeNorm ? 0.44 : 0.47;

			return {
				home,
				away,
				homeMatches: 0,
				awayMatches: 0,
				hasHomeHistory: false,
				hasAwayHistory: false,
				hasLeagueBaseline: false,
				hasOddsOnlyFallback: true,
				baselineTeamCount: 0,
				baselineMatchCount: 0,
				sampleSize: 2,
				homeWinRate,
				awayWinRate,
				historicalWinLikelihood: strictHistoricalWinLikelihood,
				modelWinLikelihood: strictModelWinLikelihood,
				impliedByOdds: strictImpliedByOdds,
				predictionOddsText: predictionOddsText || "N/A",
				homeVenueWinRate: NaN,
				awayVenueWinRate: NaN,
				venueEdge: NaN,
				likelyHomeToScore: strictLikelyHomeToScore,
				likelyAwayToScore: strictLikelyAwayToScore,
				likelyBothToScore: strictLikelyBothToScore
			};
		}
		const baselineSample = Math.max(1, Number(baseline.sampleSize) || 1);
		const modelOddsGap = Number.isFinite(modelWinLikelihood) && Number.isFinite(impliedByOdds)
			? Math.abs(modelWinLikelihood - impliedByOdds)
			: 0;
		const disagreementPenalty = clampNumber(modelOddsGap * 0.45, 0, 0.08);

		const baselineDrawRate = Number.isFinite(baseline.drawRate) ? baseline.drawRate : 0.28;
		const baselineWinRate = Number.isFinite(baseline.winRate) ? baseline.winRate : 0.36;
		const baselineHistoryWin = predictedNorm === "draw" ? baselineDrawRate : baselineWinRate;

		const strictHistoricalWinLikelihood = clampNumber(getConservativeLikelihood(baselineHistoryWin, baselineSample, 0.5, 0.15) - disagreementPenalty, 0.22, 0.76);
		const strictModelWinLikelihood = Number.isFinite(modelWinLikelihood)
			? clampNumber(getConservativeLikelihood(modelWinLikelihood, baselineSample, 0.5, 0.12) - disagreementPenalty, 0.24, 0.74)
			: NaN;
		const strictImpliedByOdds = Number.isFinite(impliedByOdds)
			? getConservativeLikelihood(impliedByOdds, baselineSample + 5, 0.5, 0.18)
			: NaN;

		const baselineScoreRate = Number.isFinite(baseline.scoreRate) ? baseline.scoreRate : 0.62;
		const strictLikelyHomeToScore = clampNumber(getConservativeLikelihood(baselineScoreRate, baselineSample, 0.5, 0.14) - 0.03, 0.22, 0.72);
		const strictLikelyAwayToScore = clampNumber(getConservativeLikelihood(baselineScoreRate, baselineSample, 0.5, 0.14) - 0.03, 0.22, 0.72);
		const strictLikelyBothToScore = clampNumber((strictLikelyHomeToScore * strictLikelyAwayToScore) * 0.88, 0.14, 0.62);

		const baselineHomeWinRate = Number.isFinite(baseline.homeWinRate) ? baseline.homeWinRate : NaN;
		const baselineAwayWinRate = Number.isFinite(baseline.awayWinRate) ? baseline.awayWinRate : NaN;
		const venueEdge = Number.isFinite(baselineHomeWinRate) && Number.isFinite(baselineAwayWinRate)
			? (baselineHomeWinRate - baselineAwayWinRate)
			: NaN;

		return {
			home,
			away,
			homeMatches: 0,
			awayMatches: 0,
			hasHomeHistory: false,
			hasAwayHistory: false,
			hasLeagueBaseline: true,
			hasOddsOnlyFallback: false,
			baselineTeamCount: Number(baseline.totalTeams) || 0,
			baselineMatchCount: Number(baseline.totalMatches) || 0,
			sampleSize: baselineSample,
			homeWinRate: baselineWinRate,
			awayWinRate: baselineWinRate,
			historicalWinLikelihood: strictHistoricalWinLikelihood,
			modelWinLikelihood: strictModelWinLikelihood,
			impliedByOdds: strictImpliedByOdds,
			predictionOddsText: predictionOddsText || "N/A",
			homeVenueWinRate: baselineHomeWinRate,
			awayVenueWinRate: baselineAwayWinRate,
			venueEdge,
			likelyHomeToScore: strictLikelyHomeToScore,
			likelyAwayToScore: strictLikelyAwayToScore,
			likelyBothToScore: strictLikelyBothToScore
		};
	}

	const sampleSizes = [];
	if (hasHomeHistory) {
		sampleSizes.push(homeMatches);
	}
	if (hasAwayHistory) {
		sampleSizes.push(awayMatches);
	}
	const sampleSize = Math.min(...sampleSizes);

	const homeWinRate = hasHomeHistory ? getRate(Number(homeStats.wins), homeMatches) : NaN;
	const awayWinRate = hasAwayHistory ? getRate(Number(awayStats.wins), awayMatches) : NaN;
	const homeDrawRate = hasHomeHistory ? getRate(Number(homeStats.draws), homeMatches) : NaN;
	const awayDrawRate = hasAwayHistory ? getRate(Number(awayStats.draws), awayMatches) : NaN;
	const drawRate = Number.isFinite(homeDrawRate) && Number.isFinite(awayDrawRate)
		? (homeDrawRate + awayDrawRate) / 2
		: (Number.isFinite(homeDrawRate) ? homeDrawRate : Number.isFinite(awayDrawRate) ? awayDrawRate : NaN);

	const homeScoreRate = hasHomeHistory ? getRate(Number(homeStats.scoredMatches), homeMatches) : NaN;
	const awayScoreRate = hasAwayHistory ? getRate(Number(awayStats.scoredMatches), awayMatches) : NaN;
	const homeConcedeRate = hasHomeHistory ? getRate(Number(homeStats.concededMatches), homeMatches) : NaN;
	const awayConcedeRate = hasAwayHistory ? getRate(Number(awayStats.concededMatches), awayMatches) : NaN;

	const likelyHomeToScore = Number.isFinite(homeScoreRate) && Number.isFinite(awayConcedeRate)
		? (homeScoreRate + awayConcedeRate) / 2
		: Number.isFinite(homeScoreRate)
			? clampNumber(homeScoreRate * 0.92, 0.1, 0.85)
		: NaN;
	const likelyAwayToScore = Number.isFinite(awayScoreRate) && Number.isFinite(homeConcedeRate)
		? (awayScoreRate + homeConcedeRate) / 2
		: Number.isFinite(awayScoreRate)
			? clampNumber(awayScoreRate * 0.92, 0.1, 0.85)
		: NaN;
	const likelyBothToScore = Number.isFinite(likelyHomeToScore) && Number.isFinite(likelyAwayToScore)
		? clampNumber(likelyHomeToScore * likelyAwayToScore, 0, 1)
		: NaN;

	const homeVenueWinRate = hasHomeHistory ? getRate(Number(homeStats.homeWins), Number(homeStats.homeMatches)) : NaN;
	const awayVenueWinRate = hasAwayHistory ? getRate(Number(awayStats.awayWins), Number(awayStats.awayMatches)) : NaN;
	const venueEdge = Number.isFinite(homeVenueWinRate) && Number.isFinite(awayVenueWinRate)
		? (homeVenueWinRate - awayVenueWinRate)
		: NaN;

	let historicalWinLikelihood = NaN;
	if (predictedNorm === homeNorm) {
		historicalWinLikelihood = homeWinRate;
	} else if (predictedNorm === awayNorm) {
		historicalWinLikelihood = awayWinRate;
	} else if (predictedNorm === "draw") {
		historicalWinLikelihood = drawRate;
	}
	const modelOddsGap = Number.isFinite(modelWinLikelihood) && Number.isFinite(impliedByOdds)
		? Math.abs(modelWinLikelihood - impliedByOdds)
		: 0;
	const disagreementPenalty = clampNumber(modelOddsGap * 0.45, 0, 0.08);

	const strictHistoricalWinLikelihood = Number.isFinite(historicalWinLikelihood)
		? clampNumber(getConservativeLikelihood(historicalWinLikelihood, sampleSize, 0.5, 0.17) - disagreementPenalty, 0.2, 0.8)
		: NaN;
	const strictModelWinLikelihood = Number.isFinite(modelWinLikelihood)
		? clampNumber(getConservativeLikelihood(modelWinLikelihood, sampleSize, 0.5, 0.14) - disagreementPenalty, 0.22, 0.78)
		: NaN;
	const strictImpliedByOdds = Number.isFinite(impliedByOdds)
		? getConservativeLikelihood(impliedByOdds, sampleSize + 5, 0.5, 0.2)
		: NaN;

	const strictLikelyHomeToScore = Number.isFinite(likelyHomeToScore)
		? clampNumber(getConservativeLikelihood(likelyHomeToScore, sampleSize, 0.5, 0.16) - 0.03, 0.18, 0.74)
		: NaN;
	const strictLikelyAwayToScore = Number.isFinite(likelyAwayToScore)
		? clampNumber(getConservativeLikelihood(likelyAwayToScore, sampleSize, 0.5, 0.16) - 0.03, 0.18, 0.74)
		: NaN;
	const strictLikelyBothToScore = Number.isFinite(strictLikelyHomeToScore) && Number.isFinite(strictLikelyAwayToScore)
		? clampNumber((strictLikelyHomeToScore * strictLikelyAwayToScore) * 0.9, 0.12, 0.68)
		: NaN;

	return {
		home,
		away,
		homeMatches,
		awayMatches,
		hasHomeHistory,
		hasAwayHistory,
		hasLeagueBaseline: false,
		hasOddsOnlyFallback: false,
		baselineTeamCount: 0,
		baselineMatchCount: 0,
		sampleSize,
		homeWinRate,
		awayWinRate,
		historicalWinLikelihood: strictHistoricalWinLikelihood,
		modelWinLikelihood: strictModelWinLikelihood,
		impliedByOdds: strictImpliedByOdds,
		predictionOddsText: predictionOddsText || "N/A",
		homeVenueWinRate,
		awayVenueWinRate,
		venueEdge,
		likelyHomeToScore: strictLikelyHomeToScore,
		likelyAwayToScore: strictLikelyAwayToScore,
		likelyBothToScore: strictLikelyBothToScore
	};
}

function buildGameInsightsPanel(eventRow, prediction, historyMap, oddsRow) {
	const tooltipPill = (text, tooltip, tierClass = "") => '<span class="meta-pill'
		+ (tierClass ? ' ' + tierClass : '')
		+ '" title="' + escapeHtml(tooltip) + '">' + escapeHtml(text) + '</span>';

	const stats = buildGameInsightStats(eventRow, prediction, historyMap, oddsRow);
	if (!stats) {
		const predictionOddsText = getDisplayOddsForEvent(eventRow, oddsRow, prediction) || "N/A";
		const predictionOdds = Number(predictionOddsText);
		const impliedByOdds = Number.isFinite(predictionOdds) && predictionOdds > 1 ? (1 / predictionOdds) : NaN;
		const modelWinLikelihood = Number.isFinite(Number(prediction && prediction.leanPct))
			? Number(prediction.leanPct) / 100
			: NaN;
		const modelTier = getLikelihoodTierClass(Number(modelWinLikelihood) * 100);
		const impliedTier = getLikelihoodTierClass(Number(impliedByOdds) * 100);

		return '<div class="card-insights" aria-hidden="true">'
			+ '<div class="card-insights-grid">'
			+ '<div class="card-insights-column left">'
			+ tooltipPill('Pre odds: ' + predictionOddsText, 'Decimal pre-game price from Sportsbet for the predicted side.')
			+ tooltipPill('History-based stats: limited', 'Not enough recent scored matches for both teams, so form-driven metrics are reduced.', 'tier-neutral')
			+ '</div>'
			+ '<div class="card-insights-column right">'
			+ tooltipPill('Model win: ' + formatPct(modelWinLikelihood), 'Model-estimated win likelihood after conservative weighting.', modelTier)
			+ tooltipPill('Odds implied: ' + formatPct(impliedByOdds), 'Win likelihood implied by Sportsbet pre-game odds.', impliedTier)
			+ '</div>'
			+ '</div>'
			+ '<p class="card-insights-foot">Limited prior-match data for one or both teams, so only market and model signals are shown.</p>'
			+ '</div>';
	}

	const homeScoreTier = getLikelihoodTierClass(Number(stats.likelyHomeToScore) * 100);
	const awayScoreTier = getLikelihoodTierClass(Number(stats.likelyAwayToScore) * 100);
	const bttsTier = getLikelihoodTierClass(Number(stats.likelyBothToScore) * 100);
	const historyTier = getLikelihoodTierClass(Number(stats.historicalWinLikelihood) * 100);
	const modelTier = getLikelihoodTierClass(Number(stats.modelWinLikelihood) * 100);
	const impliedTier = getLikelihoodTierClass(Number(stats.impliedByOdds) * 100);
	const homeWinTier = getLikelihoodTierClass(Number(stats.homeWinRate) * 100);
	const awayWinTier = getLikelihoodTierClass(Number(stats.awayWinRate) * 100);

	const venueEdgeText = !Number.isFinite(stats.venueEdge)
		? "N/A"
		: (stats.venueEdge > 0
			? stats.home + " +" + (stats.venueEdge * 100).toFixed(1) + "%"
			: stats.away + " +" + (Math.abs(stats.venueEdge) * 100).toFixed(1) + "%");

	const sampleSizeText = stats.sampleSize + " prior matches per team with conservative weighting";
	const baselineSampleBadge = stats.hasLeagueBaseline
		? tooltipPill(
			'Baseline sample: ' + String(stats.baselineMatchCount || 0) + ' matches across ' + String(stats.baselineTeamCount || 0) + ' teams',
			'Fallback baseline built from league-wide recent matches when team-specific samples are sparse.',
			'tier-neutral'
		)
		: '';
	const oddsOnlyBadge = stats.hasOddsOnlyFallback
		? tooltipPill('Fallback sample: odds-driven conservative priors', 'Strict fallback using market-implied probabilities when usable history is unavailable.', 'tier-neutral')
		: '';
	const coverageText = stats.hasLeagueBaseline
		? "History coverage: league baseline"
		: stats.hasOddsOnlyFallback
		? "History coverage: odds-only fallback"
		: stats.hasHomeHistory && stats.hasAwayHistory
		? "History coverage: both teams"
		: stats.hasHomeHistory
			? "History coverage: home team only"
			: "History coverage: away team only";

	const leftBadges = [
		tooltipPill(coverageText, 'Indicates whether history came from both teams, one team, league baseline, or odds-only fallback.', 'tier-neutral'),
		baselineSampleBadge,
		oddsOnlyBadge,
		tooltipPill('Venue edge: ' + venueEdgeText, 'Difference between home venue win tendency and away venue performance. Positive favors home.', '')
	].filter(Boolean).join('');

	const rightBadges = [
		tooltipPill('History win: ' + formatPct(stats.historicalWinLikelihood), 'Win likelihood estimated from prior match outcomes and conservative weighting.', historyTier),
		tooltipPill('Model win: ' + formatPct(stats.modelWinLikelihood), 'Model-estimated win likelihood after strict confidence tightening.', modelTier),
		tooltipPill('Odds implied: ' + formatPct(stats.impliedByOdds), 'Win likelihood implied by Sportsbet pricing for this event.', impliedTier),
		tooltipPill(stats.home + ' win: ' + formatPct(stats.homeWinRate), 'Estimated win probability for ' + stats.home + ' based on recent form and pricing.', homeWinTier),
		tooltipPill(stats.away + ' win: ' + formatPct(stats.awayWinRate), 'Estimated win probability for ' + stats.away + ' based on recent form and pricing.', awayWinTier),
		tooltipPill(stats.home + ' score: ' + formatPct(stats.likelyHomeToScore), 'Estimated chance that ' + stats.home + ' scores at least once.', homeScoreTier),
		tooltipPill(stats.away + ' score: ' + formatPct(stats.likelyAwayToScore), 'Estimated chance that ' + stats.away + ' scores at least once.', awayScoreTier),
		tooltipPill('Both score: ' + formatPct(stats.likelyBothToScore), 'Estimated chance both teams score at least once (BTTS).', bttsTier)
	].join('');

	return '<div class="card-insights" aria-hidden="true">'
		+ '<div class="card-insights-grid">'
		+ '<div class="card-insights-column left">' + leftBadges + '</div>'
		+ '<div class="card-insights-column right">' + rightBadges + '</div>'
		+ '</div>'
		+ '<p class="card-insights-foot">Based on ' + escapeHtml(sampleSizeText) + '.</p>'
		+ '</div>';
}

function buildTopBetsBlock(topBets) {
	if (!Array.isArray(topBets) || !topBets.length) {
		return '';
	}
	return '<div class="top-bets-block"><span class="top-bets-label">Top bets</span><div class="top-bets">'
		+ topBets.map((bet) => '<span class="top-bet-pill">' + escapeHtml(bet.labelText) + '</span>').join('')
		+ '</div></div>';
}

function attachTopBetsToInsights(insightsPanel, topBets) {
	if (!insightsPanel) {
		return '';
	}
	const topBetsBlock = buildTopBetsBlock(topBets);
	if (!topBetsBlock) {
		return insightsPanel;
	}
	const closeIdx = insightsPanel.lastIndexOf('</div>');
	if (closeIdx < 0) {
		return insightsPanel + topBetsBlock;
	}
	return insightsPanel.slice(0, closeIdx) + topBetsBlock + insightsPanel.slice(closeIdx);
}

function toggleGameCardInsights(card) {
	if (!card) {
		return;
	}
	const isExpanded = !card.classList.contains('expanded');
	card.classList.toggle('expanded', isExpanded);
	card.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
	const panel = card.querySelector('.card-insights');
	if (panel) {
		panel.setAttribute('aria-hidden', isExpanded ? 'false' : 'true');
	}
}

function bindGameCardInteractions() {
	if (!el || !el.upcomingWrap) {
		return;
	}
	if (el.upcomingWrap.dataset.cardExpandBound === 'true') {
		return;
	}

	el.upcomingWrap.dataset.cardExpandBound = 'true';
	el.upcomingWrap.addEventListener('click', (event) => {
		const target = event && event.target ? event.target : null;
		const card = target && target.closest ? target.closest('.game-card[data-expand-card="true"]') : null;
		if (!card || !el.upcomingWrap.contains(card)) {
			return;
		}
		if (target && target.closest && target.closest('a,button,input,select,textarea,label')) {
			return;
		}
		toggleGameCardInsights(card);
	});

	el.upcomingWrap.addEventListener('keydown', (event) => {
		if (!event || (event.key !== 'Enter' && event.key !== ' ')) {
			return;
		}
		const target = event.target;
		if (!target || !target.classList || !target.classList.contains('game-card')) {
			return;
		}
		if (target.getAttribute('data-expand-card') !== 'true') {
			return;
		}
		event.preventDefault();
		toggleGameCardInsights(target);
	});
}

function getSportsbetBookmakers(oddsRow) {
	if (!oddsRow || !Array.isArray(oddsRow.bookmakers)) {
		return [];
	}
	return oddsRow.bookmakers.filter((bookmaker) => {
		const key = bookmaker && bookmaker.key ? String(bookmaker.key).toLowerCase() : "";
		return key === SPORTSBOOK_KEY;
	});
}

function getBookmakerUpdateTimestamp(bookmaker) {
	if (!bookmaker || typeof bookmaker !== 'object') {
		return null;
	}
	const candidates = [
		bookmaker.last_update,
		bookmaker.lastUpdated,
		bookmaker.updated_at,
		bookmaker.updatedAt,
		bookmaker.updated,
		bookmaker.timestamp
	];
	for (const value of candidates) {
		const parsed = value == null || value === '' ? NaN : new Date(value).getTime();
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}
	return null;
}

function getOddsReferenceTimestamp(eventRow) {
	const startTs = getEventStartTimestamp(eventRow);
	if (!Number.isFinite(startTs)) {
		return Date.now();
	}
	const now = Date.now();
	if (isLiveEventRow(eventRow) || startTs <= now) {
		return startTs - 60 * 1000;
	}
	return now;
}

function getEligibleSportsbetBookmakersForEvent(oddsRow, eventRow) {
	const bookmakers = getSportsbetBookmakers(oddsRow);
	if (!Array.isArray(bookmakers) || !bookmakers.length) {
		return bookmakers;
	}
	const now = Date.now();
	const shouldUsePregameSnapshot = isLiveEventRow(eventRow) || getEventStartTimestamp(eventRow) <= now;
	if (!shouldUsePregameSnapshot) {
		return bookmakers;
	}

	const snapshotCutoff = getOddsReferenceTimestamp(eventRow);
	const eligible = bookmakers.filter((bookmaker) => {
		const timestamp = getBookmakerUpdateTimestamp(bookmaker);
		if (!Number.isFinite(timestamp)) {
			return true;
		}
		return timestamp <= snapshotCutoff;
	});
	return eligible.length ? eligible : bookmakers;
}

function isDrawOutcomeName(value) {
	const normalized = normalizeTeamName(value);
	if (!normalized) {
		return false;
	}
	return normalized === "draw"
		|| normalized === "tie"
		|| normalized === "x"
		|| normalized === "the draw"
		|| normalized === "full time draw";
}

function getBookmakerOddsForPrediction(eventRow, oddsRow, prediction) {
	if (!eventRow || !oddsRow || !prediction) {
		return null;
	}

	const predictedTeam = prediction && prediction.predictedTeam ? String(prediction.predictedTeam) : "";
	if (!predictedTeam) {
		return null;
	}

	const home = eventRow && eventRow.home_team ? String(eventRow.home_team) : "Home";
	const away = eventRow && eventRow.away_team ? String(eventRow.away_team) : "Away";
	const homeNorm = normalizeTeamName(home);
	const awayNorm = normalizeTeamName(away);
	const targetNorm = normalizeTeamName(predictedTeam);
	let bestOdds = null;

	for (const bookmaker of getEligibleSportsbetBookmakersForEvent(oddsRow, eventRow)) {
		if (!bookmaker || !Array.isArray(bookmaker.markets)) {
			continue;
		}
		const market = bookmaker.markets.find((item) => item && item.key === "h2h") || bookmaker.markets[0];
		if (!market || !Array.isArray(market.outcomes)) {
			continue;
		}
		const outcomeRows = market.outcomes;
		const fallbackDrawOutcome = targetNorm === "draw"
			? outcomeRows.find((outcome) => {
				const outcomeName = normalizeTeamName(outcome && outcome.name ? outcome.name : "");
				return outcomeName && outcomeName !== homeNorm && outcomeName !== awayNorm;
			})
			: null;
		for (const outcome of outcomeRows) {
			const outcomeName = normalizeTeamName(outcome && outcome.name ? outcome.name : "");
			const price = Number(outcome && outcome.price);
			if (!Number.isFinite(price) || price <= 1) {
				continue;
			}

			const matchesPrediction = targetNorm === "draw"
				? isDrawOutcomeName(outcomeName)
				: outcomeName === targetNorm
					|| outcomeName === homeNorm && predictedTeam === home
					|| outcomeName === awayNorm && predictedTeam === away
					|| outcomeName === homeNorm && targetNorm === homeNorm
					|| outcomeName === awayNorm && targetNorm === awayNorm;

			if (matchesPrediction && (!bestOdds || price > bestOdds)) {
				bestOdds = price;
			}
		}

		if (!bestOdds && fallbackDrawOutcome) {
			const fallbackPrice = Number(fallbackDrawOutcome.price);
			if (Number.isFinite(fallbackPrice) && fallbackPrice > 1) {
				bestOdds = fallbackPrice;
			}
		}
	}

	return bestOdds ? Number(bestOdds).toFixed(2) : null;
}

function getBestAvailableOddsForEvent(eventRow, oddsRow) {
	if (!eventRow || !oddsRow) {
		return null;
	}

	let bestOdds = null;
	for (const bookmaker of getEligibleSportsbetBookmakersForEvent(oddsRow, eventRow)) {
		if (!bookmaker || !Array.isArray(bookmaker.markets)) {
			continue;
		}
		const market = bookmaker.markets.find((item) => item && item.key === "h2h") || bookmaker.markets[0];
		if (!market || !Array.isArray(market.outcomes)) {
			continue;
		}
		for (const outcome of market.outcomes) {
			const price = Number(outcome && outcome.price);
			if (!Number.isFinite(price) || price <= 1) {
				continue;
			}
			if (!bestOdds || price > bestOdds) {
				bestOdds = price;
			}
		}
	}
	return bestOdds ? Number(bestOdds).toFixed(2) : null;
}

function getDisplayOddsForEvent(eventRow, oddsRow, prediction = null) {
	if (prediction && prediction.predictedTeam) {
		return getBookmakerOddsForPrediction(eventRow, oddsRow, prediction);
	}
	return getBestAvailableOddsForEvent(eventRow, oddsRow);
}

function hasUsableScoreData(eventRow) {
	if (!eventRow) {
		return false;
	}

	const scoreEntries = Array.isArray(eventRow.scores) ? eventRow.scores : [];
	if (scoreEntries.length >= 2) {
		return true;
	}

	const homeTeam = eventRow.home_team ? String(eventRow.home_team).trim() : "";
	const awayTeam = eventRow.away_team ? String(eventRow.away_team).trim() : "";
	const homeScore = Number(eventRow && (eventRow.home_score ?? eventRow.homeScore ?? eventRow.home_goals ?? eventRow.homeGoals));
	const awayScore = Number(eventRow && (eventRow.away_score ?? eventRow.awayScore ?? eventRow.away_goals ?? eventRow.awayGoals));
	return Boolean(homeTeam && awayTeam && Number.isFinite(homeScore) && Number.isFinite(awayScore));
}

function getPredictionResultForCompletedEvent(eventRow, predictedTeam) {
	if (!eventRow || !hasUsableScoreData(eventRow)) {
		return { label: "No prediction", tierClass: "tier-orange" };
	}

	const home = eventRow.home_team ? String(eventRow.home_team) : "Home";
	const away = eventRow.away_team ? String(eventRow.away_team) : "Away";
	const homeNorm = normalizeTeamName(home);
	const awayNorm = normalizeTeamName(away);
	const predictedNorm = normalizeTeamName(predictedTeam || "");

	let homeScore = NaN;
	let awayScore = NaN;
	for (const scoreRow of eventRow.scores) {
		const teamName = normalizeTeamName(scoreRow && scoreRow.name ? scoreRow.name : "");
		const parsedScore = Number(scoreRow && scoreRow.score);
		if (!Number.isFinite(parsedScore)) {
			continue;
		}
		if (teamName === homeNorm) {
			homeScore = parsedScore;
		}
		if (teamName === awayNorm) {
			awayScore = parsedScore;
		}
	}

	if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) {
		return { label: "Unknown", tierClass: "tier-orange" };
	}

	if (homeScore === awayScore) {
		if (predictedNorm === "draw") {
			return { label: "Won", tierClass: "tier-green" };
		}
		if (predictedNorm === homeNorm || predictedNorm === awayNorm) {
			return { label: "Lost", tierClass: "tier-red" };
		}
		return { label: "Push", tierClass: "tier-orange" };
	}

	const winnerNorm = homeScore > awayScore ? homeNorm : awayNorm;
	if (!predictedNorm) {
		return { label: "Unknown", tierClass: "tier-orange" };
	}

	if (winnerNorm === predictedNorm) {
		return { label: "Won", tierClass: "tier-green" };
	}

	return { label: "Lost", tierClass: "tier-red" };
}

function getLivePredictionStatus(eventRow, predictedTeam) {
	if (!eventRow || !predictedTeam || !isLiveEventRow(eventRow)) {
		return null;
	}

	const home = eventRow.home_team ? String(eventRow.home_team) : "Home";
	const away = eventRow.away_team ? String(eventRow.away_team) : "Away";
	const homeNorm = normalizeTeamName(home);
	const awayNorm = normalizeTeamName(away);
	const predictedNorm = normalizeTeamName(predictedTeam || "");

	let homeScore = NaN;
	let awayScore = NaN;
	if (Array.isArray(eventRow.scores) && eventRow.scores.length) {
		for (const scoreRow of eventRow.scores) {
			const teamName = normalizeTeamName(scoreRow && scoreRow.name ? scoreRow.name : "");
			const parsedScore = Number(scoreRow && scoreRow.score);
			if (!Number.isFinite(parsedScore)) {
				continue;
			}
			if (teamName === homeNorm) {
				homeScore = parsedScore;
			}
			if (teamName === awayNorm) {
				awayScore = parsedScore;
			}
		}
	}
	if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) {
		const flatHomeScore = Number(eventRow && (eventRow.home_score ?? eventRow.homeScore ?? eventRow.home_goals ?? eventRow.homeGoals));
		const flatAwayScore = Number(eventRow && (eventRow.away_score ?? eventRow.awayScore ?? eventRow.away_goals ?? eventRow.awayGoals));
		if (Number.isFinite(flatHomeScore)) {
			homeScore = flatHomeScore;
		}
		if (Number.isFinite(flatAwayScore)) {
			awayScore = flatAwayScore;
		}
	}
	if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore) || homeScore === awayScore) {
		return null;
	}
	const leaderNorm = homeScore > awayScore ? homeNorm : awayNorm;
	return leaderNorm === predictedNorm ? 'win' : 'loss';
}

function getEventScoreText(eventRow) {
	if (!hasUsableScoreData(eventRow)) {
		return "No usable score data";
	}
	const home = eventRow.home_team ? String(eventRow.home_team) : "Home";
	const away = eventRow.away_team ? String(eventRow.away_team) : "Away";
	const homeNorm = normalizeTeamName(home);
	const awayNorm = normalizeTeamName(away);

	let homeScore = "-";
	let awayScore = "-";
	if (Array.isArray(eventRow.scores) && eventRow.scores.length) {
		for (const scoreRow of eventRow.scores) {
			const nameNorm = normalizeTeamName(scoreRow && scoreRow.name ? scoreRow.name : "");
			const scoreValue = scoreRow && scoreRow.score != null ? String(scoreRow.score) : "-";
			if (nameNorm === homeNorm) {
				homeScore = scoreValue;
			}
			if (nameNorm === awayNorm) {
				awayScore = scoreValue;
			}
		}
	}

	if (homeScore === "-" || awayScore === "-") {
		const flatHomeScore = Number(eventRow && (eventRow.home_score ?? eventRow.homeScore ?? eventRow.home_goals ?? eventRow.homeGoals));
		const flatAwayScore = Number(eventRow && (eventRow.away_score ?? eventRow.awayScore ?? eventRow.away_goals ?? eventRow.awayGoals));
		if (Number.isFinite(flatHomeScore)) {
			homeScore = String(flatHomeScore);
		}
		if (Number.isFinite(flatAwayScore)) {
			awayScore = String(flatAwayScore);
		}
	}

	return homeScore + " - " + awayScore;
}

function getStdDev(values) {
	if (!Array.isArray(values) || values.length < 2) {
		return 0;
	}
	const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
	const variance = values.reduce((sum, value) => {
		const delta = value - mean;
		return sum + (delta * delta);
	}, 0) / values.length;
	return Math.sqrt(variance);
}

function getScoreLookupFromRow(row) {
	const lookup = {};
	if (!row) {
		return lookup;
	}

	const scoreEntries = Array.isArray(row.scores) ? row.scores : [];
	for (const scoreRow of scoreEntries) {
		const teamName = normalizeTeamName(scoreRow && scoreRow.name ? scoreRow.name : "");
		const scoreValue = Number(scoreRow && scoreRow.score);
		if (!teamName || !Number.isFinite(scoreValue)) {
			continue;
		}
		lookup[teamName] = scoreValue;
	}

	const homeTeam = row && row.home_team ? String(row.home_team).trim() : "";
	const awayTeam = row && row.away_team ? String(row.away_team).trim() : "";
	const homeScore = Number(row && (row.home_score ?? row.homeScore ?? row.home_goals ?? row.homeGoals));
	const awayScore = Number(row && (row.away_score ?? row.awayScore ?? row.away_goals ?? row.awayGoals));

	if (homeTeam) {
		const homeNorm = normalizeTeamName(homeTeam);
		if (!Number.isNaN(homeScore)) {
			lookup[homeNorm] = homeScore;
		}
	}
	if (awayTeam) {
		const awayNorm = normalizeTeamName(awayTeam);
		if (!Number.isNaN(awayScore)) {
			lookup[awayNorm] = awayScore;
		}
	}

	return lookup;
}

function buildConsensusProbabilities(eventRow, oddsRow) {
	const sportsbetBookmakers = getSportsbetBookmakers(oddsRow);
	if (!sportsbetBookmakers.length) {
		return null;
	}

	const home = eventRow && eventRow.home_team ? String(eventRow.home_team) : "Home";
	const away = eventRow && eventRow.away_team ? String(eventRow.away_team) : "Away";
	const homeNorm = normalizeTeamName(home);
	const awayNorm = normalizeTeamName(away);

	const samples = [];
	for (const bookmaker of sportsbetBookmakers) {
		if (!bookmaker || !Array.isArray(bookmaker.markets)) {
			continue;
		}
		const market = bookmaker.markets.find((item) => item && item.key === "h2h") || bookmaker.markets[0];
		if (!market || !Array.isArray(market.outcomes) || !market.outcomes.length) {
			continue;
		}

		let homePrice = NaN;
		let awayPrice = NaN;
		let drawPrice = NaN;
		for (const outcome of market.outcomes) {
			const outcomeName = normalizeTeamName(outcome && outcome.name ? outcome.name : "");
			const outcomePrice = Number(outcome && outcome.price);
			if (!Number.isFinite(outcomePrice) || outcomePrice <= 1) {
				continue;
			}
			if (outcomeName === homeNorm) {
				homePrice = outcomePrice;
			} else if (outcomeName === awayNorm) {
				awayPrice = outcomePrice;
			} else if (isDrawOutcomeName(outcomeName)) {
				drawPrice = outcomePrice;
			}
		}

		if (!Number.isFinite(homePrice) || !Number.isFinite(awayPrice)) {
			continue;
		}

		const invHome = 1 / homePrice;
		const invAway = 1 / awayPrice;
		const invDraw = Number.isFinite(drawPrice) ? 1 / drawPrice : 0;
		const total = invHome + invAway + invDraw;
		if (!Number.isFinite(total) || total <= 0) {
			continue;
		}

		samples.push({
			home: invHome / total,
			away: invAway / total,
			draw: invDraw / total
		});
	}

	if (!samples.length) {
		return null;
	}

	const homeValues = samples.map((sample) => sample.home);
	const awayValues = samples.map((sample) => sample.away);
	const drawValues = samples.map((sample) => sample.draw);

	const avgHome = homeValues.reduce((sum, value) => sum + value, 0) / homeValues.length;
	const avgAway = awayValues.reduce((sum, value) => sum + value, 0) / awayValues.length;
	const avgDraw = drawValues.reduce((sum, value) => sum + value, 0) / drawValues.length;

	return {
		home: avgHome,
		away: avgAway,
		draw: avgDraw,
		sampleSize: samples.length,
		agreementStdDev: getStdDev(homeValues)
	};
}

function getHistoryProfileForTeam(teamName, historyMap) {
	if (!teamName || !historyMap || !historyMap[teamName]) {
		return null;
	}
	return historyMap[teamName];
}

function buildTeamHistoryMap(scoresRows) {
	const historyMap = {};
	if (!Array.isArray(scoresRows)) {
		return historyMap;
	}

	for (const row of scoresRows) {
		if (!row) {
			continue;
		}

		const scoreLookup = getScoreLookupFromRow(row);
		const scoreEntries = Object.entries(scoreLookup);
		if (scoreEntries.length < 2) {
			continue;
		}

		const homeTeamName = row && row.home_team ? String(row.home_team).trim() : "";
		const awayTeamName = row && row.away_team ? String(row.away_team).trim() : "";
		const homeNorm = normalizeTeamName(homeTeamName || scoreEntries[0][0]);
		const awayNorm = normalizeTeamName(awayTeamName || scoreEntries[1][0]);
		const homeGoals = Number(scoreLookup[homeNorm] ?? scoreEntries[0][1]);
		const awayGoals = Number(scoreLookup[awayNorm] ?? scoreEntries[1][1]);
		if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) {
			continue;
		}

		for (const [teamName, teamGoals] of [[homeNorm, homeGoals], [awayNorm, awayGoals]]) {
			const profile = historyMap[teamName] || {
				matches: 0,
				wins: 0,
				draws: 0,
				losses: 0,
				goalsFor: 0,
				goalsAgainst: 0,
				points: 0,
				recentForm: 0,
				scoredMatches: 0,
				concededMatches: 0,
				homeMatches: 0,
				homeWins: 0,
				awayMatches: 0,
				awayWins: 0
			};

			profile.matches += 1;
			profile.goalsFor += teamGoals;
			if (teamGoals > 0) {
				profile.scoredMatches += 1;
			}
			if (teamName === homeNorm) {
				profile.goalsAgainst += awayGoals;
				profile.homeMatches += 1;
				if (awayGoals > 0) {
					profile.concededMatches += 1;
				}
			} else {
				profile.goalsAgainst += homeGoals;
				profile.awayMatches += 1;
				if (homeGoals > 0) {
					profile.concededMatches += 1;
				}
			}

			if (teamName === homeNorm) {
				if (homeGoals > awayGoals) {
					profile.wins += 1;
					profile.homeWins += 1;
					profile.points += 3;
					profile.recentForm += 3;
				} else if (homeGoals < awayGoals) {
					profile.losses += 1;
					profile.recentForm -= 2;
				} else {
					profile.draws += 1;
					profile.points += 1;
					profile.recentForm += 1;
				}
			} else if (awayGoals > homeGoals) {
				profile.wins += 1;
				profile.awayWins += 1;
				profile.points += 3;
				profile.recentForm += 3;
			} else if (awayGoals < homeGoals) {
				profile.losses += 1;
				profile.recentForm -= 2;
			} else {
				profile.draws += 1;
				profile.points += 1;
				profile.recentForm += 1;
			}

			historyMap[teamName] = profile;
		}
	}

	return historyMap;
}

function buildPriorHistoryMapForEvent(scoreRows, eventRow) {
	if (!Array.isArray(scoreRows) || !eventRow) {
		return buildTeamHistoryMap(Array.isArray(scoreRows) ? scoreRows : []);
	}

	const eventStartMs = getRowTimestamp(eventRow);
	if (!Number.isFinite(eventStartMs)) {
		return buildTeamHistoryMap(scoreRows);
	}

	const priorRows = scoreRows.filter((candidate) => {
		if (!candidate || typeof candidate !== 'object') {
			return false;
		}
		const candidateTs = getRowTimestamp(candidate);
		if (!Number.isFinite(candidateTs)) {
			return false;
		}
		return candidateTs < eventStartMs;
	});

	return buildTeamHistoryMap(priorRows);
}

function getHistoricalPredictionForEvent(eventRow, historyMap) {
	if (!eventRow || !historyMap) {
		return null;
	}

	const home = eventRow && eventRow.home_team ? String(eventRow.home_team) : "Home";
	const away = eventRow && eventRow.away_team ? String(eventRow.away_team) : "Away";
	const homeNorm = normalizeTeamName(home);
	const awayNorm = normalizeTeamName(away);
	const homeStats = getHistoryProfileForTeam(homeNorm, historyMap);
	const awayStats = getHistoryProfileForTeam(awayNorm, historyMap);
	const hasHomeStats = Boolean(homeStats && Number(homeStats.matches) >= 1);
	const hasAwayStats = Boolean(awayStats && Number(awayStats.matches) >= 1);

	if (!hasHomeStats || !hasAwayStats) {
		const baseline = getHistoryBaseline(historyMap);
		if (!baseline) {
			return null;
		}

		const toHybridRating = (stats, isHomeSide) => {
			const matches = Number(stats && stats.matches);
			const hasStats = Number.isFinite(matches) && matches > 0;
			const winRate = hasStats
				? getRate(Number(stats.wins), matches)
				: (isHomeSide
					? (Number.isFinite(baseline.homeWinRate) ? baseline.homeWinRate : baseline.winRate)
					: (Number.isFinite(baseline.awayWinRate) ? baseline.awayWinRate : baseline.winRate));
			const goalsForRate = hasStats
				? Number(stats.goalsFor) / matches
				: ((Number.isFinite(baseline.scoreRate) ? baseline.scoreRate : 0.55) * 1.4);
			const goalsAgainstRate = hasStats
				? Number(stats.goalsAgainst) / matches
				: ((Number.isFinite(baseline.concedeRate) ? baseline.concedeRate : 0.55) * 1.2);
			const formRate = hasStats
				? clampNumber((Number(stats.recentForm) / matches) / 6, -0.35, 0.35)
				: 0;
			const venueBoost = isHomeSide ? 0.08 : -0.03;
			const safeWinRate = Number.isFinite(winRate) ? winRate : 0.5;
			return (safeWinRate * 2.2) + (formRate * 0.9) + (goalsForRate * 0.45) - (goalsAgainstRate * 0.35) + venueBoost;
		};

		const homeRating = toHybridRating(homeStats, true);
		const awayRating = toHybridRating(awayStats, false);
		const scoreDiff = homeRating - awayRating;
		const absDiff = Math.abs(scoreDiff);

		let predictedTeam = "Draw";
		if (absDiff >= 0.14) {
			predictedTeam = scoreDiff >= 0 ? home : away;
		}

		const leanPct = predictedTeam === "Draw"
			? clampNumber(50.2 + (absDiff * 7), 50.2, 54.8)
			: clampNumber(51 + (absDiff * 7.5), 51, 57.2);
		const confidence = leanPct >= 57 ? "very high" : leanPct >= 54 ? "high" : leanPct >= 52 ? "average" : leanPct >= 51 ? "low" : "very low";
		const edgePct = Math.max(1.8, Math.min(6.5, absDiff * 8));
		const label = predictedTeam === "Draw" ? "Prediction: Draw" : "Prediction: " + predictedTeam + " to win";

		return {
			label,
			predictedTeam,
			edgePct,
			source: "hybrid-history-model",
			confidence,
			leanPct: Number(leanPct).toFixed(1)
		};
	}

	const homeRating = ((homeStats.points / Math.max(homeStats.matches, 1)) * 1.6)
		+ ((homeStats.goalsFor / Math.max(homeStats.matches, 1)) * 2.1)
		- ((homeStats.goalsAgainst / Math.max(homeStats.matches, 1)) * 1.8)
		+ (homeStats.recentForm / Math.max(homeStats.matches, 1));
	const awayRating = ((awayStats.points / Math.max(awayStats.matches, 1)) * 1.6)
		+ ((awayStats.goalsFor / Math.max(awayStats.matches, 1)) * 2.1)
		- ((awayStats.goalsAgainst / Math.max(awayStats.matches, 1)) * 1.8)
		+ (awayStats.recentForm / Math.max(awayStats.matches, 1));
	const scoreDiff = homeRating - awayRating;

	let predictedTeam = home;
	let leanPct = 50;
	let confidence = "very low";
	if (scoreDiff > 0.4) {
		predictedTeam = home;
		leanPct = clampNumber(51 + (scoreDiff * 7), 51, 57);
		confidence = leanPct >= 57 ? "very high" : leanPct >= 54 ? "high" : leanPct >= 52 ? "average" : leanPct >= 51 ? "low" : "very low";
	} else if (scoreDiff < -0.4) {
		predictedTeam = away;
		leanPct = clampNumber(51 + (Math.abs(scoreDiff) * 7), 51, 57);
		confidence = leanPct >= 57 ? "very high" : leanPct >= 54 ? "high" : leanPct >= 52 ? "average" : leanPct >= 51 ? "low" : "very low";
	} else {
		predictedTeam = "Draw";
		leanPct = clampNumber(50 + Math.abs(scoreDiff) * 5, 50, 55);
		confidence = leanPct >= 53 ? "average" : leanPct >= 51 ? "low" : "very low";
	}

	const edgePct = Math.max(2.2, Math.min(8, Math.abs(scoreDiff) * 8));
	const label = predictedTeam === "Draw" ? "Prediction: Draw" : "Prediction: " + predictedTeam + " to win";

	return {
		label,
		predictedTeam,
		edgePct,
		source: "historical-model",
		confidence,
		leanPct: Number(leanPct).toFixed(1)
	};
}

function getSportSuggestionType(sportKey) {
	const normalized = String(sportKey || "").toLowerCase();
	if (normalized.includes("basketball") || normalized.includes("nba") || normalized.includes("ncaa")) {
		return "basketball";
	}
	if (normalized.includes("tennis") || normalized.includes("atp") || normalized.includes("wta")) {
		return "tennis";
	}
	if (normalized.includes("baseball") || normalized.includes("mlb")) {
		return "baseball";
	}
	if (normalized.includes("ice_hockey") || normalized.includes("nhl") || normalized.includes("hockey")) {
		return "hockey";
	}
	if (normalized.includes("soccer") || normalized.includes("football") || normalized.includes("rugby") || normalized.includes("lacrosse")) {
		return "football";
	}
	return "default";
}

function buildTopBetSuggestions(eventRow, prediction, sportKey = "") {
	if (!eventRow || !prediction) {
		return [];
	}

	const home = eventRow && eventRow.home_team ? String(eventRow.home_team) : "Home";
	const away = eventRow && eventRow.away_team ? String(eventRow.away_team) : "Away";
	const predictedTeam = prediction && prediction.predictedTeam ? String(prediction.predictedTeam) : "";
	const leanValue = prediction && prediction.leanPct ? Number(prediction.leanPct) : 0;
	const confidence = normalizeConfidenceLabel(prediction && prediction.confidence ? prediction.confidence : "low");
	const sportType = getSportSuggestionType(sportKey);
	const isHighConfidence = confidence === "high" || confidence === "very high" || leanValue >= 54;
	const isMatchWinnerPick = predictedTeam && predictedTeam !== "Draw" && predictedTeam !== "Home" && predictedTeam !== "Away";
	const favoriteTeam = isMatchWinnerPick ? predictedTeam : "";

	if (!isHighConfidence) {
		return [];
	}

	const suggestions = [];

	if (sportType === "basketball") {
		if (favoriteTeam) {
			suggestions.push({ label: "Winner", labelText: favoriteTeam + " to win" });
		}
		if (leanValue >= 60) {
			suggestions.push({ label: "Points", labelText: favoriteTeam ? favoriteTeam + " team total points" : "Over total points" });
		}
		if (favoriteTeam && leanValue >= 66) {
			suggestions.push({ label: "Player", labelText: favoriteTeam + " player 20+ points" });
		}
	} else if (sportType === "tennis") {
		if (favoriteTeam) {
			suggestions.push({ label: "Winner", labelText: favoriteTeam + " to win match" });
		}
		if (leanValue >= 62) {
			suggestions.push({ label: "Games", labelText: favoriteTeam ? favoriteTeam + " +1.5 games" : "Over total games" });
		}
	} else if (sportType === "baseball") {
		if (favoriteTeam) {
			suggestions.push({ label: "Winner", labelText: favoriteTeam + " to win" });
		}
		if (leanValue >= 60) {
			suggestions.push({ label: "Runs", labelText: favoriteTeam ? favoriteTeam + " team over 2.5 runs" : "Over total runs" });
		}
	} else if (sportType === "hockey") {
		if (favoriteTeam && leanValue >= 62) {
			suggestions.push({ label: "Winner", labelText: favoriteTeam + " to win" });
		}
		if (leanValue >= 60 && (favoriteTeam || prediction.predictedTeam === "Draw")) {
			suggestions.push({ label: "Goals", labelText: favoriteTeam ? favoriteTeam + " over 2.5 goals" : "Over 5.5 goals" });
		}
		if (favoriteTeam && leanValue >= 66) {
			suggestions.push({ label: "Scorer", labelText: favoriteTeam + " anytime scorer" });
		}
	} else {
		if (favoriteTeam) {
			suggestions.push({ label: "Winner", labelText: favoriteTeam + " to win" });
		}
		if (leanValue >= 60 && favoriteTeam) {
			suggestions.push({ label: "Goals", labelText: favoriteTeam + " over 1.5 goals" });
		}
		if (favoriteTeam && leanValue >= 68) {
			suggestions.push({ label: "Scorer", labelText: favoriteTeam + " anytime scorer" });
		}
		if (!favoriteTeam && prediction.predictedTeam === "Draw") {
			suggestions.push({ label: "Draw", labelText: "Draw" });
		}
		if (favoriteTeam && leanValue < 68 && (home || away)) {
			suggestions.push({ label: "BTTS", labelText: home + " & " + away + " both to score" });
		}
	}

	const unique = [];
	const seen = new Set();
	for (const item of suggestions) {
		const key = item.label + ':' + item.labelText;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		unique.push(item);
	}

	if (unique.length <= 1) {
		return unique;
	}

	unique.sort((a, b) => {
		const aScore = a.label === 'Winner' ? 100 : a.label === 'Scorer' ? 80 : a.label === 'Goals' ? 70 : a.label === 'Points' ? 65 : a.label === 'Runs' ? 65 : a.label === 'Games' ? 60 : a.label === 'Player' ? 55 : a.label === 'BTTS' ? 50 : 40;
		const bScore = b.label === 'Winner' ? 100 : b.label === 'Scorer' ? 80 : b.label === 'Goals' ? 70 : b.label === 'Points' ? 65 : b.label === 'Runs' ? 65 : b.label === 'Games' ? 60 : b.label === 'Player' ? 55 : b.label === 'BTTS' ? 50 : 40;
		return bScore - aScore;
	});

	if (leanValue < 68) {
		return unique.slice(0, 1);
	}

	return unique.slice(0, 3);
}

function getFullHistoryMapForPrediction(historyMap) {
	if (Array.isArray(historyMap)) {
		return buildTeamHistoryMap(historyMap);
	}
	if (historyMap && typeof historyMap === 'object') {
		return historyMap;
	}
	return null;
}

function getDeterministicFallbackPrediction(eventRow, sportKey = "") {
	if (!eventRow) {
		return null;
	}
	const home = eventRow && eventRow.home_team ? String(eventRow.home_team) : "Home";
	const away = eventRow && eventRow.away_team ? String(eventRow.away_team) : "Away";
	if (!home && !away) {
		return null;
	}

	const base = (home + "|" + away + "|" + String(sportKey || "")).toLowerCase();
	let checksum = 0;
	for (let i = 0; i < base.length; i += 1) {
		checksum = (checksum + base.charCodeAt(i) * (i + 1)) % 9973;
	}
	const pickHome = (checksum % 2) === 0;
	const predictedTeam = pickHome ? home : away;
	const leanPct = (50.2 + ((checksum % 13) / 10)).toFixed(1);
	const edgePct = 1.2 + ((checksum % 8) * 0.2);

	return {
		label: "Prediction: " + predictedTeam + " to win",
		predictedTeam,
		edgePct: Number(edgePct.toFixed(1)),
		source: "fallback-model",
		confidence: "very low",
		leanPct
	};
}

function getPredictionForEvent(eventRow, oddsRow, historyMap = null, sportKey = "") {
	const lockedPrediction = getLockedPregamePrediction(eventRow, sportKey);
	if (lockedPrediction && lockedPrediction.predictedTeam) {
		return {
			...lockedPrediction,
			topBets: buildTopBetSuggestions(eventRow, lockedPrediction, sportKey)
		};
	}

	const home = eventRow && eventRow.home_team ? String(eventRow.home_team) : "Home";
	const away = eventRow && eventRow.away_team ? String(eventRow.away_team) : "Away";
	const effectiveHistoryMap = Array.isArray(historyMap)
		? buildPriorHistoryMapForEvent(historyMap, eventRow)
		: historyMap;
	const historyPrediction = getHistoricalPredictionForEvent(eventRow, effectiveHistoryMap);
	if (historyPrediction) {
		capturePregamePredictionSnapshot(eventRow, historyPrediction, sportKey);
		return {
			...historyPrediction,
			topBets: buildTopBetSuggestions(eventRow, historyPrediction, sportKey)
		};
	}

	const fullHistoryPrediction = getHistoricalPredictionForEvent(eventRow, getFullHistoryMapForPrediction(historyMap));
	if (fullHistoryPrediction) {
		capturePregamePredictionSnapshot(eventRow, fullHistoryPrediction, sportKey);
		return {
			...fullHistoryPrediction,
			topBets: buildTopBetSuggestions(eventRow, fullHistoryPrediction, sportKey)
		};
	}

	if (!oddsRow || !getSportsbetBookmakers(oddsRow).length) {
		const fallbackPrediction = getDeterministicFallbackPrediction(eventRow, sportKey);
		if (fallbackPrediction) {
			capturePregamePredictionSnapshot(eventRow, fallbackPrediction, sportKey);
			return {
				...fallbackPrediction,
				topBets: buildTopBetSuggestions(eventRow, fallbackPrediction, sportKey)
			};
		}
		return {
			label: "No prediction",
			predictedTeam: null,
			edgePct: null,
			source: "none",
			confidence: "low",
			leanPct: null,
			topBets: []
		};
	}

	const consensus = buildConsensusProbabilities(eventRow, oddsRow);
	if (!consensus) {
		const fallbackPrediction = getDeterministicFallbackPrediction(eventRow, sportKey);
		if (fallbackPrediction) {
			capturePregamePredictionSnapshot(eventRow, fallbackPrediction, sportKey);
			return {
				...fallbackPrediction,
				topBets: buildTopBetSuggestions(eventRow, fallbackPrediction, sportKey)
			};
		}
		return {
			label: "No prediction",
			predictedTeam: null,
			edgePct: null,
			source: "none",
			confidence: "low",
			leanPct: null,
			topBets: []
		};
	}

	const outcomes = [
		{ key: "home", team: home, prob: consensus.home },
		{ key: "away", team: away, prob: consensus.away }
	];
	if (consensus.draw > 0.001) {
		outcomes.push({ key: "draw", team: "Draw", prob: consensus.draw });
	}
	outcomes.sort((a, b) => b.prob - a.prob);

	const best = outcomes[0];
	const second = outcomes[1] || { prob: 0 };
	const calibratedProb = clampNumber(best.prob, 0.45, 0.56);
	const edgePct = Math.max(0.8, Math.min(5, (calibratedProb - second.prob) * 100));
	const agreementScore = Math.max(0, 1 - (consensus.agreementStdDev / 0.12));
	const sampleBoost = Math.min(1, consensus.sampleSize / 6);
	const confidenceScore = (edgePct / 5) * 0.5 + agreementScore * 0.35 + sampleBoost * 0.15;
	const confidence = confidenceScore >= 0.8 ? "very high" : confidenceScore >= 0.65 ? "high" : confidenceScore >= 0.5 ? "average" : confidenceScore >= 0.35 ? "low" : "very low";
	const leanPct = (Math.max(0.5, Math.min(0.56, calibratedProb)) * 100).toFixed(1);

	const label = best.key === "draw"
		? "Prediction: Draw"
		: "Prediction: " + best.team + " to win";

	const result = {
		label,
		predictedTeam: best.team,
		edgePct,
		source: "market-consensus",
		confidence,
		leanPct
	};
	capturePregamePredictionSnapshot(eventRow, result, sportKey);
	return {
		...result,
		topBets: buildTopBetSuggestions(eventRow, result, sportKey)
	};
}

function getTierClassFromWinChance(winChancePct) {
	if (!Number.isFinite(winChancePct)) {
		return "tier-red";
	}
	if (winChancePct < 55) {
		return "tier-red";
	}
	if (winChancePct < 65) {
		return "tier-orange";
	}
	if (winChancePct <= 85) {
		return "tier-green";
	}
	return "tier-gold";
}

function getWinChanceSummary(winChancePct, source) {
	if (!Number.isFinite(winChancePct)) {
		return "No reliable win probability is available from current odds, so this is a fallback estimate and should be treated cautiously.";
	}

	if (source === "fallback") {
		return "This percentage is generated from fallback logic because matching odds were not returned for this event, so confidence in the estimate is limited.";
	}

	if (winChancePct > 85) {
		return "This is a dominant probability profile where the selected side is priced as a heavy favorite, indicating a strong market expectation of a win.";
	}

	if (winChancePct >= 75) {
		return "This indicates a clear favorite with strong market support; the expected win likelihood is high and pricing advantage is usually stable.";
	}

	if (winChancePct >= 65) {
		return "This is a solid edge tier with meaningful separation between teams, suggesting a favorable but not overwhelming probability advantage.";
	}

	if (winChancePct >= 55) {
		return "This is a moderate lean where the market shows a noticeable preference, but outcomes can still swing with normal variance.";
	}

	return "This is a narrow or weak edge zone where pricing suggests a close matchup, so risk is higher and selection confidence should be conservative.";
}

function getTierClassFromEdge(edgePct) {
	if (!Number.isFinite(edgePct)) {
		return "tier-red";
	}
	if (edgePct < 0) {
		return "tier-red";
	}
	if (edgePct < 4) {
		return "tier-orange";
	}
	if (edgePct <= 15) {
		return "tier-green";
	}
	return "tier-gold";
}

function normalizeConfidenceLabel(value) {
	const normalized = String(value || '').trim().toLowerCase();
	if (normalized === 'very high') {
		return 'very high';
	}
	if (normalized === 'high') {
		return 'high';
	}
	if (normalized === 'average' || normalized === 'medium' || normalized === 'moderate') {
		return 'average';
	}
	if (normalized === 'low') {
		return 'low';
	}
	if (normalized === 'very low') {
		return 'very low';
	}
	return 'low';
}

function getTierClassFromConfidence(confidence, edgePct, source) {
	if (source === "fallback") {
		return "tier-orange";
	}
	const normalized = normalizeConfidenceLabel(confidence);
	if (normalized === "very high") {
		return "tier-gold";
	}
	if (normalized === "high") {
		return "tier-green";
	}
	if (normalized === "average") {
		return "tier-gold";
	}
	if (normalized === "low") {
		return "tier-orange";
	}
	return "tier-red";
}

function buildSummaryStrip({
	ratioText = null,
	totalOddsText = null,
	individualOddsText = null,
	individualWinningsText = null,
	ratioLabel = "Prediction ratio",
	totalOddsLabel = "Multi @ 1.00",
	individualWinningsLabel = "Singles @ 1.00"
} = {}) {
	const ratioMarkup = ratioText
		? '<div class="summary-stat"><span class="summary-label">' + escapeHtml(ratioLabel) + '</span><strong>' + escapeHtml(ratioText) + '</strong></div>'
		: '';
	const multiOddsValue = Number(totalOddsText);
	const multiWinningsText = Number.isFinite(multiOddsValue) && multiOddsValue > 0 ? '$' + (multiOddsValue * 100).toFixed(2) : null;
	const multiLabel = Number.isFinite(multiOddsValue) ? 'Multi @ ' + multiOddsValue.toFixed(2) : totalOddsLabel;
	const multiMarkup = multiWinningsText
		? '<div class="summary-stat"><span class="summary-label">' + escapeHtml(multiLabel) + '</span><strong>' + escapeHtml(multiWinningsText) + '</strong></div>'
		: '';
	const normalizedSinglesOddsValue = Number.isFinite(Number(individualOddsText)) ? Number(individualOddsText) : (Number.isFinite(Number(individualWinningsText)) ? Number(individualWinningsText) / 100 : NaN);
	const normalizedSinglesStakeValue = Number.isFinite(Number(individualWinningsText)) ? Number(individualWinningsText) : (Number.isFinite(Number(individualOddsText)) ? Number(individualOddsText) * 100 : NaN);
	const individualOddsValue = Number(normalizedSinglesOddsValue);
	const individualStakeValue = Number(normalizedSinglesStakeValue);
	const individualWinningsTextValue = Number.isFinite(individualStakeValue) && individualStakeValue > 0 ? '$' + individualStakeValue.toFixed(2) : null;
	const individualLabel = Number.isFinite(individualOddsValue) ? 'Singles @ ' + individualOddsValue.toFixed(2) : individualWinningsLabel;
	const individualMarkup = individualWinningsTextValue
		? '<div class="summary-stat"><span class="summary-label">' + escapeHtml(individualLabel) + '</span><strong>' + escapeHtml(individualWinningsTextValue) + '</strong></div>'
		: '';
	if (!ratioMarkup && !multiMarkup && !individualMarkup) {
		return '';
	}
	return '<div class="summary-strip">' + ratioMarkup + multiMarkup + individualMarkup + '</div>';
}

function getNumericOddsValue(rawValue) {
	const parsed = Number(rawValue);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getEventStartTimestamp(value) {
	const source = value && value.row ? value.row : value;
	const start = source && source.commence_time ? source.commence_time : value && value.start ? value.start : '';
	const ts = new Date(start).getTime();
	return Number.isFinite(ts) ? ts : Number.POSITIVE_INFINITY;
}

function isLiveEventRow(row) {
	if (!row || typeof row !== 'object') {
		return false;
	}
	const status = String(row.status || row.game_status || row.state || row.live_status || '').trim().toLowerCase();
	if (status.includes('final') || status.includes('complete') || status.includes('ended') || status.includes('postponed')) {
		return false;
	}
	if (status.includes('live') || status.includes('in progress') || status.includes('in_play') || status.includes('in-play') || status.includes('in play') || status === 'inprogress' || status === 'ongoing' || status === 'active' || status === 'playing' || status === 'started') {
		return true;
	}
	if (row.completed === true || row.is_completed === true) {
		return false;
	}
	if (Array.isArray(row.scores) && row.scores.length > 0) {
		return true;
	}
	const startTs = getEventStartTimestamp(row);
	if (!Number.isFinite(startTs)) {
		return false;
	}
	const now = Date.now();
	return startTs <= now && (now - startTs) <= (8 * 60 * 60 * 1000);
}

function getRowsForSelectedRange(eventRows, rangeKey, rangeWindow, liveRows = null) {
	const normalizedRange = normalizeRangeKey(rangeKey);
	if (normalizedRange === 'live') {
		const sourceRows = Array.isArray(liveRows) && liveRows.length
			? liveRows
			: Array.isArray(eventRows) ? eventRows : [];
		return sourceRows.filter(isLiveEventRow).sort((a, b) => getEventStartTimestamp(a) - getEventStartTimestamp(b));
	}
	return (Array.isArray(eventRows) ? eventRows : [])
		.filter((row) => {
			const ts = getEventStartTimestamp(row);
			if (!Number.isFinite(ts)) {
				return false;
			}
			if (isLiveEventRow(row)) {
				return false;
			}
			const nowCutoff = Date.now() + GAME_START_BUFFER_MS;
			return ts >= Math.max(rangeWindow.start.getTime(), nowCutoff) && ts <= Math.min(rangeWindow.end.getTime(), Date.now() + (7 * 24 * 60 * 60 * 1000));
		})
		.sort((a, b) => getEventStartTimestamp(a) - getEventStartTimestamp(b));
}

function sortByStart(items, direction = 'asc') {
	const ordered = (Array.isArray(items) ? items : []).slice();
	ordered.sort((a, b) => {
		const startA = getEventStartTimestamp(a);
		const startB = getEventStartTimestamp(b);
		return direction === 'desc' ? startB - startA : startA - startB;
	});
	return ordered;
}

function sortByStartAsc(items) {
	return sortByStart(items, 'asc');
}

function sortByStartDesc(items) {
	return sortByStart(items, 'desc');
}

function matchesResultsSearch(sportTitle, home, away) {
	const term = String(state.resultsSearch || '').trim().toLowerCase();
	if (!term) {
		return true;
	}
	const haystack = [sportTitle, home, away]
		.map((value) => String(value || '').trim().toLowerCase())
		.filter(Boolean)
		.join(' ');
	return haystack.includes(term);
}

function buildPredictionContext(entry, oddsByEventId, historyMap = null, sportKey = '') {
	const row = entry && entry.row ? entry.row : entry;
	const fallbackSportKey = entry && entry.sportKey ? String(entry.sportKey) : sportKey;
	const eventId = row && row.id ? String(row.id) : '';
	const oddsRow = entry && entry.oddsRow
		? entry.oddsRow
		: (eventId && oddsByEventId ? oddsByEventId[eventId] : null);
	const prediction = entry && entry.prediction
		? entry.prediction
		: getPredictionForEvent(row, oddsRow, entry && entry.historyMap ? entry.historyMap : historyMap, fallbackSportKey);
	return { row, oddsRow, prediction, sportKey: fallbackSportKey };
}

function buildRecentSummary(events, oddsByEventId, historyMap = null, sportKey = "") {
	let wins = 0;
	let losses = 0;
	let totalOdds = 1;
	let totalOddsCount = 0;

	for (const entry of Array.isArray(events) ? events : []) {
		const priorHistoryRows = Array.isArray(historyMap) ? historyMap : (Array.isArray(events) ? events : []);
		const context = buildPredictionContext(entry, oddsByEventId, priorHistoryRows, sportKey);
		const row = context.row;
		const oddsRow = context.oddsRow;
		const prediction = context.prediction;
		if (!matchesWinRateFilter(prediction)) {
			continue;
		}
		const oddsValue = prediction && prediction.predictedTeam ? getNumericOddsValue(getBookmakerOddsForPrediction(row, oddsRow, prediction)) : null;
		if (prediction && prediction.predictedTeam) {
			totalOdds *= oddsValue !== null ? oddsValue : 1;
			totalOddsCount += 1;
		}
		const result = prediction && prediction.predictedTeam ? getPredictionResultForCompletedEvent(row, prediction.predictedTeam) : null;
		if (result && result.label === 'Won') {
			wins += 1;
		} else if (result && result.label === 'Lost') {
			losses += 1;
		}
	}

	const ratioText = wins || losses ? (losses > 0 ? wins + ':' + losses : wins + ':0') : '0:0';
	const individualOddsTotal = totalOddsCount > 0 ? (Array.isArray(events) ? events : []).reduce((sum, entry) => {
		const context = buildPredictionContext(entry, oddsByEventId, Array.isArray(historyMap) ? historyMap : (Array.isArray(events) ? events : []), sportKey);
		const prediction = context.prediction;
		if (!matchesWinRateFilter(prediction)) {
			return sum;
		}
		const oddsValue = prediction && prediction.predictedTeam ? getNumericOddsValue(getBookmakerOddsForPrediction(context.row, context.oddsRow, prediction)) : null;
		return Number.isFinite(oddsValue) ? sum + oddsValue : sum;
	}, 0) : 0;
	return {
		ratioText,
		totalOddsText: totalOddsCount > 0 ? totalOdds.toFixed(2) : '1.00',
		individualOddsText: totalOddsCount > 0 ? individualOddsTotal.toFixed(2) : '0.00',
		individualWinningsText: totalOddsCount > 0 ? (individualOddsTotal * 100).toFixed(2) : '0.00'
	};
}

function buildUpcomingSummary(events, oddsByEventId, historyMap = null, sportKey = "") {
	let totalOdds = 1;
	let totalOddsCount = 0;
	for (const entry of Array.isArray(events) ? events : []) {
		const context = buildPredictionContext(entry, oddsByEventId, historyMap || null, sportKey);
		const row = context.row;
		const oddsRow = context.oddsRow;
		const prediction = context.prediction;
		if (!matchesWinRateFilter(prediction)) {
			continue;
		}
		const oddsValue = prediction && prediction.predictedTeam ? getNumericOddsValue(getBookmakerOddsForPrediction(row, oddsRow, prediction)) : null;
		if (prediction && prediction.predictedTeam) {
			totalOdds *= oddsValue !== null ? oddsValue : 1;
			totalOddsCount += 1;
		}
	}
	const individualOddsTotal = totalOddsCount > 0 ? (Array.isArray(events) ? events : []).reduce((sum, entry) => {
		if (isLiveEventRow(entry)) {
			return sum;
		}
		const context = buildPredictionContext(entry, oddsByEventId, historyMap || null, sportKey);
		const prediction = context.prediction;
		if (!matchesWinRateFilter(prediction)) {
			return sum;
		}
		const oddsValue = prediction && prediction.predictedTeam ? getNumericOddsValue(getBookmakerOddsForPrediction(context.row, context.oddsRow, prediction)) : null;
		return Number.isFinite(oddsValue) ? sum + oddsValue : sum;
	}, 0) : 0;
	return {
		totalOddsText: totalOddsCount > 0 ? totalOdds.toFixed(2) : '1.00',
		individualOddsText: totalOddsCount > 0 ? individualOddsTotal.toFixed(2) : '0.00',
		individualWinningsText: totalOddsCount > 0 ? (individualOddsTotal * 100).toFixed(2) : '0.00'
	};
}

function getRecentSportTitlesForBar(fallbackTitle = '') {
	const titlesFromItems = Array.from(new Set((Array.isArray(state.allRecentResultsItems) ? state.allRecentResultsItems : []).map((item) => String(item && item.sportTitle ? item.sportTitle : item && item.sportKey ? item.sportKey : '').trim()).filter(Boolean)));
	if (titlesFromItems.length > 0) {
		return titlesFromItems.sort((a, b) => a.localeCompare(b));
	}
	const fallback = String(fallbackTitle || '').trim();
	return fallback ? [fallback] : [];
}

function renderRecentResults(sportKey, events, oddsByEventId, historyMap = null) {
	bindGameCardInteractions();
	const meta = state.sportsByKey[sportKey] || {};
	const sportTitle = meta.title ? String(meta.title) : sportKey;
	setResultSportOptions(getRecentSportTitlesForBar(sportTitle));
	state.activeRecentSportData = {
		sportKey,
		events: Array.isArray(events) ? events.slice() : [],
		oddsByEventId: oddsByEventId || {},
		historyMap: historyMap || null
	};
	if (!Array.isArray(events) || !events.length) {
		el.upcomingWrap.innerHTML = '<p class="subhead">Recent Results | ' + escapeHtml(sportTitle) + '</p><div class="empty">No recent results available for this sport.</div>';
		return;
	}

	const sortedEvents = sortByStartDesc(events);
	const predictedRows = [];
	const noPredictionRows = [];
	for (const row of sortedEvents) {
		const home = row && row.home_team ? String(row.home_team) : "Home";
		const away = row && row.away_team ? String(row.away_team) : "Away";
		if (!matchesResultsSearch(sportTitle, home, away)) {
			continue;
		}
		const start = row && row.commence_time ? String(row.commence_time) : "";
		const eventId = row && row.id ? String(row.id) : "";
		const oddsRow = eventId && oddsByEventId ? oddsByEventId[eventId] : null;
		const priorHistoryRows = Array.isArray(historyMap) ? historyMap : (Array.isArray(events) ? events : []);
		const prediction = getPredictionForEvent(row, oddsRow, priorHistoryRows, sportKey);
		const hasPrediction = Boolean(prediction && prediction.predictedTeam);
		if (!hasPrediction) {
			noPredictionRows.push({ row, prediction, oddsRow, start, home, away });
			continue;
		}
		if (!matchesWinRateFilter(prediction)) {
			continue;
		}
		predictedRows.push({ row, prediction, oddsRow, start, home, away });
	}

	const summaryRows = predictedRows.map(({ row, oddsRow, prediction }) => ({
		row,
		oddsRow,
		prediction,
		sportKey
	}));
	const summary = buildRecentSummary(summaryRows, {}, historyMap, sportKey);

	const cardsHtml = [...predictedRows, ...noPredictionRows].map(({ row, prediction, oddsRow, start, home, away }) => {
		const scoreText = getEventScoreText(row);
		const hasPrediction = Boolean(prediction && prediction.predictedTeam);
		const betName = prediction && prediction.label ? String(prediction.label).replace(/^Prediction:\s*/i, "") : "No prediction";
		const edgeText = Number.isFinite(Number(prediction && prediction.edgePct)) ? Number(prediction.edgePct).toFixed(1) + "%" : "N/A";
		const winChanceValue = prediction && prediction.leanPct != null ? Number(prediction.leanPct) : NaN;
		const winChanceText = Number.isFinite(winChanceValue) ? prediction.leanPct + "%" : "N/A";
		const confidenceText = normalizeConfidenceLabel(prediction && prediction.confidence ? prediction.confidence : "low");
		const winTierClass = getTierClassFromWinChance(winChanceValue);
		const edgeTierClass = getTierClassFromEdge(Number(prediction && prediction.edgePct));
		const confidenceTierClass = prediction && prediction.confidence ? getTierClassFromConfidence(confidenceText, Number(prediction && prediction.edgePct), prediction && prediction.source ? prediction.source : "none") : 'tier-neutral';
		const completedPredictionResult = hasPrediction ? getPredictionResultForCompletedEvent(row, prediction.predictedTeam) : { label: "No prediction", tierClass: "tier-neutral" };
		const livePredictionStatus = hasPrediction ? getLivePredictionStatus(row, prediction.predictedTeam) : null;
		const predictionOdds = getDisplayOddsForEvent(row, oddsRow, prediction);
		const insightsPanel = hasPrediction
			? attachTopBetsToInsights(buildGameInsightsPanel(row, prediction, Array.isArray(historyMap) ? historyMap : (Array.isArray(events) ? events : []), oddsRow), prediction.topBets)
			: '';
		const expandHint = insightsPanel ? '<p class="card-expand-hint">Tap card for matchup insights</p>' : '';
		const cardExpandAttrs = insightsPanel ? ' data-expand-card="true" role="button" tabindex="0" aria-expanded="false"' : '';
		const oddsBadge = predictionOdds ? '<span class="odds-pill" title="Pre-game odds at kickoff">Pre: ' + escapeHtml(predictionOdds) + '</span>' : '';
		const confidenceBadge = prediction && prediction.confidence
			? '<span class="meta-pill ' + confidenceTierClass + '">Conf: ' + escapeHtml(confidenceText) + '</span>'
			: '';
		const winBadge = hasPrediction ? '<span class="meta-pill ' + winTierClass + '">Win: ' + escapeHtml(winChanceText) + '</span>' : '<span class="meta-pill tier-neutral">Win: N/A</span>';
		const edgeBadge = hasPrediction ? '<span class="meta-pill ' + edgeTierClass + '">Edge: ' + escapeHtml(edgeText) + '</span>' : '<span class="meta-pill tier-neutral">Edge: N/A</span>';
		const resultBadge = hasPrediction
			? '<span class="meta-pill ' + completedPredictionResult.tierClass + '">Result: ' + escapeHtml(completedPredictionResult.label) + '</span>'
			: '<span class="meta-pill tier-neutral">Result: No prediction</span>';
		const resultClass = livePredictionStatus === 'win'
			? 'result-win'
			: livePredictionStatus === 'loss'
				? 'result-loss'
				: completedPredictionResult && completedPredictionResult.label === 'Won'
					? 'result-win'
					: completedPredictionResult && completedPredictionResult.label === 'Lost'
						? 'result-loss'
						: '';

		return '<article class="game-card ' + (resultClass ? escapeHtml(resultClass) : '') + '"' + cardExpandAttrs + '>'
			+ '<div class="game-head">'
			+ '<div class="matchup-block">'
			+ '<div class="matchup-title-row">'
			+ '<span class="meta-pill sport-tag">Sport: ' + escapeHtml(sportTitle) + '</span>'
			+ '<p class="matchup">' + escapeHtml(home + ' vs ' + away) + '</p>'
			+ '</div>'
			+ '<p class="kickoff">Started: ' + escapeHtml(formatDateTime(start)) + '</p>'
			+ '</div>'
			+ '<div class="prediction-side">'
			+ '<div class="prediction-stack">'
			+ '<div class="prediction-row">'
			+ '<p class="bet-name">' + escapeHtml(betName) + '</p>'
			+ oddsBadge
			+ '</div>'
			+ '<div class="game-meta compact right-aligned">'
			+ '<span class="meta-pill">Score: ' + escapeHtml(scoreText) + '</span>'
			+ winBadge
			+ edgeBadge
			+ confidenceBadge
			+ resultBadge
			+ '</div>'
			+ '</div>'
			+ '</div>'
			+ '</div>'
			+ expandHint
			+ insightsPanel
			+ '</article>';
	}).join("");

	if (!cardsHtml) {
		el.upcomingWrap.innerHTML = '<p class="subhead">Recent Results | ' + escapeHtml(sportTitle) + '</p><div class="empty">No recent results match your search.</div>';
		return;
	}

	el.upcomingWrap.innerHTML = '<p class="subhead">Recent Results | ' + escapeHtml(sportTitle) + ' | ' + events.length + ' events</p>'
		+ buildSummaryStrip({
			ratioText: summary.ratioText,
			totalOddsText: summary.totalOddsText,
			individualOddsText: summary.individualOddsText,
			individualWinningsText: summary.individualWinningsText,
			totalOddsLabel: 'Multi @ ' + Number(summary.totalOddsText ?? 1).toFixed(2),
			individualWinningsLabel: 'Singles @ ' + Number(summary.individualOddsText ?? 0).toFixed(2)
		})
		+ '<div class="upcoming-list">' + cardsHtml + '</div>';
}

function renderUpcomingEvents(sportKey, events, oddsByEventId, rangeKey = state.timeRange, historyMap = null) {
	bindGameCardInteractions();
	const meta = state.sportsByKey[sportKey] || {};
	const sportTitle = meta.title ? String(meta.title) : sportKey;
	setResultSportOptions([sportTitle]);
	state.activeUpcomingSportData = {
		sportKey,
		events: Array.isArray(events) ? events.slice() : [],
		oddsByEventId: oddsByEventId || {},
		rangeKey,
		historyMap: historyMap || null
	};
	const rangeLabel = getRangeLabel(rangeKey);
	if (!Array.isArray(events) || !events.length) {
		el.upcomingWrap.innerHTML = '<p class="subhead">Upcoming Games | ' + escapeHtml(sportTitle) + ' | ' + escapeHtml(rangeLabel) + '</p><div class="empty">No favored games found for ' + escapeHtml(rangeLabel.toLowerCase()) + '.</div>';
		return;
	}

	const days = [];
	const dayMap = {};
	const dayFormatter = new Intl.DateTimeFormat(undefined, { weekday: "short" });
		const dateFormatter = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
	const now = new Date();
	const dayCount = 1;
	const startDayOffset = 0;
	for (let i = 0; i < dayCount; i += 1) {
		const dayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + startDayOffset + i);
		const key = dayDate.getFullYear() + "-" + String(dayDate.getMonth() + 1).padStart(2, "0") + "-" + String(dayDate.getDate()).padStart(2, "0");
		const dayObj = {
			key,
			dayLabel: dayFormatter.format(dayDate),
			dateLabel: dateFormatter.format(dayDate),
			items: []
		};
		days.push(dayObj);
		dayMap[key] = dayObj;
	}

	for (const row of events) {
		const homeName = row && row.home_team ? String(row.home_team) : "Home";
		const awayName = row && row.away_team ? String(row.away_team) : "Away";
		if (!matchesResultsSearch(sportTitle, homeName, awayName)) {
			continue;
		}
		const start = row && row.commence_time ? String(row.commence_time) : "";
		const startDate = new Date(start);
		if (!Number.isFinite(startDate.getTime())) {
			continue;
		}
		const key = startDate.getFullYear() + "-" + String(startDate.getMonth() + 1).padStart(2, "0") + "-" + String(startDate.getDate()).padStart(2, "0");
		if (!dayMap[key]) {
			continue;
		}
		const oddsRow = row && row.id && oddsByEventId ? oddsByEventId[String(row.id)] : null;
		const prediction = getPredictionForEvent(row, oddsRow, historyMap, sportKey);
		if (!matchesWinRateFilter(prediction)) {
			continue;
		}
		const predictionOdds = getDisplayOddsForEvent(row, oddsRow, prediction);
		const scoreText = hasUsableScoreData(row) ? getEventScoreText(row) : '';
		const winChanceValue = prediction && prediction.leanPct != null ? Number(prediction.leanPct) : NaN;
		const confidenceText = normalizeConfidenceLabel(prediction && prediction.confidence ? prediction.confidence : "low");
		const winTierClass = getTierClassFromWinChance(winChanceValue);
		const edgeTierClass = getTierClassFromEdge(Number(prediction && prediction.edgePct));
		const confidenceTierClass = prediction && prediction.confidence ? getTierClassFromConfidence(confidenceText, Number(prediction && prediction.edgePct), prediction && prediction.source ? prediction.source : "none") : 'tier-neutral';
		const hasPrediction = Boolean(prediction && prediction.predictedTeam);
		const livePredictionStatus = hasPrediction && isLiveEventRow(row) ? getLivePredictionStatus(row, prediction.predictedTeam) : null;
		const resultClass = livePredictionStatus === 'win' ? 'result-win' : livePredictionStatus === 'loss' ? 'result-loss' : '';
		const resultBadge = hasPrediction && livePredictionStatus
			? '<span class="meta-pill ' + (livePredictionStatus === 'win' ? 'tier-green' : 'tier-red') + '">Result: ' + (livePredictionStatus === 'win' ? 'Winning' : 'Losing') + '</span>'
			: '';
		const insightsPanel = hasPrediction
			? attachTopBetsToInsights(buildGameInsightsPanel(row, prediction, historyMap, oddsRow), prediction.topBets)
			: '';
		const item = {
			row,
			oddsRow,
			prediction,
			sportKey,
			sportTitle,
			home: homeName,
			away: awayName,
			start,
			betName: prediction && prediction.label ? String(prediction.label).replace(/^Prediction:\s*/i, "") : "No prediction",
			predictionOdds,
			scoreText: hasUsableScoreData(row) ? getEventScoreText(row) : '',
			winChanceText: Number.isFinite(winChanceValue) ? prediction.leanPct + "%" : "N/A",
			edgeText: Number.isFinite(Number(prediction && prediction.edgePct)) ? Number(prediction.edgePct).toFixed(1) + "%" : "N/A",
			confidenceText,
			winTierClass,
			edgeTierClass,
			confidenceTierClass,
			topBets: Array.isArray(prediction && prediction.topBets) ? prediction.topBets : [],
			hasPrediction,
			insightsPanel,
			livePredictionStatus,
			resultClass,
			resultBadge
		};
		dayMap[key].items.push(item);
	}

	const visibleSummaryItems = days.flatMap((day) => Array.isArray(day.items) ? day.items : []);
	const upcomingSummary = buildUpcomingSummary(visibleSummaryItems, {}, historyMap, sportKey);
	const sectionHtml = days.map((day) => {
		const cardsHtml = (day.items || []).slice().sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()).map((item) => {
			const liveGame = Boolean(item && item.start && isLiveEventRow({ commence_time: item.start }));
			const oddsBadge = !liveGame && item.predictionOdds ? '<span class="odds-pill" title="Pre-game odds at kickoff">Pre: ' + escapeHtml(item.predictionOdds) + '</span>' : '';
			const scoreBadge = item.scoreText ? '<span class="meta-pill">Score: ' + escapeHtml(item.scoreText) + '</span>' : '';
			const expandHint = item.insightsPanel ? '<p class="card-expand-hint">Tap card for matchup insights</p>' : '';
			const cardExpandAttrs = item.insightsPanel ? ' data-expand-card="true" role="button" tabindex="0" aria-expanded="false"' : '';
			const resultClass = item.resultClass ? ' ' + item.resultClass : '';
			return '<article class="game-card' + resultClass + '"' + cardExpandAttrs + '>'
				+ '<div class="game-head">'
				+ '<div class="matchup-block">'
				+ '<div class="matchup-title-row">'
				+ '<span class="meta-pill sport-tag">Sport: ' + escapeHtml(sportTitle) + '</span>'
				+ '<p class="matchup">' + escapeHtml(item.home + ' vs ' + item.away) + '</p>'
				+ '</div>'
				+ '<p class="kickoff">Starts: ' + escapeHtml(formatDateTime(item.start)) + '</p>'
				+ '</div>'
				+ '<div class="prediction-side">'
				+ '<div class="prediction-stack">'
				+ '<div class="prediction-row">'
				+ '<p class="bet-name">' + escapeHtml(item.betName) + '</p>'
				+ oddsBadge
				+ '</div>'
				+ '<div class="game-meta compact right-aligned">'
				+ (scoreBadge || '')
				+ '<span class="meta-pill ' + item.winTierClass + '">Win: ' + escapeHtml(item.winChanceText) + '</span>'
				+ '<span class="meta-pill ' + item.edgeTierClass + '">Edge: ' + escapeHtml(item.edgeText) + '</span>'
				+ (item.confidenceText ? '<span class="meta-pill ' + item.confidenceTierClass + '">Conf: ' + escapeHtml(item.confidenceText) + '</span>' : '')
				+ (item.resultBadge || '')
				+ '</div>'
				+ '</div>'
				+ '</div>'
				+ '</div>'
				+ expandHint
				+ (item.insightsPanel || '')
				+ '</article>';
		}).join("");

		return '<section class="day-group">'
			+ '<p class="saved-date-title">' + escapeHtml(day.dayLabel + ' · ' + day.dateLabel) + '</p>'
			+ '<div class="upcoming-list">' + cardsHtml + '</div>'
			+ '</section>';
	}).join("");

	if (!sectionHtml || !days.some((day) => Array.isArray(day.items) && day.items.length > 0)) {
		el.upcomingWrap.innerHTML = '<p class="subhead">Upcoming Games | ' + escapeHtml(sportTitle) + ' | ' + escapeHtml(rangeLabel) + '</p><div class="empty">No games match your search.</div>';
		return;
	}

	el.upcomingWrap.innerHTML = '<p class="subhead">Upcoming Games | ' + escapeHtml(sportTitle) + ' | ' + escapeHtml(rangeLabel) + '</p>'
		+ buildSummaryStrip({
			totalOddsText: upcomingSummary.totalOddsText,
			individualOddsText: upcomingSummary.individualOddsText,
			individualWinningsText: upcomingSummary.individualWinningsText,
			totalOddsLabel: 'Multi @ ' + Number(upcomingSummary.totalOddsText ?? 1).toFixed(2),
			individualWinningsLabel: 'Singles @ ' + Number(upcomingSummary.individualOddsText ?? 0).toFixed(2)
		})
		+ sectionHtml;
}

function renderUpcomingEventsForSavedSports(items, totalSportCount, visibleSportCount) {
	bindGameCardInteractions();
	const allItems = Array.isArray(items) ? items : [];
	const selectedSport = state.resultSportFilter;
	const scopedItems = selectedSport === 'all'
		? allItems
		: allItems.filter((item) => String(item && item.sportTitle ? item.sportTitle : '') === selectedSport);
	const visibleItems = scopedItems.filter((item) => {
		const home = item && item.home ? String(item.home) : item && item.row && item.row.home_team ? String(item.row.home_team) : '';
		const away = item && item.away ? String(item.away) : item && item.row && item.row.away_team ? String(item.row.away_team) : '';
		const sportTitle = item && item.sportTitle ? String(item.sportTitle) : item && item.sportKey ? String(item.sportKey) : '';
		return matchesResultsSearch(sportTitle, home, away);
	});
	if (!visibleItems.length) {
		el.upcomingWrap.innerHTML = '<p class="subhead">Upcoming Games | Saved Sports</p><div class="empty">No games match your search.</div>';
		return;
	}

	const renderCard = (item) => {
		const prediction = item && item.prediction ? item.prediction : {};
		const sportKey = item && item.sportKey ? String(item.sportKey) : "";
		const eventRow = item && item.row ? item.row : { home_team: item.home, away_team: item.away, commence_time: item.start };
		const oddsRow = item && item.oddsRow ? item.oddsRow : null;
		const historyMap = item && item.historyMap ? item.historyMap : null;
		const betName = prediction && prediction.label ? String(prediction.label).replace(/^Prediction:\s*/i, "") : "No prediction";
		const predictionOdds = getDisplayOddsForEvent(eventRow, oddsRow, prediction);
		const edgeText = Number.isFinite(Number(prediction && prediction.edgePct)) ? Number(prediction.edgePct).toFixed(1) + "%" : "N/A";
		const winChanceValue = prediction && prediction.leanPct != null ? Number(prediction.leanPct) : NaN;
		const winChanceText = Number.isFinite(winChanceValue) ? prediction.leanPct + "%" : "N/A";
		const confidenceText = normalizeConfidenceLabel(prediction && prediction.confidence ? prediction.confidence : "low");
		const winTierClass = getTierClassFromWinChance(winChanceValue);
		const edgeTierClass = getTierClassFromEdge(Number(prediction && prediction.edgePct));
		const confidenceTierClass = prediction && prediction.confidence ? getTierClassFromConfidence(confidenceText, Number(prediction && prediction.edgePct), prediction && prediction.source ? prediction.source : "none") : 'tier-neutral';
		const sportSpecificTopBets = prediction && prediction.predictedTeam ? buildTopBetSuggestions({ home: item.home, away: item.away }, prediction, sportKey) : [];
		const oddsBadge = !isLiveEventRow(eventRow) && predictionOdds ? '<span class="odds-pill" title="Pre-game odds at kickoff">Pre: ' + escapeHtml(predictionOdds) + '</span>' : '';
		const confidenceBadge = prediction && prediction.confidence
			? '<span class="meta-pill ' + confidenceTierClass + '">Conf: ' + escapeHtml(confidenceText) + '</span>'
			: '';
		const hasPrediction = Boolean(prediction && prediction.predictedTeam);
		const livePredictionStatus = hasPrediction && isLiveEventRow(eventRow) ? getLivePredictionStatus(eventRow, prediction.predictedTeam) : null;
		const resultClass = livePredictionStatus === 'win' ? 'result-win' : livePredictionStatus === 'loss' ? 'result-loss' : '';
		const resultBadge = livePredictionStatus
			? '<span class="meta-pill ' + (livePredictionStatus === 'win' ? 'tier-green' : 'tier-red') + '">Result: ' + (livePredictionStatus === 'win' ? 'Winning' : 'Losing') + '</span>'
			: '';
		const scoreBadge = hasUsableScoreData(eventRow) ? '<span class="meta-pill">Score: ' + escapeHtml(getEventScoreText(eventRow)) + '</span>' : '';
		const insightsPanel = hasPrediction
			? attachTopBetsToInsights(buildGameInsightsPanel(eventRow, prediction, historyMap, oddsRow), sportSpecificTopBets)
			: '';
		const expandHint = insightsPanel ? '<p class="card-expand-hint">Tap card for matchup insights</p>' : '';
		const cardExpandAttrs = insightsPanel ? ' data-expand-card="true" role="button" tabindex="0" aria-expanded="false"' : '';
		return '<article class="game-card' + (resultClass ? ' ' + resultClass : '') + '"' + cardExpandAttrs + '>'
			+ '<div class="game-head">'
			+ '<div class="matchup-block">'
			+ '<div class="matchup-title-row">'
			+ '<span class="meta-pill sport-tag">Sport: ' + escapeHtml(item.sportTitle) + '</span>'
			+ '<p class="matchup">' + escapeHtml(item.home + ' vs ' + item.away) + '</p>'
			+ '</div>'
			+ '<p class="kickoff">Starts: ' + escapeHtml(formatDateTime(item.start)) + '</p>'
			+ '</div>'
			+ '<div class="prediction-side">'
			+ '<div class="prediction-stack">'
			+ '<div class="prediction-row">'
			+ '<p class="bet-name">' + escapeHtml(betName) + '</p>'
			+ oddsBadge
			+ '</div>'
			+ '<div class="game-meta compact right-aligned">'
			+ scoreBadge
			+ '<span class="meta-pill ' + winTierClass + '">Win: ' + escapeHtml(winChanceText) + '</span>'
			+ '<span class="meta-pill ' + edgeTierClass + '">Edge: ' + escapeHtml(edgeText) + '</span>'
			+ confidenceBadge
			+ resultBadge
			+ '</div>'
			+ '</div>'
			+ '</div>'
			+ '</div>'
			+ expandHint
			+ insightsPanel
			+ '</article>';
	};

	const upcomingSummary = buildUpcomingSummary(visibleItems, {}, null, '');
	const cardsHtml = sortByStartAsc(visibleItems).map((item) => renderCard(item)).join('');

	el.upcomingWrap.innerHTML = '<p class="subhead">Upcoming Games | Saved Sports | ' + visibleItems.length + ' bets (56%+)</p>'
		+ buildSummaryStrip({
			totalOddsText: upcomingSummary.totalOddsText,
			individualOddsText: upcomingSummary.individualOddsText,
			individualWinningsText: upcomingSummary.individualWinningsText,
			totalOddsLabel: 'Multi @ ' + Number(upcomingSummary.totalOddsText ?? 1).toFixed(2),
			individualWinningsLabel: 'Singles @ ' + Number(upcomingSummary.individualOddsText ?? 0).toFixed(2)
		})
		+ '<div class="upcoming-list compact">' + cardsHtml + '</div>';
}

function renderUpcomingSportBatch() {
	state.activeUpcomingSportData = null;
	const allGames = Array.isArray(state.allUpcomingGames) ? state.allUpcomingGames : [];
	const sourceTitles = Array.isArray(state.favoriteUpcomingSportTitles) && state.favoriteUpcomingSportTitles.length
		? state.favoriteUpcomingSportTitles
		: allGames.map((item) => item && item.sportTitle ? String(item.sportTitle) : '');
	const sportOrder = [];
	const seenSportNames = new Set();
	for (const title of sourceTitles) {
		const sportTitle = String(title || '').trim();
		if (!sportTitle || seenSportNames.has(sportTitle)) {
			continue;
		}
		seenSportNames.add(sportTitle);
		sportOrder.push(sportTitle);
	}
	setResultSportOptions(sportOrder);
	const selectedSport = state.resultSportFilter;
	if (selectedSport !== 'all') {
		const filteredItems = allGames.filter((item) => String(item && item.sportTitle ? item.sportTitle : '') === selectedSport);
		renderUpcomingEventsForSavedSports(filteredItems, sportOrder.length, sportOrder.length);
		return;
	}
	renderUpcomingEventsForSavedSports(allGames, sportOrder.length, sportOrder.length);
}

async function loadUpcomingForSport(sportKey, apiKey) {
	if (!sportKey) {
		return;
	}
	state.rangeLoading = true;
	syncRangeButtons();
	setView("upcoming");
	state.activeSportKey = sportKey;
	state.favoriteUpcomingSportTitles = [];
	renderSportsTable(state.sportsRows);
	setStatus("Scanning upcoming games for " + sportKey + "...", "");
	el.upcomingWrap.innerHTML = '<p class="subhead">Upcoming Games</p><div class="loading-panel"><p class="loading-label">Loading upcoming games</p><div class="loading-bar"><span></span></div></div>';

	try {
		const now = new Date();
		const rangeWindow = getRangeWindow(state.timeRange);
		const to = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));
		const eventsUrl = BASE_URL + '/sports/' + encodeURIComponent(sportKey) + '/events/?apiKey='
			+ encodeURIComponent(apiKey)
			+ '&dateFormat=iso';
		const oddsUrl = BASE_URL + '/sports/' + encodeURIComponent(sportKey) + '/odds/?apiKey='
			+ encodeURIComponent(apiKey)
			+ '&bookmakers=sportsbet'
			+ '&regions=au,us,uk,eu'
			+ '&markets=h2h'
			+ '&oddsFormat=decimal'
			+ '&dateFormat=iso';

		const scoresUrl = BASE_URL + '/sports/' + encodeURIComponent(sportKey) + '/scores/?apiKey=' + encodeURIComponent(apiKey) + '&daysFrom=' + HISTORY_LOOKBACK_DAYS + '&dateFormat=iso';

		const [eventResponse, oddsResponse, scoresResponse] = await Promise.all([
			fetch(eventsUrl),
			fetch(oddsUrl),
			fetch(scoresUrl)
		]);
		if (!eventResponse.ok) {
			const message = 'Upcoming events request failed for sport: ' + sportKey;
			throw new Error(message);
		}
		const payload = await eventResponse.json();

		let oddsPayload = [];
		if (oddsResponse.ok) {
			oddsPayload = await oddsResponse.json();
		}
		let scoresPayload = [];
		if (scoresResponse.ok) {
			scoresPayload = await scoresResponse.json();
		}
		const incomingHistoryRows = Array.isArray(scoresPayload) ? scoresPayload : [];
		const existingRollingHistoryRows = readCache("rolling_history_" + sportKey);
		const mergedHistoryRows = mergeRollingHistoryRows(existingRollingHistoryRows, incomingHistoryRows);
		const historyMap = buildTeamHistoryMap(mergedHistoryRows);

		const rows = Array.isArray(payload) ? payload : [];
		const filtered = getRowsForSelectedRange(rows, state.timeRange, rangeWindow, Array.isArray(scoresPayload) ? scoresPayload : []);
		writeCache("upcoming_events_" + sportKey, filtered);

		const oddsRows = Array.isArray(oddsPayload) ? oddsPayload : [];
		writeCache("upcoming_odds_" + sportKey, oddsRows);
		writeCache("upcoming_history_" + sportKey, mergedHistoryRows);
		writeCache("rolling_history_" + sportKey, mergedHistoryRows);
		const oddsByEventId = buildOddsByEventId(oddsRows);

		renderUpcomingEvents(sportKey, filtered, oddsByEventId, state.timeRange, historyMap);
		setStatus('Upcoming window loaded for ' + sportKey + ': ' + filtered.length + ' events', 'ok');
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		const cachedEvents = readCache("upcoming_events_" + sportKey);
		const cachedOddsRows = readCache("upcoming_odds_" + sportKey);
		const cachedHistoryRows = readCache("upcoming_history_" + sportKey);
		const rollingHistoryRows = readCache("rolling_history_" + sportKey);
		if (Array.isArray(cachedEvents) && cachedEvents.length) {
			const oddsByEventId = buildOddsByEventId(Array.isArray(cachedOddsRows) ? cachedOddsRows : []);
			const historyRows = mergeRollingHistoryRows(rollingHistoryRows, cachedHistoryRows);
			renderUpcomingEvents(sportKey, cachedEvents, oddsByEventId, state.timeRange, historyRows);
			setStatus('Live upcoming failed: ' + message + '. Showing cached fallback data.', 'error');
			return;
		}

		el.upcomingWrap.innerHTML = '<p class="subhead">Upcoming Games</p><div class="empty">Unable to load upcoming games.</div>';
		setStatus('Failed loading upcoming games: ' + message, 'error');
	} finally {
		state.rangeLoading = false;
		syncRangeButtons();
	}
}

function renderRecentResultsForSelectedScope(scopeLabel, items) {
	bindGameCardInteractions();
	state.activeRecentSportData = null;
	const sportTitles = Array.from(new Set((Array.isArray(items) ? items : []).map((item) => String(item && item.sportTitle ? item.sportTitle : item && item.sportKey ? item.sportKey : '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
	setResultSportOptions(sportTitles.length ? sportTitles : getRecentSportTitlesForBar(scopeLabel));
	if (!Array.isArray(items) || !items.length) {
		el.upcomingWrap.innerHTML = '<p class="subhead">Recent Results | ' + escapeHtml(scopeLabel) + '</p><div class="empty">No recent results found in the current selection.</div>';
		return;
	}

	const selectedSport = state.resultSportFilter;
	const scopedItems = selectedSport === 'all'
		? items
		: items.filter((item) => String(item && item.sportTitle ? item.sportTitle : item && item.sportKey ? item.sportKey : '') === selectedSport);
	const visibleItems = scopedItems.filter((item) => {
		const row = item && item.row ? item.row : {};
		const home = row && row.home_team ? String(row.home_team) : '';
		const away = row && row.away_team ? String(row.away_team) : '';
		const sportTitle = item && item.sportTitle ? String(item.sportTitle) : item && item.sportKey ? String(item.sportKey) : '';
		return matchesResultsSearch(sportTitle, home, away);
	});

	const sortedItems = sortByStartDesc(visibleItems);
	const predictedItems = [];
	const noPredictionItems = [];
	for (const item of sortedItems) {
		const row = item.row || {};
		const oddsRow = item.oddsRow || null;
		const prediction = item.prediction || getPredictionForEvent(row, oddsRow, item.historyMap || null, item.sportKey || "");
		const hasPrediction = Boolean(prediction && prediction.predictedTeam);
		if (!hasPrediction) {
			noPredictionItems.push(item);
			continue;
		}
		if (!matchesWinRateFilter(prediction)) {
			continue;
		}
		predictedItems.push(item);
	}

	const cardsHtml = [...predictedItems, ...noPredictionItems].map((item) => {
		const row = item.row || {};
		const oddsRow = item.oddsRow || null;
		const prediction = item.prediction || getPredictionForEvent(row, oddsRow, item.historyMap || null, item.sportKey || "");
		const hasPrediction = Boolean(prediction && prediction.predictedTeam);
		const home = row && row.home_team ? String(row.home_team) : "Home";
		const away = row && row.away_team ? String(row.away_team) : "Away";
		const scoreText = getEventScoreText(row);
		const betName = prediction && prediction.label ? String(prediction.label).replace(/^Prediction:\s*/i, "") : "No prediction";
		const predictionOdds = getDisplayOddsForEvent(row, oddsRow, prediction);
		const edgeText = Number.isFinite(Number(prediction && prediction.edgePct)) ? Number(prediction.edgePct).toFixed(1) + "%" : "N/A";
		const winChanceValue = prediction && prediction.leanPct != null ? Number(prediction.leanPct) : NaN;
		const winChanceText = Number.isFinite(winChanceValue) ? prediction.leanPct + "%" : "N/A";
		const confidenceText = normalizeConfidenceLabel(prediction && prediction.confidence ? prediction.confidence : "low");
		const winTierClass = getTierClassFromWinChance(winChanceValue);
		const edgeTierClass = getTierClassFromEdge(Number(prediction && prediction.edgePct));
		const confidenceTierClass = prediction && prediction.confidence ? getTierClassFromConfidence(confidenceText, Number(prediction && prediction.edgePct), prediction && prediction.source ? prediction.source : "none") : 'tier-neutral';
		const completedPredictionResult = hasPrediction ? getPredictionResultForCompletedEvent(row, prediction.predictedTeam) : { label: "No prediction", tierClass: "tier-neutral" };
		const detailsHistoryMap = item && item.historyMap ? item.historyMap : null;
		const insightsPanel = hasPrediction
			? attachTopBetsToInsights(buildGameInsightsPanel(row, prediction, detailsHistoryMap, oddsRow), prediction.topBets)
			: '';
		const expandHint = insightsPanel ? '<p class="card-expand-hint">Tap card for matchup insights</p>' : '';
		const cardExpandAttrs = insightsPanel ? ' data-expand-card="true" role="button" tabindex="0" aria-expanded="false"' : '';
		const oddsBadge = predictionOdds ? '<span class="odds-pill" title="Pre-game odds at kickoff">Pre: ' + escapeHtml(predictionOdds) + '</span>' : '';
		const confidenceBadge = prediction && prediction.confidence
			? '<span class="meta-pill ' + confidenceTierClass + '">Conf: ' + escapeHtml(confidenceText) + '</span>'
			: '';
		const sportLabel = item.sportTitle ? String(item.sportTitle) : (item.sportKey || 'Sport');
		const resultClass = completedPredictionResult && completedPredictionResult.label === 'Won' ? 'result-win' : completedPredictionResult && completedPredictionResult.label === 'Lost' ? 'result-loss' : '';
		const winBadge = hasPrediction ? '<span class="meta-pill ' + winTierClass + '">Win: ' + escapeHtml(winChanceText) + '</span>' : '<span class="meta-pill tier-neutral">Win: N/A</span>';
		const edgeBadge = hasPrediction ? '<span class="meta-pill ' + edgeTierClass + '">Edge: ' + escapeHtml(edgeText) + '</span>' : '<span class="meta-pill tier-neutral">Edge: N/A</span>';
		const resultBadge = hasPrediction
			? '<span class="meta-pill ' + completedPredictionResult.tierClass + '">Result: ' + escapeHtml(completedPredictionResult.label) + '</span>'
			: '<span class="meta-pill tier-neutral">Result: No prediction</span>';

		return '<article class="game-card ' + (resultClass ? escapeHtml(resultClass) : '') + '"' + cardExpandAttrs + '>'
			+ '<div class="game-head">'
			+ '<div class="matchup-block">'
			+ '<div class="matchup-title-row">'
			+ '<span class="meta-pill sport-tag">Sport: ' + escapeHtml(sportLabel) + '</span>'
			+ '<p class="matchup">' + escapeHtml(home + ' vs ' + away) + '</p>'
			+ '</div>'
			+ '<p class="kickoff">' + escapeHtml(formatDateTime(item.start)) + '</p>'
			+ '</div>'
			+ '<div class="prediction-side">'
			+ '<div class="prediction-stack">'
			+ '<div class="prediction-row">'
			+ '<p class="bet-name">' + escapeHtml(betName) + '</p>'
			+ oddsBadge
			+ '</div>'
			+ '<div class="game-meta compact right-aligned">'
			+ '<span class="meta-pill">Score: ' + escapeHtml(scoreText) + '</span>'
			+ winBadge
			+ edgeBadge
			+ confidenceBadge
			+ resultBadge
			+ '</div>'
			+ '</div>'
			+ '</div>'
			+ '</div>'
			+ expandHint
			+ insightsPanel
			+ '</article>';
	}).join('');

	if (!cardsHtml) {
		el.upcomingWrap.innerHTML = '<p class="subhead">Recent Results | ' + escapeHtml(scopeLabel) + '</p><div class="empty">No recent results match your search.</div>';
		return;
	}

	el.upcomingWrap.innerHTML = '<p class="subhead">Recent Results | ' + escapeHtml(scopeLabel) + '</p>'
		+ '<div class="upcoming-list">' + cardsHtml + '</div>';
}

async function loadRecentResultsForSelectedScope(apiKey) {
	if (!apiKey) {
		return;
	}
	state.rangeLoading = true;
	syncRangeButtons();
	setView("recent");
	state.activeSportKey = "";
	state.activeRecentSportData = null;
	renderSportsTable(state.sportsRows);
	const scopeLabel = state.catalogScope === 'favorites' ? 'Favourites' : 'All Sports';
	setStatus('Loading recent results for ' + scopeLabel.toLowerCase() + '...', '');
	el.upcomingWrap.innerHTML = '<p class="subhead">Recent Results | ' + escapeHtml(scopeLabel) + '</p><div class="loading-panel"><p class="loading-label">Loading recent results</p><div class="loading-bar"><span></span></div></div>';

	try {
		const sportRows = Array.isArray(state.sportsRows) ? state.sportsRows : [];
		if (!sportRows.length) {
			await loadSportsCatalog(apiKey);
		}
		const rows = getScopedSportsForLoading();
		if (!rows.length) {
			const emptyMessage = state.catalogScope === 'favorites'
				? 'No favourited sports selected. Save a sport from the catalog to see recent results.'
				: 'No sports are available in the current selection.';
			state.allRecentResultsItems = [];
			state.recentScopeLabel = scopeLabel;
			setResultSportOptions([]);
			el.upcomingWrap.innerHTML = '<p class="subhead">Recent Results | ' + escapeHtml(scopeLabel) + '</p><div class="empty">' + escapeHtml(emptyMessage) + '</div>';
			setStatus(state.catalogScope === 'favorites' ? 'No favourited sports selected.' : 'No sports available for recent results.', 'ok');
			return;
		}

		const allRecentItems = [];
		for (const sport of rows) {
			const sportKey = sport && sport.key ? String(sport.key) : '';
			if (!sportKey) {
				continue;
			}
			try {
				const historyScoresUrl = BASE_URL + '/sports/' + encodeURIComponent(sportKey) + '/scores/?apiKey=' + encodeURIComponent(apiKey) + '&daysFrom=' + HISTORY_LOOKBACK_DAYS + '&dateFormat=iso';
				const recentScoresUrl = BASE_URL + '/sports/' + encodeURIComponent(sportKey) + '/scores/?apiKey=' + encodeURIComponent(apiKey) + '&daysFrom=' + RECENT_RESULTS_LOOKBACK_DAYS + '&dateFormat=iso';
				const recentWindowStart = new Date(Date.now() - (2 * 24 * 60 * 60 * 1000)).toISOString();
				const recentWindowEnd = new Date(Date.now() - GAME_START_BUFFER_MS).toISOString();
				const oddsUrl = BASE_URL + '/sports/' + encodeURIComponent(sportKey) + '/odds/?apiKey=' + encodeURIComponent(apiKey)
					+ '&bookmakers=sportsbet'
					+ '&regions=au,us,uk,eu'
					+ '&markets=h2h'
					+ '&oddsFormat=decimal'
					+ '&dateFormat=iso'
					+ '&commenceTimeFrom=' + encodeURIComponent(recentWindowStart)
					+ '&commenceTimeTo=' + encodeURIComponent(recentWindowEnd);
				const [historyScoresResponse, recentScoresResponse, oddsResponse] = await Promise.all([fetch(historyScoresUrl), fetch(recentScoresUrl), fetch(oddsUrl)]);
				const historyScoresPayload = historyScoresResponse.ok ? await historyScoresResponse.json() : [];
				const recentScoresPayload = recentScoresResponse.ok ? await recentScoresResponse.json() : [];
				const oddsPayload = oddsResponse.ok ? await oddsResponse.json() : [];
				const historyRows = Array.isArray(historyScoresPayload) ? historyScoresPayload : [];
				const existingRollingHistoryRows = readCache("rolling_history_" + sportKey);
				const mergedHistoryRows = mergeRollingHistoryRows(existingRollingHistoryRows, historyRows);
				writeCache("rolling_history_" + sportKey, mergedHistoryRows);
				const recentRows = Array.isArray(recentScoresPayload) ? recentScoresPayload : [];
				const oddsRows = Array.isArray(oddsPayload) ? oddsPayload : [];
				const completedHistoryRows = filterPastResults(mergedHistoryRows, GAME_START_BUFFER_MS);
				const completedRecentRows = filterPastResults(recentRows, GAME_START_BUFFER_MS);
				const eligibleRecentRows = completedRecentRows.length ? completedRecentRows : completedHistoryRows;
				const oddsByEventId = buildOddsByEventId(oddsRows);
				const previousGames = eligibleRecentRows
					.filter((row) => row && (row.home_team || row.away_team) && row.commence_time)
					.sort((a, b) => new Date(b.commence_time).getTime() - new Date(a.commence_time).getTime());

				for (const row of previousGames) {
					const eventId = row && row.id ? String(row.id) : '';
					const oddsRow = eventId ? oddsByEventId[eventId] || null : null;
					const historyForPrediction = completedHistoryRows.length ? completedHistoryRows : eligibleRecentRows;
					const priorHistoryMap = buildPriorHistoryMapForEvent(historyForPrediction, row);
					const prediction = getPredictionForEvent(row, oddsRow, priorHistoryMap, sportKey);
					const hasPrediction = Boolean(prediction && prediction.predictedTeam);
					if (!hasPrediction) {
						allRecentItems.push({
							sportKey,
							sportTitle: sport.title ? String(sport.title) : sportKey,
							start: row && row.commence_time ? String(row.commence_time) : '',
							row,
							oddsRow,
							historyMap: historyForPrediction,
							prediction: prediction || null
						});
						continue;
					}
					if (!matchesWinRateFilter(prediction)) {
						continue;
					}
					allRecentItems.push({
						sportKey,
						sportTitle: sport.title ? String(sport.title) : sportKey,
						start: row && row.commence_time ? String(row.commence_time) : '',
						row,
						oddsRow,
						historyMap: historyForPrediction,
						prediction
					});
				}
			} catch {
				continue;
			}
		}

		renderRecentResultsForSelectedScope(scopeLabel, allRecentItems);
		state.allRecentResultsItems = allRecentItems.slice();
		state.recentScopeLabel = scopeLabel;
		markDataLoaded();
		setStatus('Recent results loaded for ' + scopeLabel.toLowerCase() + ': ' + allRecentItems.length + ' games', 'ok');
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		state.allRecentResultsItems = [];
		state.recentScopeLabel = scopeLabel;
		setResultSportOptions([]);
		el.upcomingWrap.innerHTML = '<p class="subhead">Recent Results | ' + escapeHtml(scopeLabel) + '</p><div class="empty">Unable to load recent results.</div>';
		setStatus('Failed loading recent results: ' + message, 'error');
	} finally {
		state.rangeLoading = false;
		syncRangeButtons();
	}
}

async function loadRecentResultsForSport(sportKey, apiKey) {
	if (!sportKey) {
		return;
	}
	state.rangeLoading = true;
	syncRangeButtons();
	setView("recent");
	state.activeSportKey = sportKey;
	renderSportsTable(state.sportsRows);
	setStatus("Loading recent results for " + sportKey + "...", "");
	el.upcomingWrap.innerHTML = '<p class="subhead">Recent Results</p><div class="loading-panel"><p class="loading-label">Loading results</p><div class="loading-bar"><span></span></div></div>';

	try {
		const historyScoresUrl = BASE_URL + '/sports/' + encodeURIComponent(sportKey) + '/scores/?apiKey='
			+ encodeURIComponent(apiKey)
			+ '&daysFrom=' + HISTORY_LOOKBACK_DAYS
			+ '&dateFormat=iso';
		const recentScoresUrl = BASE_URL + '/sports/' + encodeURIComponent(sportKey) + '/scores/?apiKey='
			+ encodeURIComponent(apiKey)
			+ '&daysFrom=' + RECENT_RESULTS_LOOKBACK_DAYS
			+ '&dateFormat=iso';
		const oddsUrl = BASE_URL + '/sports/' + encodeURIComponent(sportKey) + '/odds/?apiKey='
			+ encodeURIComponent(apiKey)
			+ '&bookmakers=sportsbet'
			+ '&regions=au,us,uk,eu'
			+ '&markets=h2h'
			+ '&oddsFormat=decimal'
			+ '&dateFormat=iso';

		const responses = await Promise.all([fetch(historyScoresUrl), fetch(recentScoresUrl), fetch(oddsUrl)]);
		const historyResponse = responses[0];
		const recentResponse = responses[1];
		const oddsResponse = responses[2];
		const historyPayload = await historyResponse.json();
		const recentPayload = await recentResponse.json();
		const oddsPayload = await oddsResponse.json();
		const historyRows = Array.isArray(historyPayload) ? historyPayload : [];
		const existingRollingHistoryRows = readCache("rolling_history_" + sportKey);
		const mergedHistoryRows = mergeRollingHistoryRows(existingRollingHistoryRows, historyRows);
		writeCache("rolling_history_" + sportKey, mergedHistoryRows);
		const rows = Array.isArray(recentPayload) ? recentPayload : [];

		if (!recentResponse.ok) {
			const message = recentPayload && recentPayload.message ? String(recentPayload.message) : 'Request failed';
			throw new Error(message);
		}

		const sorted = filterPastResults(rows, GAME_START_BUFFER_MS).sort((a, b) => {
			const aTs = new Date(a && a.commence_time ? a.commence_time : '').getTime();
			const bTs = new Date(b && b.commence_time ? b.commence_time : '').getTime();
			return bTs - aTs;
		});
		const recentGames = sorted.length ? sorted : filterPastResults(mergedHistoryRows, GAME_START_BUFFER_MS);
		writeCache("recent_scores_" + sportKey, recentGames);
	 	writeCache("recent_history_" + sportKey, mergedHistoryRows);

		const oddsRows = oddsResponse.ok && Array.isArray(oddsPayload) ? oddsPayload : [];
		writeCache("recent_odds_" + sportKey, oddsRows);
		const oddsByEventId = buildOddsByEventId(oddsRows);

		renderRecentResults(sportKey, recentGames, oddsByEventId, mergedHistoryRows);
		state.allRecentResultsItems = sortByStartDesc(recentGames).map((row) => ({
			sportKey,
			sportTitle: state.sportsByKey[sportKey] && state.sportsByKey[sportKey].title ? String(state.sportsByKey[sportKey].title) : sportKey,
			start: row && row.commence_time ? String(row.commence_time) : '',
			row,
			oddsRow: row && row.id ? oddsByEventId[String(row.id)] || null : null,
			historyMap: mergedHistoryRows
		}));
		state.recentScopeLabel = state.sportsByKey[sportKey] && state.sportsByKey[sportKey].title ? String(state.sportsByKey[sportKey].title) : sportKey;
		markDataLoaded();
		setStatus('Recent results loaded for ' + sportKey + ': ' + recentGames.length + ' games', 'ok');
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		const cachedScores = readCache("recent_scores_" + sportKey);
		const cachedOddsRows = readCache("recent_odds_" + sportKey);
		const cachedHistoryRows = readCache("recent_history_" + sportKey);
		const rollingHistoryRows = readCache("rolling_history_" + sportKey);
		if (Array.isArray(cachedScores) && cachedScores.length) {
			const oddsByEventId = buildOddsByEventId(Array.isArray(cachedOddsRows) ? cachedOddsRows : []);
			const historyRows = mergeRollingHistoryRows(rollingHistoryRows, cachedHistoryRows);
			renderRecentResults(sportKey, cachedScores, oddsByEventId, historyRows);
			setStatus('Live recent results failed: ' + message + '. Showing cached fallback data.', 'error');
			return;
		}

		el.upcomingWrap.innerHTML = '<p class="subhead">Recent Results</p><div class="empty">Unable to load recent results.</div>';
		state.allRecentResultsItems = [];
		state.recentScopeLabel = '';
		setResultSportOptions([]);
		setStatus('Failed loading recent results: ' + message, 'error');
	} finally {
		state.rangeLoading = false;
		syncRangeButtons();
	}
}

async function loadAllSportsUpcoming(apiKey) {
	if (!apiKey) {
		return;
	}
	state.rangeLoading = true;
	syncRangeButtons();
	setView('upcoming');
	state.activeSportKey = "";
	state.activeUpcomingSportData = null;
	const scopeLabel = state.catalogScope === 'favorites' ? 'Favourites' : 'All Sports';
	const rangeLabel = getRangeLabel(state.timeRange);
	setStatus('Checking ' + scopeLabel.toLowerCase() + ' for ' + rangeLabel.toLowerCase() + '...', '');
	el.upcomingWrap.innerHTML = '<p class="subhead">Upcoming Games | ' + escapeHtml(scopeLabel) + '</p><div class="loading-panel"><p class="loading-label">Loading upcoming games</p><div class="loading-bar"><span></span></div></div>';

	try {
		const sportRows = Array.isArray(state.sportsRows) ? state.sportsRows : [];
		if (!sportRows.length) {
			await loadSportsCatalog(apiKey);
		}
		const rows = getScopedSportsForLoading();
		state.favoriteUpcomingSportTitles = rows
			.map((sport) => sport && sport.title ? String(sport.title).trim() : '')
			.filter(Boolean);
		if (!rows.length) {
			const emptyMessage = state.catalogScope === 'favorites'
				? 'No favourited sports selected. Save a sport from the catalog to see its games.'
				: 'No sports were available to load for this range.';
			state.allUpcomingGames = [];
			setResultSportOptions([]);
			el.upcomingWrap.innerHTML = '<p class="subhead">Upcoming Games | ' + escapeHtml(scopeLabel) + ' | ' + escapeHtml(rangeLabel) + '</p><div class="empty">' + escapeHtml(emptyMessage) + '</div>';
			setStatus(state.catalogScope === 'favorites' ? 'No favourited sports selected.' : 'No sports available for this range.', 'ok');
			return;
		}
		const allGames = [];
		const rangeWindow = getRangeWindow(state.timeRange);
		for (const sport of rows) {
			const sportKey = sport && sport.key ? String(sport.key) : '';
			if (!sportKey) {
				continue;
			}

			try {
				const eventsUrl = BASE_URL + '/sports/' + encodeURIComponent(sportKey) + '/events/?apiKey='
					+ encodeURIComponent(apiKey)
					+ '&dateFormat=iso';
				const oddsUrl = BASE_URL + '/sports/' + encodeURIComponent(sportKey) + '/odds/?apiKey='
					+ encodeURIComponent(apiKey)
					+ '&bookmakers=sportsbet'
					+ '&regions=au,us,uk,eu'
					+ '&markets=h2h'
					+ '&oddsFormat=decimal'
					+ '&dateFormat=iso';
				const historyUrl = BASE_URL + '/sports/' + encodeURIComponent(sportKey) + '/scores/?apiKey='
					+ encodeURIComponent(apiKey)
					+ '&daysFrom=' + HISTORY_LOOKBACK_DAYS
					+ '&dateFormat=iso';

				const [eventResponse, oddsResponse, historyResponse] = await Promise.all([
					fetch(eventsUrl),
					fetch(oddsUrl),
					fetch(historyUrl)
				]);
				if (!eventResponse.ok) {
					continue;
				}
				const eventPayload = await eventResponse.json();
				if (!Array.isArray(eventPayload)) {
					continue;
				}

				let oddsPayload = [];
				if (oddsResponse.ok) {
					oddsPayload = await oddsResponse.json();
				}
				let historyPayload = [];
				if (historyResponse.ok) {
					historyPayload = await historyResponse.json();
				}
				const oddsByEventId = buildOddsByEventId(Array.isArray(oddsPayload) ? oddsPayload : []);
				const existingRollingHistoryRows = readCache("rolling_history_" + sportKey);
				const mergedHistoryRows = mergeRollingHistoryRows(existingRollingHistoryRows, Array.isArray(historyPayload) ? historyPayload : []);
				writeCache("rolling_history_" + sportKey, mergedHistoryRows);
				const historyMap = buildTeamHistoryMap(mergedHistoryRows);
				const filtered = getRowsForSelectedRange(eventPayload, state.timeRange, rangeWindow, Array.isArray(historyPayload) ? historyPayload : []);

				for (const eventRow of filtered) {
					const eventId = eventRow && eventRow.id ? String(eventRow.id) : '';
					const prediction = getPredictionForEvent(eventRow, eventId ? oddsByEventId[eventId] : null, historyMap, sportKey);
					if (!matchesWinRateFilter(prediction)) {
						continue;
					}
					const winChanceValue = getPredictionWinRateValue(prediction);
					if (state.winRateFilter !== 'all' && !Number.isFinite(winChanceValue)) {
						continue;
					}
					allGames.push({
						sportKey,
						sportTitle: sport.title ? String(sport.title) : sportKey,
						home: eventRow && eventRow.home_team ? String(eventRow.home_team) : 'Home',
						away: eventRow && eventRow.away_team ? String(eventRow.away_team) : 'Away',
						start: eventRow && eventRow.commence_time ? String(eventRow.commence_time) : '',
						prediction,
						row: eventRow,
						oddsRow: eventId ? oddsByEventId[eventId] : null,
						historyMap
					});
				}

			} catch {
				continue;
			}
		}

		if (!allGames.length) {
			const rangeLabel = getRangeLabel(state.timeRange);
			setResultSportOptions([]);
			el.upcomingWrap.innerHTML = '<p class="subhead">Upcoming Games | All Sports | ' + escapeHtml(rangeLabel) + '</p><div class="empty">No favored games found in the selected range.</div>';
			setStatus('No favored games found for all sports in this range.', 'ok');
			return;
		}

		state.allUpcomingGames = allGames;
		state.upcomingVisibleSportCount = state.favoriteUpcomingSportTitles.length || 5;
		renderUpcomingSportBatch();
		markDataLoaded();
		setStatus('Loaded favorited games for all sports in ' + getRangeLabel(state.timeRange).toLowerCase() + '.', 'ok');
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		state.allUpcomingGames = [];
		state.favoriteUpcomingSportTitles = [];
		setResultSportOptions([]);
		el.upcomingWrap.innerHTML = '<p class="subhead">Upcoming Games | All Sports</p><div class="empty">Unable to load all sports favorites.</div>';
		setStatus('Failed loading all sports favorites: ' + message, 'error');
	} finally {
		state.rangeLoading = false;
		syncRangeButtons();
	}
}
