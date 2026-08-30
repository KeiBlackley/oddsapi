// --- App state, storage keys and shared browser state ---
const STORAGE_KEY = "keieye_home_api_key_v1";
const LEGACY_STORAGE_KEY = "keieye_betting_api_keys";
const SAVED_SPORTS_KEY = "keieye_saved_sports_v1";
const SAVED_SPORTS_BACKUP_KEY = "keieye_saved_sports_backup_v1";
const SAVED_SPORTS_SESSION_KEY = "keieye_saved_sports_session_v1";
const BASE_URL = "https://api.the-odds-api.com/v4";
const CACHE_VERSION = "v1";
const GAME_START_BUFFER_MS = 60 * 1000;
const CACHE_TTL_MS = 1000 * 60 * 60 * 6;
const MIN_VISIBLE_WIN_RATE = 50;
const RANGE_SELECTION_KEY = "keieye_selected_range_v1";
const LAST_DATA_LOAD_KEY = "keieye_last_data_load_v1";

const el = {
	settingsBtn: document.getElementById("settingsBtn"),
	apiKeyModal: document.getElementById("apiKeyModal"),
	apiKeyModalTitle: document.getElementById("apiKeyModalTitle"),
	modalCloseBtn: document.querySelector('.modal-close'),
	apiKeyLabel: document.querySelector('label[for="apiKeyInput"]'),
	apiKeyInput: document.getElementById("apiKeyInput"),
	swapApiKeyBtn: document.getElementById("swapApiKeyBtn"),
	apiKeyMasked: document.getElementById("apiKeyMasked"),
	clearHistoryCacheBtn: document.getElementById("clearHistoryCacheBtn"),
	cancelApiKeyBtn: document.getElementById("cancelApiKeyBtn"),
	saveApiKeyBtn: document.getElementById("saveApiKeyBtn"),
	resultsSportScopeSelect: document.getElementById("resultsSportScopeSelect"),
	resultsSportScopeLabel: document.getElementById("resultsSportScopeLabel"),
	settingsPanel: document.querySelector('.settings-panel'),
	pageTitle: document.getElementById("pageTitle"),
	panelSub: document.getElementById("panelSub"),
	backBtn: document.getElementById("backBtn"),
	logoutBtn: document.getElementById("logoutBtn"),
	status: document.getElementById("status"),
	sportsSearchInput: document.getElementById("sportsSearchInput"),
	tableWrap: document.getElementById("tableWrap"),
	upcomingWrap: document.getElementById("upcomingWrap"),
	sportFilterBar: document.getElementById("sportFilterBar"),
	sportFilterButtons: document.getElementById("sportFilterButtons")
};

const state = {
	sportsByKey: {},
	sportsRows: [],
	activeSportKey: "",
	activeUpcomingSportData: null,
	activeRecentSportData: null,
	view: "catalog",
	savedSports: [],
	apiKey: "",
	timeRange: "today",
	catalogScope: "all",
	catalogSearch: "",
	resultsSearch: "",
	catalogSort: {
		field: "title",
		direction: "asc"
	},
	allUpcomingGames: [],
	favoriteUpcomingSportTitles: [],
	upcomingVisibleSportCount: 5,
	allRecentResultsItems: [],
	recentScopeLabel: '',
	resultSportOptions: [],
	resultSportFilter: 'all',
	favoriteFlash: null,
	favoriteFlashTimerId: null,
	rangeButtonsEnabled: false,
	timeRangeSelected: false,
	winRateFilter: 'all',
	rangeLoading: false,
	preloadedRangeData: {
		today: null,
		live: null,
		pastWeek: null
	},
	lastLoadedAt: null
};

function normalizeSportKey(value) {
	return String(value || '').trim().toLowerCase();
}

function syncSearchInputMode() {
	if (!el.sportsSearchInput) {
		return;
	}
	const isCatalogView = state.view === 'catalog';
	el.sportsSearchInput.placeholder = isCatalogView
		? 'Search sports by key, title or group'
		: 'Search results by sport title or team name';
	el.sportsSearchInput.setAttribute('aria-label', isCatalogView ? 'Search sports catalog' : 'Search results by sport title or team name');
	el.sportsSearchInput.value = isCatalogView ? String(state.catalogSearch || '') : String(state.resultsSearch || '');
}

function rerenderActiveResultsView() {
	if (state.view === 'catalog') {
		renderSportsTable(state.sportsRows);
		return;
	}

	if (state.view === 'recent') {
		if (state.activeSportKey && state.activeRecentSportData && state.activeRecentSportData.sportKey === state.activeSportKey) {
			renderRecentResults(
				state.activeRecentSportData.sportKey,
				Array.isArray(state.activeRecentSportData.events) ? state.activeRecentSportData.events : [],
				state.activeRecentSportData.oddsByEventId || {},
				state.activeRecentSportData.historyMap || null
			);
			return;
		}
		renderRecentResultsForSelectedScope(state.recentScopeLabel || 'All Sports', state.allRecentResultsItems);
		return;
	}

	if (state.view === 'upcoming') {
		if (state.activeSportKey && state.activeUpcomingSportData && state.activeUpcomingSportData.sportKey === state.activeSportKey) {
			renderUpcomingEvents(
				state.activeUpcomingSportData.sportKey,
				Array.isArray(state.activeUpcomingSportData.events) ? state.activeUpcomingSportData.events : [],
				state.activeUpcomingSportData.oddsByEventId || {},
				state.activeUpcomingSportData.rangeKey || state.timeRange,
				state.activeUpcomingSportData.historyMap || null
			);
			return;
		}
		renderUpcomingSportBatch();
	}
}

