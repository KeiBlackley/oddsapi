// --- App state, UI coordination and persisted view state ---
const el = {
	infoBtn: document.getElementById("infoBtn"),
	settingsBtn: document.getElementById("settingsBtn"),
	apiKeyModal: document.getElementById("apiKeyModal"),
	apiKeyModalTitle: document.getElementById("apiKeyModalTitle"),
	modalCloseBtn: document.querySelector('.modal-close'),
	predictionInfoModal: document.getElementById("predictionInfoModal"),
	predictionInfoModalTitle: document.getElementById("predictionInfoModalTitle"),
	predictionInfoModalCloseBtn: document.querySelector('.prediction-info-modal .modal-close'),
	logoutConfirmModal: document.getElementById("logoutConfirmModal"),
	cancelLogoutBtn: document.getElementById("cancelLogoutBtn"),
	confirmLogoutBtn: document.getElementById("confirmLogoutBtn"),
	apiKeyLabel: document.querySelector('label[for="apiKeyInput"]'),
	savedApiKeySelect: document.getElementById("savedApiKeySelect"),
	apiKeyInput: document.getElementById("apiKeyInput"),
	swapApiKeyBtn: document.getElementById("swapApiKeyBtn"),
	clearHistoryCacheBtn: document.getElementById("clearHistoryCacheBtn"),
	cancelApiKeyBtn: document.getElementById("cancelApiKeyBtn"),
	saveApiKeyBtn: document.getElementById("saveApiKeyBtn"),
	resultsSportScopeSelect: document.getElementById("resultsSportScopeSelect"),
	resultsSportScopeLabel: document.getElementById("resultsSportScopeLabel"),
	gameFilterGroup: document.getElementById("gameFilterGroup"),
	secureModeToggleBtn: document.getElementById("secureModeToggleBtn"),
	settingsPanel: document.querySelector('.settings-panel'),
	pageTitle: document.getElementById("pageTitle"),
	panelSub: document.getElementById("panelSub"),
	authStatusBtn: document.getElementById("authStatusBtn"),
	backBtn: document.getElementById("backBtn"),
	refreshFeedBtn: document.getElementById("refreshFeedBtn"),
	logoutBtn: document.getElementById("logoutBtn"),
	status: document.getElementById("status"),
	sportsSearchInput: document.getElementById("sportsSearchInput"),
	searchToggleBtn: document.getElementById("searchToggleBtn"),
	globalLoadingOverlay: document.getElementById("globalLoadingOverlay"),
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
	savedApiKeys: [],
	secureMode: true,
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
	upcomingSavedSportsShowTomorrow: false,
	upcomingSavedSportsShowDayAfter: false,
	allRecentResultsItems: [],
	recentScopeLabel: '',
	recentResultsLookbackDays: 1,
	backtestTrendWindow: 5,
	resultSportOptions: [],
	resultSportFilter: 'all',
	pendingResultSportFilter: '',
	favoriteFlash: null,
	favoriteFlashTimerId: null,
	searchBarExpanded: false,
	apiKeyLogoutConfirmArmed: false,
	rangeButtonsEnabled: false,
	timeRangeSelected: false,
	winRateFilter: 'all',
	gameFilters: {
		positiveEv: false,
		greenWinRate: false,
		positiveEdge: false
	},
	exampleStake: 100,
	rangeLoading: false,
	preloadedRangeData: {
		today: null,
		live: null,
		pastWeek: null
	},
	lastLoadedAt: null,
	lastLoadCreditCost: 0,
	activeLoadingToken: 0,
	settingsModalCloseTimerId: null,
	statusHideTimerId: null,
	busyOverlayCount: 0,
	upcomingBePickLimit: 24,
	isInitialHydration: false
};

function beginTrackedLoading(creditCost = 0) {
	state.activeLoadingToken = Math.max(0, Number(state.activeLoadingToken) || 0) + 1;
	state.lastLoadCreditCost = Math.max(0, Math.trunc(Number(creditCost) || 0));
	return state.activeLoadingToken;
}

function isTrackedLoadingCurrent(token) {
	return Number(token) > 0 && Number(token) === Number(state.activeLoadingToken);
}

function cancelTrackedLoading(exitMessage = 'Exit loading screen.') {
	state.activeLoadingToken = Math.max(0, Number(state.activeLoadingToken) || 0) + 1;
	state.rangeLoading = false;
	state.busyOverlayCount = 0;
	if (el.globalLoadingOverlay) {
		el.globalLoadingOverlay.classList.remove('is-visible');
		el.globalLoadingOverlay.setAttribute('aria-hidden', 'true');
	}
	if (typeof syncRangeButtons === 'function') {
		syncRangeButtons();
	}
	setStatus(String(exitMessage || 'Exit loading screen.'), 'error');
}

function beginBusyOverlay() {
	if (!el.globalLoadingOverlay) {
		return;
	}
	state.busyOverlayCount = Math.max(0, Number(state.busyOverlayCount) || 0) + 1;
	el.globalLoadingOverlay.classList.add('is-visible');
	el.globalLoadingOverlay.setAttribute('aria-hidden', 'false');
}

function endBusyOverlay() {
	if (!el.globalLoadingOverlay) {
		return;
	}
	state.busyOverlayCount = Math.max(0, (Number(state.busyOverlayCount) || 0) - 1);
	if (state.busyOverlayCount > 0) {
		return;
	}
	el.globalLoadingOverlay.classList.remove('is-visible');
	el.globalLoadingOverlay.setAttribute('aria-hidden', 'true');
}

function normalizeSportKey(value) {
	return String(value || '').trim().toLowerCase();
}

function clampText(value, maxLength = MAX_SEARCH_INPUT_LENGTH) {
	const normalized = String(value || '');
	if (!Number.isFinite(Number(maxLength)) || Number(maxLength) <= 0) {
		return normalized;
	}
	return normalized.slice(0, Math.trunc(Number(maxLength)));
}

function normalizeApiKeyInput(value) {
	return clampText(String(value || '').trim(), MAX_API_KEY_LENGTH);
}

function readSecureModeSetting() {
	// Secure mode is always enforced in this application.
	return true;
}

function persistSecureModeSetting() {
	try {
		localStorage.setItem(SECURE_MODE_KEY, '1');
	} catch {
		// Ignore storage failures for secure mode preference.
	}
}

