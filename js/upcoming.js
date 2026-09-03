// --- Upcoming/recent results rendering and prediction model ---
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

let _pregamePredictionStoreCache = null;

function readPregamePredictionStore() {
	if (_pregamePredictionStoreCache !== null) {
		return _pregamePredictionStoreCache;
	}
	try {
		const raw = localStorage.getItem(PREGAME_PREDICTION_STORE_KEY);
		if (!raw) {
			_pregamePredictionStoreCache = {};
			return _pregamePredictionStoreCache;
		}
		const parsed = JSON.parse(raw);
		_pregamePredictionStoreCache = parsed && typeof parsed === 'object' ? parsed : {};
		return _pregamePredictionStoreCache;
	} catch {
		_pregamePredictionStoreCache = {};
		return _pregamePredictionStoreCache;
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
		_pregamePredictionStoreCache = store;
	} catch {
		// Ignore local storage write failures for prediction snapshots.
		_pregamePredictionStoreCache = null;
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
	const combined = (Array.isArray(existingRows) ? existingRows : []).concat(Array.isArray(incomingRows) ? incomingRows : []);
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

	const marketSnapshot = getPredictionMarketSnapshot(eventRow, oddsRow, prediction);
	const predictionOddsText = marketSnapshot.oddsText;
	const impliedByOdds = marketSnapshot.impliedProbability;
	const modelWinLikelihood = Number.isFinite(Number(prediction && prediction.leanPct))
		? Number(prediction.leanPct) / 100
		: NaN;
	const evPct = Number.isFinite(Number(prediction && prediction.evPct)) ? Number(prediction.evPct) : marketSnapshot.evPct;

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
				evPct,
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
			evPct,
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
		evPct,
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
	const tooltipPill = (text, tooltip, tierClass = "") => '<span class="meta-pill has-tooltip'
		+ (tierClass ? ' ' + tierClass : '')
		+ '" data-tooltip="' + escapeHtml(tooltip) + '">' + escapeHtml(text) + '</span>';

	const stats = buildGameInsightStats(eventRow, prediction, historyMap, oddsRow);
	if (!stats) {
		const marketSnapshot = getPredictionMarketSnapshot(eventRow, oddsRow, prediction);
		const predictionOddsText = marketSnapshot.oddsText || "N/A";
		const impliedByOdds = marketSnapshot.impliedProbability;
		const modelWinLikelihood = Number.isFinite(Number(prediction && prediction.leanPct))
			? Number(prediction.leanPct) / 100
			: NaN;
		const evPct = Number.isFinite(Number(prediction && prediction.evPct)) ? Number(prediction.evPct) : marketSnapshot.evPct;
		const modelTier = getLikelihoodTierClass(Number(modelWinLikelihood) * 100);
		const impliedTier = getLikelihoodTierClass(Number(impliedByOdds) * 100);
		const evTier = getTierClassFromEv(evPct);

		return '<div class="card-insights" aria-hidden="true">'
			+ '<div class="card-insights-grid">'
			+ '<div class="card-insights-column left">'
			+ tooltipPill('Pre odds: ' + predictionOddsText, 'Decimal pre-game price from Sportsbet for the predicted side.')
			+ tooltipPill('History-based stats: limited', 'Not enough recent scored matches for both teams, so form-driven metrics are reduced.', 'tier-neutral')
			+ '</div>'
			+ '<div class="card-insights-column right">'
			+ tooltipPill('Model win: ' + formatPct(modelWinLikelihood), 'Model-estimated win likelihood after conservative weighting.', modelTier)
			+ tooltipPill('Odds implied: ' + formatPct(impliedByOdds), 'Win likelihood implied by Sportsbet pre-game odds.', impliedTier)
			+ tooltipPill('EV: ' + formatEvTagText(evPct), EV_TOOLTIP_TEXT, evTier)
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
	const evTier = getTierClassFromEv(Number(stats.evPct));
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
		tooltipPill('EV: ' + formatEvTagText(Number(stats.evPct)), EV_TOOLTIP_TEXT, evTier),
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
		initUpcomingBreakEvenFilter();
		return;
	}

	el.upcomingWrap.dataset.cardExpandBound = 'true';
	initUpcomingBreakEvenFilter();
	el.upcomingWrap.addEventListener('click', (event) => {
		const target = event && event.target ? event.target : null;
		const viewMoreButton = target && target.closest ? target.closest('[data-action="view-more-upcoming"]') : null;
		if (viewMoreButton && el.upcomingWrap.contains(viewMoreButton)) {
			event.preventDefault();
			handleUpcomingViewMoreClick();
			return;
		}
		const recentViewMoreButton = target && target.closest ? target.closest('[data-action="view-more-recent"]') : null;
		if (recentViewMoreButton && el.upcomingWrap.contains(recentViewMoreButton)) {
			event.preventDefault();
			handleRecentResultsViewMoreClick();
			return;
		}
		const backtestTrendButton = target && target.closest ? target.closest('[data-action="backtest-trend-window"]') : null;
		if (backtestTrendButton && el.upcomingWrap.contains(backtestTrendButton)) {
			event.preventDefault();
			const selectedWindow = Number(backtestTrendButton.getAttribute('data-window'));
			if (selectedWindow) {
				setBacktestTrendWindow(selectedWindow);
				rerenderActiveResultsView();
			}
			return;
		}
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

function handleUpcomingViewMoreClick() {
	const activeData = state.activeUpcomingSportData;
	if (activeData && activeData.sportKey) {
		if (normalizeRangeKey(activeData.rangeKey || state.timeRange) !== 'today') {
			return;
		}
		if (activeData.showTomorrow === true) {
			return;
		}

		activeData.showTomorrow = true;
		state.upcomingBePickLimit = DEFAULT_UPCOMING_CARD_WINDOW_HOURS * 2;
		persistRefreshViewState();
		renderUpcomingEvents(
			activeData.sportKey,
			Array.isArray(activeData.events) ? activeData.events : [],
			activeData.oddsByEventId || {},
			activeData.rangeKey || state.timeRange,
			activeData.historyMap || null,
			{ showTomorrow: true }
		);
		return;
	}

	if (normalizeRangeKey(state.timeRange) !== 'today' || state.view !== 'upcoming' || state.activeSportKey) {
		return;
	}
	if (state.upcomingSavedSportsShowTomorrow === true) {
		return;
	}
	state.upcomingSavedSportsShowTomorrow = true;
	state.upcomingBePickLimit = DEFAULT_UPCOMING_CARD_WINDOW_HOURS * 2;
	persistRefreshViewState();
	renderUpcomingSportBatch();
}

function handleRecentResultsViewMoreClick() {
	if (state.view !== 'recent' || !state.apiKey) {
		return;
	}
	const nextLookbackDays = Math.min(MAX_RECENT_RESULTS_LOOKBACK_DAYS, (Number(state.recentResultsLookbackDays) || RECENT_RESULTS_LOOKBACK_DAYS) + 1);
	state.recentResultsLookbackDays = nextLookbackDays;
	state.upcomingBePickLimit = nextLookbackDays * 24;
	persistRefreshViewState();
	rerenderActiveResultsView();
	if (state.activeSportKey) {
		loadRecentResultsForSport(state.activeSportKey, state.apiKey, { forceRefresh: true });
		return;
	}
	loadRecentResultsForSelectedScope(state.apiKey, { forceRefresh: true });
}

function getRecentViewMoreMarkup() {
	const shouldShow = state.view === 'recent' && state.recentResultsLookbackDays < MAX_RECENT_RESULTS_LOOKBACK_DAYS;
	return shouldShow
		? '<div class="upcoming-view-more-wrap"><div class="upcoming-separator" aria-hidden="true"></div><button type="button" class="upcoming-view-more-btn" data-action="view-more-recent"><i class="fa-solid fa-angles-down" aria-hidden="true"></i>View More</button></div>'
		: '';
}

function filterRecentPickWindow(rows) {
	const hours = Math.max(0, Number(state.upcomingBePickLimit) || 0);
	if (!hours) {
		return Array.isArray(rows) ? rows : [];
	}
	const cutoff = Date.now() - hours * 60 * 60 * 1000;
	return (Array.isArray(rows) ? rows : []).filter((row) => {
		const timestamp = getEventStartTimestamp(row);
		return !Number.isFinite(timestamp) || timestamp >= cutoff;
	});
}

function filterRecentResultsToLookback(rows) {
	const lookbackDays = Math.max(RECENT_RESULTS_LOOKBACK_DAYS, Number(state.recentResultsLookbackDays) || RECENT_RESULTS_LOOKBACK_DAYS);
	const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
	return (Array.isArray(rows) ? rows : []).filter((row) => {
		const timestamp = getEventStartTimestamp(row);
		return !Number.isFinite(timestamp) || timestamp >= cutoff;
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
			return false;
		}
		return timestamp <= snapshotCutoff;
	});
	return eligible;
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

function getImpliedProbabilityFromOdds(oddsValue) {
	const odds = Number(oddsValue);
	if (!Number.isFinite(odds) || odds <= 1) {
		return NaN;
	}
	return 1 / odds;
}

function getExpectedValuePct(modelProbability, oddsValue) {
	const probability = Number(modelProbability);
	const odds = Number(oddsValue);
	if (!Number.isFinite(probability) || !Number.isFinite(odds) || odds <= 1) {
		return NaN;
	}
	return ((probability * odds) - 1) * 100;
}

function getPredictionMarketSnapshot(eventRow, oddsRow, prediction) {
	if (!prediction || !prediction.predictedTeam) {
		return {
			oddsText: null,
			oddsValue: NaN,
			impliedProbability: NaN,
			evPct: NaN,
			edgePct: NaN
		};
	}

	const storedOdds = Number(prediction && prediction.pregameOdds);
	const oddsText = Number.isFinite(storedOdds) && storedOdds > 1
		? storedOdds.toFixed(2)
		: getBookmakerOddsForPrediction(eventRow, oddsRow, prediction);
	const oddsValue = Number(oddsText);
	const impliedProbability = getImpliedProbabilityFromOdds(oddsValue);
	const modelProbability = Number(prediction && prediction.leanPct) / 100;
	const evPct = getExpectedValuePct(modelProbability, oddsValue);
	const edgePct = Number.isFinite(modelProbability) && Number.isFinite(impliedProbability)
		? (modelProbability - impliedProbability) * 100
		: NaN;

	return {
		oddsText,
		oddsValue,
		impliedProbability,
		evPct,
		edgePct
	};
}

function enrichPredictionWithMarketMetrics(eventRow, oddsRow, prediction) {
	if (!prediction || typeof prediction !== 'object') {
		return prediction;
	}
	const marketSnapshot = getPredictionMarketSnapshot(eventRow, oddsRow, prediction);
	const nextPrediction = {
		...prediction,
		pregameOdds: Number.isFinite(marketSnapshot.oddsValue) ? Number(marketSnapshot.oddsValue.toFixed(2)) : null,
		impliedProbPct: Number.isFinite(marketSnapshot.impliedProbability) ? Number((marketSnapshot.impliedProbability * 100).toFixed(1)) : null,
		evPct: Number.isFinite(marketSnapshot.evPct) ? Number(marketSnapshot.evPct.toFixed(1)) : null
	};
	if (Number.isFinite(marketSnapshot.edgePct)) {
		nextPrediction.edgePct = Number(marketSnapshot.edgePct.toFixed(1));
	}
	return nextPrediction;
}

function getNumericScoreValue(source) {
	if (source == null) {
		return NaN;
	}
	if (typeof source === 'object') {
		const nestedValue = source.score ?? source.points ?? source.value ?? source.total ?? source.goals ?? source.count ?? source.runs ?? source.sets ?? source.games ?? source.periodScore;
		const parsedNested = Number(nestedValue);
		return Number.isFinite(parsedNested) ? parsedNested : NaN;
	}
	const parsed = Number(source);
	return Number.isFinite(parsed) ? parsed : NaN;
}

function parseScorePairFromText(source) {
	const text = String(source || '').trim();
	if (!text) {
		return null;
	}
	const match = text.match(/(\d+)\s*[-:\u2013\u2014]\s*(\d+)/);
	if (!match) {
		return null;
	}
	const homeScore = Number(match[1]);
	const awayScore = Number(match[2]);
	if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) {
		return null;
	}
	return { homeScore, awayScore };
}

function getLiveScoreFallbackText(eventRow) {
	if (!eventRow || typeof eventRow !== 'object') {
		return '';
	}
	const status = String(eventRow.status || eventRow.game_status || eventRow.state || eventRow.live_status || '').trim();
	if (status) {
		return status;
	}
	const period = eventRow.period || eventRow.current_period || eventRow.quarter || eventRow.inning || eventRow.set || eventRow.leg;
	if (period == null || period === '') {
		return 'Live';
	}
	const clock = eventRow.clock || eventRow.time_remaining || eventRow.timeRemaining || eventRow.remaining || eventRow.match_clock;
	const periodText = String(period).trim();
	const clockText = String(clock || '').trim();
	if (periodText && clockText) {
		return 'Live · ' + periodText + ' ' + clockText;
	}
	if (periodText) {
		return 'Live · ' + periodText;
	}
	if (clockText) {
		return 'Live · ' + clockText;
	}
	return 'Live';
}

function extractEventScores(eventRow) {
	let homeScore = NaN;
	let awayScore = NaN;
	if (!eventRow || typeof eventRow !== 'object') {
		return { homeScore, awayScore };
	}

	const home = eventRow.home_team ? String(eventRow.home_team) : 'Home';
	const away = eventRow.away_team ? String(eventRow.away_team) : 'Away';
	const homeNorm = normalizeTeamName(home);
	const awayNorm = normalizeTeamName(away);

	const scoreEntries = Array.isArray(eventRow.scores) ? eventRow.scores : [];
	for (const scoreRow of scoreEntries) {
		const teamName = normalizeTeamName(scoreRow && (scoreRow.name ?? scoreRow.team ?? scoreRow.team_name ?? scoreRow.participant) ? (scoreRow.name ?? scoreRow.team ?? scoreRow.team_name ?? scoreRow.participant) : '');
		const parsedScore = getNumericScoreValue(scoreRow);
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

	if ((!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) && scoreEntries.length >= 2) {
		const firstScore = getNumericScoreValue(scoreEntries[0]);
		const secondScore = getNumericScoreValue(scoreEntries[1]);
		if (!Number.isFinite(homeScore) && Number.isFinite(firstScore)) {
			homeScore = firstScore;
		}
		if (!Number.isFinite(awayScore) && Number.isFinite(secondScore)) {
			awayScore = secondScore;
		}
	}

	const scoreObject = eventRow.score && typeof eventRow.score === 'object' ? eventRow.score : null;
	const nonArrayScores = eventRow.scores && !Array.isArray(eventRow.scores) && typeof eventRow.scores === 'object' ? eventRow.scores : null;
	const flatHomeScore = getNumericScoreValue(
		eventRow.home_score
		?? eventRow.homeScore
		?? eventRow.home_goals
		?? eventRow.homeGoals
		?? eventRow.home_points
		?? eventRow.homePoints
		?? (scoreObject ? (scoreObject.home ?? scoreObject.home_score ?? scoreObject.homeScore ?? scoreObject.home_points ?? scoreObject.homePoints) : undefined)
		?? (nonArrayScores ? (nonArrayScores.home ?? nonArrayScores.home_score ?? nonArrayScores.homeScore ?? nonArrayScores.home_points ?? nonArrayScores.homePoints) : undefined)
	);
	const flatAwayScore = getNumericScoreValue(
		eventRow.away_score
		?? eventRow.awayScore
		?? eventRow.away_goals
		?? eventRow.awayGoals
		?? eventRow.away_points
		?? eventRow.awayPoints
		?? (scoreObject ? (scoreObject.away ?? scoreObject.away_score ?? scoreObject.awayScore ?? scoreObject.away_points ?? scoreObject.awayPoints) : undefined)
		?? (nonArrayScores ? (nonArrayScores.away ?? nonArrayScores.away_score ?? nonArrayScores.awayScore ?? nonArrayScores.away_points ?? nonArrayScores.awayPoints) : undefined)
	);

	if (!Number.isFinite(homeScore) && Number.isFinite(flatHomeScore)) {
		homeScore = flatHomeScore;
	}
	if (!Number.isFinite(awayScore) && Number.isFinite(flatAwayScore)) {
		awayScore = flatAwayScore;
	}

	if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) {
		const pairCandidates = [
			eventRow.score,
			eventRow.scores,
			eventRow.score_text,
			eventRow.scoreText,
			eventRow.display_score,
			eventRow.displayScore,
			eventRow.result,
			eventRow.summary
		];
		for (const candidate of pairCandidates) {
			if (typeof candidate !== 'string') {
				continue;
			}
			const parsedPair = parseScorePairFromText(candidate);
			if (!parsedPair) {
				continue;
			}
			if (!Number.isFinite(homeScore)) {
				homeScore = parsedPair.homeScore;
			}
			if (!Number.isFinite(awayScore)) {
				awayScore = parsedPair.awayScore;
			}
			if (Number.isFinite(homeScore) && Number.isFinite(awayScore)) {
				break;
			}
		}
	}

	return { homeScore, awayScore };
}

function hasUsableScoreData(eventRow) {
	if (!eventRow) {
		return false;
	}
	const scores = extractEventScores(eventRow);
	if (Number.isFinite(scores.homeScore) && Number.isFinite(scores.awayScore)) {
		return true;
	}
	if (isLiveEventRow(eventRow)) {
		return Boolean(getLiveScoreFallbackText(eventRow));
	}
	return false;
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

	const scores = extractEventScores(eventRow);
	const homeScore = scores.homeScore;
	const awayScore = scores.awayScore;

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

	const scores = extractEventScores(eventRow);
	const homeScore = scores.homeScore;
	const awayScore = scores.awayScore;
	if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore) || homeScore === awayScore) {
		return null;
	}
	const leaderNorm = homeScore > awayScore ? homeNorm : awayNorm;
	return leaderNorm === predictedNorm ? 'win' : 'loss';
}

function getEventScoreText(eventRow) {
	const scores = extractEventScores(eventRow);
	const homeScore = Number.isFinite(scores.homeScore) ? String(scores.homeScore) : "-";
	const awayScore = Number.isFinite(scores.awayScore) ? String(scores.awayScore) : "-";
	if (Number.isFinite(scores.homeScore) || Number.isFinite(scores.awayScore)) {
		return homeScore + " - " + awayScore;
	}
	if (isLiveEventRow(eventRow)) {
		return getLiveScoreFallbackText(eventRow);
	}
	return "No score data";
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
	const sportsbetBookmakers = getEligibleSportsbetBookmakersForEvent(oddsRow, eventRow);
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

	const orderedRows = scoresRows
		.slice()
		.filter((row) => row && typeof row === 'object')
		.sort((a, b) => {
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

	for (let index = 0; index < orderedRows.length; index += 1) {
		const row = orderedRows[index];
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

		const recencyWeight = Math.pow(HISTORY_RECENT_FORM_DECAY, index);

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
					profile.recentForm += 3 * recencyWeight;
				} else if (homeGoals < awayGoals) {
					profile.losses += 1;
					profile.recentForm -= 2 * recencyWeight;
				} else {
					profile.draws += 1;
					profile.points += 1;
					profile.recentForm += 1 * recencyWeight;
				}
			} else if (awayGoals > homeGoals) {
				profile.wins += 1;
				profile.awayWins += 1;
				profile.points += 3;
				profile.recentForm += 3 * recencyWeight;
			} else if (awayGoals < homeGoals) {
				profile.losses += 1;
				profile.recentForm -= 2 * recencyWeight;
			} else {
				profile.draws += 1;
				profile.points += 1;
				profile.recentForm += 1 * recencyWeight;
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

function normalizePredictedTeamForSport(predictedTeam, home, away, profile) {
	const raw = String(predictedTeam || '').trim();
	if (!raw) {
		return raw;
	}
	if (normalizeTeamName(raw) !== 'draw') {
		return raw;
	}
	if (profile && profile.allowDraw) {
		return 'Draw';
	}
	const homeLabel = String(home || '').trim();
	const awayLabel = String(away || '').trim();
	if (homeLabel && awayLabel) {
		return homeLabel.localeCompare(awayLabel, undefined, { sensitivity: 'base' }) <= 0 ? homeLabel : awayLabel;
	}
	return homeLabel || awayLabel || raw;
}

function normalizePredictionForSport(prediction, home, away, profile) {
	if (!prediction || typeof prediction !== 'object') {
		return prediction;
	}
	const normalizedTeam = normalizePredictedTeamForSport(prediction.predictedTeam, home, away, profile);
	const normalizedLabel = normalizedTeam === 'Draw'
		? 'Prediction: Draw'
		: normalizedTeam
			? 'Prediction: ' + normalizedTeam + ' to win'
			: 'No prediction';
	return {
		...prediction,
		predictedTeam: normalizedTeam,
		label: normalizedLabel
	};
}

function getHistoricalPredictionForEvent(eventRow, historyMap, modelProfile = null) {
	if (!eventRow || !historyMap) {
		return null;
	}
	const profile = modelProfile || getSportModelProfile('');

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

		let predictedTeam = profile.allowDraw ? "Draw" : home;
		if (absDiff >= 0.14) {
			predictedTeam = scoreDiff >= 0 ? home : away;
		}
		predictedTeam = normalizePredictedTeamForSport(predictedTeam, home, away, profile);

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
		predictedTeam = profile.allowDraw ? "Draw" : (scoreDiff >= 0 ? home : away);
		leanPct = profile.allowDraw
			? clampNumber(50 + Math.abs(scoreDiff) * 5, 50, 55)
			: clampNumber(50.6 + Math.abs(scoreDiff) * 4.2, 50.6, 55.4);
		confidence = leanPct >= 53 ? "average" : leanPct >= 51 ? "low" : "very low";
	}
	predictedTeam = normalizePredictedTeamForSport(predictedTeam, home, away, profile);

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

function doesSportAllowDraw(sportKey) {
	const normalized = String(sportKey || '').toLowerCase();
	if (!normalized) {
		return false;
	}
	return normalized.includes('soccer');
}

function resolveSportKeyForPrediction(eventRow, sportKey = '', oddsRow = null) {
	const direct = String(sportKey || '').trim();
	if (direct) {
		return direct;
	}
	const fromEvent = String(eventRow && eventRow.sport_key ? eventRow.sport_key : '').trim();
	if (fromEvent) {
		return fromEvent;
	}
	const fromOdds = String(oddsRow && oddsRow.sport_key ? oddsRow.sport_key : '').trim();
	return fromOdds;
}

function getSportModelProfile(sportKey) {
	const sportType = getSportSuggestionType(sportKey);
	const allowDraw = doesSportAllowDraw(sportKey);
	if (sportType === 'tennis') {
		return {
			allowDraw,
			historyReliabilityDivisor: 16,
			historyReliabilitySingleDivisor: 22,
			marketTrustBias: 0.72,
			drawSeedBase: 0,
			drawFloor: 0,
			drawCap: 0
		};
	}
	if (sportType === 'basketball' || sportType === 'baseball') {
		return {
			allowDraw,
			historyReliabilityDivisor: 18,
			historyReliabilitySingleDivisor: 24,
			marketTrustBias: 0.68,
			drawSeedBase: 0,
			drawFloor: 0,
			drawCap: 0
		};
	}
	if (sportType === 'hockey') {
		return {
			allowDraw,
			historyReliabilityDivisor: 18,
			historyReliabilitySingleDivisor: 24,
			marketTrustBias: 0.63,
			drawSeedBase: 0.02,
			drawFloor: 0,
			drawCap: 0.06
		};
	}
	if (sportType === 'football') {
		return {
			allowDraw,
			historyReliabilityDivisor: 18,
			historyReliabilitySingleDivisor: 24,
			marketTrustBias: 0.62,
			drawSeedBase: 0.2,
			drawFloor: 0.07,
			drawCap: 0.2
		};
	}
	return {
		allowDraw,
		historyReliabilityDivisor: 18,
		historyReliabilitySingleDivisor: 24,
		marketTrustBias: 0.65,
		drawSeedBase: 0.16,
		drawFloor: 0.05,
		drawCap: 0.16
	};
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

function getHistoryReliabilityForEvent(eventRow, historyMap, sportKey = "") {
	if (!eventRow || !historyMap || typeof historyMap !== 'object') {
		return 0;
	}
	const profile = getSportModelProfile(sportKey);
	const homeNorm = normalizeTeamName(eventRow && eventRow.home_team ? eventRow.home_team : '');
	const awayNorm = normalizeTeamName(eventRow && eventRow.away_team ? eventRow.away_team : '');
	const homeStats = historyMap[homeNorm];
	const awayStats = historyMap[awayNorm];
	const homeMatches = Number(homeStats && homeStats.matches);
	const awayMatches = Number(awayStats && awayStats.matches);
	const hasHome = Number.isFinite(homeMatches) && homeMatches > 0;
	const hasAway = Number.isFinite(awayMatches) && awayMatches > 0;
	if (!hasHome && !hasAway) {
		return 0;
	}
	if (hasHome && hasAway) {
		const minSample = Math.min(homeMatches, awayMatches);
		return clampNumber((minSample - 1) / Number(profile.historyReliabilityDivisor || 18), 0.12, 0.9);
	}
	const singleSample = hasHome ? homeMatches : awayMatches;
	return clampNumber((singleSample - 1) / Number(profile.historyReliabilitySingleDivisor || 24), 0.08, 0.55);
}

function buildHistoryProbabilitiesFromPrediction(eventRow, historyPrediction, historyMap, sportKey = "") {
	if (!eventRow || !historyPrediction || !historyPrediction.predictedTeam) {
		return null;
	}
	const profile = getSportModelProfile(sportKey);
	const home = eventRow && eventRow.home_team ? String(eventRow.home_team) : 'Home';
	const away = eventRow && eventRow.away_team ? String(eventRow.away_team) : 'Away';
	const predicted = String(historyPrediction.predictedTeam || '');
	const lean = Number(historyPrediction.leanPct);
	if (!Number.isFinite(lean)) {
		return null;
	}

	const drawSeed = profile.allowDraw
		? clampNumber(Number(profile.drawSeedBase || 0.16) - Math.max(0, (lean - 50)) / 35, Number(profile.drawFloor || 0.05), Number(profile.drawCap || 0.16))
		: 0;
	if (predicted === 'Draw') {
		const drawProb = profile.allowDraw ? clampNumber(lean / 100, 0.32, 0.6) : 0;
		const nonDraw = 1 - drawProb;
		return {
			home: nonDraw / 2,
			away: nonDraw / 2,
			draw: drawProb
		};
	}

	const predictedProb = clampNumber(lean / 100, 0.5, 0.78);
	const remainder = Math.max(0.01, 1 - predictedProb);
	const drawProb = profile.allowDraw ? Math.min(drawSeed, remainder * 0.52) : 0;
	const opponentProb = Math.max(0.01, remainder - drawProb);
	if (predicted === home) {
		return {
			home: predictedProb,
			away: opponentProb,
			draw: drawProb
		};
	}
	if (predicted === away) {
		return {
			home: opponentProb,
			away: predictedProb,
			draw: drawProb
		};
	}

	const historyReliability = getHistoryReliabilityForEvent(eventRow, historyMap, sportKey);
	const balancedProb = clampNumber(0.5 + ((lean - 50) / 100) * (0.4 + (historyReliability * 0.4)), 0.46, 0.65);
	const drawProbFallback = profile.allowDraw ? clampNumber(drawSeed, Number(profile.drawFloor || 0.05), Number(profile.drawCap || 0.16)) : 0;
	const sideProb = (1 - drawProbFallback) / 2;
	return {
		home: sideProb,
		away: sideProb,
		draw: drawProbFallback,
		preferred: balancedProb
	};
}

function normalizeOutcomeProbabilities(probabilities) {
	if (!probabilities || typeof probabilities !== 'object') {
		return null;
	}
	const home = Number(probabilities.home);
	const away = Number(probabilities.away);
	const draw = Number(probabilities.draw);
	if (!Number.isFinite(home) || !Number.isFinite(away) || !Number.isFinite(draw)) {
		return null;
	}
	const total = home + away + draw;
	if (!Number.isFinite(total) || total <= 0) {
		return null;
	}
	return {
		home: home / total,
		away: away / total,
		draw: draw / total
	};
}

function getPredictionForEvent(eventRow, oddsRow, historyMap = null, sportKey = "") {
	const resolvedSportKey = resolveSportKeyForPrediction(eventRow, sportKey, oddsRow);
	const home = eventRow && eventRow.home_team ? String(eventRow.home_team) : "Home";
	const away = eventRow && eventRow.away_team ? String(eventRow.away_team) : "Away";
	const modelProfile = getSportModelProfile(resolvedSportKey);
	const lockedPrediction = getLockedPregamePrediction(eventRow, resolvedSportKey);
	if (lockedPrediction && lockedPrediction.predictedTeam) {
		const normalizedLockedPrediction = normalizePredictionForSport(lockedPrediction, home, away, modelProfile);
		const enrichedLockedPrediction = enrichPredictionWithMarketMetrics(eventRow, oddsRow, normalizedLockedPrediction);
		return {
			...enrichedLockedPrediction,
			topBets: buildTopBetSuggestions(eventRow, enrichedLockedPrediction, resolvedSportKey)
		};
	}

	const effectiveHistoryMap = Array.isArray(historyMap)
		? buildPriorHistoryMapForEvent(historyMap, eventRow)
		: historyMap;
	const historyStatsMap = Array.isArray(historyMap)
		? effectiveHistoryMap
		: getFullHistoryMapForPrediction(historyMap);
	const historyPrediction = getHistoricalPredictionForEvent(eventRow, effectiveHistoryMap, modelProfile)
		|| (!Array.isArray(historyMap) ? getHistoricalPredictionForEvent(eventRow, historyStatsMap, modelProfile) : null);
	const historyProbabilities = normalizeOutcomeProbabilities(buildHistoryProbabilitiesFromPrediction(eventRow, historyPrediction, historyStatsMap, resolvedSportKey));
	const historyReliability = getHistoryReliabilityForEvent(eventRow, historyStatsMap, resolvedSportKey);

	const hasMarketData = Boolean(oddsRow && getEligibleSportsbetBookmakersForEvent(oddsRow, eventRow).length);
	if (!hasMarketData && historyPrediction) {
		const normalizedHistoryPrediction = normalizePredictionForSport(historyPrediction, home, away, modelProfile);
		const enrichedHistoryPrediction = enrichPredictionWithMarketMetrics(eventRow, oddsRow, normalizedHistoryPrediction);
		capturePregamePredictionSnapshot(eventRow, enrichedHistoryPrediction, resolvedSportKey);
		return {
			...enrichedHistoryPrediction,
			topBets: buildTopBetSuggestions(eventRow, enrichedHistoryPrediction, resolvedSportKey)
		};
	}

	if (!hasMarketData) {
		const fallbackPrediction = getDeterministicFallbackPrediction(eventRow, resolvedSportKey);
		if (fallbackPrediction) {
			const normalizedFallbackPrediction = normalizePredictionForSport(fallbackPrediction, home, away, modelProfile);
			const enrichedFallbackPrediction = enrichPredictionWithMarketMetrics(eventRow, oddsRow, normalizedFallbackPrediction);
			capturePregamePredictionSnapshot(eventRow, enrichedFallbackPrediction, resolvedSportKey);
			return {
				...enrichedFallbackPrediction,
				topBets: buildTopBetSuggestions(eventRow, enrichedFallbackPrediction, resolvedSportKey)
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
		if (historyPrediction) {
			const normalizedHistoryPrediction = normalizePredictionForSport(historyPrediction, home, away, modelProfile);
			const enrichedHistoryPrediction = enrichPredictionWithMarketMetrics(eventRow, oddsRow, normalizedHistoryPrediction);
			capturePregamePredictionSnapshot(eventRow, enrichedHistoryPrediction, resolvedSportKey);
			return {
				...enrichedHistoryPrediction,
				topBets: buildTopBetSuggestions(eventRow, enrichedHistoryPrediction, resolvedSportKey)
			};
		}
		const fallbackPrediction = getDeterministicFallbackPrediction(eventRow, resolvedSportKey);
		if (fallbackPrediction) {
			const normalizedFallbackPrediction = normalizePredictionForSport(fallbackPrediction, home, away, modelProfile);
			const enrichedFallbackPrediction = enrichPredictionWithMarketMetrics(eventRow, oddsRow, normalizedFallbackPrediction);
			capturePregamePredictionSnapshot(eventRow, enrichedFallbackPrediction, resolvedSportKey);
			return {
				...enrichedFallbackPrediction,
				topBets: buildTopBetSuggestions(eventRow, enrichedFallbackPrediction, resolvedSportKey)
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

	const marketReliabilityBase = clampNumber((Number(consensus.sampleSize) - 1) / 5, 0.28, 0.9);
	const marketAgreementPenalty = clampNumber(Number(consensus.agreementStdDev) / 0.18, 0, 0.45);
	const marketReliability = clampNumber(marketReliabilityBase * (1 - marketAgreementPenalty), 0.18, 0.9);
	const historyWeightRaw = historyProbabilities ? historyReliability : 0;
	const marketWeightRaw = marketReliability * Number(modelProfile.marketTrustBias || 0.65);
	const totalWeight = Math.max(0.0001, historyWeightRaw + marketWeightRaw);
	const marketWeight = marketWeightRaw / totalWeight;
	const historyWeight = historyWeightRaw / totalWeight;

	const blendedProbabilities = historyProbabilities
		? {
			home: (consensus.home * marketWeight) + (historyProbabilities.home * historyWeight),
			away: (consensus.away * marketWeight) + (historyProbabilities.away * historyWeight),
			draw: (consensus.draw * marketWeight) + (historyProbabilities.draw * historyWeight)
		}
		: {
			home: consensus.home,
			away: consensus.away,
			draw: consensus.draw
		};

	const calibratedBlend = normalizeOutcomeProbabilities(blendedProbabilities) || {
		home: consensus.home,
		away: consensus.away,
		draw: consensus.draw
	};

	const outcomes = [
		{ key: "home", team: home, prob: calibratedBlend.home },
		{ key: "away", team: away, prob: calibratedBlend.away }
	];
	if (modelProfile.allowDraw && calibratedBlend.draw > 0.001) {
		outcomes.push({ key: "draw", team: "Draw", prob: calibratedBlend.draw });
	}
	outcomes.sort((a, b) => b.prob - a.prob);

	const best = outcomes[0];
	const second = outcomes[1] || { prob: 0 };
	const consensusSampleSize = Math.max(1, Number(consensus.sampleSize) || 1);
	const combinedReliability = clampNumber((marketReliability * 0.62) + (historyReliability * 0.38), 0.1, 0.9);
	const disagreementUncertainty = clampNumber(Number(consensus.agreementStdDev) / 0.12, 0, 0.42);
	const sparseMarketPenalty = consensusSampleSize <= 1 ? 0.22 : consensusSampleSize <= 2 ? 0.12 : 0;
	const uncertaintyPenalty = clampNumber(disagreementUncertainty + sparseMarketPenalty, 0, 0.55);
	const shrinkFactor = clampNumber(0.52 - (combinedReliability * 0.24) + (uncertaintyPenalty * 0.22), 0.2, 0.58);
	const conservativeProbCap = combinedReliability >= 0.62 ? 0.76 : combinedReliability >= 0.44 ? 0.73 : 0.69;
	const calibratedProb = clampNumber(0.5 + ((best.prob - 0.5) * (1 - shrinkFactor)), 0.5, conservativeProbCap);
	const calibratedSecond = clampNumber(0.5 + ((second.prob - 0.5) * (1 - shrinkFactor)), 0.2, 0.49);
	const marketSnapshotForConfidence = getPredictionMarketSnapshot(eventRow, oddsRow, { predictedTeam: best.team, leanPct: (calibratedProb * 100).toFixed(1) });
	const marketEdgePct = Number.isFinite(marketSnapshotForConfidence.edgePct)
		? marketSnapshotForConfidence.edgePct
		: NaN;
	const rawEdgePct = Number.isFinite(marketEdgePct)
		? marketEdgePct
		: (calibratedProb - calibratedSecond) * 100;
	const edgeDampening = clampNumber(1 - (uncertaintyPenalty * 0.7), 0.45, 1);
	const adjustedEdgePct = rawEdgePct >= 0
		? rawEdgePct * edgeDampening
		: rawEdgePct * clampNumber(0.92 + (uncertaintyPenalty * 0.18), 0.92, 1.1);
	const edgePct = clampNumber(adjustedEdgePct, -12, 18);
	const edgeForConfidence = Math.max(0, edgePct);

	const agreementScore = Math.max(0, 1 - (consensus.agreementStdDev / 0.14));
	const sampleSupport = clampNumber(Math.log10(Math.max(2, consensus.sampleSize + 1)) / Math.log10(8), 0, 1);
	const margin = Math.max(0, calibratedProb - calibratedSecond);
	const marginSupport = clampNumber(margin / 0.16, 0, 1);
	const uncertaintyPenaltyScore = clampNumber(Number(consensus.agreementStdDev) / 0.2, 0, 0.55);
	const sourceAgreement = historyPrediction && historyPrediction.predictedTeam
		? (normalizeTeamName(historyPrediction.predictedTeam) === normalizeTeamName(best.team) ? 1 : 0)
		: 0.5;
	const confidenceScore = (edgeForConfidence / 18) * 0.32
		+ (agreementScore * 0.2)
		+ (sampleSupport * 0.18)
		+ (combinedReliability * 0.14)
		+ (sourceAgreement * 0.08)
		+ (marginSupport * 0.08)
		- (edgePct < 0 ? 0.2 : 0)
		- uncertaintyPenaltyScore;
	let confidence = confidenceScore >= 0.79 ? "very high"
		: confidenceScore >= 0.66 ? "high"
		: confidenceScore >= 0.5 ? "average"
		: confidenceScore >= 0.34 ? "low"
		: "very low";
	if (edgePct < 1.2 && confidence !== 'very low') {
		confidence = 'low';
	}
	if (uncertaintyPenalty >= 0.36 && (confidence === 'very high' || confidence === 'high')) {
		confidence = 'average';
	}
	if (consensusSampleSize <= 1 && historyReliability < 0.2) {
		confidence = 'very low';
	}
	const leanPct = (calibratedProb * 100).toFixed(1);

	const label = best.key === "draw"
		? "Prediction: Draw"
		: "Prediction: " + best.team + " to win";

	const result = {
		label,
		predictedTeam: best.team,
		edgePct: Number(edgePct.toFixed(1)),
		source: historyProbabilities ? "ensemble-model" : "market-consensus",
		confidence,
		leanPct
	};
	const enrichedResult = enrichPredictionWithMarketMetrics(eventRow, oddsRow, result);
	capturePregamePredictionSnapshot(eventRow, enrichedResult, resolvedSportKey);
	return {
		...enrichedResult,
		topBets: buildTopBetSuggestions(eventRow, enrichedResult, resolvedSportKey)
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

function getTierClassFromEv(evPct) {
	if (!Number.isFinite(evPct)) {
		return "tier-neutral";
	}
	if (evPct < 0) {
		return "tier-red";
	}
	if (evPct < 2) {
		return "tier-orange";
	}
	if (evPct <= 8) {
		return "tier-green";
	}
	return "tier-gold";
}

function formatEvTagText(evPct) {
	if (!Number.isFinite(evPct)) {
		return "N/A";
	}
	const rounded = Number(evPct).toFixed(1);
	if (evPct > 0) {
		return '+' + rounded + '% (+EV)';
	}
	return rounded + '%';
}

function buildEvBadge(prediction, eventRow, oddsRow) {
	if (!prediction || !prediction.predictedTeam) {
		return '<span class="meta-pill tier-neutral" title="' + escapeHtml(EV_TOOLTIP_TEXT) + '">EV: N/A</span>';
	}
	const marketSnapshot = getPredictionMarketSnapshot(eventRow, oddsRow, prediction);
	const evPct = Number.isFinite(Number(prediction && prediction.evPct)) ? Number(prediction.evPct) : marketSnapshot.evPct;
	const evTierClass = getTierClassFromEv(evPct);
	return '<span class="meta-pill ' + evTierClass + '" title="' + escapeHtml(EV_TOOLTIP_TEXT) + '">EV: ' + escapeHtml(formatEvTagText(evPct)) + '</span>';
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
	if (String(source || '').toLowerCase().includes('fallback')) {
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
		return "tier-orange";
	}
	if (normalized === "low") {
		return "tier-orange";
	}
	return "tier-red";
}

function buildSummaryStrip({
	ratioText = null,
	totalOddsText = null,
	multiOddsParts = null,
	ratioLabel = "Prediction ratio",
	totalOddsLabel = "Multi"
} = {}) {
	const ratioMarkup = ratioText
		? '<div class="summary-stat"><span class="summary-label">' + escapeHtml(ratioLabel) + '</span><strong>' + escapeHtml(ratioText) + '</strong></div>'
		: '';
	const normalizedParts = (Array.isArray(multiOddsParts) ? multiOddsParts : [])
		.map((value) => Number(value))
		.filter((value) => Number.isFinite(value) && value > 0);
	const multiOddsValue = Number(totalOddsText);
	const fallbackMultiOdds = Number.isFinite(multiOddsValue) && multiOddsValue > 0 ? multiOddsValue : 1;
	const multiProduct = normalizedParts.length ? normalizedParts.reduce((product, value) => product * value, 1) : fallbackMultiOdds;
	const multiExpression = normalizedParts.length ? normalizedParts.map((value) => value.toFixed(2)).join(' x ') : fallbackMultiOdds.toFixed(2);
	const stakeValue = Number.isFinite(Number(state.exampleStake)) && Number(state.exampleStake) >= 0 ? Number(state.exampleStake) : 100;
	const valueAmount = multiProduct;
	const multiMarkup = '';
	const stakeMarkup = '';
	const valueMarkup = '';
	if (!ratioMarkup && !multiMarkup && !stakeMarkup && !valueMarkup) {
		return '';
	}
	return '<div class="summary-strip">' + ratioMarkup + multiMarkup + stakeMarkup + valueMarkup + '</div>';
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
	return startTs <= now && (now - startTs) <= (3.5 * 60 * 60 * 1000);
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
	const eventId = row && row.id ? String(row.id) : '';
	const oddsRow = entry && entry.oddsRow
		? entry.oddsRow
		: (eventId && oddsByEventId ? oddsByEventId[eventId] : null);
	const fallbackSportKey = resolveSportKeyForPrediction(row, entry && entry.sportKey ? String(entry.sportKey) : sportKey, oddsRow);
	const prediction = entry && entry.prediction
		? entry.prediction
		: getPredictionForEvent(row, oddsRow, entry && entry.historyMap ? entry.historyMap : historyMap, fallbackSportKey);
	return { row, oddsRow, prediction, sportKey: fallbackSportKey };
}

function getActualOutcomeForRow(row) {
	if (!row || !hasUsableScoreData(row)) {
		return '';
	}
	const scores = extractEventScores(row);
	if (!Number.isFinite(scores.homeScore) || !Number.isFinite(scores.awayScore)) {
		return '';
	}
	if (scores.homeScore === scores.awayScore) {
		return 'draw';
	}
	return scores.homeScore > scores.awayScore ? 'home' : 'away';
}

function getPredictedOutcomeKey(eventRow, prediction) {
	if (!eventRow || !prediction || !prediction.predictedTeam) {
		return '';
	}
	const predictedNorm = normalizeTeamName(prediction.predictedTeam);
	const homeNorm = normalizeTeamName(eventRow.home_team || '');
	const awayNorm = normalizeTeamName(eventRow.away_team || '');
	if (predictedNorm === 'draw') {
		return 'draw';
	}
	if (predictedNorm === homeNorm) {
		return 'home';
	}
	if (predictedNorm === awayNorm) {
		return 'away';
	}
	return '';
}

function getLegacyMarketBaselinePrediction(eventRow, oddsRow, sportKey = '') {
	const consensus = buildConsensusProbabilities(eventRow, oddsRow);
	if (!consensus) {
		return null;
	}
	const resolvedSportKey = resolveSportKeyForPrediction(eventRow, sportKey, oddsRow);
	const profile = getSportModelProfile(resolvedSportKey);
	const home = eventRow && eventRow.home_team ? String(eventRow.home_team) : 'Home';
	const away = eventRow && eventRow.away_team ? String(eventRow.away_team) : 'Away';
	const outcomes = [
		{ key: 'home', team: home, prob: consensus.home },
		{ key: 'away', team: away, prob: consensus.away }
	];
	if (profile.allowDraw && consensus.draw > 0.001) {
		outcomes.push({ key: 'draw', team: 'Draw', prob: consensus.draw });
	}
	outcomes.sort((a, b) => b.prob - a.prob);
	const best = outcomes[0];
	if (!best) {
		return null;
	}
	const leanPct = (Math.max(0.5, Math.min(0.56, best.prob)) * 100).toFixed(1);
	return {
		predictedTeam: best.team,
		leanPct
	};
}

function buildPredictionBacktestSummary(items) {
	const rows = Array.isArray(items) ? items : [];
	const ensemble = { total: 0, hits: 0, brierSum: 0 };
	const baseline = { total: 0, hits: 0, brierSum: 0 };

	for (const item of rows) {
		const row = item && item.row ? item.row : null;
		const actual = getActualOutcomeForRow(row);
		if (!actual) {
			continue;
		}

		const ensemblePrediction = item && item.prediction ? item.prediction : null;
		const ensemblePick = getPredictedOutcomeKey(row, ensemblePrediction);
		const ensembleProb = clampNumber(Number(ensemblePrediction && ensemblePrediction.leanPct) / 100, 0.34, 0.9);
		if (ensemblePick && Number.isFinite(ensembleProb)) {
			const won = ensemblePick === actual;
			ensemble.total += 1;
			ensemble.hits += won ? 1 : 0;
			ensemble.brierSum += Math.pow(ensembleProb - (won ? 1 : 0), 2);
		}

		const baselinePrediction = getLegacyMarketBaselinePrediction(row, item && item.oddsRow ? item.oddsRow : null, item && item.sportKey ? item.sportKey : '');
		const baselinePick = getPredictedOutcomeKey(row, baselinePrediction);
		const baselineProb = clampNumber(Number(baselinePrediction && baselinePrediction.leanPct) / 100, 0.34, 0.9);
		if (baselinePick && Number.isFinite(baselineProb)) {
			const won = baselinePick === actual;
			baseline.total += 1;
			baseline.hits += won ? 1 : 0;
			baseline.brierSum += Math.pow(baselineProb - (won ? 1 : 0), 2);
		}
	}

	if (!ensemble.total) {
		return null;
	}

	const ensembleAccuracy = (ensemble.hits / ensemble.total) * 100;
	const ensembleBrier = ensemble.brierSum / ensemble.total;
	const baselineAccuracy = baseline.total ? (baseline.hits / baseline.total) * 100 : NaN;
	const baselineBrier = baseline.total ? (baseline.brierSum / baseline.total) : NaN;
	return {
		sampleSize: ensemble.total,
		ensembleAccuracy,
		ensembleBrier,
		baselineAccuracy,
		baselineBrier
	};
}

function readBacktestHistory() {
	try {
		const raw = localStorage.getItem(BACKTEST_HISTORY_KEY);
		if (!raw) {
			return [];
		}
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function writeBacktestHistory(history) {
	if (!Array.isArray(history)) {
		return;
	}
	try {
		localStorage.setItem(BACKTEST_HISTORY_KEY, JSON.stringify(history));
	} catch {
		// Ignore local storage failures.
	}
}

function saveBacktestSnapshot(scopeLabel, backtest, perSportBreakdown = []) {
	if (!backtest || !Number.isFinite(backtest.sampleSize) || backtest.sampleSize <= 0) {
		return;
	}
	const history = readBacktestHistory();
	history.push({
		ts: new Date().toISOString(),
		scope: String(scopeLabel || ''),
		sampleSize: Number(backtest.sampleSize),
		ensembleAccuracy: Number(backtest.ensembleAccuracy),
		ensembleBrier: Number(backtest.ensembleBrier),
		baselineAccuracy: Number(backtest.baselineAccuracy),
		baselineBrier: Number(backtest.baselineBrier),
		perSport: Array.isArray(perSportBreakdown) ? perSportBreakdown.slice(0, 6).map((item) => ({
			sport: String(item && item.sport ? item.sport : ''),
			sampleSize: Number(item && item.sampleSize),
			accuracy: Number(item && item.accuracy),
			brier: Number(item && item.brier)
		})) : []
	});
	while (history.length > 16) {
		history.shift();
	}
	writeBacktestHistory(history);
}

function normalizeBacktestTrendWindow(value) {
	const numeric = Number(value);
	if (numeric === 1 || numeric === 5 || numeric === 10) {
		return numeric;
	}
	return 5;
}

function getBacktestTrendWindow() {
	const stateValue = normalizeBacktestTrendWindow(state && state.backtestTrendWindow ? state.backtestTrendWindow : 5);
	if (state) {
		state.backtestTrendWindow = stateValue;
	}
	try {
		const stored = localStorage.getItem(BACKTEST_TREND_WINDOW_KEY);
		if (!stored) {
			return stateValue;
		}
		const normalized = normalizeBacktestTrendWindow(stored);
		if (state) {
			state.backtestTrendWindow = normalized;
		}
		return normalized;
	} catch {
		return stateValue;
	}
}

function setBacktestTrendWindow(value) {
	const normalized = normalizeBacktestTrendWindow(value);
	if (state) {
		state.backtestTrendWindow = normalized;
	}
	try {
		localStorage.setItem(BACKTEST_TREND_WINDOW_KEY, String(normalized));
	} catch {
		// Ignore local storage failures.
	}
	return normalized;
}

function getRecentBacktestTrend(limit = 5) {
	const history = readBacktestHistory();
	if (!history.length) {
		return [];
	}
	const rows = history.slice(-Math.max(1, Number(limit) || 5));
	return rows.map((entry) => ({
		timestamp: entry && entry.ts ? String(entry.ts) : '',
		sampleSize: Number(entry && entry.sampleSize),
		ensembleAccuracy: Number(entry && entry.ensembleAccuracy),
		ensembleBrier: Number(entry && entry.ensembleBrier)
	})).filter((entry) => Number.isFinite(entry.sampleSize) && entry.sampleSize > 0);
}

function buildPerSportBacktestBreakdown(items) {
	const rows = Array.isArray(items) ? items : [];
	const bySport = new Map();
	for (const item of rows) {
		const row = item && item.row ? item.row : null;
		const actual = getActualOutcomeForRow(row);
		if (!actual) {
			continue;
		}
		const prediction = item && item.prediction ? item.prediction : null;
		const predictedKey = getPredictedOutcomeKey(row, prediction);
		const prob = clampNumber(Number(prediction && prediction.leanPct) / 100, 0.34, 0.9);
		if (!predictedKey || !Number.isFinite(prob)) {
			continue;
		}
		const sportName = String(item && item.sportTitle ? item.sportTitle : item && item.sportKey ? item.sportKey : 'Unknown').trim() || 'Unknown';
		if (!bySport.has(sportName)) {
			bySport.set(sportName, { sport: sportName, total: 0, hits: 0, brierSum: 0 });
		}
		const target = bySport.get(sportName);
		const won = predictedKey === actual;
		target.total += 1;
		target.hits += won ? 1 : 0;
		target.brierSum += Math.pow(prob - (won ? 1 : 0), 2);
	}

	return Array.from(bySport.values())
		.filter((item) => item.total > 0)
		.map((item) => ({
			sport: item.sport,
			sampleSize: item.total,
			accuracy: (item.hits / item.total) * 100,
			brier: item.brierSum / item.total
		}))
		.sort((a, b) => b.sampleSize - a.sampleSize)
		.slice(0, 4);
}

function buildBacktestTrendSparkline(rows) {
	const safeRows = Array.isArray(rows) ? rows.filter((row) => row && Number.isFinite(Number(row.ensembleAccuracy))) : [];
	if (!safeRows.length) {
		return '';
	}
	const values = safeRows.map((row) => Number(row.ensembleAccuracy));
	const minVal = Math.min(...values, 0);
	const maxVal = Math.max(...values, 100);
	const spread = Math.max(1, maxVal - minVal);
	const points = values.map((value, index) => {
		const x = safeRows.length === 1 ? 80 : 12 + ((index / (safeRows.length - 1)) * 136);
		const y = 26 - ((value - minVal) / spread) * 18;
		return x + ',' + y.toFixed(2);
	}).join(' ');
	const firstPoint = values.length === 1 ? '80,26' : '';
	const areaPoints = safeRows.length === 1
		? '80,26 80,26 80,26'
		: '12,26 ' + points + ' 148,26';
	return '<svg class="backtest-sparkline" viewBox="0 0 160 34" preserveAspectRatio="none" aria-label="Backtest trend chart">'
		+ '<polygon class="backtest-sparkline-area" points="' + areaPoints + '"></polygon>'
		+ '<polyline class="backtest-sparkline-line" points="' + points + '" fill="none"></polyline>'
		+ (firstPoint ? '<circle class="backtest-sparkline-dot" cx="80" cy="26" r="2.5"></circle>' : '')
		+ '</svg>';
}

function buildBacktestCardMarkup(backtest, evaluatedItems, scopeLabel = '') {
	const safeBacktest = backtest && typeof backtest === 'object' ? backtest : {
		sampleSize: 0,
		ensembleAccuracy: 0,
		ensembleBrier: 0,
		baselineAccuracy: NaN,
		baselineBrier: NaN
	};
	const hasData = Number.isFinite(safeBacktest.sampleSize) && safeBacktest.sampleSize > 0;
	const deltaAccuracy = Number.isFinite(safeBacktest.baselineAccuracy) ? (safeBacktest.ensembleAccuracy - safeBacktest.baselineAccuracy) : NaN;
	const deltaBrier = Number.isFinite(safeBacktest.baselineBrier) ? (safeBacktest.baselineBrier - safeBacktest.ensembleBrier) : NaN;
	const accuracyTier = Number.isFinite(deltaAccuracy) ? (deltaAccuracy >= 0 ? 'tier-green' : 'tier-red') : 'tier-neutral';
	const brierTier = Number.isFinite(deltaBrier) ? (deltaBrier >= 0 ? 'tier-green' : 'tier-red') : 'tier-neutral';
	const trendWindow = getBacktestTrendWindow();
	const trend = hasData
		? (trendWindow === 1
			? [{ timestamp: new Date().toISOString(), sampleSize: safeBacktest.sampleSize, ensembleAccuracy: safeBacktest.ensembleAccuracy, ensembleBrier: safeBacktest.ensembleBrier }]
			: getRecentBacktestTrend(trendWindow))
		: [];
	const trendHtml = trend.length
		? '<div class="backtest-trend">' + trend.map((row) => {
			const stamp = row.timestamp ? new Date(row.timestamp) : null;
			const label = trendWindow === 1
				? 'Current'
				: stamp && Number.isFinite(stamp.getTime())
					? stamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
					: 'Run';
			return '<span class="meta-pill tier-neutral" title="Sample ' + row.sampleSize + ', Brier ' + row.ensembleBrier.toFixed(3) + '">' + escapeHtml(label + ' ' + row.ensembleAccuracy.toFixed(1) + '%') + '</span>';
		}).join('') + '</div>'
		: '<p class="backtest-note">Trend builds as you reload Results.</p>';
	const perSport = buildPerSportBacktestBreakdown(Array.isArray(evaluatedItems) ? evaluatedItems : []);
	const perSportHtml = perSport.length
		? '<div class="backtest-sport-grid">' + perSport.map((item) => '<div class="backtest-sport-row" data-sport-filter="' + escapeHtml(item.sport) + '"><span>' + escapeHtml(item.sport + ' (' + item.sampleSize + ')') + '</span><strong>' + escapeHtml(item.accuracy.toFixed(1) + '%') + '</strong></div>').join('') + '</div>'
		: '<p class="backtest-note">' + (hasData ? 'Not enough settled outcomes for per-sport split.' : 'No settled outcomes yet. Backtest will show here when results are available.') + '</p>';
	const toggleButton = (windowValue, label) => {
		const isActive = trendWindow === windowValue;
		const iconClass = windowValue === 1 ? 'fa-bolt' : 'fa-chart-line';
		const windowTrend = windowValue === 1
			? (hasData ? [{ ensembleAccuracy: safeBacktest.ensembleAccuracy }] : [])
			: (hasData ? getRecentBacktestTrend(windowValue) : []);
		const acc = windowTrend.length
			? windowTrend.reduce(function(s, r) { return s + r.ensembleAccuracy; }, 0) / windowTrend.length
			: NaN;
		const accStr = Number.isFinite(acc) ? ' · ' + acc.toFixed(1) + '%' : '';
		return '<button type="button" class="backtest-toggle-btn' + (isActive ? ' is-active' : '') + '" data-action="backtest-trend-window" data-window="' + windowValue + '" aria-pressed="' + (isActive ? 'true' : 'false') + '"><i class="fa-solid ' + iconClass + '" aria-hidden="true"></i>' + escapeHtml(label + accStr) + '</button>';
	};
	const summaryStats = hasData ? '' : '<div class="summary-strip"><div class="summary-stat"><span class="summary-label">Status</span><strong>Waiting for settled results</strong></div></div>';

	// Compute net odds and win/loss counts for the 4-column summary grid
	let winOddsSum = 0, lossOddsSum = 0, wonCount = 0, lostCount = 0;
	(Array.isArray(evaluatedItems) ? evaluatedItems : []).forEach(function(item) {
		if (!item || !item.prediction || !item.prediction.predictedTeam) { return; }
		const result = getPredictionResultForCompletedEvent(item.row, item.prediction.predictedTeam);
		if (!result || (result.label !== 'Won' && result.label !== 'Lost')) { return; }
		const odds = Number(
			getBookmakerOddsForPrediction(item.row, item.oddsRow, item.prediction) ||
			(item.prediction && item.prediction.pregameOdds)
		);
		if (!Number.isFinite(odds) || odds <= 1) { return; }
		if (result.label === 'Won') { winOddsSum += odds; wonCount++; } else { lossOddsSum += odds; lostCount++; }
	});
	const netOdds = winOddsSum - lossOddsSum;
	const netOddsStr = (winOddsSum > 0 || lossOddsSum > 0) ? ' @ ' + (netOdds >= 0 ? '+' : '') + netOdds.toFixed(2) : '';
	const avgWinTierClass = hasData ? (safeBacktest.ensembleAccuracy >= 55 ? 'tier-green' : safeBacktest.ensembleAccuracy >= 45 ? 'tier-neutral' : 'tier-red') : 'tier-neutral';
	const avgWinStatHtml = hasData
		? '<div class="backtest-sport-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:6px">'
			+ '<div class="backtest-sport-row"><span>Avg Win %</span><strong class="' + avgWinTierClass + '">' + escapeHtml(safeBacktest.ensembleAccuracy.toFixed(1) + '%' + netOddsStr) + '</strong></div>'
			+ '<div class="backtest-sport-row"><span>Won</span><strong class="tier-green">' + escapeHtml(String(wonCount)) + '</strong></div>'
			+ '<div class="backtest-sport-row"><span>Lost</span><strong class="tier-red">' + escapeHtml(String(lostCount)) + '</strong></div>'
			+ '<div class="backtest-sport-row"><span>Sample</span><strong>' + escapeHtml(String(safeBacktest.sampleSize)) + '</strong></div>'
			+ '</div>'
		: '';

	const beEvalItems = Array.isArray(evaluatedItems) ? evaluatedItems : [];
	let beAbove = 0, beBelow = 0, beTotal = 0;
	beEvalItems.forEach(function(item) {
		if (!item || !item.prediction || !item.prediction.predictedTeam) { return; }
		const lp = Number(item.prediction.leanPct);
		if (!Number.isFinite(lp) || lp <= 0) { return; }
		const odds = Number(getBookmakerOddsForPrediction(item.row, item.oddsRow, item.prediction));
		if (!Number.isFinite(odds) || odds <= 1) { return; }
		beTotal++;
		if (odds >= (100 / lp)) { beAbove++; } else { beBelow++; }
	});
	const abovePctStr = beTotal > 0 ? (beAbove / beTotal * 100).toFixed(0) + '%' : '—';
	const belowPctStr = beTotal > 0 ? (beBelow / beTotal * 100).toFixed(0) + '%' : '—';
	const beFilterHtml = beTotal > 0
		? '<section class="backtest-card" aria-label="Break-even filter" style="margin-top:6px">'
			+ '<div class="backtest-head"><h3>Break-Even</h3><button type="button" class="backtest-collapse-btn" aria-expanded="true" aria-label="Collapse"><i class="fa-solid fa-chevron-down" aria-hidden="true"></i></button></div>'
			+ '<div class="summary-strip">'
			+ '<div class="summary-stat be-stat-btn" data-be-upcoming-filter="above"><span class="summary-label">Above BE</span><strong style="color:#9ee4b7">' + escapeHtml(String(beAbove) + ' \u00b7 ' + abovePctStr) + '</strong></div>'
			+ '<div class="summary-stat be-stat-btn" data-be-upcoming-filter="below"><span class="summary-label">Below BE</span><strong style="color:#f2a6a6">' + escapeHtml(String(beBelow) + ' \u00b7 ' + belowPctStr) + '</strong></div>'
			+ '</div>'
			+ '</section>'
		: '';

	return '<section class="backtest-card" aria-label="Prediction backtest summary">'
		+ '<div class="backtest-head"><h3>Win Percentage</h3><button type="button" class="backtest-collapse-btn" aria-expanded="true" aria-label="Collapse"><i class="fa-solid fa-chevron-down" aria-hidden="true"></i></button></div>'
		+ summaryStats
		+ avgWinStatHtml
		+ perSportHtml
		+ beFilterHtml
		+ '</section>';
}

function buildNextTestSummary(items) {
	const rows = Array.isArray(items)
		? items.filter((item) => item && item.prediction && item.prediction.predictedTeam)
		: [];
	if (!rows.length) {
		return null;
	}
	let winPctSum = 0;
	let winPctCount = 0;
	let edgePctSum = 0;
	let edgePctCount = 0;
	let tierGreen = 0;
	let tierOrange = 0;
	let tierRed = 0;
	let oddsSum = 0;
	for (const item of rows) {
		const winPct = Number(item.prediction.leanPct);
		if (Number.isFinite(winPct)) {
			winPctSum += winPct;
			winPctCount += 1;
			if (winPct >= 58) {
				tierGreen += 1;
			} else if (winPct >= 45) {
				tierOrange += 1;
			} else {
				tierRed += 1;
			}
		}
		const edgePct = Number(item.prediction.edgePct);
		if (Number.isFinite(edgePct)) {
			edgePctSum += edgePct;
			edgePctCount += 1;
		}
		const odds = Number(
			(item.predictionOdds) ||
			getBookmakerOddsForPrediction(item.row, item.oddsRow, item.prediction) ||
			(item.prediction && item.prediction.pregameOdds)
		);
		if (Number.isFinite(odds) && odds > 1) { oddsSum += odds; }
	}
	if (!winPctCount) {
		return null;
	}
	return {
		sampleSize: winPctCount,
		avgWinPct: winPctSum / winPctCount,
		avgEdgePct: edgePctCount ? edgePctSum / edgePctCount : NaN,
		oddsSum,
		tierGreen,
		tierOrange,
		tierRed
	};
}

function readNextTestHistory() {
	try {
		const raw = localStorage.getItem(NEXTTEST_HISTORY_KEY);
		if (!raw) {
			return [];
		}
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function writeNextTestHistory(history) {
	if (!Array.isArray(history)) {
		return;
	}
	try {
		localStorage.setItem(NEXTTEST_HISTORY_KEY, JSON.stringify(history));
	} catch {
		// Ignore local storage failures.
	}
}

function saveNextTestSnapshot(scopeLabel, summary) {
	if (!summary || !Number.isFinite(summary.sampleSize) || summary.sampleSize <= 0) {
		return;
	}
	const history = readNextTestHistory();
	history.push({
		ts: new Date().toISOString(),
		scope: String(scopeLabel || ''),
		sampleSize: Number(summary.sampleSize),
		avgWinPct: Number(summary.avgWinPct),
		avgEdgePct: Number(summary.avgEdgePct),
		tierGreen: Number(summary.tierGreen),
		tierOrange: Number(summary.tierOrange),
		tierRed: Number(summary.tierRed)
	});
	while (history.length > 16) {
		history.shift();
	}
	writeNextTestHistory(history);
}

function getRecentNextTestTrend(limit = 5) {
	const history = readNextTestHistory();
	if (!history.length) {
		return [];
	}
	const rows = history.slice(-Math.max(1, Number(limit) || 5));
	return rows.map((entry) => ({
		timestamp: entry && entry.ts ? String(entry.ts) : '',
		sampleSize: Number(entry && entry.sampleSize),
		avgWinPct: Number(entry && entry.avgWinPct)
	})).filter((entry) => Number.isFinite(entry.sampleSize) && entry.sampleSize > 0
		&& Number.isFinite(entry.avgWinPct));
}

function buildPerSportNextTestBreakdown(items) {
	const rows = Array.isArray(items)
		? items.filter((item) => item && item.prediction && item.prediction.predictedTeam)
		: [];
	const bySport = new Map();
	for (const item of rows) {
		const winPct = Number(item.prediction.leanPct);
		if (!Number.isFinite(winPct)) {
			continue;
		}
		const sportName = String(item.sportTitle || item.sportKey || 'Unknown').trim() || 'Unknown';
		if (!bySport.has(sportName)) {
			bySport.set(sportName, { sport: sportName, total: 0, winPctSum: 0 });
		}
		const target = bySport.get(sportName);
		target.total += 1;
		target.winPctSum += winPct;
	}
	return Array.from(bySport.values())
		.filter((item) => item.total > 0)
		.map((item) => ({
			sport: item.sport,
			sampleSize: item.total,
			avgWinPct: item.winPctSum / item.total
		}))
		.sort((a, b) => b.sampleSize - a.sampleSize)
		.slice(0, 4);
}

function buildNextTestTrendSparkline(rows) {
	const safeRows = Array.isArray(rows)
		? rows.filter((row) => row && Number.isFinite(Number(row.avgWinPct)))
		: [];
	if (!safeRows.length) {
		return '';
	}
	const values = safeRows.map((row) => Number(row.avgWinPct));
	const minVal = Math.min(...values, 0);
	const maxVal = Math.max(...values, 100);
	const spread = Math.max(1, maxVal - minVal);
	const points = values.map((value, index) => {
		const x = safeRows.length === 1 ? 80 : 12 + ((index / (safeRows.length - 1)) * 136);
		const y = 26 - ((value - minVal) / spread) * 18;
		return x + ',' + y.toFixed(2);
	}).join(' ');
	const firstPoint = values.length === 1 ? '80,26' : '';
	const areaPoints = safeRows.length === 1
		? '80,26 80,26 80,26'
		: '12,26 ' + points + ' 148,26';
	return '<svg class="backtest-sparkline" viewBox="0 0 160 34" preserveAspectRatio="none" aria-label="Next-test trend chart">'
		+ '<polygon class="backtest-sparkline-area" points="' + areaPoints + '"></polygon>'
		+ '<polyline class="backtest-sparkline-line" points="' + points + '" fill="none"></polyline>'
		+ (firstPoint ? '<circle class="backtest-sparkline-dot" cx="80" cy="26" r="2.5"></circle>' : '')
		+ '</svg>';
}

function buildNextTestCardMarkup(summary, items, scopeLabel = '') {
	const safeSummary = summary && typeof summary === 'object' ? summary : null;
	const hasData = safeSummary && Number.isFinite(safeSummary.sampleSize) && safeSummary.sampleSize > 0;
	const trendWindow = getBacktestTrendWindow();
	const trend = hasData
		? (trendWindow === 1
			? [{ timestamp: new Date().toISOString(), sampleSize: safeSummary.sampleSize, avgWinPct: safeSummary.avgWinPct }]
			: getRecentNextTestTrend(trendWindow))
		: [];
	const trendHtml = trend.length
		? '<div class="backtest-trend">'
			+ trend.map((row) => {
				const stamp = row.timestamp ? new Date(row.timestamp) : null;
				const label = trendWindow === 1
					? 'Current'
					: stamp && Number.isFinite(stamp.getTime())
						? stamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
						: 'Load';
				return '<span class="meta-pill tier-neutral" title="n=' + row.sampleSize + '">'
					+ escapeHtml(label + ' ' + row.avgWinPct.toFixed(1) + '%') + '</span>';
			}).join('') + '</div>'
		: '<p class="backtest-note">Trend builds as you reload Upcoming.</p>';

	const perSport = buildPerSportNextTestBreakdown(Array.isArray(items) ? items : []);
	const perSportHtml = perSport.length
		? '<div class="backtest-sport-grid">'
			+ perSport.map((item) => {
				const winTier = getLikelihoodTierClass(item.avgWinPct);
				return '<div class="backtest-sport-row" data-sport-filter="' + escapeHtml(item.sport) + '">'
					+ '<span>' + escapeHtml(item.sport + ' (' + item.sampleSize + ')') + '</span>'
					+ '<strong class="' + winTier + '">' + escapeHtml(item.avgWinPct.toFixed(1) + '%') + '</strong>'
					+ '</div>';
			}).join('') + '</div>'
		: '<p class="backtest-note">'
			+ (hasData ? 'Not enough picks for per-sport split.' : 'No upcoming predictions to analyse.')
			+ '</p>';

	const toggleButton = (windowValue, label) => {
		const isActive = trendWindow === windowValue;
		const iconClass = windowValue === 1 ? 'fa-bolt' : 'fa-chart-line';
		return '<button type="button" class="backtest-toggle-btn'
			+ (isActive ? ' is-active' : '')
			+ '" data-action="backtest-trend-window" data-window="' + windowValue
			+ '" aria-pressed="' + (isActive ? 'true' : 'false') + '">'
			+ '<i class="fa-solid ' + iconClass + '" aria-hidden="true"></i>'
			+ escapeHtml(label) + '</button>';
	};

	const avgWinTier = hasData ? getLikelihoodTierClass(safeSummary.avgWinPct) : 'tier-neutral';
	const avgEdgeStr = hasData && Number.isFinite(safeSummary.avgEdgePct)
		? (safeSummary.avgEdgePct >= 0 ? '+' : '') + safeSummary.avgEdgePct.toFixed(1) + '%'
		: 'N/A';
	const avgEdgeTier = hasData && Number.isFinite(safeSummary.avgEdgePct)
		? (safeSummary.avgEdgePct > 0 ? 'tier-green' : safeSummary.avgEdgePct < 0 ? 'tier-red' : 'tier-neutral')
		: 'tier-neutral';

	const summaryStats = hasData
		? '<div class="backtest-sport-grid" style="grid-template-columns:repeat(4,1fr)">'
			+ '<div class="backtest-sport-row"><span>Avg Win %</span><strong class="' + avgWinTier + '">' + escapeHtml(safeSummary.avgWinPct.toFixed(1) + '%' + (safeSummary.oddsSum > 0 ? ' @ ' + safeSummary.oddsSum.toFixed(2) : '')) + '</strong></div>'
			+ '<div class="backtest-sport-row"><span>Avg Edge</span><strong class="' + avgEdgeTier + '">' + escapeHtml(avgEdgeStr) + '</strong></div>'
			+ '<div class="backtest-sport-row"><span>High Conf</span><strong class="tier-green">' + escapeHtml(String(safeSummary.tierGreen) + ' picks') + '</strong></div>'
			+ '<div class="backtest-sport-row"><span>Med / Low</span><strong>' + escapeHtml(safeSummary.tierOrange + ' / ' + safeSummary.tierRed) + '</strong></div>'
			+ '</div>'
		: '<div class="summary-strip"><div class="summary-stat">'
			+ '<span class="summary-label">Status</span><strong>No upcoming predictions yet</strong>'
			+ '</div></div>';

	return '<section class="backtest-card" aria-label="Upcoming prediction overview">'
		+ '<div class="backtest-head"><h3>Win Percentages</h3>'
		+ '<button type="button" class="backtest-collapse-btn" aria-expanded="true" aria-label="Collapse"><i class="fa-solid fa-chevron-down" aria-hidden="true"></i></button></div>'
		+ summaryStats
		+ '<p class="backtest-subhead">Per-Sport %</p>'
		+ perSportHtml
		+ '</section>';
}

function buildRecentSummary(events, oddsByEventId, historyMap = null, sportKey = "") {
	let wins = 0;
	let losses = 0;
	let totalOdds = 1;
	let totalOddsCount = 0;
	const multiOddsParts = [];

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
			const normalizedOddsValue = oddsValue !== null ? oddsValue : 1;
			totalOdds *= normalizedOddsValue;
			multiOddsParts.push(normalizedOddsValue);
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
		multiOddsParts,
		individualOddsText: totalOddsCount > 0 ? individualOddsTotal.toFixed(2) : '0.00',
		individualWinningsText: totalOddsCount > 0 ? (individualOddsTotal * 100).toFixed(2) : '0.00'
	};
}

function buildUpcomingSummary(events, oddsByEventId, historyMap = null, sportKey = "") {
	let totalOdds = 1;
	let totalOddsCount = 0;
	const multiOddsParts = [];
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
			const normalizedOddsValue = oddsValue !== null ? oddsValue : 1;
			totalOdds *= normalizedOddsValue;
			multiOddsParts.push(normalizedOddsValue);
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
		multiOddsParts,
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
		el.upcomingWrap.innerHTML = '<p class="subhead">Recent Results | ' + escapeHtml(sportTitle) + '</p>'
			+ '<div class="empty">No recent results available for this sport.</div>';
		return;
	}

	const sortedEvents = sortByStartDesc(filterRecentPickWindow(events));
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
			if (hasActiveGameFilters()) {
				continue;
			}
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
	const evaluatedItems = [...predictedRows, ...noPredictionRows].map(({ row, oddsRow, prediction }) => ({
		row,
		oddsRow,
		prediction,
		sportKey,
		sportTitle
	}));
	const backtest = buildPredictionBacktestSummary(evaluatedItems);
	const backtestCardHtml = buildBacktestCardMarkup(backtest, evaluatedItems, sportTitle);
	const recentViewMoreHtml = getRecentViewMoreMarkup();
	const beItems = predictedRows.map(function(item) {
		return {
			row: item.row,
			oddsRow: item.oddsRow,
			prediction: item.prediction,
			sportKey,
			sportTitle,
			start: item.start,
			home: item.home,
			away: item.away,
			betName: item.prediction && item.prediction.label ? String(item.prediction.label).replace(/^Prediction:\s*/i, '') : '',
			predictionOdds: item.prediction && item.prediction.pregameOdds ? item.prediction.pregameOdds : null
		};
	});

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
		const evBadge = buildEvBadge(prediction, row, oddsRow);
		const completedPredictionResult = hasPrediction ? getPredictionResultForCompletedEvent(row, prediction.predictedTeam) : { label: "No prediction", tierClass: "tier-neutral" };
		const livePredictionStatus = hasPrediction ? getLivePredictionStatus(row, prediction.predictedTeam) : null;
		const predictionOdds = getDisplayOddsForEvent(row, oddsRow, prediction)
			|| (prediction && prediction.pregameOdds ? Number(prediction.pregameOdds).toFixed(2) : null);
		const insightsPanel = hasPrediction
			? attachTopBetsToInsights(buildGameInsightsPanel(row, prediction, Array.isArray(historyMap) ? historyMap : (Array.isArray(events) ? events : []), oddsRow), prediction.topBets)
			: '';
		const expandHint = insightsPanel ? '<p class="card-expand-hint">Tap card for matchup insights</p>' : '';
		const cardExpandAttrs = insightsPanel ? ' data-expand-card="true" role="button" tabindex="0" aria-expanded="false"' : '';
		const oddsAndScoreBadge = hasPrediction
			? '<span class="odds-pill" title="Pre-game odds and final score">Odds: ' + escapeHtml(predictionOdds || 'N/A') + ' | Score: ' + escapeHtml(scoreText || 'N/A') + '</span>'
			: '';
		const confidenceBadge = prediction && prediction.confidence
			? '<span class="meta-pill ' + confidenceTierClass + '">Conf: ' + escapeHtml(confidenceText) + '</span>'
			: '';
		const winBadge = hasPrediction ? '<span class="meta-pill ' + winTierClass + '">Win: ' + escapeHtml(winChanceText) + '</span>' : '<span class="meta-pill tier-neutral">Win: N/A</span>';
		const edgeBadge = hasPrediction ? '<span class="meta-pill ' + edgeTierClass + '">Edge: ' + escapeHtml(edgeText) + '</span>' : '<span class="meta-pill tier-neutral">Edge: N/A</span>';
		const resultBadge = hasPrediction
			? '<span class="meta-pill ' + completedPredictionResult.tierClass + '">Result: ' + escapeHtml(completedPredictionResult.label) + '</span>'
			: '<span class="meta-pill tier-neutral">Result: No prediction</span>';
		const beOddsV = Number(getBookmakerOddsForPrediction(row, oddsRow, prediction) || (prediction && prediction.pregameOdds));
		const beLpV = Number(prediction && prediction.leanPct);
		const beStatus = hasPrediction && Number.isFinite(beOddsV) && beOddsV > 1 && Number.isFinite(beLpV) && beLpV > 0
			? (beOddsV >= (100 / beLpV) ? 'above' : 'below') : '';
		const resultClass = ''; // green/red only applied when BE filter button is pressed

		return '<article class="game-card"' + ' data-sport="' + escapeHtml(sportTitle) + '"' + (beStatus ? ' data-be-status="' + beStatus + '"' : '') + cardExpandAttrs + '>'
			+ '<div class="game-head">'
			+ '<div class="matchup-block">'
			+ '<p class="sport-card-title">' + escapeHtml(sportTitle) + '</p>'
			+ '<div class="matchup-title-row">'
			+ '<p class="matchup">' + escapeHtml(home + ' vs ' + away) + '</p>'
			+ '</div>'
			+ '<p class="kickoff">Started: ' + escapeHtml(formatDateTime(start)) + '</p>'
			+ '</div>'
			+ '<div class="prediction-side">'
			+ '<div class="prediction-stack">'
			+ '<div class="prediction-row">'
			+ '<p class="bet-name">' + escapeHtml(betName) + '</p>'
			+ oddsAndScoreBadge
			+ '</div>'
			+ '<div class="game-meta compact right-aligned">'
			+ winBadge
			+ edgeBadge
			+ evBadge
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
		el.upcomingWrap.innerHTML = '<p class="subhead">Recent Results | ' + escapeHtml(sportTitle) + '</p>'
			+ '<div class="empty">No recent results match your search.</div>'
			+ recentViewMoreHtml;
		return;
	}

	el.upcomingWrap.innerHTML = '<p class="subhead">Recent Results | ' + escapeHtml(sportTitle) + ' | ' + events.length + ' events</p>'
		+ buildSummaryStrip({
			ratioText: summary.ratioText,
			totalOddsText: summary.totalOddsText,
			multiOddsParts: summary.multiOddsParts
		})
		+ buildUpcomingBreakEvenSection(beItems, sportTitle, 'recent')
		+ backtestCardHtml
		+ '<div class="upcoming-list">' + cardsHtml + '</div>'
		+ recentViewMoreHtml;
}

function renderUpcomingEvents(sportKey, events, oddsByEventId, rangeKey = state.timeRange, historyMap = null, options = {}) {
	bindGameCardInteractions();
	const meta = state.sportsByKey[sportKey] || {};
	const sportTitle = meta.title ? String(meta.title) : sportKey;
	setResultSportOptions([sportTitle]);
	const normalizedRange = normalizeRangeKey(rangeKey);
	const hideLiveInThisView = normalizedRange !== 'live';
	const isTodayRange = normalizeRangeKey(rangeKey) === 'today';
	const nowTimestamp = Date.now();
	const showAllUpcomingCards = isTodayRange && Number(state.upcomingBePickLimit) === 0;
	const upcomingCardWindowEnd = isTodayRange
		? (showAllUpcomingCards ? null : nowTimestamp + DEFAULT_UPCOMING_CARD_WINDOW_HOURS * 2 * 60 * 60 * 1000)
		: null;
	const hasRequestedTomorrow = Boolean(options && options.showTomorrow);
	const showTomorrow = isTodayRange && hasRequestedTomorrow;
	state.activeUpcomingSportData = {
		sportKey,
		events: Array.isArray(events) ? events.slice() : [],
		oddsByEventId: oddsByEventId || {},
		rangeKey,
		historyMap: historyMap || null,
		showTomorrow
	};
	const rangeLabel = getRangeLabel(rangeKey);
	if (!Array.isArray(events) || !events.length) {
		el.upcomingWrap.innerHTML = '<p class="subhead">' + escapeHtml(getGamesSectionTitle(rangeKey)) + ' | ' + escapeHtml(sportTitle) + ' | ' + escapeHtml(rangeLabel) + '</p><div class="empty">No games found for ' + escapeHtml(rangeLabel.toLowerCase()) + '.</div>';
		return;
	}

	const days = [];
	const dayMap = {};
	const dayFormatter = new Intl.DateTimeFormat(undefined, { weekday: "short" });
	const dateFormatter = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
	const now = new Date();
	const dayCount = isTodayRange ? 2 : 1;
	for (let i = 0; i < dayCount; i += 1) {
		const dayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
		const key = dayDate.getFullYear() + "-" + String(dayDate.getMonth() + 1).padStart(2, "0") + "-" + String(dayDate.getDate()).padStart(2, "0");
		const dayObj = {
			key,
			offset: i,
			dayLabel: dayFormatter.format(dayDate),
			dateLabel: dateFormatter.format(dayDate),
			items: []
		};
		days.push(dayObj);
		dayMap[key] = dayObj;
	}

	for (const row of events) {
		if (hideLiveInThisView && isLiveEventRow(row)) {
			continue;
		}
		const rowTs = getEventStartTimestamp(row);
		if (!isLiveEventRow(row) && Number.isFinite(rowTs) && rowTs < Date.now() - GAME_START_BUFFER_MS) {
			continue;
		}
		if (isTodayRange && Number.isFinite(upcomingCardWindowEnd) && Number.isFinite(rowTs) && rowTs > upcomingCardWindowEnd) {
			continue;
		}
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
			if (!isLiveEventRow(row) && !showAllUpcomingCards) { continue; }
			const dayObj = {
				key,
				offset: Math.round((new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / (24 * 60 * 60 * 1000)),
				dayLabel: dayFormatter.format(startDate),
				dateLabel: dateFormatter.format(startDate),
				items: []
			};
			days.unshift(dayObj);
			dayMap[key] = dayObj;
		}
		const oddsRow = row && row.id && oddsByEventId ? oddsByEventId[String(row.id)] : null;
		const prediction = getPredictionForEvent(row, oddsRow, historyMap, sportKey);
		if (!matchesWinRateFilter(prediction)) {
			continue;
		}
			const predictionOdds = getDisplayOddsForEvent(row, oddsRow, prediction)
				|| (prediction && Number(prediction.pregameOdds) > 1 ? Number(prediction.pregameOdds).toFixed(2) : null);
		const liveGame = isLiveEventRow(row);
		const scoreText = liveGame ? getEventScoreText(row) : (hasUsableScoreData(row) ? getEventScoreText(row) : '');
		const winChanceValue = prediction && prediction.leanPct != null ? Number(prediction.leanPct) : NaN;
		const confidenceText = normalizeConfidenceLabel(prediction && prediction.confidence ? prediction.confidence : "low");
		const winTierClass = getTierClassFromWinChance(winChanceValue);
		const edgeTierClass = getTierClassFromEdge(Number(prediction && prediction.edgePct));
		const confidenceTierClass = prediction && prediction.confidence ? getTierClassFromConfidence(confidenceText, Number(prediction && prediction.edgePct), prediction && prediction.source ? prediction.source : "none") : 'tier-neutral';
		const evBadge = buildEvBadge(prediction, row, oddsRow);
		const hasPrediction = Boolean(prediction && prediction.predictedTeam);
		const livePredictionStatus = hasPrediction && isLiveEventRow(row) ? getLivePredictionStatus(row, prediction.predictedTeam) : null;
		const beOdds = Number(predictionOdds || (prediction && prediction.pregameOdds));
		const beLp = Number(prediction && prediction.leanPct);
		const beStatus = hasPrediction && !liveGame && Number.isFinite(beOdds) && beOdds > 1 && Number.isFinite(beLp) && beLp > 0
			? (beOdds >= (100 / beLp) ? 'above' : 'below')
			: '';
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
			evBadge,
			confidenceTierClass,
			topBets: Array.isArray(prediction && prediction.topBets) ? prediction.topBets : [],
			hasPrediction,
			insightsPanel,
			livePredictionStatus,
			resultClass,
			beStatus,
			resultBadge,
			liveGame
		};
		dayMap[key].items.push(item);
	}

	const displayWindowEnd = isTodayRange && !showAllUpcomingCards
		? nowTimestamp + DEFAULT_UPCOMING_CARD_WINDOW_HOURS * (showTomorrow ? 2 : 1) * 60 * 60 * 1000
		: null;
	const orderedDays = days.slice().sort((a, b) => a.offset - b.offset);
	const renderedDays = isTodayRange
		? orderedDays.map((day) => ({
			...day,
			items: day.items.filter((item) => {
				const itemTs = getEventStartTimestamp(item);
				return !Number.isFinite(displayWindowEnd) || !Number.isFinite(itemTs) || itemTs <= displayWindowEnd;
			})
		})).filter((day) => day.items.length > 0)
		: orderedDays;
	const todayDay = orderedDays.find((day) => day.offset === 0);
	const todayItems = todayDay && Array.isArray(todayDay.items) ? todayDay.items : [];
	const visibleSummaryItems = renderedDays.flatMap((day) => Array.isArray(day.items) ? day.items : []);
	const upcomingSummary = buildUpcomingSummary(visibleSummaryItems, {}, historyMap, sportKey);
	const sectionHtml = renderedDays.map((day) => {
		const cardsHtml = (day.items || []).slice().sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()).map((item) => {
			const liveGame = Boolean(item && item.liveGame);
			const liveScoreBadge = item.scoreText ? '<span class="odds-pill" title="Live score">Score: ' + escapeHtml(item.scoreText) + '</span>' : '';
			const oddsOrScoreBadge = liveGame
				? liveScoreBadge
				: (item.hasPrediction ? '<span class="odds-pill" title="Pre-game odds at kickoff">Odds: ' + escapeHtml(item.predictionOdds || 'N/A') + '</span>' : '');
			const scoreBadge = !liveGame && item.scoreText ? '<span class="meta-pill">Score: ' + escapeHtml(item.scoreText) + '</span>' : '';
			const expandHint = item.insightsPanel ? '<p class="card-expand-hint">Tap card for matchup insights</p>' : '';
			const cardExpandAttrs = item.insightsPanel ? ' data-expand-card="true" role="button" tabindex="0" aria-expanded="false"' : '';
			const resultClass = item.resultClass ? ' ' + item.resultClass : '';
			const beAttr = item.beStatus ? ' data-be-status="' + item.beStatus + '"' : '';
			return '<article class="game-card' + resultClass + '"' + beAttr + cardExpandAttrs + '>'
				+ '<div class="game-head">'
				+ '<div class="matchup-block">'
				+ '<p class="sport-card-title">' + escapeHtml(sportTitle) + '</p>'
				+ '<div class="matchup-title-row">'
				+ '<p class="matchup">' + escapeHtml(item.home + ' vs ' + item.away) + '</p>'
				+ '</div>'
				+ '<p class="kickoff">Starts: ' + escapeHtml(formatDateTime(item.start)) + '</p>'
				+ '</div>'
				+ '<div class="prediction-side">'
				+ '<div class="prediction-stack">'
				+ '<div class="prediction-row">'
				+ '<p class="bet-name">' + escapeHtml(item.betName) + '</p>'
				+ oddsOrScoreBadge
				+ '</div>'
				+ '<div class="game-meta compact right-aligned">'
				+ (scoreBadge || '')
				+ '<span class="meta-pill ' + item.winTierClass + '">Win: ' + escapeHtml(item.winChanceText) + '</span>'
				+ '<span class="meta-pill ' + item.edgeTierClass + '">Edge: ' + escapeHtml(item.edgeText) + '</span>'
				+ item.evBadge
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
	const tomorrowDay = isTodayRange ? orderedDays.find((day) => day.offset === 1) : null;
	const tomorrowItems = tomorrowDay && Array.isArray(tomorrowDay.items) ? tomorrowDay.items : [];
	const hasMoreUpcomingItems = isTodayRange && !showAllUpcomingCards && !showTomorrow && days.some((day) => day.items.some((item) => {
		const itemTs = getEventStartTimestamp(item);
		return Number.isFinite(itemTs) && itemTs > nowTimestamp + DEFAULT_UPCOMING_CARD_WINDOW_HOURS * 60 * 60 * 1000;
	}));
	const viewMoreHtml = hasMoreUpcomingItems
		? '<div class="upcoming-view-more-wrap"><div class="upcoming-separator" aria-hidden="true"></div><button type="button" class="upcoming-view-more-btn" data-action="view-more-upcoming"><i class="fa-solid fa-angles-down" aria-hidden="true"></i>View More</button></div>'
		: '';
	const hasVisibleItems = renderedDays.some((day) => Array.isArray(day.items) && day.items.length > 0);
	const hasTodayItems = todayItems.length > 0;
	const hasTomorrowItems = tomorrowItems.length > 0;
	const nexttestSummary = buildNextTestSummary(visibleSummaryItems);
	if (nexttestSummary) {
		saveNextTestSnapshot(sportTitle, nexttestSummary);
	}
	const nexttestCardHtml = buildNextTestCardMarkup(nexttestSummary, visibleSummaryItems, sportTitle);

	if (!sectionHtml || !hasVisibleItems) {
		el.upcomingWrap.innerHTML = '<p class="subhead">' + escapeHtml(getGamesSectionTitle(rangeKey)) + ' | ' + escapeHtml(sportTitle) + ' | ' + escapeHtml(rangeLabel) + '</p>'
			+ '<div class="empty">No games match your search.</div>';
		return;
	}

	el.upcomingWrap.innerHTML = '<p class="subhead">' + escapeHtml(getGamesSectionTitle(rangeKey)) + ' | ' + escapeHtml(sportTitle) + ' | ' + escapeHtml(rangeLabel) + '</p>'
		+ buildSummaryStrip({
			totalOddsText: upcomingSummary.totalOddsText,
			multiOddsParts: upcomingSummary.multiOddsParts
		})
		+ nexttestCardHtml
		+ buildUpcomingBreakEvenSection(visibleSummaryItems, sportTitle, normalizedRange === 'live' ? 'live' : 'upcoming')
		+ sectionHtml
		+ viewMoreHtml;
}

function renderUpcomingEventsForSavedSports(items, totalSportCount, visibleSportCount) {
	bindGameCardInteractions();
	const allItems = Array.isArray(items) ? items : [];
	const normalizedRange = normalizeRangeKey(state.timeRange);
	const isTodayRange = normalizedRange === 'today';
	const scopeLabel = state.catalogScope === 'favorites' ? 'Favourites' : 'All Sports';
	const nowTimestamp = Date.now();
	const showAllUpcomingCards = isTodayRange && Number(state.upcomingBePickLimit) === 0;
	const upcomingCardWindowEnd = isTodayRange
		? (showAllUpcomingCards ? null : nowTimestamp + DEFAULT_UPCOMING_CARD_WINDOW_HOURS * 2 * 60 * 60 * 1000)
		: null;
	const hideLiveInThisView = normalizedRange !== 'live';
	const showTomorrow = isTodayRange && state.upcomingSavedSportsShowTomorrow === true;
	const showDayAfter = showTomorrow && state.upcomingSavedSportsShowDayAfter === true;
	const selectedSport = state.resultSportFilter;
	const scopedItems = selectedSport === 'all'
		? allItems
		: allItems.filter((item) => String(item && item.sportTitle ? item.sportTitle : '') === selectedSport);
	const visibleItems = filterRecentPickWindow(scopedItems).filter((item) => {
		const row = item && item.row ? item.row : null;
		if (hideLiveInThisView && isLiveEventRow(row)) {
			return false;
		}
		const itemTs = getEventStartTimestamp(item);
		if (!isLiveEventRow(row) && Number.isFinite(itemTs) && itemTs < Date.now() - GAME_START_BUFFER_MS) {
			return false;
		}
		if (isTodayRange && Number.isFinite(upcomingCardWindowEnd) && Number.isFinite(itemTs) && itemTs > upcomingCardWindowEnd) {
			return false;
		}
		if (!matchesWinRateFilter(item && item.prediction ? item.prediction : null)) {
			return false;
		}
		const home = item && item.home ? String(item.home) : item && item.row && item.row.home_team ? String(item.row.home_team) : '';
		const away = item && item.away ? String(item.away) : item && item.row && item.row.away_team ? String(item.row.away_team) : '';
		const sportTitle = item && item.sportTitle ? String(item.sportTitle) : item && item.sportKey ? String(item.sportKey) : '';
		return matchesResultsSearch(sportTitle, home, away);
	});

	const getDayOffsetFromItem = (item) => {
		const ts = getEventStartTimestamp(item);
		if (!Number.isFinite(ts)) {
			return null;
		}
		const eventDate = new Date(ts);
		const eventDay = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate());
		const now = new Date();
		const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		return Math.round((eventDay.getTime() - startOfToday.getTime()) / (24 * 60 * 60 * 1000));
	};

	const todayItems = visibleItems.filter((item) => getDayOffsetFromItem(item) === 0);
	const tomorrowItems = visibleItems.filter((item) => getDayOffsetFromItem(item) === 1);
	const dayAfterItems = visibleItems.filter((item) => getDayOffsetFromItem(item) === 2);
	const displayWindowEnd = isTodayRange && !showAllUpcomingCards
		? nowTimestamp + DEFAULT_UPCOMING_CARD_WINDOW_HOURS * (showTomorrow ? 2 : 1) * 60 * 60 * 1000
		: null;
	const renderItems = isTodayRange
		? visibleItems.filter((item) => {
			const itemTs = getEventStartTimestamp(item);
			return !Number.isFinite(displayWindowEnd) || !Number.isFinite(itemTs) || itemTs <= displayWindowEnd;
		})
		: visibleItems;
	const hasMoreUpcomingItems = isTodayRange && !showAllUpcomingCards && !showTomorrow && visibleItems.some((item) => {
		const itemTs = getEventStartTimestamp(item);
		return Number.isFinite(itemTs) && itemTs > nowTimestamp + DEFAULT_UPCOMING_CARD_WINDOW_HOURS * 60 * 60 * 1000;
	});
	const viewMoreHtml = hasMoreUpcomingItems
		? '<div class="upcoming-view-more-wrap"><div class="upcoming-separator" aria-hidden="true"></div><button type="button" class="upcoming-view-more-btn" data-action="view-more-upcoming"><i class="fa-solid fa-angles-down" aria-hidden="true"></i>View More</button></div>'
		: '';
	if (!renderItems.length) {
		el.upcomingWrap.innerHTML = '<p class="subhead">' + escapeHtml(getGamesSectionTitle(state.timeRange)) + ' | ' + escapeHtml(scopeLabel) + '</p><div class="empty">No games match your search.</div>' + viewMoreHtml;
		return;
	}

	const renderCard = (item) => {
		const prediction = item && item.prediction ? item.prediction : {};
		const sportKey = item && item.sportKey ? String(item.sportKey) : "";
		const eventRow = item && item.row ? item.row : { home_team: item.home, away_team: item.away, commence_time: item.start };
		const oddsRow = item && item.oddsRow ? item.oddsRow : null;
		const historyMap = item && item.historyMap ? item.historyMap : null;
		const betName = prediction && prediction.label ? String(prediction.label).replace(/^Prediction:\s*/i, "") : "No prediction";
		const predictionOdds = getDisplayOddsForEvent(eventRow, oddsRow, prediction)
			|| (prediction && Number(prediction.pregameOdds) > 1 ? Number(prediction.pregameOdds).toFixed(2) : null);
		const edgeText = Number.isFinite(Number(prediction && prediction.edgePct)) ? Number(prediction.edgePct).toFixed(1) + "%" : "N/A";
		const winChanceValue = prediction && prediction.leanPct != null ? Number(prediction.leanPct) : NaN;
		const winChanceText = Number.isFinite(winChanceValue) ? prediction.leanPct + "%" : "N/A";
		const confidenceText = normalizeConfidenceLabel(prediction && prediction.confidence ? prediction.confidence : "low");
		const winTierClass = getTierClassFromWinChance(winChanceValue);
		const edgeTierClass = getTierClassFromEdge(Number(prediction && prediction.edgePct));
		const confidenceTierClass = prediction && prediction.confidence ? getTierClassFromConfidence(confidenceText, Number(prediction && prediction.edgePct), prediction && prediction.source ? prediction.source : "none") : 'tier-neutral';
		const evBadge = buildEvBadge(prediction, eventRow, oddsRow);
		const sportSpecificTopBets = prediction && prediction.predictedTeam ? buildTopBetSuggestions({ home: item.home, away: item.away }, prediction, sportKey) : [];
		const liveGame = isLiveEventRow(eventRow);
		const hasPrediction = Boolean(prediction && prediction.predictedTeam);
		const scoreText = liveGame ? getEventScoreText(eventRow) : (hasUsableScoreData(eventRow) ? getEventScoreText(eventRow) : '');
		const liveScoreBadge = scoreText ? '<span class="odds-pill" title="Live score">Score: ' + escapeHtml(scoreText) + '</span>' : '';
		const oddsOrScoreBadge = liveGame
			? liveScoreBadge
			: (hasPrediction ? '<span class="odds-pill" title="Pre-game odds at kickoff">Odds: ' + escapeHtml(predictionOdds || 'N/A') + '</span>' : '');
		const confidenceBadge = prediction && prediction.confidence
			? '<span class="meta-pill ' + confidenceTierClass + '">Conf: ' + escapeHtml(confidenceText) + '</span>'
			: '';
		const livePredictionStatus = hasPrediction && liveGame ? getLivePredictionStatus(eventRow, prediction.predictedTeam) : null;
		const beOdds = Number(predictionOdds || (prediction && prediction.pregameOdds));
		const beLp = Number(prediction && prediction.leanPct);
		const beStatus = hasPrediction && !liveGame && Number.isFinite(beOdds) && beOdds > 1 && Number.isFinite(beLp) && beLp > 0
			? (beOdds >= (100 / beLp) ? 'above' : 'below') : '';
		// beClass intentionally omitted — filter buttons add result-win/result-loss on click
		const resultClass = livePredictionStatus === 'win' ? 'result-win' : livePredictionStatus === 'loss' ? 'result-loss' : '';
		const resultBadge = livePredictionStatus
			? '<span class="meta-pill ' + (livePredictionStatus === 'win' ? 'tier-green' : 'tier-red') + '">Result: ' + (livePredictionStatus === 'win' ? 'Winning' : 'Losing') + '</span>'
			: '';
		const scoreBadge = !liveGame && scoreText ? '<span class="meta-pill">Score: ' + escapeHtml(scoreText) + '</span>' : '';
		const insightsPanel = hasPrediction
			? attachTopBetsToInsights(buildGameInsightsPanel(eventRow, prediction, historyMap, oddsRow), sportSpecificTopBets)
			: '';
		const expandHint = insightsPanel ? '<p class="card-expand-hint">Tap card for matchup insights</p>' : '';
		const cardExpandAttrs = insightsPanel ? ' data-expand-card="true" role="button" tabindex="0" aria-expanded="false"' : '';
		const beAttr2 = beStatus ? ' data-be-status="' + beStatus + '"' : '';
		const sportAttr = item.sportTitle ? ' data-sport="' + escapeHtml(item.sportTitle) + '"' : '';
		return '<article class="game-card' + (resultClass ? ' ' + resultClass : '') + '"' + sportAttr + beAttr2 + cardExpandAttrs + '>'
			+ '<div class="game-head">'
			+ '<div class="matchup-block">'
			+ '<p class="sport-card-title">' + escapeHtml(item.sportTitle) + '</p>'
			+ '<div class="matchup-title-row">'
			+ '<p class="matchup">' + escapeHtml(item.home + ' vs ' + item.away) + '</p>'
			+ '</div>'
			+ '<p class="kickoff">Starts: ' + escapeHtml(formatDateTime(item.start)) + '</p>'
			+ '</div>'
			+ '<div class="prediction-side">'
			+ '<div class="prediction-stack">'
			+ '<div class="prediction-row">'
			+ '<p class="bet-name">' + escapeHtml(betName) + '</p>'
			+ oddsOrScoreBadge
			+ '</div>'
			+ '<div class="game-meta compact right-aligned">'
			+ scoreBadge
			+ '<span class="meta-pill ' + winTierClass + '">Win: ' + escapeHtml(winChanceText) + '</span>'
			+ '<span class="meta-pill ' + edgeTierClass + '">Edge: ' + escapeHtml(edgeText) + '</span>'
			+ evBadge
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

	const upcomingSummary = buildUpcomingSummary(renderItems, {}, null, '');
	const nexttestSummary = buildNextTestSummary(renderItems);
	if (nexttestSummary) {
		saveNextTestSnapshot(scopeLabel, nexttestSummary);
	}
	const nexttestCardHtml = buildNextTestCardMarkup(nexttestSummary, renderItems, scopeLabel);
	const breakEvenHtml = buildUpcomingBreakEvenSection(visibleItems, scopeLabel, normalizedRange === 'live' ? 'live' : 'upcoming');
	const cardsWithSeps = (items) => {
		const dayGroups = new Map();
		const dayOrder = [];
		sortByStartAsc(items).forEach((item) => {
			const d = item.start ? new Date(item.start) : null;
			const day = d && Number.isFinite(d.getTime()) ? d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) : 'Upcoming';
			if (!dayGroups.has(day)) { dayGroups.set(day, []); dayOrder.push(day); }
			dayGroups.get(day).push(renderCard(item));
		});
		return dayOrder.map((day) =>
			'<section class="backtest-card day-group-card" aria-label="' + escapeHtml(day) + '">'
			+ '<div class="backtest-head"><h3>' + escapeHtml(day) + '</h3>'
			+ '<button type="button" class="backtest-collapse-btn" aria-expanded="true" aria-label="Collapse"><i class="fa-solid fa-chevron-down" aria-hidden="true"></i></button>'
			+ '</div>'
			+ '<div class="upcoming-list compact">' + dayGroups.get(day).join('') + '</div>'
			+ '</section>'
		).join('');
	};
	const cardsHtml = cardsWithSeps(renderItems);
	el.upcomingWrap.innerHTML = '<p class="subhead">' + escapeHtml(getGamesSectionTitle(state.timeRange)) + ' | ' + escapeHtml(scopeLabel) + ' | ' + renderItems.length + ' bets (56%+)</p>'
		+ buildSummaryStrip({ totalOddsText: upcomingSummary.totalOddsText, multiOddsParts: upcomingSummary.multiOddsParts })
		+ breakEvenHtml
		+ nexttestCardHtml
		+ cardsHtml
		+ viewMoreHtml;
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

async function loadUpcomingForSport(sportKey, apiKey, options = {}) {
	if (!sportKey) {
		return;
	}
	const loadCost = 1;
	const forceRefresh = Boolean(options && options.forceRefresh === true);
	setView("upcoming");
	state.activeSportKey = sportKey;
	state.favoriteUpcomingSportTitles = [];
	renderSportsTable(state.sportsRows);

	const cachedEvents = readCache("upcoming_events_" + sportKey);
	const cachedOddsRows = readCache("upcoming_odds_" + sportKey);
	const cachedHistoryRows = readCache("upcoming_history_" + sportKey);
	const rollingHistoryRows = readCache("rolling_history_" + sportKey);
	const hasUsableCache = Array.isArray(cachedEvents) && cachedEvents.length > 0;
	const shouldForceCacheOnHydration = state.isInitialHydration === true;
	const needsRefresh = hasUsableCache
		? (forceRefresh ? true : (shouldForceCacheOnHydration ? false : shouldRefreshCachedEvents(cachedEvents)))
		: true;
	if (hasUsableCache && !needsRefresh) {
		const oddsByEventId = buildOddsByEventId(Array.isArray(cachedOddsRows) ? cachedOddsRows : []);
		const historyRows = mergeRollingHistoryRows(rollingHistoryRows, cachedHistoryRows);
		renderUpcomingEvents(sportKey, cachedEvents, oddsByEventId, state.timeRange, historyRows, { showTomorrow: false });
		const cachedLoadedAt = readCacheTimestamp('upcoming_events_' + sportKey);
		markDataLoaded(cachedEvents.length, Number.isFinite(cachedLoadedAt) ? cachedLoadedAt : Date.now());
		setStatus('Loaded upcoming from cache. Auto-refresh happens 6 minutes before next game.', 'ok');
		return;
	}

	if (state.isInitialHydration === true) {
		setStatus('No cached upcoming data found for ' + sportKey + '. Add your API key to refresh this sport.', 'error');
		el.upcomingWrap.innerHTML = '<p class="subhead">' + escapeHtml(getGamesSectionTitle(state.timeRange)) + '</p><div class="empty">No cached upcoming data found for this sport.</div>';
		return;
	}

	if (!String(apiKey || '').trim()) {
		setStatus('No cached upcoming data found for ' + sportKey + '. Add your API key to refresh this sport.', 'error');
		el.upcomingWrap.innerHTML = '<p class="subhead">' + escapeHtml(getGamesSectionTitle(state.timeRange)) + '</p><div class="empty">No cached upcoming data found for this sport.</div>';
		return;
	}

	const loadToken = beginTrackedLoading(loadCost);
	const loadingStampCost = 3;
	beginBusyOverlay();
	state.rangeLoading = true;
	syncRangeButtons();
	setStatus((normalizeRangeKey(state.timeRange) === 'live' ? 'Scanning live games' : 'Scanning upcoming games') + ' for ' + sportKey + '...', "");
	el.upcomingWrap.innerHTML = '<p class="subhead">' + escapeHtml(getGamesSectionTitle(state.timeRange)) + '</p><div class="loading-panel"><p class="loading-label">Connecting to odds API…</p><div class="loading-bar"><span></span></div></div>';
	setLoadingMessage('Requesting game list for ' + escapeHtml(sportKey) + '…');

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
			fetchWithTimeout(eventsUrl),
			fetchWithTimeout(oddsUrl),
			fetchWithTimeout(scoresUrl)
		]);
		const apiCreditsUsed = getApiCreditsUsedFromResponses([eventResponse, oddsResponse, scoresResponse]);
		if (!isTrackedLoadingCurrent(loadToken)) {
			return;
		}
		if (!eventResponse.ok) {
			const message = 'Upcoming events request failed for sport: ' + sportKey;
			throw new Error(message);
		}
		const payload = await safeReadJson(eventResponse, []);

		let oddsPayload = [];
		if (oddsResponse.ok) {
			oddsPayload = await safeReadJson(oddsResponse, []);
		}
		let scoresPayload = [];
		if (scoresResponse.ok) {
			scoresPayload = await safeReadJson(scoresResponse, []);
		}
		const incomingHistoryRows = Array.isArray(scoresPayload) ? scoresPayload : [];
		const existingRollingHistoryRows = readCache("rolling_history_" + sportKey);
		const mergedHistoryRows = mergeRollingHistoryRows(existingRollingHistoryRows, incomingHistoryRows);
		const historyMap = buildTeamHistoryMap(mergedHistoryRows);

		const rows = Array.isArray(payload) ? payload : [];
		const filtered = getRowsForSelectedRange(rows, state.timeRange, rangeWindow, Array.isArray(scoresPayload) ? scoresPayload : []);
		const sourceEvents = normalizeRangeKey(state.timeRange) === 'today' ? rows : filtered;
		let cacheSavedAt = writeCache("upcoming_events_" + sportKey, sourceEvents);

		const oddsRows = Array.isArray(oddsPayload) ? oddsPayload : [];
		cacheSavedAt = Math.max(cacheSavedAt, writeCache("upcoming_odds_" + sportKey, oddsRows));
		cacheSavedAt = Math.max(cacheSavedAt, writeCache("upcoming_history_" + sportKey, mergedHistoryRows));
		cacheSavedAt = Math.max(cacheSavedAt, writeCache("rolling_history_" + sportKey, mergedHistoryRows));
		const oddsByEventId = buildOddsByEventId(oddsRows);

		if (!isTrackedLoadingCurrent(loadToken)) {
			return;
		}
		renderUpcomingEvents(sportKey, sourceEvents, oddsByEventId, state.timeRange, historyMap, { showTomorrow: false });
		markDataLoaded(filtered.length, cacheSavedAt);
		setStatus('Upcoming window loaded for ' + sportKey + ': ' + filtered.length + ' events', 'ok');
	} catch (error) {
		if (!isTrackedLoadingCurrent(loadToken)) {
			return;
		}
		const message = error instanceof Error ? error.message : 'Unknown error';
		const cachedEvents = readCache("upcoming_events_" + sportKey);
		const cachedOddsRows = readCache("upcoming_odds_" + sportKey);
		const cachedHistoryRows = readCache("upcoming_history_" + sportKey);
		const rollingHistoryRows = readCache("rolling_history_" + sportKey);
		if (Array.isArray(cachedEvents) && cachedEvents.length) {
			const oddsByEventId = buildOddsByEventId(Array.isArray(cachedOddsRows) ? cachedOddsRows : []);
			const historyRows = mergeRollingHistoryRows(rollingHistoryRows, cachedHistoryRows);
			renderUpcomingEvents(sportKey, cachedEvents, oddsByEventId, state.timeRange, historyRows, { showTomorrow: false });
			setStatus('Live upcoming failed: ' + message + '. Showing cached fallback data.', 'error');
			return;
		}

		el.upcomingWrap.innerHTML = '<p class="subhead">' + escapeHtml(getGamesSectionTitle(state.timeRange)) + '</p><div class="empty">Unable to load ' + (normalizeRangeKey(state.timeRange) === 'live' ? 'live' : 'upcoming') + ' games.</div>';
		setStatus('Failed loading ' + (normalizeRangeKey(state.timeRange) === 'live' ? 'live' : 'upcoming') + ' games: ' + message, 'error');
	} finally {
		if (isTrackedLoadingCurrent(loadToken)) {
			state.rangeLoading = false;
			syncRangeButtons();
			endBusyOverlay();
		}
	}
}

function renderRecentResultsForSelectedScope(scopeLabel, items) {
	bindGameCardInteractions();
	state.activeRecentSportData = null;
	const sportTitles = Array.from(new Set((Array.isArray(items) ? items : []).map((item) => String(item && item.sportTitle ? item.sportTitle : item && item.sportKey ? item.sportKey : '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
	setResultSportOptions(sportTitles.length ? sportTitles : getRecentSportTitlesForBar(scopeLabel));
	const recentViewMoreHtml = getRecentViewMoreMarkup();
	if (!Array.isArray(items) || !items.length) {
		el.upcomingWrap.innerHTML = '<p class="subhead">Recent Results | ' + escapeHtml(scopeLabel) + '</p>'
			+ '<div class="empty">No recent results found in the current selection.</div>'
			+ recentViewMoreHtml;
		return;
	}

	const selectedSport = state.resultSportFilter;
	const scopedItems = selectedSport === 'all'
		? items
		: items.filter((item) => String(item && item.sportTitle ? item.sportTitle : item && item.sportKey ? item.sportKey : '') === selectedSport);
	const visibleItems = filterRecentPickWindow(scopedItems).filter((item) => {
		const row = item && item.row ? item.row : {};
		if (isLiveEventRow(row)) { return false; }
		const itemTs = getEventStartTimestamp(item);
		if (Number.isFinite(itemTs) && itemTs > Date.now() - GAME_START_BUFFER_MS) { return false; }
		const home = row && row.home_team ? String(row.home_team) : '';
		const away = row && row.away_team ? String(row.away_team) : '';
		const sportTitle = item && item.sportTitle ? String(item.sportTitle) : item && item.sportKey ? String(item.sportKey) : '';
		return matchesResultsSearch(sportTitle, home, away);
	});

	const sortedItems = sortByStartDesc(visibleItems);
	const predictedItems = [];
	const noPredictionItems = [];
	const evaluatedItems = [];
	for (const item of sortedItems) {
		const row = item.row || {};
		const oddsRow = item.oddsRow || null;
		const prediction = item.prediction || getPredictionForEvent(row, oddsRow, item.historyMap || null, item.sportKey || "");
		const hasPrediction = Boolean(prediction && prediction.predictedTeam);
		evaluatedItems.push({
			row,
			oddsRow,
			prediction,
			sportKey: item && item.sportKey ? item.sportKey : '',
			sportTitle: item && item.sportTitle ? item.sportTitle : ''
		});
		if (!hasPrediction) {
			if (hasActiveGameFilters()) {
				continue;
			}
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
		const predictionOdds = getDisplayOddsForEvent(row, oddsRow, prediction)
			|| (prediction && prediction.pregameOdds ? Number(prediction.pregameOdds).toFixed(2) : null);
		const edgeText = Number.isFinite(Number(prediction && prediction.edgePct)) ? Number(prediction.edgePct).toFixed(1) + "%" : "N/A";
		const winChanceValue = prediction && prediction.leanPct != null ? Number(prediction.leanPct) : NaN;
		const winChanceText = Number.isFinite(winChanceValue) ? prediction.leanPct + "%" : "N/A";
		const confidenceText = normalizeConfidenceLabel(prediction && prediction.confidence ? prediction.confidence : "low");
		const winTierClass = getTierClassFromWinChance(winChanceValue);
		const edgeTierClass = getTierClassFromEdge(Number(prediction && prediction.edgePct));
		const confidenceTierClass = prediction && prediction.confidence ? getTierClassFromConfidence(confidenceText, Number(prediction && prediction.edgePct), prediction && prediction.source ? prediction.source : "none") : 'tier-neutral';
		const evBadge = buildEvBadge(prediction, row, oddsRow);
		const completedPredictionResult = hasPrediction ? getPredictionResultForCompletedEvent(row, prediction.predictedTeam) : { label: "No prediction", tierClass: "tier-neutral" };
		const detailsHistoryMap = item && item.historyMap ? item.historyMap : null;
		const insightsPanel = hasPrediction
			? attachTopBetsToInsights(buildGameInsightsPanel(row, prediction, detailsHistoryMap, oddsRow), prediction.topBets)
			: '';
		const expandHint = insightsPanel ? '<p class="card-expand-hint">Tap card for matchup insights</p>' : '';
		const cardExpandAttrs = insightsPanel ? ' data-expand-card="true" role="button" tabindex="0" aria-expanded="false"' : '';
		const oddsAndScoreBadge = hasPrediction
			? '<span class="odds-pill" title="Pre-game odds and final score">Odds: ' + escapeHtml(predictionOdds || 'N/A') + ' | Score: ' + escapeHtml(scoreText || 'N/A') + '</span>'
			: '';
		const confidenceBadge = prediction && prediction.confidence
			? '<span class="meta-pill ' + confidenceTierClass + '">Conf: ' + escapeHtml(confidenceText) + '</span>'
			: '';
		const beOddsV2 = Number(getBookmakerOddsForPrediction(item.row, item.oddsRow, item.prediction) || (item.prediction && item.prediction.pregameOdds));
		const beLpV2 = Number(item.prediction && item.prediction.leanPct);
		const beStatus2 = hasPrediction && Number.isFinite(beOddsV2) && beOddsV2 > 1 && Number.isFinite(beLpV2) && beLpV2 > 0
			? (beOddsV2 >= (100 / beLpV2) ? 'above' : 'below') : '';
		const resultClass = ''; // green/red only applied when BE filter is pressed
		const sportLabel = item.sportTitle ? String(item.sportTitle) : (item.sportKey || 'Sport');
		const winBadge = hasPrediction ? '<span class="meta-pill ' + winTierClass + '">Win: ' + escapeHtml(winChanceText) + '</span>' : '<span class="meta-pill tier-neutral">Win: N/A</span>';
		const edgeBadge = hasPrediction ? '<span class="meta-pill ' + edgeTierClass + '">Edge: ' + escapeHtml(edgeText) + '</span>' : '<span class="meta-pill tier-neutral">Edge: N/A</span>';
		const resultBadge = hasPrediction
			? '<span class="meta-pill ' + completedPredictionResult.tierClass + '">Result: ' + escapeHtml(completedPredictionResult.label) + '</span>'
			: '<span class="meta-pill tier-neutral">Result: No prediction</span>';

		return '<article class="game-card" data-sport="' + escapeHtml(sportLabel) + '"' + (beStatus2 ? ' data-be-status="' + beStatus2 + '"' : '') + cardExpandAttrs + '>'
			+ '<div class="game-head">'
			+ '<div class="matchup-block">'
			+ '<p class="sport-card-title">' + escapeHtml(sportLabel) + '</p>'
			+ '<div class="matchup-title-row">'
			+ '<p class="matchup">' + escapeHtml(home + ' vs ' + away) + '</p>'
			+ '</div>'
			+ '<p class="kickoff">' + escapeHtml(formatDateTime(item.start)) + '</p>'
			+ '</div>'
			+ '<div class="prediction-side">'
			+ '<div class="prediction-stack">'
			+ '<div class="prediction-row">'
			+ '<p class="bet-name">' + escapeHtml(betName) + '</p>'
			+ oddsAndScoreBadge
			+ '</div>'
			+ '<div class="game-meta compact right-aligned">'
			+ winBadge
			+ edgeBadge
			+ evBadge
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
		el.upcomingWrap.innerHTML = '<p class="subhead">Recent Results (0) | ' + escapeHtml(scopeLabel) + '</p>'
			+ '<div class="empty">No recent results match your search.</div>'
			+ recentViewMoreHtml;
		return;
	}
	const backtest = buildPredictionBacktestSummary(evaluatedItems);
	const backtestCardHtml = buildBacktestCardMarkup(backtest, evaluatedItems, scopeLabel);
	const beItems = predictedItems.map(function(item) {
		return {
			row: item.row,
			oddsRow: item.oddsRow,
			prediction: item.prediction,
			sportKey: item.sportKey,
			sportTitle: item.sportTitle,
			start: item.start,
			home: item.row && item.row.home_team ? String(item.row.home_team) : '',
			away: item.row && item.row.away_team ? String(item.row.away_team) : '',
			betName: item.prediction && item.prediction.label ? String(item.prediction.label).replace(/^Prediction:\s*/i, '') : '',
			predictionOdds: item.prediction && item.prediction.pregameOdds ? item.prediction.pregameOdds : null
		};
	});

	el.upcomingWrap.innerHTML = '<p class="subhead">Recent Results (' + sortedItems.length + ') | ' + escapeHtml(scopeLabel) + '</p>'
		+ buildUpcomingBreakEvenSection(beItems, scopeLabel, 'recent')
		+ backtestCardHtml
		+ '<div class="upcoming-list">' + cardsHtml + '</div>'
		+ recentViewMoreHtml;
}

async function loadRecentResultsForSelectedScope(apiKey, options = {}) {
	const loadCost = 1;
	const forceRefresh = Boolean(options && options.forceRefresh === true);
	const preserveVisibleResults = state.view === 'recent' && Array.isArray(state.allRecentResultsItems) && state.allRecentResultsItems.length > 0;
	const loadToken = beginTrackedLoading(0);
	if (!preserveVisibleResults) {
		beginBusyOverlay();
	}
	state.rangeLoading = true;
	syncRangeButtons();
	setView("recent");
	state.activeSportKey = "";
	state.activeRecentSportData = null;
	renderSportsTable(state.sportsRows);
	const scopeLabel = state.catalogScope === 'favorites' ? 'Favourites' : 'All Sports';
	let apiCreditsUsedTotal = 0;
	if (!Number.isFinite(state.recentResultsLookbackDays) || state.recentResultsLookbackDays < RECENT_RESULTS_LOOKBACK_DAYS) {
		state.recentResultsLookbackDays = RECENT_RESULTS_LOOKBACK_DAYS;
	}
	const recentLookbackDays = Number(state.recentResultsLookbackDays) || RECENT_RESULTS_LOOKBACK_DAYS;
	const loadingStampCost = Math.max(3, Math.max(1, (Array.isArray(state.sportsRows) && state.sportsRows.length) ? state.sportsRows.length : 1) * 3);
	setStatus('Loading recent results for ' + scopeLabel.toLowerCase() + '...', '');
	if (!preserveVisibleResults) {
		el.upcomingWrap.innerHTML = '<p class="subhead">Recent Results | ' + escapeHtml(scopeLabel) + '</p><div class="loading-panel"><p class="loading-label">Connecting to odds API…</p><div class="loading-bar"><span></span></div></div>';
	}
	setLoadingMessage('Fetching scores for ' + escapeHtml(scopeLabel) + '…');

	try {
		const sportRows = Array.isArray(state.sportsRows) ? state.sportsRows : [];
		if (!sportRows.length) {
			apiCreditsUsedTotal += await loadSportsCatalog(apiKey, { skipLoadStamp: true });
		}
		const rows = getScopedSportsForLoading();
		if (!rows.length) {
			const emptyMessage = state.catalogScope === 'favorites'
				? 'No favourite sports selected. Save a sport from the catalog to see recent results.'
				: 'No sports are available in the current selection.';
			state.allRecentResultsItems = [];
			state.recentScopeLabel = scopeLabel;
			setResultSportOptions([]);
			el.upcomingWrap.innerHTML = '<p class="subhead">Recent Results | ' + escapeHtml(scopeLabel) + '</p><div class="empty">' + escapeHtml(emptyMessage) + '</div>';
			setStatus(state.catalogScope === 'favorites' ? 'No favourite sports selected.' : 'No sports available for recent results.', 'ok');
			return;
		}

		const cachedRecentBySport = new Map();
		let hasCompleteCache = true;
		let cachedLoadedAt = 0;
		for (const sport of rows) {
			const sportKey = sport && sport.key ? String(sport.key) : '';
			if (!sportKey) {
				continue;
			}
			const cachedScores = readCache("recent_scores_" + sportKey);
			if (!Array.isArray(cachedScores) || !cachedScores.length) {
				hasCompleteCache = false;
				break;
			}
			const sportCachedLoadedAt = readCacheTimestamp('recent_scores_' + sportKey);
			if (Number.isFinite(sportCachedLoadedAt)) {
				cachedLoadedAt = Math.max(cachedLoadedAt, sportCachedLoadedAt);
			}
			cachedRecentBySport.set(sportKey, {
				scores: cachedScores,
				oddsRows: readCache("recent_odds_" + sportKey),
				historyRows: readCache("recent_history_" + sportKey),
				rollingRows: readCache("rolling_history_" + sportKey)
			});
		}

		if (hasCompleteCache && !forceRefresh) {
			const cachedItems = [];
			for (const sport of rows) {
				const sportKey = sport && sport.key ? String(sport.key) : '';
				if (!sportKey || !cachedRecentBySport.has(sportKey)) {
					continue;
				}
				const cached = cachedRecentBySport.get(sportKey);
				const historyRows = mergeRollingHistoryRows(cached.rollingRows, cached.historyRows);
				const oddsByEventId = buildOddsByEventId(Array.isArray(cached.oddsRows) ? cached.oddsRows : []);
				for (const row of sortByStartDesc(filterRecentResultsToLookback(cached.scores))) {
					cachedItems.push({
						sportKey,
						sportTitle: sport.title ? String(sport.title) : sportKey,
						start: row && row.commence_time ? String(row.commence_time) : '',
						row,
						oddsRow: row && row.id ? oddsByEventId[String(row.id)] || null : null,
						historyMap: historyRows,
						prediction: getPredictionForEvent(row, row && row.id ? oddsByEventId[String(row.id)] || null : null, historyRows, sportKey)
					});
				}
			}
			if (!isTrackedLoadingCurrent(loadToken)) {
				return;
			}
			renderRecentResultsForSelectedScope(scopeLabel, cachedItems);
			state.allRecentResultsItems = cachedItems.slice();
			state.recentScopeLabel = scopeLabel;
			markDataLoaded(cachedItems.length, cachedLoadedAt || Date.now());
			setStatus('Loaded recent results from cache.', 'ok');
			return;
		}

		if (state.isInitialHydration === true) {
			setStatus('Recent cache is incomplete for this scope. Add your API key to refresh missing sports.', 'error');
			state.allRecentResultsItems = [];
			state.recentScopeLabel = scopeLabel;
			setResultSportOptions([]);
			el.upcomingWrap.innerHTML = '<p class="subhead">Recent Results | ' + escapeHtml(scopeLabel) + '</p><div class="empty">No complete cached recent results were found for this scope.</div>';
			return;
		}

		if (!String(apiKey || '').trim()) {
			setStatus('Recent cache is incomplete. Add your API key to refresh missing sports.', 'error');
			state.allRecentResultsItems = [];
			state.recentScopeLabel = scopeLabel;
			setResultSportOptions([]);
			el.upcomingWrap.innerHTML = '<p class="subhead">Recent Results | ' + escapeHtml(scopeLabel) + '</p><div class="empty">No complete cached recent results were found for this scope.</div>';
			return;
		}

		const allRecentItems = [];
		let successfulSportLoads = 0;
		let failedSportLoads = 0;
		let cacheSavedAt = 0;
		for (const sport of rows) {
			if (!isTrackedLoadingCurrent(loadToken)) {
				return;
			}
			const sportKey = sport && sport.key ? String(sport.key) : '';
			if (!sportKey) {
				continue;
			}
			try {
				const historyScoresUrl = BASE_URL + '/sports/' + encodeURIComponent(sportKey) + '/scores/?apiKey=' + encodeURIComponent(apiKey) + '&daysFrom=' + HISTORY_LOOKBACK_DAYS + '&dateFormat=iso';
				const recentScoresUrl = BASE_URL + '/sports/' + encodeURIComponent(sportKey) + '/scores/?apiKey=' + encodeURIComponent(apiKey) + '&daysFrom=' + recentLookbackDays + '&dateFormat=iso';
				const oddsUrl = BASE_URL + '/sports/' + encodeURIComponent(sportKey) + '/odds/?apiKey=' + encodeURIComponent(apiKey)
					+ '&bookmakers=sportsbet'
					+ '&regions=au,us,uk,eu'
					+ '&markets=h2h'
					+ '&oddsFormat=decimal'
					+ '&dateFormat=iso';
				const [historyScoresResponse, recentScoresResponse, oddsResponse] = await Promise.all([
					fetchWithTimeout(historyScoresUrl),
					fetchWithTimeout(recentScoresUrl),
					fetchWithTimeout(oddsUrl)
				]);
				apiCreditsUsedTotal += getApiCreditsUsedFromResponses([historyScoresResponse, recentScoresResponse, oddsResponse]);
				const historyScoresPayload = historyScoresResponse.ok ? await historyScoresResponse.json() : [];
				const recentScoresPayload = recentScoresResponse.ok ? await recentScoresResponse.json() : [];
				const oddsPayload = oddsResponse.ok ? await oddsResponse.json() : [];
				const historyRows = Array.isArray(historyScoresPayload) ? historyScoresPayload : [];
				const existingRollingHistoryRows = readCache("rolling_history_" + sportKey);
				const mergedHistoryRows = mergeRollingHistoryRows(existingRollingHistoryRows, historyRows);
				cacheSavedAt = Math.max(cacheSavedAt, writeCache("rolling_history_" + sportKey, mergedHistoryRows));
				const recentRows = Array.isArray(recentScoresPayload) ? recentScoresPayload : [];
				const oddsRows = Array.isArray(oddsPayload) ? oddsPayload : [];
				const completedHistoryRows = filterPastResults(mergedHistoryRows, GAME_START_BUFFER_MS);
				const completedRecentRows = filterPastResults(recentRows, GAME_START_BUFFER_MS);
				const eligibleRecentRows = completedRecentRows.length ? completedRecentRows : completedHistoryRows;
				cacheSavedAt = Math.max(cacheSavedAt, writeCache("recent_scores_" + sportKey, eligibleRecentRows));
				cacheSavedAt = Math.max(cacheSavedAt, writeCache("recent_odds_" + sportKey, oddsRows));
				cacheSavedAt = Math.max(cacheSavedAt, writeCache("recent_history_" + sportKey, mergedHistoryRows));
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
				successfulSportLoads += 1;
			} catch {
				failedSportLoads += 1;
				continue;
			}
		}

		if (!successfulSportLoads && failedSportLoads > 0) {
			throw new Error('All sport requests failed while loading recent results.');
		}

		if (!isTrackedLoadingCurrent(loadToken)) {
			return;
		}
		const backtest = buildPredictionBacktestSummary(allRecentItems);
		if (backtest) {
			saveBacktestSnapshot(scopeLabel, backtest, buildPerSportBacktestBreakdown(allRecentItems));
		}
		renderRecentResultsForSelectedScope(scopeLabel, allRecentItems);
		state.allRecentResultsItems = allRecentItems.slice();
		state.recentScopeLabel = scopeLabel;
		markDataLoaded(allRecentItems.length, cacheSavedAt || Date.now());
		setStatus(
			backtest
				? 'Recent results loaded for ' + scopeLabel.toLowerCase() + ': ' + allRecentItems.length + ' games | Backtest (' + backtest.sampleSize + '): Ensemble ' + backtest.ensembleAccuracy.toFixed(1) + '% / Brier ' + backtest.ensembleBrier.toFixed(3) + ' vs Baseline ' + (Number.isFinite(backtest.baselineAccuracy) ? backtest.baselineAccuracy.toFixed(1) + '%' : 'N/A') + ' / ' + (Number.isFinite(backtest.baselineBrier) ? backtest.baselineBrier.toFixed(3) : 'N/A')
				: 'Recent results loaded for ' + scopeLabel.toLowerCase() + ': ' + allRecentItems.length + ' games',
			'ok'
		);
	} catch (error) {
		if (!isTrackedLoadingCurrent(loadToken)) {
			return;
		}
		const message = error instanceof Error ? error.message : 'Unknown error';
		if (preserveVisibleResults) {
			rerenderActiveResultsView();
			setStatus('Could not load additional recent results: ' + message + '. Showing the current results.', 'error');
			return;
		}
		state.allRecentResultsItems = [];
		state.recentScopeLabel = scopeLabel;
		setResultSportOptions([]);
		el.upcomingWrap.innerHTML = '<p class="subhead">Recent Results | ' + escapeHtml(scopeLabel) + '</p><div class="empty">Unable to load recent results.</div>';
		setStatus('Failed loading recent results: ' + message, 'error');
	} finally {
		if (isTrackedLoadingCurrent(loadToken)) {
			state.rangeLoading = false;
			syncRangeButtons();
				if (!preserveVisibleResults) {
					endBusyOverlay();
				}
		}
	}
}

async function loadRecentResultsForSport(sportKey, apiKey, options = {}) {
	if (!sportKey) {
		return;
	}
	const loadCost = 1;
	const forceRefresh = Boolean(options && options.forceRefresh === true);
	setView("recent");
	state.activeSportKey = sportKey;
	renderSportsTable(state.sportsRows);

	const cachedScores = readCache("recent_scores_" + sportKey);
	const cachedOddsRows = readCache("recent_odds_" + sportKey);
	const cachedHistoryRows = readCache("recent_history_" + sportKey);
	const rollingHistoryRows = readCache("rolling_history_" + sportKey);
	if (Array.isArray(cachedScores) && cachedScores.length && !forceRefresh) {
		const visibleCachedScores = filterRecentResultsToLookback(cachedScores);
		const oddsByEventId = buildOddsByEventId(Array.isArray(cachedOddsRows) ? cachedOddsRows : []);
		const historyRows = mergeRollingHistoryRows(rollingHistoryRows, cachedHistoryRows);
		renderRecentResults(sportKey, visibleCachedScores, oddsByEventId, historyRows);
		const cachedLoadedAt = readCacheTimestamp('recent_scores_' + sportKey);
		markDataLoaded(visibleCachedScores.length, Number.isFinite(cachedLoadedAt) ? cachedLoadedAt : Date.now());
		setStatus('Loaded recent results from cache.', 'ok');
		return;
	}

	const loadToken = beginTrackedLoading(loadCost);
	const loadingStampCost = 3;
	beginBusyOverlay();
	state.rangeLoading = true;
	syncRangeButtons();
	setStatus("Loading recent results for " + sportKey + "...", "");
	el.upcomingWrap.innerHTML = '<p class="subhead">Recent Results</p><div class="loading-panel"><p class="loading-label">Connecting to odds API…</p><div class="loading-bar"><span></span></div></div>';
	setLoadingMessage('Fetching scores for ' + escapeHtml(sportKey) + '…');

	try {
		const recentLookbackDays = Math.max(RECENT_RESULTS_LOOKBACK_DAYS, Number(state.recentResultsLookbackDays) || RECENT_RESULTS_LOOKBACK_DAYS);
		const historyScoresUrl = BASE_URL + '/sports/' + encodeURIComponent(sportKey) + '/scores/?apiKey='
			+ encodeURIComponent(apiKey)
			+ '&daysFrom=' + HISTORY_LOOKBACK_DAYS
			+ '&dateFormat=iso';
		const recentScoresUrl = BASE_URL + '/sports/' + encodeURIComponent(sportKey) + '/scores/?apiKey='
			+ encodeURIComponent(apiKey)
			+ '&daysFrom=' + recentLookbackDays
			+ '&dateFormat=iso';
		const oddsUrl = BASE_URL + '/sports/' + encodeURIComponent(sportKey) + '/odds/?apiKey='
			+ encodeURIComponent(apiKey)
			+ '&bookmakers=sportsbet'
			+ '&regions=au,us,uk,eu'
			+ '&markets=h2h'
			+ '&oddsFormat=decimal'
			+ '&dateFormat=iso';

		const responses = await Promise.all([fetchWithTimeout(historyScoresUrl), fetchWithTimeout(recentScoresUrl), fetchWithTimeout(oddsUrl)]);
		const apiCreditsUsed = getApiCreditsUsedFromResponses(responses);
		if (!isTrackedLoadingCurrent(loadToken)) {
			return;
		}
		const historyResponse = responses[0];
		const recentResponse = responses[1];
		const oddsResponse = responses[2];
		const historyPayload = await safeReadJson(historyResponse, []);
		const recentPayload = await safeReadJson(recentResponse, []);
		const oddsPayload = await safeReadJson(oddsResponse, []);
		const historyRows = Array.isArray(historyPayload) ? historyPayload : [];
		const existingRollingHistoryRows = readCache("rolling_history_" + sportKey);
		const mergedHistoryRows = mergeRollingHistoryRows(existingRollingHistoryRows, historyRows);
		writeCache("rolling_history_" + sportKey, mergedHistoryRows);
		const rows = Array.isArray(recentPayload) ? recentPayload : [];

		if (!recentResponse.ok) {
			const message = recentPayload && recentPayload.message ? String(recentPayload.message) : (recentResponse.statusText || 'Request failed');
			throw new Error(message);
		}

		const sorted = filterPastResults(rows, GAME_START_BUFFER_MS).sort((a, b) => {
			const aTs = new Date(a && a.commence_time ? a.commence_time : '').getTime();
			const bTs = new Date(b && b.commence_time ? b.commence_time : '').getTime();
			return bTs - aTs;
		});
		const recentGames = sorted.length ? sorted : filterPastResults(mergedHistoryRows, GAME_START_BUFFER_MS);
		let cacheSavedAt = writeCache("recent_scores_" + sportKey, recentGames);
		cacheSavedAt = Math.max(cacheSavedAt, writeCache("recent_history_" + sportKey, mergedHistoryRows));

		const oddsRows = oddsResponse.ok && Array.isArray(oddsPayload) ? oddsPayload : [];
		cacheSavedAt = Math.max(cacheSavedAt, writeCache("recent_odds_" + sportKey, oddsRows));
		const oddsByEventId = buildOddsByEventId(oddsRows);

		state.allRecentResultsItems = sortByStartDesc(recentGames).map((row) => ({
			sportKey,
			sportTitle: state.sportsByKey[sportKey] && state.sportsByKey[sportKey].title ? String(state.sportsByKey[sportKey].title) : sportKey,
			start: row && row.commence_time ? String(row.commence_time) : '',
			row,
			oddsRow: row && row.id ? oddsByEventId[String(row.id)] || null : null,
			historyMap: mergedHistoryRows
		}));
		state.recentScopeLabel = state.sportsByKey[sportKey] && state.sportsByKey[sportKey].title ? String(state.sportsByKey[sportKey].title) : sportKey;
		const scoredItemsForBacktest = state.allRecentResultsItems.map((item) => ({
			...item,
			prediction: getPredictionForEvent(item.row, item.oddsRow, item.historyMap || null, item.sportKey || '')
		}));
		const backtest = buildPredictionBacktestSummary(scoredItemsForBacktest);
		if (backtest) {
			saveBacktestSnapshot(sportKey, backtest, buildPerSportBacktestBreakdown(scoredItemsForBacktest));
		}
		if (!isTrackedLoadingCurrent(loadToken)) {
			return;
		}
		renderRecentResults(sportKey, recentGames, oddsByEventId, mergedHistoryRows);
		markDataLoaded(recentGames.length, cacheSavedAt);
		setStatus(
			backtest
				? 'Recent results loaded for ' + sportKey + ': ' + recentGames.length + ' games | Backtest (' + backtest.sampleSize + '): Ensemble ' + backtest.ensembleAccuracy.toFixed(1) + '% / Brier ' + backtest.ensembleBrier.toFixed(3) + ' vs Baseline ' + (Number.isFinite(backtest.baselineAccuracy) ? backtest.baselineAccuracy.toFixed(1) + '%' : 'N/A') + ' / ' + (Number.isFinite(backtest.baselineBrier) ? backtest.baselineBrier.toFixed(3) : 'N/A')
				: 'Recent results loaded for ' + sportKey + ': ' + recentGames.length + ' games',
			'ok'
		);
	} catch (error) {
		if (!isTrackedLoadingCurrent(loadToken)) {
			return;
		}
		const message = error instanceof Error ? error.message : 'Unknown error';
		const cachedScores = readCache("recent_scores_" + sportKey);
		const cachedOddsRows = readCache("recent_odds_" + sportKey);
		const cachedHistoryRows = readCache("recent_history_" + sportKey);
		const rollingHistoryRows = readCache("rolling_history_" + sportKey);
		if (Array.isArray(cachedScores) && cachedScores.length) {
			const visibleCachedScores = filterRecentResultsToLookback(cachedScores);
			const oddsByEventId = buildOddsByEventId(Array.isArray(cachedOddsRows) ? cachedOddsRows : []);
			const historyRows = mergeRollingHistoryRows(rollingHistoryRows, cachedHistoryRows);
			renderRecentResults(sportKey, visibleCachedScores, oddsByEventId, historyRows);
			setStatus('Recent results request failed: ' + message + '. Showing cached fallback data.', 'error');
			return;
		}

		el.upcomingWrap.innerHTML = '<p class="subhead">Recent Results</p><div class="empty">Unable to load recent results.</div>';
		state.allRecentResultsItems = [];
		state.recentScopeLabel = '';
		setResultSportOptions([]);
		setStatus('Failed loading recent results: ' + message, 'error');
	} finally {
		if (isTrackedLoadingCurrent(loadToken)) {
			state.rangeLoading = false;
			syncRangeButtons();
			endBusyOverlay();
		}
	}
}

async function loadAllSportsUpcoming(apiKey, options = {}) {
	const loadCost = 1;
	const forceRefresh = Boolean(options && options.forceRefresh === true);
	const loadToken = beginTrackedLoading(0);
	beginBusyOverlay();
	state.rangeLoading = true;
	syncRangeButtons();
	setView('upcoming');
	state.activeSportKey = "";
	state.activeUpcomingSportData = null;
	state.upcomingSavedSportsShowTomorrow = false;
	state.upcomingSavedSportsShowDayAfter = false;
	persistRefreshViewState();
	const scopeLabel = state.catalogScope === 'favorites' ? 'Favourites' : 'All Sports';
	const rangeLabel = getRangeLabel(state.timeRange);
	const loadingStampCost = Math.max(3, Math.max(1, (Array.isArray(state.sportsRows) && state.sportsRows.length) ? state.sportsRows.length : 1) * 3);
	let apiCreditsUsedTotal = 0;
	let usedLiveRefresh = false;
	setStatus('Checking ' + scopeLabel.toLowerCase() + ' for ' + rangeLabel.toLowerCase() + '...', '');
	el.upcomingWrap.innerHTML = '<p class="subhead">' + escapeHtml(getGamesSectionTitle(state.timeRange)) + ' | ' + escapeHtml(scopeLabel) + '</p><div class="loading-panel"><p class="loading-label">' + escapeHtml(getLoadingStampLabel(loadingStampCost)) + '</p><div class="loading-bar"><span></span></div></div>';

	try {
		const sportRows = Array.isArray(state.sportsRows) && state.sportsRows.length
			? state.sportsRows
			: (Array.isArray(readCache("sports_catalog")) ? readCache("sports_catalog") : []);
		if (!Array.isArray(state.sportsRows) || !state.sportsRows.length) {
			renderSportsTable(Array.isArray(sportRows) ? sportRows : []);
		}
		const rows = getScopedSportsForLoading();
		state.favoriteUpcomingSportTitles = rows
			.map((sport) => sport && sport.title ? String(sport.title).trim() : '')
			.filter(Boolean);
		if (!rows.length) {
			const emptyMessage = state.catalogScope === 'favorites'
				? 'No favourite sports selected. Save a sport from the catalog to see its games.'
				: 'No sports were available to load for this range.';
			state.allUpcomingGames = [];
			setResultSportOptions([]);
			el.upcomingWrap.innerHTML = '<p class="subhead">' + escapeHtml(getGamesSectionTitle(state.timeRange)) + ' | ' + escapeHtml(scopeLabel) + ' | ' + escapeHtml(rangeLabel) + '</p><div class="empty">' + escapeHtml(emptyMessage) + '</div>';
			setStatus(state.catalogScope === 'favorites' ? 'No favourite sports selected.' : 'No sports available for this range.', 'ok');
			return;
		}
		const allGames = [];
		const isTodayRange = normalizeRangeKey(state.timeRange) === 'today';
		const rangeWindow = getRangeWindow(state.timeRange);
		let cacheSavedAt = 0;
		for (const sport of rows) {
			if (!isTrackedLoadingCurrent(loadToken)) {
				return;
			}
			const sportKey = sport && sport.key ? String(sport.key) : '';
			if (!sportKey) {
				continue;
			}

			const cachedEvents = readCache("upcoming_events_" + sportKey);
			const cachedOddsRows = readCache("upcoming_odds_" + sportKey);
			const cachedHistoryRows = readCache("upcoming_history_" + sportKey);
			const rollingHistoryRows = readCache("rolling_history_" + sportKey);
			const shouldForceCacheOnHydration = state.isInitialHydration === true;
			const canUseCache = Array.isArray(cachedEvents)
				&& cachedEvents.length > 0
				&& !forceRefresh
				&& (shouldForceCacheOnHydration || !shouldRefreshCachedEvents(cachedEvents));

			let sourceRows = [];
			let oddsByEventId = {};
			let historyMap = {};

			if (canUseCache) {
				oddsByEventId = buildOddsByEventId(Array.isArray(cachedOddsRows) ? cachedOddsRows : []);
				const mergedHistoryRows = mergeRollingHistoryRows(rollingHistoryRows, cachedHistoryRows);
				historyMap = buildTeamHistoryMap(mergedHistoryRows);
				sourceRows = Array.isArray(cachedEvents) ? cachedEvents : [];
				const cachedLoadedAt = readCacheTimestamp('upcoming_events_' + sportKey);
				if (Number.isFinite(cachedLoadedAt)) {
					cacheSavedAt = Math.max(cacheSavedAt, cachedLoadedAt);
				}
			} else {
				if (state.isInitialHydration === true) {
					continue;
				}
				if (!String(apiKey || '').trim()) {
					continue;
				}
				if (!usedLiveRefresh) {
					usedLiveRefresh = true;
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
						fetchWithTimeout(eventsUrl),
						fetchWithTimeout(oddsUrl),
						fetchWithTimeout(historyUrl)
					]);
					apiCreditsUsedTotal += getApiCreditsUsedFromResponses([eventResponse, oddsResponse, historyResponse]);
					if (!isTrackedLoadingCurrent(loadToken)) {
						return;
					}
					if (!eventResponse.ok) {
						continue;
					}
					const eventPayload = await safeReadJson(eventResponse, []);
					if (!Array.isArray(eventPayload)) {
						continue;
					}

					let oddsPayload = [];
					if (oddsResponse.ok) {
						oddsPayload = await safeReadJson(oddsResponse, []);
					}
					let historyPayload = [];
					if (historyResponse.ok) {
						historyPayload = await safeReadJson(historyResponse, []);
					}
					oddsByEventId = buildOddsByEventId(Array.isArray(oddsPayload) ? oddsPayload : []);
					const existingRollingHistoryRows = readCache("rolling_history_" + sportKey);
					const mergedHistoryRows = mergeRollingHistoryRows(existingRollingHistoryRows, Array.isArray(historyPayload) ? historyPayload : []);
					cacheSavedAt = Math.max(cacheSavedAt, writeCache("rolling_history_" + sportKey, mergedHistoryRows));
					historyMap = buildTeamHistoryMap(mergedHistoryRows);
					const filtered = getRowsForSelectedRange(eventPayload, state.timeRange, rangeWindow, Array.isArray(historyPayload) ? historyPayload : []);
					sourceRows = isTodayRange ? eventPayload : filtered;
					cacheSavedAt = Math.max(cacheSavedAt, writeCache("upcoming_events_" + sportKey, sourceRows));
					cacheSavedAt = Math.max(cacheSavedAt, writeCache("upcoming_odds_" + sportKey, Array.isArray(oddsPayload) ? oddsPayload : []));
					cacheSavedAt = Math.max(cacheSavedAt, writeCache("upcoming_history_" + sportKey, mergedHistoryRows));
				} catch {
					continue;
				}
			}

			for (const eventRow of sourceRows) {
				const isLiveRange = normalizeRangeKey(state.timeRange) === 'live';
				if (isLiveRange && !isLiveEventRow(eventRow)) {
					continue;
				}
				if (!isLiveRange && isLiveEventRow(eventRow)) {
					continue;
				}
				const eventTs = getEventStartTimestamp(eventRow);
				if (!isLiveRange && !isLiveEventRow(eventRow)
						&& Number.isFinite(eventTs) && eventTs < Date.now() - GAME_START_BUFFER_MS) {
					continue;
				}
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
		}

		if (!allGames.length) {
			const rangeLabel = getRangeLabel(state.timeRange);
			setResultSportOptions([]);
			el.upcomingWrap.innerHTML = '<p class="subhead">' + escapeHtml(getGamesSectionTitle(state.timeRange)) + ' | ' + escapeHtml(scopeLabel) + ' | ' + escapeHtml(rangeLabel) + '</p><div class="empty">No games found in the selected range.</div>';
			setStatus('No games found for all sports in this range.', 'ok');
			return;
		}

		state.allUpcomingGames = allGames;
		state.upcomingVisibleSportCount = state.favoriteUpcomingSportTitles.length || 5;
		if (!isTrackedLoadingCurrent(loadToken)) {
			return;
		}
		renderUpcomingSportBatch();
		markDataLoaded(allGames.length, cacheSavedAt || Date.now());
		setStatus(
			apiCreditsUsedTotal > 0
				? 'Loaded favourite games for all sports in ' + getRangeLabel(state.timeRange).toLowerCase() + '.'
				: 'Loaded games from cache. Auto-refresh happens 6 minutes before next game.',
			'ok'
		);
	} catch (error) {
		if (!isTrackedLoadingCurrent(loadToken)) {
			return;
		}
		const message = error instanceof Error ? error.message : 'Unknown error';
		state.allUpcomingGames = [];
		state.favoriteUpcomingSportTitles = [];
		setResultSportOptions([]);
		el.upcomingWrap.innerHTML = '<p class="subhead">' + escapeHtml(getGamesSectionTitle(state.timeRange)) + ' | ' + escapeHtml(scopeLabel) + '</p><div class="empty">Unable to load games for the selected scope.</div>';
		setStatus('Failed loading favourite games for all sports: ' + message, 'error');
	} finally {
		if (isTrackedLoadingCurrent(loadToken)) {
			state.rangeLoading = false;
			syncRangeButtons();
			endBusyOverlay();
		}
	}
}