function isLoginMode() {
	return !String(state.apiKey || '').trim();
}

function maskApiKey(value) {
	const key = String(value || '').trim();
	if (!key) {
		return '';
	}
	if (key.length <= 8) {
		return '*'.repeat(key.length);
	}
	const start = key.slice(0, 4);
	const end = key.slice(-4);
	return start + '*'.repeat(Math.max(4, key.length - 8)) + end;
}

function syncApiKeySubmitButtonState() {
	if (!el.saveApiKeyBtn) {
		return;
	}
	if (!isLoginMode()) {
		el.saveApiKeyBtn.disabled = false;
		return;
	}
	const hasInput = Boolean(el.apiKeyInput && String(el.apiKeyInput.value || '').trim());
	el.saveApiKeyBtn.disabled = !hasInput;
}

function syncApiKeyModalMode() {
	const loginMode = isLoginMode();
	document.body.classList.toggle('auth-locked', loginMode);
	if (el.apiKeyModal) {
		el.apiKeyModal.classList.toggle('fullscreen-login', loginMode);
	}

	if (el.apiKeyModalTitle) {
		el.apiKeyModalTitle.textContent = loginMode ? 'Login' : 'API Key Settings';
	}
	if (el.apiKeyLabel) {
		el.apiKeyLabel.textContent = loginMode ? 'Please enter your API key..' : 'Odds API key';
	}
	if (el.saveApiKeyBtn) {
		el.saveApiKeyBtn.textContent = loginMode ? 'Continue' : 'Save';
	}
	if (el.apiKeyInput) {
		el.apiKeyInput.classList.toggle('hidden', false);
		el.apiKeyInput.disabled = !loginMode;
	}
	if (el.swapApiKeyBtn) {
		el.swapApiKeyBtn.classList.toggle('hidden', loginMode);
	}
	if (el.apiKeyMasked) {
		el.apiKeyMasked.classList.toggle('hidden', true);
		el.apiKeyMasked.textContent = maskApiKey(state.apiKey);
	}
	if (el.modalCloseBtn) {
		el.modalCloseBtn.classList.toggle('hidden', loginMode);
	}
	if (el.cancelApiKeyBtn) {
		el.cancelApiKeyBtn.classList.toggle('hidden', loginMode);
	}
	if (el.clearHistoryCacheBtn) {
		el.clearHistoryCacheBtn.classList.toggle('hidden', loginMode);
	}
	if (el.settingsPanel) {
		el.settingsPanel.classList.toggle('hidden', loginMode);
	}
	syncApiKeySubmitButtonState();
}

function normalizeSportFilterValue(value) {
	if (value === 'all') {
		return 'all';
	}
	return String(value || '').trim();
}

function getSportDisplayTitle(row) {
	if (!row || typeof row !== 'object') {
		return '';
	}
	const title = String(row.title || row.label || row.name || '').trim();
	if (title) {
		return title;
	}
	return String(row.key || '').trim();
}

function syncResultSportFilterBar() {
	if (!el.sportFilterBar || !el.sportFilterButtons) {
		return;
	}

	const hasMultipleOptions = Array.isArray(state.resultSportOptions) && state.resultSportOptions.length > 1;
	const isDetailView = state.view === 'upcoming' || state.view === 'recent';
	if (!hasMultipleOptions || !isDetailView) {
		el.sportFilterBar.classList.add('hidden');
		el.sportFilterButtons.innerHTML = '';
		return;
	}

	el.sportFilterBar.classList.remove('hidden');
	const allButton = '<button class="control-btn sport-filter-btn ' + (state.resultSportFilter === 'all' ? 'is-active' : '') + '" type="button" data-result-sport="all" aria-pressed="' + (state.resultSportFilter === 'all' ? 'true' : 'false') + '">All Sports</button>';
	const sportButtons = state.resultSportOptions.map((sportTitle) => {
		const isActive = state.resultSportFilter === sportTitle;
		return '<button class="control-btn sport-filter-btn ' + (isActive ? 'is-active' : '') + '" type="button" data-result-sport="' + escapeHtml(sportTitle) + '" aria-pressed="' + (isActive ? 'true' : 'false') + '">' + escapeHtml(sportTitle) + '</button>';
	}).join('');
	el.sportFilterButtons.innerHTML = allButton + sportButtons;
}