function applySecureModeStoragePolicy() {
	if (state.secureMode !== true) {
		return;
	}
	try {
		localStorage.removeItem(STORAGE_KEY);
		localStorage.removeItem(LEGACY_STORAGE_KEY);
		localStorage.removeItem(SAVED_API_KEYS_KEY);
	} catch {
		// Ignore storage cleanup failures.
	}
	if (state.apiKey) {
		try {
			sessionStorage.setItem(STORAGE_KEY, state.apiKey);
		} catch {
			// Ignore session persistence failures.
		}
	}
	state.savedApiKeys = [];
}

function syncSecureModeButton() {
	if (!el.secureModeToggleBtn) {
		return;
	}
	const enabled = state.secureMode === true;
	el.secureModeToggleBtn.classList.toggle('is-active', enabled);
	el.secureModeToggleBtn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
	el.secureModeToggleBtn.innerHTML = enabled
		? '<i class="fa-solid fa-shield-halved" aria-hidden="true"></i>Secure Mode: On'
		: '<i class="fa-solid fa-shield-halved" aria-hidden="true"></i>Secure Mode: Off';
}

function setSecureMode(enabled) {
	const shouldEnable = Boolean(enabled);
	if (state.secureMode === shouldEnable) {
		syncSecureModeButton();
		syncApiKeyModalMode();
		persistRefreshViewState();
		return;
	}
	persistSecureModeSetting();
	if (shouldEnable) {
		applySecureModeStoragePolicy();
		setStatus('Secure mode enabled. API key now uses session-only storage.', 'ok');
	}
	syncSavedApiKeySelect();
	syncSecureModeButton();
	syncApiKeyModalMode();
	persistRefreshViewState();
}

function toggleSecureMode() {
	setSecureMode(!(state.secureMode === true));
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
	const panelTools = el.sportsSearchInput.closest('.panel-head-tools');
	if (panelTools) {
		panelTools.classList.toggle('is-collapsed', state.searchBarExpanded === false);
	}
	const isCollapsed = state.searchBarExpanded === false;
	if (el.searchToggleBtn) {
		el.searchToggleBtn.classList.remove('hidden');
		el.searchToggleBtn.setAttribute('aria-pressed', isCollapsed ? 'false' : 'true');
		el.searchToggleBtn.title = isCollapsed ? 'Open search bar' : 'Close search bar';
		el.searchToggleBtn.setAttribute('aria-label', isCollapsed ? 'Open search bar' : 'Close search bar');
	}
	el.sportsSearchInput.disabled = isCollapsed;
	el.sportsSearchInput.setAttribute('tabindex', isCollapsed ? '-1' : '0');
}

function syncBackButtonMode() {
	if (!el.backBtn) {
		return;
	}
	const icon = el.backBtn.querySelector('i');
	if (!(icon instanceof HTMLElement)) {
		return;
	}

	const isCatalogView = state.view === 'catalog';
	if (isCatalogView) {
		const favoritesOnly = state.catalogScope === 'favorites';
		el.backBtn.classList.remove('hidden');
		el.backBtn.classList.add('catalog-favorite-toggle');
		el.backBtn.setAttribute('data-catalog-target', favoritesOnly ? 'all' : 'favorites');
		el.backBtn.setAttribute('aria-pressed', favoritesOnly ? 'true' : 'false');
		el.backBtn.setAttribute('aria-label', favoritesOnly ? 'Show all sports' : 'Show favourites only');
		el.backBtn.title = favoritesOnly ? 'Show all sports' : 'Show favourites only';
		icon.className = favoritesOnly ? 'fa-solid fa-star' : 'fa-solid fa-futbol';
		return;
	}

	el.backBtn.classList.remove('catalog-favorite-toggle');
	el.backBtn.removeAttribute('data-catalog-target');
	el.backBtn.classList.remove('hidden');
	el.backBtn.setAttribute('aria-pressed', 'false');
	el.backBtn.setAttribute('aria-label', 'Sports catalog');
	el.backBtn.title = 'Sports catalog';
	icon.className = 'fa-solid fa-futbol';
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
				state.activeUpcomingSportData.historyMap || null,
				{ showTomorrow: state.activeUpcomingSportData.showTomorrow === true }
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
	if (key.length <= 4) {
		return '*'.repeat(key.length);
	}
	return '*'.repeat(Math.max(0, key.length - 4)) + key.slice(-4);
}

function readSavedApiKeys() {
	if (state.secureMode === true) {
		return [];
	}
	try {
		const raw = localStorage.getItem(SAVED_API_KEYS_KEY);
		if (!raw) {
			return [];
		}
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) {
			return [];
		}
		const normalized = parsed
			.map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
			.filter((entry) => entry && !isPlaceholderApiKey(entry));
		return Array.from(new Set(normalized));
	} catch {
		return [];
	}
}

function persistSavedApiKeys(nextKeys) {
	if (state.secureMode === true) {
		state.savedApiKeys = [];
		return;
	}
	const normalized = Array.from(new Set((Array.isArray(nextKeys) ? nextKeys : [])
		.map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
		.filter((entry) => entry && !isPlaceholderApiKey(entry))))
		.slice(0, MAX_SAVED_API_KEYS);
	state.savedApiKeys = normalized;
	try {
		localStorage.setItem(SAVED_API_KEYS_KEY, JSON.stringify(normalized));
	} catch {
		// Ignore local storage failures for non-critical saved key list.
	}
}

function addSavedApiKey(nextKey) {
	if (state.secureMode === true) {
		return;
	}
	const normalized = normalizeApiKeyInput(nextKey);
	if (!normalized || isPlaceholderApiKey(normalized)) {
		return;
	}
	const merged = [normalized].concat(Array.isArray(state.savedApiKeys) ? state.savedApiKeys : []);
	persistSavedApiKeys(merged);
}

