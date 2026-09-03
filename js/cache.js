// --- Local cache and event timestamp helpers ---
function getCacheKey(name) {
	return "keieye_cache_" + CACHE_VERSION + "_" + name;
}

function writeCache(name, data) {
	try {
		const timestamp = Date.now();
		localStorage.setItem(getCacheKey(name), JSON.stringify({
			ts: timestamp,
			data
		}));
		return timestamp;
	} catch {
		return Date.now();
	}
}

function readCache(name) {
	const entry = readCacheEntry(name);
	return entry ? entry.data : null;
}

function readCacheEntry(name) {
	try {
		const raw = localStorage.getItem(getCacheKey(name));
		if (!raw) {
			return null;
		}
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object" || !("ts" in parsed)) {
			return null;
		}
		if (typeof parsed.ts !== "number" || !Number.isFinite(parsed.ts)) {
			return null;
		}
		if ((Date.now() - parsed.ts) > CACHE_TTL_MS) {
			return null;
		}
		return parsed;
	} catch {
		return null;
	}
}

function readCacheTimestamp(name) {
	const entry = readCacheEntry(name);
	return entry && Number.isFinite(Number(entry.ts)) ? Number(entry.ts) : NaN;
}

function clearRollingHistoryCache(sportKey = "") {
	const normalizedKey = String(sportKey || "").trim();
	const targets = normalizedKey
		? [
			"rolling_history_" + normalizedKey,
			"upcoming_history_" + normalizedKey,
			"recent_history_" + normalizedKey
		]
		: [];

	try {
		if (targets.length) {
			for (const name of targets) {
				localStorage.removeItem(getCacheKey(name));
			}
			return;
		}

		const cachePrefix = "keieye_cache_" + CACHE_VERSION + "_";
		const historyNamePrefixList = ["rolling_history_", "upcoming_history_", "recent_history_"];
		const keysToRemove = [];
		for (let i = 0; i < localStorage.length; i += 1) {
			const key = localStorage.key(i);
			if (!key || !key.startsWith(cachePrefix)) {
				continue;
			}
			const cacheName = key.slice(cachePrefix.length);
			if (historyNamePrefixList.some((prefix) => cacheName.startsWith(prefix))) {
				keysToRemove.push(key);
			}
		}
		for (const key of keysToRemove) {
			localStorage.removeItem(key);
		}
	} catch {
		// Ignore cache clear failures.
	}
}

function buildOddsByEventId(oddsRows) {
	const oddsByEventId = {};
	if (!Array.isArray(oddsRows)) {
		return oddsByEventId;
	}
	for (const row of oddsRows) {
		if (row && row.id) {
			oddsByEventId[String(row.id)] = row;
		}
	}
	return oddsByEventId;
}

function getEventStartTimestamp(eventRow) {
	if (!eventRow || typeof eventRow !== 'object') {
		return NaN;
	}
	const raw = eventRow.commence_time || eventRow.start || eventRow.start_time || '';
	if (!raw) {
		return NaN;
	}
	const ts = new Date(String(raw)).getTime();
	return Number.isFinite(ts) ? ts : NaN;
}

function getNextGameStartTimestamp(eventRows) {
	if (!Array.isArray(eventRows) || !eventRows.length) {
		return NaN;
	}
	const now = Date.now();
	let nextTs = NaN;
	for (const row of eventRows) {
		const ts = getEventStartTimestamp(row);
		if (!Number.isFinite(ts) || ts <= now) {
			continue;
		}
		if (!Number.isFinite(nextTs) || ts < nextTs) {
			nextTs = ts;
		}
	}
	return nextTs;
}

function shouldRefreshCachedEvents(eventRows) {
	const nextStartTs = getNextGameStartTimestamp(eventRows);
	if (!Number.isFinite(nextStartTs)) {
		return false;
	}
	return Date.now() >= (nextStartTs - REFRESH_BEFORE_NEXT_GAME_MS);
}