function syncResultsSportScopeDropdown() {
	if (el.resultsSportScopeLabel) {
		const labelScope = state.catalogScope === 'favorites' ? 'Favourites' : 'All Sports';
		el.resultsSportScopeLabel.textContent = 'Results sport scope (' + labelScope + ')';
	}

	if (!el.resultsSportScopeSelect) {
		return;
	}

	const select = el.resultsSportScopeSelect;
	const favoriteKeys = new Set((Array.isArray(state.savedSports) ? state.savedSports : []).map((key) => normalizeSportKey(key)));
	const availableTitles = [];
	const seen = new Set();

	for (const row of Array.isArray(state.sportsRows) ? state.sportsRows : []) {
		const title = getSportDisplayTitle(row);
		const key = row && row.key ? String(row.key).trim() : '';
		const normalizedKey = normalizeSportKey(key || title);
		if (!title || seen.has(title)) {
			continue;
		}
		seen.add(title);

		if (state.catalogScope === 'favorites') {
			if (favoriteKeys.has(normalizedKey)) {
				availableTitles.push(title);
			}
			continue;
		}

		availableTitles.push(title);
	}

	const sortedTitles = availableTitles.slice().sort((a, b) => a.localeCompare(b));
	select.innerHTML = '';

	const allOption = document.createElement('option');
	allOption.value = 'all';
	allOption.textContent = 'All Sports';
	if (state.resultSportFilter === 'all') {
		allOption.selected = true;
	}
	select.appendChild(allOption);

	if (sortedTitles.length) {
		const group = document.createElement('optgroup');
		group.label = state.catalogScope === 'favorites' ? 'Favourites' : 'All Sports';
		for (const title of sortedTitles) {
			const option = document.createElement('option');
			option.value = title;
			option.textContent = title;
			if (state.resultSportFilter === title) {
				option.selected = true;
			}
			group.appendChild(option);
		}
		select.appendChild(group);
	}

	if (state.resultSportFilter !== 'all' && !Array.from(select.options).some((option) => option.value === state.resultSportFilter)) {
		select.value = 'all';
		state.resultSportFilter = 'all';
	} else if (state.resultSportFilter === 'all') {
		select.value = 'all';
	} else {
		select.value = state.resultSportFilter;
	}
}

function setResultSportOptions(sportTitles) {
	const list = Array.isArray(sportTitles) ? sportTitles : [];
	const deduped = [];
	const seen = new Set();
	for (const title of list) {
		const normalized = String(title || '').trim();
		if (!normalized || seen.has(normalized)) {
			continue;
		}
		seen.add(normalized);
		deduped.push(normalized);
	}
	state.resultSportOptions = deduped;
	if (state.resultSportFilter !== 'all' && !state.resultSportOptions.includes(state.resultSportFilter)) {
		state.resultSportFilter = 'all';
	}
	syncResultSportFilterBar();
	syncResultsSportScopeDropdown();
}

function setResultSportFilter(value) {
	const next = normalizeSportFilterValue(value);
	if (next !== 'all' && !state.resultSportOptions.includes(next)) {
		return;
	}
	state.resultSportFilter = next;
	syncResultSportFilterBar();
	syncResultsSportScopeDropdown();

	if (state.view === 'upcoming' && !state.activeSportKey) {
		renderUpcomingSportBatch();
		return;
	}
	if (state.view === 'recent' && !state.activeSportKey) {
		renderRecentResultsForSelectedScope(state.recentScopeLabel || 'All Sports', state.allRecentResultsItems);
	}
}

function loadSavedSports() {
	const normalizeSavedSports = (value) => {
		if (!Array.isArray(value)) {
			return [];
		}
		return value
			.map((item) => normalizeSportKey(item))
			.filter(Boolean);
	};

	const fromStructuredValue = (value) => {
		if (Array.isArray(value)) {
			return normalizeSavedSports(value);
		}
		if (value && typeof value === 'object') {
			const candidateKeys = ['savedSports', 'favorites', 'favourites', 'sports', 'items'];
			for (const key of candidateKeys) {
				if (Array.isArray(value[key])) {
					return normalizeSavedSports(value[key]);
				}
			}
			const mappedKeys = Object.keys(value).filter((entryKey) => value[entryKey] === true);
			if (mappedKeys.length) {
				return normalizeSavedSports(mappedKeys);
			}
		}
		if (typeof value === 'string') {
			return normalizeSavedSports(value.split(','));
		}
		return [];
	};

	const parseRawValue = (raw) => {
		if (!raw) {
			return [];
		}
		try {
			return fromStructuredValue(JSON.parse(raw));
		} catch {
			return fromStructuredValue(raw);
		}
	};

	try {
		const rawPrimary = localStorage.getItem(SAVED_SPORTS_KEY);
		const rawBackup = localStorage.getItem(SAVED_SPORTS_BACKUP_KEY);
		const rawSession = sessionStorage.getItem(SAVED_SPORTS_SESSION_KEY);
		const primary = parseRawValue(rawPrimary);
		const backup = parseRawValue(rawBackup);
		const session = parseRawValue(rawSession);
		return Array.from(new Set([...primary, ...backup, ...session]));
	} catch {
		return [];
	}
}

function getCacheKey(name) {
	return "keieye_cache_" + CACHE_VERSION + "_" + name;
}