function syncSavedApiKeySelect() {
	if (!el.savedApiKeySelect) {
		return;
	}
	if (state.secureMode === true) {
		el.savedApiKeySelect.innerHTML = '<option value="">Saved keys disabled in Secure Mode</option>';
		el.savedApiKeySelect.classList.add('hidden');
		el.savedApiKeySelect.value = '';
		return;
	}
	const keys = Array.isArray(state.savedApiKeys) ? state.savedApiKeys : [];
	const options = ['<option value="">Choose a saved API key</option>'].concat(keys.map((key) => {
		return '<option value="' + escapeHtml(key) + '">' + escapeHtml(maskApiKey(key)) + '</option>';
	}));
	el.savedApiKeySelect.innerHTML = options.join('');
	const hasSavedKeys = keys.length > 0;
	el.savedApiKeySelect.classList.toggle('hidden', !isLoginMode() || !hasSavedKeys);
	if (!hasSavedKeys) {
		el.savedApiKeySelect.value = '';
	}
}

function syncApiKeySubmitButtonState() {
	if (!el.saveApiKeyBtn) {
		return;
	}
	if (!isLoginMode()) {
		el.saveApiKeyBtn.disabled = true;
		el.saveApiKeyBtn.classList.add('hidden');
		return;
	}
	el.saveApiKeyBtn.classList.remove('hidden');
	const hasInput = Boolean(el.apiKeyInput && String(el.apiKeyInput.value || '').trim());
	el.saveApiKeyBtn.disabled = !hasInput;
}

function readGameFilters() {
	try {
		const raw = localStorage.getItem(GAME_FILTERS_KEY);
		if (!raw) {
			return {
				positiveEv: false,
				greenWinRate: false,
				positiveEdge: false
			};
		}
		const parsed = JSON.parse(raw);
		return {
			positiveEv: Boolean(parsed && parsed.positiveEv),
			greenWinRate: Boolean(parsed && parsed.greenWinRate),
			positiveEdge: Boolean(parsed && parsed.positiveEdge)
		};
	} catch {
		return {
			positiveEv: false,
			greenWinRate: false,
			positiveEdge: false
		};
	}
}

function persistGameFilters() {
	try {
		localStorage.setItem(GAME_FILTERS_KEY, JSON.stringify({
			positiveEv: Boolean(state.gameFilters && state.gameFilters.positiveEv),
			greenWinRate: Boolean(state.gameFilters && state.gameFilters.greenWinRate),
			positiveEdge: Boolean(state.gameFilters && state.gameFilters.positiveEdge)
		}));
	} catch {
		// Ignore storage failures for non-critical UI filters.
	}
}

function syncGameFilterButtons() {
	const group = el.gameFilterGroup;
	if (!group) {
		return;
	}
	const buttons = group.querySelectorAll('[data-game-filter]');
	buttons.forEach((button) => {
		const key = button.getAttribute('data-game-filter') || '';
		const isActive = Boolean(state.gameFilters && state.gameFilters[key]);
		button.classList.toggle('is-active', isActive);
		button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
	});
}

function setGameFilterToggle(key, enabled) {
	if (!state.gameFilters || typeof state.gameFilters !== 'object') {
		state.gameFilters = { positiveEv: false, greenWinRate: false, positiveEdge: false };
	}
	if (key !== 'positiveEv' && key !== 'greenWinRate' && key !== 'positiveEdge') {
		return;
	}
	state.gameFilters[key] = Boolean(enabled);
	persistGameFilters();
	syncGameFilterButtons();
	rerenderActiveResultsView();
}

function hasActiveGameFilters() {
	return Boolean(state.gameFilters && (state.gameFilters.positiveEv || state.gameFilters.greenWinRate || state.gameFilters.positiveEdge));
}