function writeCache(name, data) {
	try {
		localStorage.setItem(getCacheKey(name), JSON.stringify({
			ts: Date.now(),
			data
		}));
	} catch {
		// Ignore storage cache failures.
	}
}

function readCache(name) {
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
		return parsed.data;
	} catch {
		return null;
	}
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

function persistSavedSports() {
	const normalized = Array.from(new Set((Array.isArray(state.savedSports) ? state.savedSports : [])
		.map((key) => normalizeSportKey(key))
		.filter(Boolean)));
	state.savedSports = normalized;

	const serialized = JSON.stringify(normalized);
	const writeSessionBackup = () => {
		try {
			sessionStorage.setItem(SAVED_SPORTS_SESSION_KEY, serialized);
		} catch {
			// Ignore session storage failures.
		}
	};

	const clearCacheEntriesForStorageHeadroom = () => {
		try {
			const cachePrefix = 'keieye_cache_';
			const keysToRemove = [];
			for (let i = 0; i < localStorage.length; i += 1) {
				const key = localStorage.key(i);
				if (key && key.startsWith(cachePrefix)) {
					keysToRemove.push(key);
				}
			}
			for (const key of keysToRemove) {
				localStorage.removeItem(key);
			}
		} catch {
			// Ignore cache cleanup failures.
		}
	};

	try {
		localStorage.setItem(SAVED_SPORTS_KEY, serialized);
		localStorage.setItem(SAVED_SPORTS_BACKUP_KEY, serialized);
		writeSessionBackup();
	} catch {
		// Clear non-essential cache data and retry favourites persistence.
		clearCacheEntriesForStorageHeadroom();
		try {
			localStorage.setItem(SAVED_SPORTS_KEY, serialized);
			localStorage.setItem(SAVED_SPORTS_BACKUP_KEY, serialized);
		} catch {
			// Ignore local storage failures after retry.
		}
		writeSessionBackup();
	}
}

function isSportSaved(sportKey) {
	const normalizedKey = normalizeSportKey(sportKey);
	return normalizedKey ? state.savedSports.includes(normalizedKey) : false;
}

function toggleSavedSport(sportKey) {
	if (!sportKey) {
		return;
	}
	const normalizedKey = normalizeSportKey(sportKey);
	if (!normalizedKey) {
		return;
	}

	const currentStored = loadSavedSports();
	state.savedSports = Array.from(new Set(currentStored));
	let flashType = 'saved';
	if (isSportSaved(normalizedKey)) {
		state.savedSports = state.savedSports.filter((key) => key !== normalizedKey);
		flashType = 'removed';
	} else {
		state.savedSports = [...state.savedSports, normalizedKey];
		flashType = 'saved';
	}
	persistSavedSports();
	state.savedSports = loadSavedSports();
	state.favoriteFlash = {
		sportKey: normalizedKey,
		type: flashType
	};
	renderSportsTable(state.sportsRows);
	if (state.favoriteFlashTimerId) {
		clearTimeout(state.favoriteFlashTimerId);
	}
	state.favoriteFlashTimerId = window.setTimeout(() => {
		if (!state.favoriteFlash || state.favoriteFlash.sportKey !== normalizedKey || state.favoriteFlash.type !== flashType) {
			return;
		}
		state.favoriteFlash = null;
		state.favoriteFlashTimerId = null;
		renderSportsTable(state.sportsRows);
	}, 1100);
}

function syncRangeButtons() {
	const buttons = document.querySelectorAll('.range-btn');
	buttons.forEach((button) => {
		const isActive = state.rangeButtonsEnabled && state.timeRangeSelected && button.getAttribute('data-range') === state.timeRange;
		button.classList.toggle('is-active', isActive);
		button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
		button.disabled = !state.rangeButtonsEnabled || state.rangeLoading;
	});
}

function getPredictionWinRateValue(prediction) {
	if (!prediction || prediction.leanPct == null || prediction.leanPct === '') {
		return NaN;
	}
	const value = Number(prediction.leanPct);
	return Number.isFinite(value) ? value : NaN;
}

function matchesWinRateFilter(prediction) {
	if (!prediction || !prediction.predictedTeam) {
		return true;
	}
	const value = getPredictionWinRateValue(prediction);
	if (!Number.isFinite(value)) {
		return true;
	}
	if (value < MIN_VISIBLE_WIN_RATE) {
		return false;
	}
	if (state.winRateFilter === 'all') {
		return true;
	}
	if (state.winRateFilter === 'low') {
		return value < 65;
	}
	if (state.winRateFilter === 'medium') {
		return value >= 65 && value <= 75;
	}
	if (state.winRateFilter === 'high') {
		return value > 75;
	}
	return true;
}

function syncCatalogScopeButtons() {
	const allSportsCount = Array.isArray(state.sportsRows) ? state.sportsRows.length : 0;
	const favouriteLoadedCount = Array.isArray(state.savedSports) ? state.savedSports.length : 0;

	const buttons = document.querySelectorAll('.scope-btn');
	buttons.forEach((button) => {
		const scopeKey = button.getAttribute('data-scope') || 'all';
		if (scopeKey === 'favorites') {
			button.textContent = 'Favourites (' + favouriteLoadedCount + ')';
		} else {
			button.textContent = 'All Sports (' + allSportsCount + ')';
		}

		const isActive = button.getAttribute('data-scope') === state.catalogScope;
		button.classList.toggle('is-active', isActive);
		button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
	});
}