function syncApiKeyModalMode() {
	const loginMode = isLoginMode();
	document.body.classList.toggle('auth-locked', loginMode);
	if (el.authStatusBtn) {
		el.authStatusBtn.classList.toggle('hidden', loginMode);
	}
	if (el.apiKeyModal) {
		el.apiKeyModal.classList.toggle('fullscreen-login', loginMode);
	}

	if (el.apiKeyModalTitle) {
		el.apiKeyModalTitle.textContent = loginMode ? 'Login' : 'API Key Settings';
	}
	if (el.apiKeyLabel) {
		el.apiKeyLabel.textContent = loginMode ? 'Please enter your API key..' : 'Odds API key';
	}
	syncSavedApiKeySelect();
	if (el.saveApiKeyBtn) {
		el.saveApiKeyBtn.innerHTML = loginMode
			? '<i class="fa-solid fa-arrow-right" aria-hidden="true"></i>Continue'
			: '<i class="fa-solid fa-floppy-disk" aria-hidden="true"></i>Save';
		el.saveApiKeyBtn.classList.toggle('hidden', !loginMode);
		el.saveApiKeyBtn.disabled = !loginMode;
	}
	if (el.apiKeyInput) {
		el.apiKeyInput.classList.toggle('hidden', false);
		el.apiKeyInput.type = loginMode ? 'password' : 'text';
		el.apiKeyInput.value = loginMode ? '' : maskApiKey(state.apiKey);
		el.apiKeyInput.disabled = !loginMode;
		el.apiKeyInput.readOnly = !loginMode;
	}
	if (el.swapApiKeyBtn) {
		el.swapApiKeyBtn.classList.toggle('hidden', loginMode);
		el.swapApiKeyBtn.innerHTML = '<i class="fa-solid fa-right-from-bracket" aria-hidden="true"></i>';
		el.swapApiKeyBtn.title = 'Sign out';
		el.swapApiKeyBtn.setAttribute('aria-label', 'Sign out');
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
	if (el.secureModeToggleBtn) {
		el.secureModeToggleBtn.classList.toggle('hidden', loginMode);
	}
	syncSecureModeButton();
	syncApiKeySubmitButtonState();
	syncSearchInputMode();
}

function syncSettingsModalPageShiftState() {
	if (!el.apiKeyModal) {
		document.body.style.setProperty('--page-shift-x', '0px');
		return;
	}
	if (isLoginMode()) {
		el.apiKeyModal.style.display = 'flex';
		document.body.style.setProperty('--page-shift-x', '0px');
		return;
	}
	const modalIsOpen = el.apiKeyModal.classList.contains('is-open');
	const modalIsClosing = el.apiKeyModal.classList.contains('is-closing');
	const shouldKeepModalShiftState = modalIsOpen || modalIsClosing;
	if (!shouldKeepModalShiftState) {
		el.apiKeyModal.style.display = 'none';
		document.body.style.setProperty('--page-shift-x', '0px');
		return;
	}
	if (modalIsClosing) {
		el.apiKeyModal.style.display = 'flex';
		document.body.style.setProperty('--page-shift-x', '0px');
		return;
	}
	el.apiKeyModal.style.display = 'flex';
	const modalCard = el.apiKeyModal.querySelector('.modal-card');
	const cardWidth = modalCard instanceof HTMLElement ? modalCard.getBoundingClientRect().width : 0;
	const viewportWidth = window.innerWidth || 0;
	const preferredShift = Math.max(180, Math.min(cardWidth * 0.68, 260));
	const maxAllowedShift = Math.max(0, viewportWidth - 560);
	const shiftPx = Math.max(0, Math.min(preferredShift, maxAllowedShift));
	document.body.style.setProperty('--page-shift-x', '-' + shiftPx.toFixed(0) + 'px');
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

function getSportKeyByTitle(title) {
	const needle = String(title || '').trim().toLowerCase();
	if (!needle) {
		return '';
	}
	for (const row of Array.isArray(state.sportsRows) ? state.sportsRows : []) {
		const rowTitle = getSportDisplayTitle(row).toLowerCase();
		if (rowTitle !== needle) {
			continue;
		}
		return row && row.key ? String(row.key).trim() : '';
	}
	return '';
}

function getActiveSportTitle() {
	const activeKey = String(state.activeSportKey || '').trim();
	if (!activeKey) {
		return '';
	}
	const activeRow = state.sportsByKey && state.sportsByKey[activeKey] ? state.sportsByKey[activeKey] : null;
	const fromRow = getSportDisplayTitle(activeRow);
	if (fromRow) {
		return fromRow;
	}
	if (Array.isArray(state.allUpcomingGames) && state.allUpcomingGames.length) {
		const hit = state.allUpcomingGames.find((item) => String(item && item.sportKey ? item.sportKey : '').trim() === activeKey);
		if (hit && hit.sportTitle) {
			return String(hit.sportTitle).trim();
		}
	}
	if (Array.isArray(state.allRecentResultsItems) && state.allRecentResultsItems.length) {
		const hit = state.allRecentResultsItems.find((item) => String(item && item.sportKey ? item.sportKey : '').trim() === activeKey);
		if (hit && hit.sportTitle) {
			return String(hit.sportTitle).trim();
		}
	}
	return activeKey;
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
	const allButton = '<button class="control-btn sport-filter-btn ' + (state.resultSportFilter === 'all' ? 'is-active' : '') + '" type="button" data-result-sport="all" aria-pressed="' + (state.resultSportFilter === 'all' ? 'true' : 'false') + '"><i class="fa-solid fa-globe" aria-hidden="true"></i>All Sports</button>';
	const sportButtons = state.resultSportOptions.map((sportTitle) => {
		const isActive = state.resultSportFilter === sportTitle;
		return '<button class="control-btn sport-filter-btn ' + (isActive ? 'is-active' : '') + '" type="button" data-result-sport="' + escapeHtml(sportTitle) + '" aria-pressed="' + (isActive ? 'true' : 'false') + '"><i class="fa-solid fa-tag" aria-hidden="true"></i>' + escapeHtml(sportTitle) + '</button>';
	}).join('');
	el.sportFilterButtons.innerHTML = allButton + sportButtons;
}

function getCatalogScopeLabel(scopeKey = state.catalogScope) {
	return scopeKey === 'favorites' ? 'Favourites' : 'All Sports';
}

function syncResultsSportScopeDropdown() {
	if (el.resultsSportScopeLabel) {
		el.resultsSportScopeLabel.textContent = 'Results sport scope (' + getCatalogScopeLabel() + ')';
	}

	if (!el.resultsSportScopeSelect) {
		return;
	}

	const select = el.resultsSportScopeSelect;
	const optionTitles = Array.isArray(state.resultSportOptions) ? state.resultSportOptions : [];
	const fallbackTitles = [];
	if (!optionTitles.length) {
		const favoriteKeys = new Set((Array.isArray(state.savedSports) ? state.savedSports : []).map((key) => normalizeSportKey(key)));
		const seen = new Set();
		for (const row of Array.isArray(state.sportsRows) ? state.sportsRows : []) {
			const title = getSportDisplayTitle(row);
			const key = row && row.key ? String(row.key).trim() : '';
			const normalizedKey = normalizeSportKey(key || title);
			if (!title || seen.has(title)) {
				continue;
			}
			seen.add(title);
			if (state.catalogScope === 'favorites' && !favoriteKeys.has(normalizedKey)) {
				continue;
			}
			fallbackTitles.push(title);
		}
	}

	const sortedTitles = (optionTitles.length ? optionTitles.slice() : fallbackTitles.slice()).sort((a, b) => a.localeCompare(b));
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
		group.label = getCatalogScopeLabel();
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
	select.disabled = false;
	const activeSportTitle = getActiveSportTitle();
	if (activeSportTitle && !Array.from(select.options).some((option) => option.value === activeSportTitle)) {
		const dynamicOption = document.createElement('option');
		dynamicOption.value = activeSportTitle;
		dynamicOption.textContent = activeSportTitle;
		select.appendChild(dynamicOption);
	}

	if (activeSportTitle) {
		select.value = activeSportTitle;
		return;
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
	if (state.pendingResultSportFilter && state.resultSportOptions.includes(state.pendingResultSportFilter)) {
		state.resultSportFilter = state.pendingResultSportFilter;
		state.pendingResultSportFilter = '';
	}
	if (state.resultSportFilter !== 'all' && !state.resultSportOptions.includes(state.resultSportFilter)) {
		state.resultSportFilter = 'all';
	}
	syncResultSportFilterBar();
	syncResultsSportScopeDropdown();
}

function setResultSportFilter(value) {
	const next = normalizeSportFilterValue(value);
	const isDetailView = state.view === 'upcoming' || state.view === 'recent';
	const hasActiveSport = Boolean(String(state.activeSportKey || '').trim());
	const nextSportKey = next === 'all' ? '' : getSportKeyByTitle(next);

	if (next !== 'all' && nextSportKey && (hasActiveSport || !state.resultSportOptions.includes(next))) {
		state.pendingResultSportFilter = '';
		state.resultSportFilter = 'all';
		state.activeSportKey = nextSportKey;
		syncResultSportFilterBar();
		syncResultsSportScopeDropdown();
		if (isDetailView) {
			if (state.view === 'recent') {
				loadRecentResultsForSport(nextSportKey, state.apiKey);
			} else {
				loadUpcomingForSport(nextSportKey, state.apiKey);
			}
		}
		persistRefreshViewState();
		return;
	}

	if (String(state.activeSportKey || '').trim()) {
		if (next === 'all') {
			state.pendingResultSportFilter = '';
			state.resultSportFilter = 'all';
			state.activeSportKey = '';
			syncResultSportFilterBar();
			syncResultsSportScopeDropdown();
			if (state.view === 'recent') {
				loadRecentResultsForSelectedScope(state.apiKey);
			} else {
				loadAllSportsUpcoming(state.apiKey);
			}
			persistRefreshViewState();
			return;
		}
		const nextSportKey = getSportKeyByTitle(next);
		if (!nextSportKey) {
			state.pendingResultSportFilter = next;
			syncResultsSportScopeDropdown();
			persistRefreshViewState();
			return;
		}
		state.pendingResultSportFilter = '';
		state.resultSportFilter = 'all';
		state.activeSportKey = nextSportKey;
		syncResultSportFilterBar();
		syncResultsSportScopeDropdown();
		if (state.view === 'recent') {
			loadRecentResultsForSport(nextSportKey, state.apiKey);
		} else {
			loadUpcomingForSport(nextSportKey, state.apiKey);
		}
		persistRefreshViewState();
		return;
	}
	if (next !== 'all' && !state.resultSportOptions.includes(next)) {
		state.pendingResultSportFilter = next;
		syncResultsSportScopeDropdown();
		persistRefreshViewState();
		return;
	}
	state.pendingResultSportFilter = '';
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
	persistRefreshViewState();
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
	// Update only the affected row's star button to avoid a full re-render losing saved state.
	const affectedStar = el.tableWrap
		? el.tableWrap.querySelector('.star-btn[data-star-key="' + normalizedKey + '"]')
		: null;
	if (affectedStar instanceof HTMLElement) {
		affectedStar.classList.toggle('active', flashType === 'saved');
		affectedStar.classList.toggle('remove-btn', flashType === 'saved');
		if (state.catalogScope === 'favorites') {
			renderSportsTable(state.sportsRows);
		}
	} else {
		renderSportsTable(state.sportsRows);
	}
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

function syncShortcutBarState() {
	const bar = document.getElementById('desktopShortcutBar');
	if (!bar) { return; }
	bar.querySelectorAll('.shortcut-chip.is-current').forEach(function(c) { c.classList.remove('is-current'); });
	const scopeKey = state.catalogScope === 'favorites' ? 'F' : 'A';
	const scopeChip = bar.querySelector('[data-shortcut-key="' + scopeKey + '"]');
	if (scopeChip) { scopeChip.classList.add('is-current'); }
	if (state.view === 'recent' || (state.timeRangeSelected && state.timeRange === 'pastWeek')) {
		const chip = bar.querySelector('[data-shortcut-key="R"]');
		if (chip) { chip.classList.add('is-current'); }
	} else if (state.timeRangeSelected && normalizeRangeKey(state.timeRange) === 'live') {
		const chip = bar.querySelector('[data-shortcut-key="L"]');
		if (chip) { chip.classList.add('is-current'); }
	} else if (state.timeRangeSelected && normalizeRangeKey(state.timeRange) === 'today') {
		const chip = bar.querySelector('[data-shortcut-key="U"]');
		if (chip) { chip.classList.add('is-current'); }
	}
}

function syncRangeButtons() {
	const rangeIconByKey = {
		pastWeek: 'fa-clock-rotate-left',
		live: 'fa-satellite-dish',
		today: 'fa-calendar-day'
	};
	const rangeLabelByKey = {
		pastWeek: 'Results',
		live: 'Live',
		today: 'Upcoming'
	};
	const buttons = document.querySelectorAll('.range-btn');
	buttons.forEach((button) => {
		const rangeKey = button.getAttribute('data-range') || 'today';
		const iconClass = rangeIconByKey[rangeKey] || 'fa-sliders';
		const label = rangeLabelByKey[rangeKey] || String(rangeKey || 'Range');
		button.innerHTML = '<i class="fa-solid ' + iconClass + '" aria-hidden="true"></i>' + escapeHtml(label);
		const isActive = state.rangeButtonsEnabled && state.timeRangeSelected && button.getAttribute('data-range') === state.timeRange;
		button.classList.toggle('is-active', isActive);
		button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
		button.disabled = !state.rangeButtonsEnabled || state.rangeLoading;
	});
	syncShortcutBarState();
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
		return !hasActiveGameFilters();
	}
	const value = getPredictionWinRateValue(prediction);
	if (state.gameFilters && state.gameFilters.greenWinRate) {
		if (!Number.isFinite(value) || value < 65) {
			return false;
		}
	}
	if (state.gameFilters && state.gameFilters.positiveEdge) {
		const edgeValue = Number(prediction && prediction.edgePct);
		if (!Number.isFinite(edgeValue) || edgeValue <= 0) {
			return false;
		}
	}
	if (state.gameFilters && state.gameFilters.positiveEv) {
		const evValue = Number(prediction && prediction.evPct);
		if (!Number.isFinite(evValue) || evValue <= 0) {
			return false;
		}
	}
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
			button.innerHTML = '<i class="fa-solid fa-star" aria-hidden="true"></i>Favourites (' + favouriteLoadedCount + ')';
		} else {
			button.innerHTML = '<i class="fa-solid fa-globe" aria-hidden="true"></i>All Sports (' + allSportsCount + ')';
		}

		const isActive = button.getAttribute('data-scope') === state.catalogScope;
		button.classList.toggle('is-active', isActive);
		button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
	});

	// Sync the panel-head scope toggle pill.
	syncBackButtonMode();
	syncShortcutBarState();
	if (el.tableWrap) {
		el.tableWrap.classList.toggle('scope-favorites', state.catalogScope === 'favorites');
	}
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
		persistRefreshViewState();
		return;
	}
	setStatus('Sports loaded: ' + (scopeKey === 'favorites' ? getLoadedSportsCount() : 0), 'ok');
	persistRefreshViewState();
}

function setView(viewName) {
	if (viewName === "upcoming" || viewName === "recent") {
		state.view = viewName;
	} else {
		state.view = "catalog";
	}
	const isDetailView = state.view === "upcoming" || state.view === "recent";
	if (state.view === "upcoming") {
		el.pageTitle.textContent = getGamesSectionTitle(state.timeRange);
	} else if (state.view === "recent") {
		el.pageTitle.textContent = "Recent Results";
	} else {
		el.pageTitle.textContent = state.catalogScope === 'favorites' ? 'Favourites Catalog' : 'Sports Catalog';
	}
	syncBackButtonMode();
	if (el.refreshFeedBtn) { el.refreshFeedBtn.classList.remove('hidden'); }
	if (el.searchToggleBtn) { el.searchToggleBtn.classList.remove('hidden'); }
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
	syncShortcutBarState();
	persistRefreshViewState();
}

function setStatus(text, mode) {
	if (!el.status) {
		return;
	}
	if (state.statusHideTimerId) {
		window.clearTimeout(state.statusHideTimerId);
		state.statusHideTimerId = null;
	}
	const nextText = String(text || '').trim();
	if (!nextText) {
		el.status.textContent = '';
		el.status.className = 'status';
		el.status.classList.remove('is-visible');
		return;
	}

	el.status.textContent = nextText;
	el.status.className = "status";
	if (mode === "ok") {
		el.status.classList.add("ok");
	}
	if (mode === "error") {
		el.status.classList.add("error");
	}
	if (mode !== "ok" && mode !== "error") {
		el.status.classList.add('loading');
	}
	el.status.classList.add('is-visible');
	state.statusHideTimerId = window.setTimeout(() => {
		el.status.classList.remove('is-visible');
	}, 6000);
}