function getLoadedSportsCount() {
	if (state.catalogScope === 'favorites') {
		return Array.isArray(state.savedSports) ? state.savedSports.length : 0;
	}
	return Array.isArray(state.sportsRows) ? state.sportsRows.length : 0;
}

function getScopedSportsForLoading() {
	if (state.catalogScope !== 'favorites') {
		return (Array.isArray(state.sportsRows) ? state.sportsRows : []).filter((sport) => {
			const key = sport && sport.key ? String(sport.key).trim() : '';
			return Boolean(key);
		});
	}

	const rowsByKey = {};
	for (const row of Array.isArray(state.sportsRows) ? state.sportsRows : []) {
		const key = row && row.key ? normalizeSportKey(row.key) : '';
		if (!key) {
			continue;
		}
		rowsByKey[key] = row;
	}

	const uniqueSavedKeys = Array.from(new Set((Array.isArray(state.savedSports) ? state.savedSports : [])
		.map((key) => normalizeSportKey(key))
		.filter(Boolean)));

	return uniqueSavedKeys.map((key) => {
		const existing = rowsByKey[key];
		if (existing) {
			return existing;
		}
		return {
			key,
			title: key,
			group: 'Saved',
			active: true,
			has_outrights: false,
			isUnlistedFavorite: true
		};
	});
}

function setCatalogScope(scopeKey) {
	if (scopeKey !== 'all' && scopeKey !== 'favorites') {
		return;
	}
	if (scopeKey === 'favorites') {
		state.savedSports = loadSavedSports();
	}
	state.catalogScope = scopeKey;
	state.timeRange = 'today';
	state.timeRangeSelected = false;
	state.rangeButtonsEnabled = true;
	syncCatalogScopeButtons();
	syncRangeButtons();
	setView('catalog');
	if (state.apiKey) {
		loadSportsCatalog(state.apiKey);
		return;
	}
	setStatus('Sports loaded: ' + (scopeKey === 'favorites' ? getLoadedSportsCount() : 0), 'ok');
}

function setView(viewName) {
	if (viewName === "upcoming" || viewName === "recent") {
		state.view = viewName;
	} else {
		state.view = "catalog";
	}
	const isDetailView = state.view !== "catalog";
	if (state.view === "upcoming") {
		el.pageTitle.textContent = state.timeRange === "live" ? "Live Games" : "Upcoming Games";
	} else if (state.view === "recent") {
		el.pageTitle.textContent = "Recent Results";
	} else {
		el.pageTitle.textContent = "Sports Catalog";
	}
	el.backBtn.classList.toggle("hidden", !isDetailView);
	el.tableWrap.classList.toggle("hidden", isDetailView);
	el.upcomingWrap.classList.toggle("hidden", !isDetailView);
	state.rangeButtonsEnabled = true;
	if (!isDetailView) {
		state.timeRangeSelected = false;
		state.timeRange = 'today';
		state.resultSportFilter = 'all';
		setResultSportOptions([]);
	}
	syncRangeButtons();
	syncResultSportFilterBar();
	syncSearchInputMode();
}

function setStatus(text, mode) {
	if (!el.status) {
		return;
	}
	el.status.textContent = text;
	el.status.className = "status";
	if (mode === "ok") {
		el.status.classList.add("ok");
	}
	if (mode === "error") {
		el.status.classList.add("error");
	}
}

function normalizeTeamName(value) {
	return String(value || "").trim().toLowerCase();
}

function normalizeRangeKey(rangeKey) {
	if (rangeKey === "pastWeek" || rangeKey === "recent") {
		return "pastWeek";
	}
	if (rangeKey === "live") {
		return "live";
	}
	return "today";
}

function getSavedRangeSelection() {
	try {
		const rawValue = localStorage.getItem(RANGE_SELECTION_KEY);
		if (!rawValue) {
			return 'today';
		}
		return normalizeRangeKey(rawValue);
	} catch {
		return 'today';
	}
}

function saveRangeSelection(rangeKey) {
	const normalizedRange = normalizeRangeKey(rangeKey);
	state.timeRange = normalizedRange;
	state.timeRangeSelected = true;
	try {
		localStorage.setItem(RANGE_SELECTION_KEY, normalizedRange);
	} catch {
		// Ignore local storage failures.
	}
}

function getLastLoadedTimestamp() {
	try {
		const rawValue = localStorage.getItem(LAST_DATA_LOAD_KEY);
		if (!rawValue) {
			return null;
		}
		const parsed = new Date(rawValue);
		return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
	} catch {
		return null;
	}
}