// Updates the text label inside an active .loading-panel inside upcomingWrap.
function setLoadingMessage(text) {
	if (!el.upcomingWrap) return;
	const label = el.upcomingWrap.querySelector('.loading-label');
	if (label instanceof HTMLElement) {
		label.textContent = String(text || '').trim();
	}
}

const _normalizeTeamNameCache = new Map();
function normalizeTeamName(value) {
	const raw = String(value || "");
	let result = _normalizeTeamNameCache.get(raw);
	if (result === undefined) {
		result = raw.trim().toLowerCase();
		if (_normalizeTeamNameCache.size > 2000) {
			_normalizeTeamNameCache.clear();
		}
		_normalizeTeamNameCache.set(raw, result);
	}
	return result;
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

function persistRefreshViewState() {
	const allowedSortFields = new Set(['key', 'title', 'group', 'active', 'outrights']);
	const sortField = state.catalogSort && allowedSortFields.has(state.catalogSort.field)
		? state.catalogSort.field
		: 'title';
	const sortDirection = state.catalogSort && state.catalogSort.direction === 'desc' ? 'desc' : 'asc';
	const snapshot = {
		view: state.view === 'upcoming' || state.view === 'recent' ? state.view : 'catalog',
		catalogScope: state.catalogScope === 'favorites' ? 'favorites' : 'all',
		activeSportKey: String(state.activeSportKey || '').trim(),
		timeRange: normalizeRangeKey(state.timeRange),
		timeRangeSelected: Boolean(state.timeRangeSelected),
		rangeButtonsEnabled: Boolean(state.rangeButtonsEnabled),
		resultSportFilter: state.resultSportFilter === 'all' ? 'all' : String(state.resultSportFilter || '').trim(),
		catalogSearch: String(state.catalogSearch || ''),
		resultsSearch: String(state.resultsSearch || ''),
		searchBarExpanded: Boolean(state.searchBarExpanded),
		secureMode: state.secureMode === true,
		recentResultsLookbackDays: Number.isFinite(Number(state.recentResultsLookbackDays))
			? Math.max(1, Math.min(14, Math.round(Number(state.recentResultsLookbackDays))))
			: 2,
		upcomingSavedSportsShowTomorrow: state.upcomingSavedSportsShowTomorrow === true,
		upcomingSavedSportsShowDayAfter: state.upcomingSavedSportsShowDayAfter === true,
		exampleStake: Number.isFinite(Number(state.exampleStake)) && Number(state.exampleStake) >= 0
			? Number(state.exampleStake)
			: 100,
		catalogSort: {
			field: sortField,
			direction: sortDirection
		}
	};
	try {
		localStorage.setItem(REFRESH_VIEW_STATE_KEY, JSON.stringify(snapshot));
	} catch {
		// Ignore local storage failures for refresh-state persistence.
	}
}

function readRefreshViewState() {
	try {
		const raw = localStorage.getItem(REFRESH_VIEW_STATE_KEY);
		if (!raw) {
			return null;
		}
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === 'object' ? parsed : null;
	} catch {
		return null;
	}
}

function applyRefreshViewState(snapshot) {
	if (!snapshot || typeof snapshot !== 'object') {
		return false;
	}

	state.view = snapshot.view === 'upcoming' || snapshot.view === 'recent' ? snapshot.view : 'catalog';
	state.catalogScope = snapshot.catalogScope === 'favorites' ? 'favorites' : 'all';
	state.activeSportKey = String(snapshot.activeSportKey || '').trim();
	state.timeRange = normalizeRangeKey(snapshot.timeRange || state.timeRange);
	state.timeRangeSelected = snapshot.timeRangeSelected !== false;
	state.rangeButtonsEnabled = snapshot.rangeButtonsEnabled !== false;
	state.catalogSearch = String(snapshot.catalogSearch || '').trim();
	state.resultsSearch = String(snapshot.resultsSearch || '').trim();
	state.searchBarExpanded = snapshot.searchBarExpanded === true;
	state.secureMode = true;
	state.upcomingSavedSportsShowTomorrow = snapshot.upcomingSavedSportsShowTomorrow === true;
	state.upcomingSavedSportsShowDayAfter = snapshot.upcomingSavedSportsShowDayAfter === true;
	state.recentResultsLookbackDays = Number.isFinite(Number(snapshot.recentResultsLookbackDays))
		? Math.max(1, Math.min(14, Math.round(Number(snapshot.recentResultsLookbackDays))))
		: state.recentResultsLookbackDays;
	state.exampleStake = Number.isFinite(Number(snapshot.exampleStake)) && Number(snapshot.exampleStake) >= 0
		? Number(snapshot.exampleStake)
		: state.exampleStake;

	const allowedSortFields = new Set(['key', 'title', 'group', 'active', 'outrights']);
	if (snapshot.catalogSort && typeof snapshot.catalogSort === 'object') {
		state.catalogSort = {
			field: allowedSortFields.has(snapshot.catalogSort.field) ? snapshot.catalogSort.field : state.catalogSort.field,
			direction: snapshot.catalogSort.direction === 'desc' ? 'desc' : 'asc'
		};
	}

	const nextFilter = normalizeSportFilterValue(snapshot.resultSportFilter || 'all');
	if (nextFilter === 'all') {
		state.resultSportFilter = 'all';
		state.pendingResultSportFilter = '';
	} else {
		state.resultSportFilter = 'all';
		state.pendingResultSportFilter = nextFilter;
	}

	return true;
}

function clearRefreshViewState() {
	try {
		localStorage.removeItem(REFRESH_VIEW_STATE_KEY);
	} catch {
		// Ignore storage failures while clearing refresh snapshot.
	}
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
	persistRefreshViewState();
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
	const resultCount = Math.max(0, Math.trunc(Number(state.lastLoadCreditCost) || 0));
	if (el.panelSub) {
		el.panelSub.textContent = 'LOADED (' + resultCount + '): ' + friendlyStamp;
	}
}

function markDataLoaded(creditCost = state.lastLoadCreditCost, loadedAt = Date.now()) {
	state.lastLoadCreditCost = Math.max(0, Math.trunc(Number(creditCost) || 0));
	setLastLoadedTimestamp(loadedAt);
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
	state.activeSportKey = state.view === 'catalog' ? '' : String(snapshot.activeSportKey || '').trim();
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

function getGamesSectionTitle(rangeKey = state.timeRange) {
	return normalizeRangeKey(rangeKey) === 'live' ? 'Live Games' : 'Upcoming Games';
}

function getGamesLoadingLabel(rangeKey = state.timeRange) {
	return normalizeRangeKey(rangeKey) === 'live' ? 'Loading live games' : 'Loading upcoming games';
}

function getLoadingStampLabel(creditCost = 0) {
	const cost = Math.max(0, Math.trunc(Number(creditCost) || 0));
	const timestamp = new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
	return 'LOADED (' + cost + '): ' + timestamp;
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
	const startOfPastWindow = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
	const endOfPastWindow = new Date(now.getTime());

	if (normalizedRange === "pastWeek") {
		return { start: startOfPastWindow, end: endOfPastWindow };
	}
	const end24h = new Date(now.getTime() + (24 * 60 * 60 * 1000));
	return { start: startOfToday, end: end24h };
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

function hasCachedDataForRefreshBootstrap() {
	const sportsCatalog = readCache('sports_catalog');
	if (Array.isArray(sportsCatalog) && sportsCatalog.length > 0) {
		return true;
	}
	try {
		const cachePrefix = 'keieye_cache_' + CACHE_VERSION + '_';
		for (let i = 0; i < localStorage.length; i += 1) {
			const key = localStorage.key(i);
			if (!key || !key.startsWith(cachePrefix)) {
				continue;
			}
			const cacheName = key.slice(cachePrefix.length);
			if (cacheName.startsWith('upcoming_events_') || cacheName.startsWith('recent_scores_')) {
				return true;
			}
		}
	} catch {
		return false;
	}
	return false;
}

function requireLoginOrRedirect() {
	state.savedApiKeys = readSavedApiKeys();
	const candidates = [];
	if (state.secureMode !== true) {
		try {
			const value = localStorage.getItem(STORAGE_KEY) || '';
			candidates.push(value);
			if (isPlaceholderApiKey(value)) {
				localStorage.removeItem(STORAGE_KEY);
			}
		} catch {
			candidates.push('');
		}
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

	if (state.secureMode !== true) {
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
	}

	const apiKey = candidates
		.map((value) => (typeof value === 'string' ? value.trim() : ''))
		.filter((value) => value.length > 0 && !isPlaceholderApiKey(value))
		[0] || '';
	if (apiKey.trim()) {
		addSavedApiKey(apiKey);
	}
	if (!apiKey.trim()) {
		if (hasCachedDataForRefreshBootstrap()) {
			if (typeof setStatus === 'function') {
				setStatus('No API key found. Showing cached data from storage.', 'ok');
			}
			return '';
		}
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
	closePredictionInfoModal();
	state.apiKeyLogoutConfirmArmed = false;
	if (state.settingsModalCloseTimerId) {
		window.clearTimeout(state.settingsModalCloseTimerId);
		state.settingsModalCloseTimerId = null;
	}
	syncApiKeyModalMode();
	if (el.apiKeyInput && isLoginMode()) {
		el.apiKeyInput.value = "";
	}
	syncApiKeySubmitButtonState();
	el.apiKeyModal.style.display = 'flex';
	el.apiKeyModal.classList.remove('is-closing');
	el.apiKeyModal.classList.add("is-open");
	el.apiKeyModal.classList.remove('simplified');
	syncSettingsModalPageShiftState();
	if (isLoginMode() && el.apiKeyInput) {
		window.setTimeout(() => el.apiKeyInput.focus(), 40);
	}
}

function openPredictionInfoModal() {
	if (el.predictionInfoModal) {
		el.predictionInfoModal.classList.add("is-open");
	}
	if (el.predictionInfoModalCloseBtn) {
		window.setTimeout(() => el.predictionInfoModalCloseBtn.focus(), 40);
	}
}

function closePredictionInfoModal() {
	if (!el.predictionInfoModal) {
		return;
	}
	el.predictionInfoModal.classList.remove("is-open");
}

function openLogoutConfirmModal() {
	closeApiKeyModal();
	closePredictionInfoModal();
	state.apiKeyLogoutConfirmArmed = false;
	if (!el.logoutConfirmModal) {
		return;
	}
	el.logoutConfirmModal.classList.add('is-open');
	if (el.confirmLogoutBtn) {
		window.setTimeout(() => el.confirmLogoutBtn.focus(), 40);
	}
}

function closeLogoutConfirmModal() {
	if (!el.logoutConfirmModal) {
		return;
	}
	state.apiKeyLogoutConfirmArmed = false;
	el.logoutConfirmModal.classList.remove('is-open');
}

function closeApiKeyModal() {
	if (isLoginMode()) {
		if (el.apiKeyModal) {
			el.apiKeyModal.style.display = 'flex';
			el.apiKeyModal.classList.remove('is-closing');
			el.apiKeyModal.classList.add('is-open');
		}
		syncSettingsModalPageShiftState();
		return;
	}
	if (state.settingsModalCloseTimerId) {
		window.clearTimeout(state.settingsModalCloseTimerId);
		state.settingsModalCloseTimerId = null;
	}
	state.apiKeyLogoutConfirmArmed = false;
	el.apiKeyModal.style.display = 'flex';
	el.apiKeyModal.classList.remove("is-open");
	el.apiKeyModal.classList.add('is-closing');
	syncSettingsModalPageShiftState();
	state.settingsModalCloseTimerId = window.setTimeout(() => {
		if (!el.apiKeyModal) {
			return;
		}
		el.apiKeyModal.style.display = 'none';
		el.apiKeyModal.classList.remove('is-closing');
		syncSettingsModalPageShiftState();
		state.settingsModalCloseTimerId = null;
	}, 360);
	if (el.apiKeyInput) {
		el.apiKeyInput.value = "";
	}
}

function saveApiKeySettings() {
	const nextKey = normalizeApiKeyInput(el.apiKeyInput.value || "");
	if (el.apiKeyInput) {
		el.apiKeyInput.value = nextKey;
	}
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
		state.apiKeyLogoutConfirmArmed = false;
		syncApiKeyModalMode();
		closeApiKeyModal();
		setStatus("API key already saved.", "ok");
		return;
	}

	state.apiKey = nextKey;
	state.apiKeyLogoutConfirmArmed = false;
	addSavedApiKey(nextKey);
	syncSavedApiKeySelect();
	state.savedSports = loadSavedSports();
	syncApiKeyModalMode();
	syncCatalogScopeButtons();
	try {
		if (state.secureMode !== true) {
			localStorage.setItem(STORAGE_KEY, nextKey);
		}
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
	persistRefreshViewState();
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
		if (state.isInitialHydration === true) {
			state.timeRange = normalizedRange;
			state.timeRangeSelected = true;
			saveRangeSelection(normalizedRange);
			if (normalizedRange === 'pastWeek') {
				state.recentResultsLookbackDays = 1;
				state.upcomingBePickLimit = 24;
				if (state.activeSportKey) {
					loadRecentResultsForSport(state.activeSportKey, '');
					persistRefreshViewState();
					return;
				}
				loadRecentResultsForSelectedScope('');
				persistRefreshViewState();
				return;
			}
			if (state.activeSportKey) {
				loadUpcomingForSport(state.activeSportKey, '');
				persistRefreshViewState();
				return;
			}
			loadAllSportsUpcoming('');
			persistRefreshViewState();
			return;
		}
		openApiKeyModal();
		setStatus('No API key found. Add your Odds API key to continue.', 'error');
		persistRefreshViewState();
		return;
	}
	state.timeRange = normalizedRange;
	state.timeRangeSelected = true;
	saveRangeSelection(normalizedRange);
	if (normalizedRange === 'pastWeek') {
		state.recentResultsLookbackDays = 1;
		state.upcomingBePickLimit = 24;
		if (state.activeSportKey) {
			loadRecentResultsForSport(state.activeSportKey, state.apiKey);
			persistRefreshViewState();
			return;
		}
		loadRecentResultsForSelectedScope(state.apiKey);
		persistRefreshViewState();
		return;
	}
	if (normalizedRange === 'live') {
		if (state.activeSportKey) {
			loadUpcomingForSport(state.activeSportKey, state.apiKey);
			persistRefreshViewState();
			return;
		}
		loadAllSportsUpcoming(state.apiKey);
		persistRefreshViewState();
		return;
	}
	if (state.activeSportKey) {
		loadUpcomingForSport(state.activeSportKey, state.apiKey);
		persistRefreshViewState();
		return;
	}
	loadAllSportsUpcoming(state.apiKey);
	persistRefreshViewState();
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
					const [eventResponse, oddsResponse, historyResponse] = await Promise.all([
						fetchWithTimeout(eventsUrl),
						fetchWithTimeout(oddsUrl),
						fetchWithTimeout(historyUrl)
					]);
					const eventPayload = eventResponse.ok ? await eventResponse.json() : [];
					const oddsPayload = oddsResponse.ok ? await oddsResponse.json() : [];
					const historyPayload = historyResponse.ok ? await historyResponse.json() : [];
					const oddsByEventId = buildOddsByEventId(Array.isArray(oddsPayload) ? oddsPayload : []);
					const mergedHistoryRows = mergeRollingHistoryRows(readCache('rolling_history_' + sportKey), Array.isArray(historyPayload) ? historyPayload : []);
					const eventRows = Array.isArray(eventPayload) ? eventPayload : [];
					const oddsRows = Array.isArray(oddsPayload) ? oddsPayload : [];
					const historyRows = Array.isArray(historyPayload) ? historyPayload : [];
					const completedHistoryRows = filterPastResults(historyRows, GAME_START_BUFFER_MS);

					writeCache('upcoming_events_' + sportKey, eventRows);
					writeCache('upcoming_odds_' + sportKey, oddsRows);
					writeCache('upcoming_history_' + sportKey, mergedHistoryRows);
					writeCache('recent_scores_' + sportKey, completedHistoryRows);
					writeCache('recent_odds_' + sportKey, oddsRows);
					writeCache('recent_history_' + sportKey, mergedHistoryRows);
					writeCache('rolling_history_' + sportKey, mergedHistoryRows);
					const historyMap = buildTeamHistoryMap(mergedHistoryRows);
					const liveFiltered = getRowsForSelectedRange(eventRows, 'live', getRangeWindow('live'), historyRows);
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
					const completedRows = completedHistoryRows;
					for (const row of completedRows.slice(0, 7)) {
						const eventId = row && row.id ? String(row.id) : '';
						const oddsRow = eventId ? oddsByEventId[eventId] || null : null;
						const prediction = getPredictionForEvent(row, oddsRow, historyMap, sportKey);
						if (!prediction || !prediction.predictedTeam) {
							recentItems.push({ sportKey, sportTitle: sport.title ? String(sport.title) : sportKey, start: row && row.commence_time ? String(row.commence_time) : '', row, oddsRow, historyMap, prediction: prediction || null });
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