function setLastLoadedTimestamp(dateValue = new Date()) {
	const value = dateValue instanceof Date ? dateValue : new Date(dateValue);
	if (!Number.isFinite(value.getTime())) {
		return;
	}
	state.lastLoadedAt = value.toISOString();
	try {
		localStorage.setItem(LAST_DATA_LOAD_KEY, state.lastLoadedAt);
	} catch {
		// Ignore local storage failures.
	}
	const friendlyStamp = value.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
	if (el.panelSub) {
		el.panelSub.textContent = 'Loaded: ' + friendlyStamp;
	}
}

function markDataLoaded() {
	setLastLoadedTimestamp(new Date());
}

function renderRangeFromPreloadedSnapshot(rangeKey) {
	const snapshot = state.preloadedRangeData && state.preloadedRangeData[normalizeRangeKey(rangeKey)];
	if (!snapshot) {
		return false;
	}
	if (normalizeRangeKey(rangeKey) === 'pastWeek') {
		state.allRecentResultsItems = Array.isArray(snapshot.items) ? snapshot.items.slice() : [];
		state.recentScopeLabel = snapshot.scopeLabel || 'All Sports';
		renderRecentResultsForSelectedScope(state.recentScopeLabel, state.allRecentResultsItems);
		return true;
	}
	state.allUpcomingGames = Array.isArray(snapshot.games) ? snapshot.games.slice() : [];
	state.upcomingVisibleSportCount = Number.isFinite(snapshot.visibleCount) ? snapshot.visibleCount : 5;
	setResultSportOptions(Array.isArray(snapshot.sportOptions) ? snapshot.sportOptions : []);
	renderUpcomingSportBatch();
	return true;
}

function getRangeLabel(rangeKey) {
	const normalizedRange = normalizeRangeKey(rangeKey);
	if (normalizedRange === "pastWeek") {
		return "Results";
	}
	if (normalizedRange === "live") {
		return "Live";
	}
	return "Upcoming";
}

function getStartOfTodayDate() {
	const now = new Date();
	return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function getRangeWindow(rangeKey) {
	const normalizedRange = normalizeRangeKey(rangeKey);
	const startOfToday = getStartOfTodayDate();
	const startOfYesterday = new Date(startOfToday.getTime() - (24 * 60 * 60 * 1000));
	const startOfTomorrow = new Date(startOfToday.getTime() + (24 * 60 * 60 * 1000));
	const endOfToday = new Date(startOfTomorrow.getTime() - 1);
	const now = new Date();
	const startOfPastWindow = new Date(startOfYesterday.getTime());
	const endOfPastWindow = new Date(now.getTime());

	if (normalizedRange === "pastWeek") {
		return { start: startOfPastWindow, end: endOfPastWindow };
	}
	return { start: startOfToday, end: endOfToday };
}

function getRowTimestamp(row) {
	if (!row || typeof row !== 'object') {
		return null;
	}
	const candidates = [
		row.commence_time,
		row.start_time,
		row.start,
		row.scheduled,
		row.date,
		row.begin_at,
		row.last_update,
		row.lastUpdate,
		row.completed_at,
		row.completedAt
	];
	for (const candidate of candidates) {
		if (candidate == null || candidate === '') {
			continue;
		}
		const ts = new Date(candidate).getTime();
		if (Number.isFinite(ts)) {
			return ts;
		}
	}
	return null;
}

function filterPastResults(rows, bufferMs = 0) {
	if (!Array.isArray(rows)) {
		return [];
	}
	const nowMs = Date.now();
	const cutoffMs = Math.max(0, Number(bufferMs) || 0);
	return rows.filter((row) => {
		if (!row || typeof row !== 'object') {
			return false;
		}
		if (isLiveEventRow(row)) {
			return false;
		}
		const ts = getRowTimestamp(row);
		if (Number.isFinite(ts)) {
			return ts <= (nowMs - cutoffMs);
		}
		const hasScoreData = Array.isArray(row.scores) && row.scores.length > 0;
		const hasCompletedFlag = row.completed === true || row.is_completed === true || row.status === 'completed' || row.status === 'final';
		const hasTeams = Boolean(row.home_team && row.away_team);
		return Boolean(hasScoreData || hasCompletedFlag || hasTeams);
	});
}

function isPlaceholderApiKey(value) {
	if (typeof value !== 'string') {
		return false;
	}
	const normalized = value.trim().toLowerCase();
	if (!normalized) {
		return true;
	}
	const blockedPatterns = [
		'demo_key_for_state_check',
		'demo',
		'test',
		'example',
		'placeholder',
		'your_api_key',
		'your api key',
		'not_a_real_key'
	];
	return blockedPatterns.includes(normalized) || normalized.includes('demo_') || normalized.includes('placeholder') || normalized.includes('example');
}

function requireLoginOrRedirect() {
	const candidates = [];
	try {
		const value = localStorage.getItem(STORAGE_KEY) || '';
		candidates.push(value);
		if (isPlaceholderApiKey(value)) {
			localStorage.removeItem(STORAGE_KEY);
		}
	} catch {
		candidates.push('');
	}
	try {
		const value = sessionStorage.getItem(STORAGE_KEY) || '';
		candidates.push(value);
		if (isPlaceholderApiKey(value)) {
			sessionStorage.removeItem(STORAGE_KEY);
		}
	} catch {
		candidates.push('');
	}

	let legacyApiKey = '';
	try {
		const rawLegacy = localStorage.getItem(LEGACY_STORAGE_KEY);
		if (rawLegacy) {
			const parsed = JSON.parse(rawLegacy);
			if (parsed && typeof parsed.oddsApiKey === 'string') {
				legacyApiKey = parsed.oddsApiKey;
			}
		}
		if (isPlaceholderApiKey(legacyApiKey)) {
			localStorage.removeItem(LEGACY_STORAGE_KEY);
			legacyApiKey = '';
		}
	} catch {
		legacyApiKey = '';
	}
	candidates.push(legacyApiKey);

	const apiKey = candidates
		.map((value) => (typeof value === 'string' ? value.trim() : ''))
		.filter((value) => value.length > 0 && !isPlaceholderApiKey(value))
		[0] || '';
	if (!apiKey.trim()) {
		if (typeof openApiKeyModal === 'function') {
			openApiKeyModal();
		}
		if (typeof setStatus === 'function') {
			setStatus('No valid API key found. Add your Odds API key to continue.', 'error');
		}
		return null;
	}
	return apiKey.trim();
}

function openApiKeyModal() {
	syncApiKeyModalMode();
	if (el.apiKeyInput) {
		el.apiKeyInput.value = isLoginMode() ? "" : state.apiKey || "";
	}
	syncApiKeySubmitButtonState();
	el.apiKeyModal.classList.add("is-open");
	if (isLoginMode() && el.apiKeyInput) {
		window.setTimeout(() => el.apiKeyInput.focus(), 40);
	}
}

function closeApiKeyModal() {
	if (isLoginMode()) {
		return;
	}
	el.apiKeyModal.classList.remove("is-open");
	el.apiKeyInput.value = "";
}

function saveApiKeySettings() {
	const nextKey = (el.apiKeyInput.value || "").trim();
	if (!nextKey) {
		setStatus("API key cannot be empty.", "error");
		el.apiKeyInput.focus();
		return;
	}
	if (isPlaceholderApiKey(nextKey)) {
		setStatus("Please enter a real Odds API key. The placeholder value is not valid.", "error");
		el.apiKeyInput.focus();
		return;
	}

	if (state.apiKey === nextKey) {
		syncApiKeyModalMode();
		closeApiKeyModal();
		setStatus("API key already saved.", "ok");
		return;
	}

	state.apiKey = nextKey;
	state.savedSports = loadSavedSports();
	syncApiKeyModalMode();
	syncCatalogScopeButtons();
	try {
		localStorage.setItem(STORAGE_KEY, nextKey);
		sessionStorage.setItem(STORAGE_KEY, nextKey);
	} catch {
		// Ignore storage failures.
	}
	closeApiKeyModal();
	setStatus("API key saved.", "ok");
	if (state.view === "catalog") {
		loadSportsCatalog(nextKey);
	} else if (state.activeSportKey) {
		if (state.timeRange === "pastWeek") {
			loadRecentResultsForSport(state.activeSportKey, nextKey);
		} else {
			loadUpcomingForSport(state.activeSportKey, nextKey);
		}
	} else if (state.timeRange === "pastWeek") {
		loadRecentResultsForSelectedScope(nextKey);
	} else {
		loadAllSportsUpcoming(nextKey);
	}
	preloadAllRangeViews(nextKey);
}

function setRangeSelection(rangeKey) {
	const normalizedRange = normalizeRangeKey(rangeKey);
	if (!state.rangeButtonsEnabled || state.rangeLoading) {
		return;
	}
	if (state.timeRangeSelected && state.timeRange === normalizedRange) {
		return;
	}
	if (!state.apiKey) {
		openApiKeyModal();
		setStatus('No API key found. Add your Odds API key to continue.', 'error');
		return;
	}
	state.timeRange = normalizedRange;
	state.timeRangeSelected = true;
	saveRangeSelection(normalizedRange);
	if (normalizedRange === 'pastWeek') {
		if (state.activeSportKey) {
			loadRecentResultsForSport(state.activeSportKey, state.apiKey);
			return;
		}
		loadRecentResultsForSelectedScope(state.apiKey);
		return;
	}
	if (normalizedRange === 'live') {
		if (state.activeSportKey) {
			loadUpcomingForSport(state.activeSportKey, state.apiKey);
			return;
		}
		loadAllSportsUpcoming(state.apiKey);
		return;
	}
	if (state.activeSportKey) {
		loadUpcomingForSport(state.activeSportKey, state.apiKey);
		return;
	}
	loadAllSportsUpcoming(state.apiKey);
}

async function preloadAllRangeViews(apiKey) {
	if (!apiKey) {
		return;
	}
	try {
		const sportRows = Array.isArray(state.sportsRows) ? state.sportsRows : [];
		if (!sportRows.length) {
			await loadSportsCatalog(apiKey);
		}
		const rows = getScopedSportsForLoading();
		const liveSnapshot = { games: [], sportOptions: [], visibleCount: 5, loadedAt: new Date().toISOString() };
		const recentSnapshot = { items: [], scopeLabel: state.catalogScope === 'favorites' ? 'Favourites' : 'All Sports', loadedAt: new Date().toISOString() };
		if (rows.length) {
			const liveGames = [];
			const recentItems = [];
			const favoriteScopeTitles = Array.from(new Set(rows.map((sport) => sport && sport.title ? String(sport.title).trim() : '').filter(Boolean))).sort((a, b) => a.localeCompare(b));
			for (const sport of rows) {
				const sportKey = sport && sport.key ? String(sport.key) : '';
				if (!sportKey) {
					continue;
				}
				try {
					const eventsUrl = BASE_URL + '/sports/' + encodeURIComponent(sportKey) + '/events/?apiKey=' + encodeURIComponent(apiKey) + '&dateFormat=iso';
					const oddsUrl = BASE_URL + '/sports/' + encodeURIComponent(sportKey) + '/odds/?apiKey=' + encodeURIComponent(apiKey) + '&bookmakers=sportsbet&regions=au,us,uk,eu&markets=h2h&oddsFormat=decimal&dateFormat=iso';
					const historyUrl = BASE_URL + '/sports/' + encodeURIComponent(sportKey) + '/scores/?apiKey=' + encodeURIComponent(apiKey) + '&daysFrom=' + HISTORY_LOOKBACK_DAYS + '&dateFormat=iso';
					const [eventResponse, oddsResponse, historyResponse] = await Promise.all([fetch(eventsUrl), fetch(oddsUrl), fetch(historyUrl)]);
					const eventPayload = eventResponse.ok ? await eventResponse.json() : [];
					const oddsPayload = oddsResponse.ok ? await oddsResponse.json() : [];
					const historyPayload = historyResponse.ok ? await historyResponse.json() : [];
					const oddsByEventId = buildOddsByEventId(Array.isArray(oddsPayload) ? oddsPayload : []);
					const mergedHistoryRows = mergeRollingHistoryRows(readCache('rolling_history_' + sportKey), Array.isArray(historyPayload) ? historyPayload : []);
					writeCache('rolling_history_' + sportKey, mergedHistoryRows);
					const historyMap = buildTeamHistoryMap(mergedHistoryRows);
					const liveFiltered = getRowsForSelectedRange(Array.isArray(eventPayload) ? eventPayload : [], 'live', getRangeWindow('live'), Array.isArray(historyPayload) ? historyPayload : []);
					for (const eventRow of liveFiltered) {
						const eventId = eventRow && eventRow.id ? String(eventRow.id) : '';
						const prediction = getPredictionForEvent(eventRow, eventId ? oddsByEventId[eventId] : null, historyMap, sportKey);
						if (!matchesWinRateFilter(prediction)) {
							continue;
						}
						liveGames.push({
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
					const recentRows = Array.isArray(historyPayload) ? historyPayload : [];
					const completedRows = filterPastResults(recentRows, GAME_START_BUFFER_MS);
					for (const row of completedRows.slice(0, 7)) {
						const eventId = row && row.id ? String(row.id) : '';
						const oddsRow = eventId ? oddsByEventId[eventId] || null : null;
						const prediction = getPredictionForEvent(row, oddsRow, historyMap, sportKey);
						if (!prediction || !prediction.predictedTeam) {
							recentItems.push({ sportKey, sportTitle: sport.title ? String(sport.title) : sportKey, start: row && row.commence_time ? String(row.commence_time) : '', row, oddsRow, historyMap, prediction: prediction || null });
							continue;
						}
						if (!matchesWinRateFilter(prediction)) {
							continue;
						}
						recentItems.push({ sportKey, sportTitle: sport.title ? String(sport.title) : sportKey, start: row && row.commence_time ? String(row.commence_time) : '', row, oddsRow, historyMap, prediction });
					}
				} catch {
					continue;
				}
			}
			const sportsForBar = favoriteScopeTitles.length
				? favoriteScopeTitles
				: Array.from(new Set(liveGames.map((item) => String(item.sportTitle || item.sportKey || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
			liveSnapshot.games = liveGames;
			liveSnapshot.sportOptions = sportsForBar;
			liveSnapshot.visibleCount = sportsForBar.length || 5;
			recentSnapshot.items = recentItems;
			recentSnapshot.scopeLabel = state.catalogScope === 'favorites' ? 'Favourites' : 'All Sports';
		}
		state.preloadedRangeData = {
			today: liveSnapshot,
			live: liveSnapshot,
			pastWeek: recentSnapshot
		};
		setLastLoadedTimestamp(new Date());
		if (state.view === 'catalog' && state.apiKey) {
			const savedRange = getSavedRangeSelection();
			if (savedRange === 'pastWeek' || savedRange === 'live' || savedRange === 'today') {
				state.timeRange = savedRange;
				state.timeRangeSelected = true;
				syncRangeButtons();
				renderRangeFromPreloadedSnapshot(savedRange);
			}
		}
	} catch {
		// Ignore preloading failures and allow the normal on-demand loaders to recover.
	}
}
