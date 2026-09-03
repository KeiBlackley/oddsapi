// --- App bootstrapping and event wiring ---

const TOUR_STEPS = [
	{ selector: '#desktopShortcutBar', title: 'Keyboard Shortcut Bar', desc: 'Every chip here is a live keyboard shortcut. Press the key on your keyboard to trigger the action instantly — no mouse needed.', position: 'bottom' },
	{ selector: '[data-shortcut-key="A"]', title: 'All Sports  ·  A', desc: 'Switches the catalog to every available sport from the API. Click any row to load its predictions and odds.', position: 'bottom' },
	{ selector: '[data-shortcut-key="F"]', title: 'Favourites  ·  F', desc: 'Filters the catalog to only the sports you have starred. Star a sport from the table to save it here.', position: 'bottom' },
	{ selector: '[data-shortcut-key="R"]', title: 'Results  ·  R', desc: 'Loads recent match results and scores each prediction against the real outcome. The Backtest card tracks historical accuracy over time.', position: 'bottom' },
	{ selector: '[data-shortcut-key="L"]', title: 'Live  ·  L', desc: 'Shows games currently in progress with live scores. Predictions are locked at kickoff so you can monitor them in real time.', position: 'bottom' },
	{ selector: '[data-shortcut-key="U"]', title: 'Upcoming  ·  U', desc: 'Lists upcoming games with model predictions, win %, edge %, and EV. The Next-Test card summarises confidence across all picks shown.', position: 'bottom' },
	{ selector: '[data-shortcut-key="S"]', title: 'Search  ·  S', desc: 'Toggles the inline search bar. Type a sport name, key or group to filter whatever view is currently active.', position: 'bottom' },
	{ selector: '[data-shortcut-key="B"]', title: 'Back  ·  B', desc: 'Returns you to the sports catalog from any predictions or results view.', position: 'bottom' },
	{ selector: '[data-shortcut-key="escape"]', title: 'Settings  ·  Esc', desc: 'Opens the settings panel — manage your API key, switch sport scope, adjust the time range, and apply game filters.', position: 'bottom' },
	{ selector: '#refreshFeedBtn', title: 'Refresh Feed', desc: 'Forces a live reload from the odds API, bypassing the cache. Use this to fetch the latest odds or updated scores.', position: 'bottom' },
	{ selector: '#tableWrap', title: 'Sports Catalog', desc: 'Each row is a sport. Click a row to load its predictions. The star button saves a sport to Favourites. Column headers are sortable.', position: 'top' },
];

const MOBILE_TOUR_STEPS = [
	{ selector: '#settingsBtn', title: 'Settings', desc: 'Your main navigation hub on mobile. Tap the gear to open the settings panel — this is where you switch between All Sports / Favourites, choose Results / Live / Upcoming, and manage your API key.', position: 'bottom' },
	{ selector: '#refreshFeedBtn', title: 'Refresh Feed', desc: 'Forces a live reload from the odds API, bypassing the local cache. Use this after changing range or when you want the latest odds and scores.', position: 'bottom' },
	{ selector: '#pageTitle', title: 'Current View', desc: 'Shows which view is active — Sports Catalog, Upcoming, Results, or Live. Switch views from the Settings panel.', position: 'bottom' },
	{ selector: '#tableWrap', title: 'Sports Catalog', desc: 'Tap any sport row to load its predictions and odds. The star button saves a sport to your Favourites. Use the Settings panel to filter to Favourites only.', position: 'top' },
];

const _tourState = { active: false, step: 0, steps: TOUR_STEPS, waitingForChip: false };

function init() {
	const appbars = Array.from(document.querySelectorAll('.appbar, .secondary-appbar'));
	const scrollSources = [window];
	let shortcutFlashTimer = null;
	const flashShortcutContainer = (shortcutKey) => {
		const key = String(shortcutKey || '').toLowerCase();
		const shortcutBar = document.getElementById('desktopShortcutBar');
		if (!shortcutBar) {
			return;
		}
		const chip = shortcutBar.querySelector('[data-shortcut-key="' + key + '" i]');
		if (!(chip instanceof HTMLElement)) {
			return;
		}
		shortcutBar.querySelectorAll('.shortcut-chip.is-active').forEach((activeChip) => {
			activeChip.classList.remove('is-active');
		});
		chip.classList.add('is-active');
		if (shortcutFlashTimer) {
			window.clearTimeout(shortcutFlashTimer);
		}
		shortcutFlashTimer = window.setTimeout(() => {
			chip.classList.remove('is-active');
			shortcutFlashTimer = null;
		}, 420);
	};
	if (appbars.length) {
		let lastScrollY = window.scrollY || 0;
		let lastDirection = 'up';
		let cachedThreshold = -1;
		let rafPending = false;
		const getScrollPosition = (source) => {
			if (source === window) {
				return window.scrollY || 0;
			}
			return source && source instanceof HTMLElement ? source.scrollTop : 0;
		};
		const recomputeThreshold = () => {
			cachedThreshold = appbars.reduce((total, bar) => total + bar.getBoundingClientRect().height, 0);
		};
		const applyAppbarVisibility = () => {
			rafPending = false;
			const currentScrollY = getScrollPosition(window);
			const deltaY = currentScrollY - lastScrollY;
			const hasMeaningfulMovement = Math.abs(deltaY) > 6;
			if (hasMeaningfulMovement) {
				lastDirection = deltaY > 0 ? 'down' : 'up';
			}
			const threshold = cachedThreshold;
			const shouldHide = currentScrollY > threshold && lastDirection === 'down';
			const shouldShow = currentScrollY <= threshold || lastDirection === 'up';
			for (const bar of appbars) {
				if (shouldShow) {
					bar.classList.remove('is-hidden');
				} else if (shouldHide) {
					bar.classList.add('is-hidden');
				}
			}
			lastScrollY = currentScrollY;
		};
		const updateAppbarVisibility = () => {
			if (!rafPending) {
				rafPending = true;
				window.requestAnimationFrame(applyAppbarVisibility);
			}
		};
		for (const source of scrollSources) {
			source.addEventListener('scroll', updateAppbarVisibility, { passive: true });
		}
		window.addEventListener('resize', () => {
			recomputeThreshold();
			updateAppbarVisibility();
		}, { passive: true });
		recomputeThreshold();
		applyAppbarVisibility();
	}

	const restoredViewState = readRefreshViewState();
	state.secureMode = readSecureModeSetting();
	persistSecureModeSetting();
	if (state.secureMode === true) {
		applySecureModeStoragePolicy();
	}
	const apiKey = requireLoginOrRedirect();
	state.apiKey = apiKey || "";
	syncApiKeyModalMode();
	// Always surface the login modal when there is no key, even if cached data was shown.
	if (isLoginMode()) {
		openApiKeyModal();
	}
	state.savedSports = loadSavedSports();
	state.catalogScope = state.savedSports.length ? 'favorites' : 'all';
	state.timeRange = getSavedRangeSelection();
	state.timeRangeSelected = true;
	state.lastLoadedAt = getLastLoadedTimestamp();
	state.gameFilters = readGameFilters();
	if (restoredViewState) {
		applyRefreshViewState(restoredViewState);
	}
	const restoredTargetView = state.view;
	const restoredTargetRange = normalizeRangeKey(state.timeRange);
	syncCatalogScopeButtons();
	syncGameFilterButtons();
	syncSecureModeButton();
	setView('catalog');
	state.isInitialHydration = true;
	try {
		if (state.apiKey) {
			if (restoredViewState && (restoredTargetView === 'upcoming' || restoredTargetView === 'recent')) {
				const restoredRange = restoredTargetView === 'recent'
					? 'pastWeek'
					: restoredTargetRange;
				state.timeRangeSelected = false;
				setRangeSelection(restoredRange);
			} else if (restoredViewState && restoredTargetView === 'catalog') {
				loadSportsCatalog(state.apiKey);
			} else {
				const savedRange = getSavedRangeSelection();
				state.timeRangeSelected = false;
				setRangeSelection(savedRange);
			}
		} else {
			const cachedCatalogRows = readCache('sports_catalog');
			if (Array.isArray(cachedCatalogRows) && cachedCatalogRows.length) {
				renderSportsTable(cachedCatalogRows);
				if (restoredViewState && (restoredTargetView === 'upcoming' || restoredTargetView === 'recent')) {
					const restoredRange = restoredTargetView === 'recent'
						? 'pastWeek'
						: restoredTargetRange;
					state.timeRangeSelected = false;
					setRangeSelection(restoredRange);
				}
				// If catalog was the last view, stay on catalog — renderSportsTable above already handled it.
			}
		}
	} finally {
		state.isInitialHydration = false;
	}

	window.addEventListener('beforeunload', () => {
		persistRefreshViewState();
	});
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'hidden') {
			persistRefreshViewState();
		}
	});

	el.settingsBtn.addEventListener('click', () => {
		flashShortcutContainer('escape');
		openApiKeyModal();
	});
	if (el.authStatusBtn) {
		const icon = el.authStatusBtn.querySelector('i');
		if (icon instanceof HTMLElement) { icon.className = 'fa-solid fa-right-from-bracket'; }
		el.authStatusBtn.setAttribute('aria-label', 'Sign out');
		el.authStatusBtn.addEventListener('click', () => {
			flashShortcutContainer('escape');
			logoutCurrentUser();
		});
	}
	if (el.refreshFeedBtn) {
		el.refreshFeedBtn.addEventListener('click', () => {
			flashShortcutContainer('escape');
			if (!state.apiKey) {
				openApiKeyModal();
				setStatus('Add your API key to refresh the feed.', 'error');
				return;
			}
			if (state.view === 'catalog') {
				loadSportsCatalog(state.apiKey, { forceRefresh: true });
				return;
			}
			if (state.view === 'recent') {
				if (state.activeSportKey) {
					loadRecentResultsForSport(state.activeSportKey, state.apiKey, { forceRefresh: true });
				} else {
					loadRecentResultsForSelectedScope(state.apiKey, { forceRefresh: true });
				}
				return;
			}
			if (state.activeSportKey) {
				loadUpcomingForSport(state.activeSportKey, state.apiKey, { forceRefresh: true });
				return;
			}
			loadAllSportsUpcoming(state.apiKey, { forceRefresh: true });
		});
	}
	if (el.infoBtn) {
		el.infoBtn.addEventListener('click', () => {
			closeApiKeyModal();
			openPredictionInfoModal();
		});
	}
	if (el.cancelApiKeyBtn) {
		el.cancelApiKeyBtn.addEventListener('click', () => closeApiKeyModal());
	}
	el.saveApiKeyBtn.addEventListener('click', () => saveApiKeySettings());
	if (el.clearHistoryCacheBtn) {
		el.clearHistoryCacheBtn.addEventListener('click', () => {
			const targetSportKey = state.activeSportKey ? String(state.activeSportKey) : '';
			clearRollingHistoryCache(targetSportKey);
			const scopeLabel = targetSportKey ? 'current sport' : 'all sports';
			setStatus('History cache cleared for ' + scopeLabel + '.', 'ok');

			if (!state.apiKey) {
				return;
			}
			if (state.view === 'recent') {
				if (targetSportKey) {
					loadRecentResultsForSport(targetSportKey, state.apiKey);
				} else {
					loadRecentResultsForSelectedScope(state.apiKey);
				}
				return;
			}
			if (state.view === 'upcoming') {
				if (targetSportKey) {
					loadUpcomingForSport(targetSportKey, state.apiKey);
				} else {
					loadAllSportsUpcoming(state.apiKey);
				}
			}
		});
	}
	el.apiKeyModal.addEventListener('click', (event) => {
		if (event.target instanceof HTMLElement && event.target.dataset.closeModal === 'true') {
			closeApiKeyModal();
		}
	});
	if (el.predictionInfoModal) {
		el.predictionInfoModal.addEventListener('click', (event) => {
			if (event.target instanceof HTMLElement && (event.target === el.predictionInfoModal || event.target.dataset.closeModal === 'true')) {
				closePredictionInfoModal();
			}
		});
	}
	el.apiKeyInput.addEventListener('keydown', (event) => {
		if (event.key === 'Escape' && !isLoginMode()) {
			closeApiKeyModal();
		}
		if (event.key === 'Enter') {
			event.preventDefault();
			saveApiKeySettings();
		}
	});
	el.apiKeyInput.addEventListener('input', () => {
		syncApiKeySubmitButtonState();
	});
	if (el.savedApiKeySelect) {
		el.savedApiKeySelect.addEventListener('change', (event) => {
			const target = event.target instanceof HTMLSelectElement ? event.target : null;
			if (!target || !el.apiKeyInput || !isLoginMode()) {
				return;
			}
			const selectedKey = String(target.value || '').trim();
			if (!selectedKey) {
				syncApiKeySubmitButtonState();
				return;
			}
			el.apiKeyInput.value = selectedKey;
			syncApiKeySubmitButtonState();
			el.apiKeyInput.focus();
			el.apiKeyInput.select();
		});
	}

	if (el.sportsSearchInput) {
		let _searchDebounceTimer = null;
		el.sportsSearchInput.addEventListener('blur', () => {
			if (state.searchBarExpanded) {
				state.searchBarExpanded = false;
				syncSearchInputMode();
				persistRefreshViewState();
			}
		});
		el.sportsSearchInput.addEventListener('input', (event) => {
			const rawInput = event.target && event.target.value ? String(event.target.value) : '';
			const nextValue = clampText(rawInput, MAX_SEARCH_INPUT_LENGTH);
			if (event.target && event.target.value !== nextValue) {
				event.target.value = nextValue;
			}
			const trimmed = nextValue.trim();
			if (_searchDebounceTimer) {
				window.clearTimeout(_searchDebounceTimer);
			}
			_searchDebounceTimer = window.setTimeout(() => {
				_searchDebounceTimer = null;
				if (state.view === 'catalog') {
					state.catalogSearch = trimmed;
					renderSportsTable(state.sportsRows);
					persistRefreshViewState();
					return;
				}
				state.resultsSearch = trimmed;
				rerenderActiveResultsView();
				persistRefreshViewState();
			}, 150);
		});
	}

	if (el.searchToggleBtn) {
		el.searchToggleBtn.addEventListener('click', () => {
			flashShortcutContainer('s');
			state.searchBarExpanded = !state.searchBarExpanded;
			syncSearchInputMode();
			persistRefreshViewState();
			if (state.searchBarExpanded && el.sportsSearchInput) {
				window.setTimeout(() => el.sportsSearchInput.focus(), 40);
			}
		});
	}

	document.addEventListener('mousedown', (event) => {
		if (!state.searchBarExpanded || !el.sportsSearchInput || el.sportsSearchInput.disabled) {
			return;
		}
		const target = event.target instanceof HTMLElement ? event.target : null;
		if (!target) {
			return;
		}
		if (target === el.sportsSearchInput || el.sportsSearchInput.contains(target)) {
			return;
		}
		if (el.searchToggleBtn && (target === el.searchToggleBtn || el.searchToggleBtn.contains(target))) {
			return;
		}
		state.searchBarExpanded = false;
		syncSearchInputMode();
		persistRefreshViewState();
	});

	document.addEventListener('click', (event) => {
		if (!isLoginMode()) {
			return;
		}
		const target = event.target instanceof HTMLElement ? event.target : null;
		if (!target) {
			return;
		}
		// In login mode allow only the API key input and the Continue/Save button.
		const isAllowed = Boolean(
			target === el.apiKeyInput || (el.apiKeyInput && el.apiKeyInput.contains(target)) ||
			target === el.saveApiKeyBtn || (el.saveApiKeyBtn && el.saveApiKeyBtn.contains(target))
		);
		if (!isAllowed) {
			event.preventDefault();
			event.stopPropagation();
			if (el.apiKeyInput) {
				el.apiKeyInput.focus();
			}
		}
	}, true);

	document.querySelectorAll('.scope-btn').forEach((button) => {
		if (button.dataset.scopeBound === 'true') {
			return;
		}
		button.dataset.scopeBound = 'true';
		button.addEventListener('click', () => {
			const scopeKey = button.getAttribute('data-scope') || 'all';
			flashShortcutContainer(scopeKey === 'favorites' ? 'f' : 'a');
			setCatalogScope(scopeKey);
		});
	});

	document.querySelectorAll('.range-btn').forEach((button) => {
		if (button.dataset.rangeBound === 'true') {
			return;
		}
		button.dataset.rangeBound = 'true';
		button.addEventListener('click', () => {
			const rangeKey = button.getAttribute('data-range') || 'today';
			flashShortcutContainer(rangeKey === 'pastWeek' ? 'r' : rangeKey === 'live' ? 'l' : 'u');
			setRangeSelection(rangeKey);
		});
	});

	if (el.sportFilterButtons) {
		el.sportFilterButtons.addEventListener('click', (event) => {
			const target = event.target instanceof HTMLElement ? event.target : null;
			if (!target) {
				return;
			}
			const button = target.closest('[data-result-sport]');
			if (!(button instanceof HTMLElement)) {
				return;
			}
			const sportValue = button.getAttribute('data-result-sport') || 'all';
			setResultSportFilter(sportValue);
		});
	}

	if (el.resultsSportScopeSelect) {
		el.resultsSportScopeSelect.addEventListener('change', (event) => {
			const selected = event.target && event.target.value ? String(event.target.value) : 'all';
			setResultSportFilter(selected);
		});
	}

	if (el.gameFilterGroup) {
		el.gameFilterGroup.addEventListener('click', (event) => {
			const target = event.target instanceof HTMLElement ? event.target : null;
			if (!target) {
				return;
			}
			const button = target.closest('[data-game-filter]');
			if (!(button instanceof HTMLElement)) {
				return;
			}
			const filterKey = button.getAttribute('data-game-filter') || '';
			const isEnabled = Boolean(state.gameFilters && state.gameFilters[filterKey]);
			setGameFilterToggle(filterKey, !isEnabled);
		});
	}

	if (el.upcomingWrap) {
		el.upcomingWrap.addEventListener('input', (event) => {
			const target = event.target instanceof HTMLElement ? event.target : null;
			if (!(target instanceof HTMLInputElement) || !target.classList.contains('summary-stake-input')) {
				return;
			}
			const rawValue = String(target.value || '').trim();
			const parsedStake = Number(rawValue);
			const nextStake = Number.isFinite(parsedStake) && parsedStake >= 0 ? parsedStake : 0;
			state.exampleStake = nextStake;
			const summaryOutputFields = el.upcomingWrap.querySelectorAll('.summary-value-output[data-multi-odds]');
			summaryOutputFields.forEach((field) => {
				if (!(field instanceof HTMLInputElement)) {
					return;
				}
				const multiOdds = Number(field.getAttribute('data-multi-odds'));
				const nextValue = Number.isFinite(multiOdds) && multiOdds > 0
					? (nextStake * multiOdds)
					: nextStake;
				field.value = '$' + nextValue.toFixed(2);
			});
			persistRefreshViewState();
		});
	}

	el.backBtn.addEventListener('click', () => {
		flashShortcutContainer('b');
		if (state.view === 'catalog') {
			setCatalogScope(state.catalogScope === 'favorites' ? 'all' : 'favorites');
			setStatus(state.catalogScope === 'favorites' ? 'Showing favourite sports only' : 'Showing all sports', 'ok');
			persistRefreshViewState();
			return;
		}
		state.activeSportKey = "";
		state.rangeButtonsEnabled = true;
		state.timeRangeSelected = false;
		setView('catalog');
		setStatus('Showing sports catalog', 'ok');
		persistRefreshViewState();
	});

	el.backBtn.addEventListener('mouseenter', () => {
		if (!el.backBtn.classList.contains('catalog-favorite-toggle')) {
			return;
		}
		const icon = el.backBtn.querySelector('i');
		if (!(icon instanceof HTMLElement)) {
			return;
		}
		if (state.catalogScope === 'favorites') {
			icon.className = 'fa-solid fa-futbol';
			return;
		}
		icon.className = 'fa-solid fa-star';
	});

	el.backBtn.addEventListener('mouseleave', () => {
		if (!el.backBtn.classList.contains('catalog-favorite-toggle')) {
			return;
		}
		syncBackButtonMode();
	});

	el.tableWrap.addEventListener('click', (event) => {
		const target = event.target instanceof HTMLElement ? event.target : null;
		if (!target) {
			return;
		}
		const sortHeader = target.closest('[data-sort-field]');
		if (sortHeader) {
			event.preventDefault();
			event.stopPropagation();
			const nextField = sortHeader.getAttribute('data-sort-field') || 'title';
			if (state.catalogSort.field === nextField) {
				state.catalogSort.direction = state.catalogSort.direction === 'asc' ? 'desc' : 'asc';
			} else {
				state.catalogSort.field = nextField;
				state.catalogSort.direction = 'asc';
			}
			renderSportsTable(state.sportsRows);
			persistRefreshViewState();
			return;
		}
		const star = target.closest('.star-btn');
		if (star) {
			event.preventDefault();
			event.stopPropagation();
			const sportKey = star.getAttribute('data-star-key') || '';
			if (!sportKey) {
				return;
			}
			toggleSavedSport(sportKey);
			return;
		}
		const row = target.closest('.sport-row');
		if (!row) {
			return;
		}
		const sportKey = row.getAttribute('data-sport-key') || '';
		if (!sportKey) {
			return;
		}
		state.activeSportKey = sportKey;
		state.rangeButtonsEnabled = true;
		state.timeRangeSelected = false;
		syncRangeButtons();
		persistRefreshViewState();
		if (!state.apiKey) {
			openApiKeyModal();
			return;
		}
		loadUpcomingForSport(sportKey, state.apiKey);
	});

	el.tableWrap.addEventListener('keydown', (event) => {
		if (event.key !== 'Enter' && event.key !== ' ') {
			return;
		}
		const target = event.target instanceof HTMLElement ? event.target : null;
		if (!target || !target.classList.contains('sport-row')) {
			return;
		}
		event.preventDefault();
		const sportKey = target.getAttribute('data-sport-key') || '';
		if (!sportKey) {
			return;
		}
		state.activeSportKey = sportKey;
		state.rangeButtonsEnabled = true;
		state.timeRangeSelected = false;
		syncRangeButtons();
		persistRefreshViewState();
		if (!state.apiKey) {
			openApiKeyModal();
			return;
		}
		loadUpcomingForSport(sportKey, state.apiKey);
	});

	function logoutCurrentUser() {
		addSavedApiKey(state.apiKey);
		syncSavedApiKeySelect();
		clearRefreshViewState();
		try {
			localStorage.removeItem(STORAGE_KEY);
			localStorage.removeItem(LEGACY_STORAGE_KEY);
		} catch {
			// Ignore storage cleanup failures and keep the user in the app flow.
		}
		try {
			sessionStorage.removeItem(STORAGE_KEY);
		} catch {
			// Ignore storage cleanup failures and keep the user in the app flow.
		}
		state.apiKey = "";
		syncApiKeyModalMode();
		closeApiKeyModal();
		if (typeof openApiKeyModal === 'function') {
			openApiKeyModal();
		}
		setStatus('Signed out. Add your Odds API key to continue.', 'error');
	}

	if (el.logoutBtn) {
		el.logoutBtn.addEventListener('click', () => {
			openLogoutConfirmModal();
		});
	}

	if (el.cancelLogoutBtn) {
		el.cancelLogoutBtn.addEventListener('click', () => closeLogoutConfirmModal());
	}
	if (el.confirmLogoutBtn) {
		el.confirmLogoutBtn.addEventListener('click', () => {
			closeLogoutConfirmModal();
			logoutCurrentUser();
		});
	}

	if (el.swapApiKeyBtn) {
		el.swapApiKeyBtn.addEventListener('click', () => {
			logoutCurrentUser();
		});
	}

	const shortcutBar = document.getElementById('desktopShortcutBar');
	if (shortcutBar) {
		const syncShortcutOverflowState = () => {
			shortcutBar.classList.remove('is-compact');
			const needsCompactMode = shortcutBar.scrollWidth > (shortcutBar.clientWidth + 2);
			shortcutBar.classList.toggle('is-compact', needsCompactMode);
			const maxScrollLeft = Math.max(0, shortcutBar.scrollWidth - shortcutBar.clientWidth);
			const scrollLeft = Math.max(0, shortcutBar.scrollLeft || 0);
			const hasOverflow = maxScrollLeft > 2;
			shortcutBar.classList.toggle('is-overflowing', hasOverflow);
			shortcutBar.classList.toggle('at-start', !hasOverflow || scrollLeft <= 2);
			shortcutBar.classList.toggle('at-end', !hasOverflow || scrollLeft >= (maxScrollLeft - 2));
		};

		shortcutBar.addEventListener('scroll', syncShortcutOverflowState, { passive: true });
		window.addEventListener('resize', syncShortcutOverflowState, { passive: true });
		window.setTimeout(() => {
			shortcutBar.classList.add('is-visible');
			syncShortcutOverflowState();
		}, 60);
		window.setTimeout(syncShortcutOverflowState, 220);
	}

	const closeAllOpenModals = () => {
		let hadOpenModal = false;
		if (el.predictionInfoModal && el.predictionInfoModal.classList.contains('is-open')) {
			closePredictionInfoModal();
			hadOpenModal = true;
		}
		if (el.logoutConfirmModal && el.logoutConfirmModal.classList.contains('is-open')) {
			closeLogoutConfirmModal();
			hadOpenModal = true;
		}
		if (el.apiKeyModal && el.apiKeyModal.classList.contains('is-open')) {
			state.apiKeyLogoutConfirmArmed = false;
			syncApiKeyModalMode();
			closeApiKeyModal();
			if (el.apiKeyModal.classList.contains('is-open')) {
				el.apiKeyModal.classList.remove('is-open');
				if (typeof syncSettingsModalPageShiftState === 'function') {
					syncSettingsModalPageShiftState();
				}
			}
			hadOpenModal = true;
		}
		return hadOpenModal;
	};

	const isSettingsModalOpen = () => {
		return Boolean(el.apiKeyModal && el.apiKeyModal.classList.contains('is-open'));
	};

	const runShortcutAction = (shortcutKey) => {
		const key = String(shortcutKey || '').toLowerCase();
	if (_tourState.waitingForChip) {
		const stepIdx = findTourStepForChip(key.toUpperCase());
		if (stepIdx < 0) { return false; }
		exitTourWaitingMode();
		_tourState.step = stepIdx;
		renderTourStep(stepIdx);
		// Fall through: let the real shortcut action also execute
	} else if (_tourState.active) {
		const stepIdx = findTourStepForChip(key.toUpperCase());
		if (stepIdx < 0) { return false; }
		_tourState.step = stepIdx;
		renderTourStep(stepIdx);
		// Fall through: execute action AND update tooltip
	}
		if (isLoginMode() && key !== 'escape') {
			return false;
		}
		if (key === 'escape') {
			if (state.rangeLoading || state.busyOverlayCount > 0) {
				return false;
			}
			flashShortcutContainer('escape');
			if (closeAllOpenModals()) {
				return true;
			}
			openApiKeyModal();
			return true;
		}
		if (key === 'b') {
			if (state.rangeLoading || state.busyOverlayCount > 0) {
				return false;
			}
			flashShortcutContainer('b');
			if (state.view === 'catalog') {
				return false;
			}
			state.activeSportKey = "";
			state.rangeButtonsEnabled = true;
			state.timeRangeSelected = false;
			setView('catalog');
			setStatus('Showing sports catalog', 'ok');
			return true;
		}
		if (key === 'a') {
			flashShortcutContainer('a');
			setCatalogScope('all');
			return true;
		}
		if (key === 'f') {
			flashShortcutContainer('f');
			setCatalogScope('favorites');
			return true;
		}
		if (key === 's' && el.sportsSearchInput) {
			if (state.rangeLoading || state.busyOverlayCount > 0) {
				return false;
			}
			flashShortcutContainer('s');
			if (el.searchToggleBtn) {
				state.searchBarExpanded = !state.searchBarExpanded;
				syncSearchInputMode();
				persistRefreshViewState();
			}
			if (!el.sportsSearchInput.disabled) {
				window.setTimeout(() => {
					if (el.sportsSearchInput && !el.sportsSearchInput.disabled) {
						el.sportsSearchInput.focus();
						el.sportsSearchInput.select();
					}
				}, 40);
			}
			return true;
		}
		if (key === 'r') {
			flashShortcutContainer('r');
			setRangeSelection('pastWeek');
			return true;
		}
		if (key === 'l') {
			flashShortcutContainer('l');
			setRangeSelection('live');
			return true;
		}
		if (key === 'u') {
			flashShortcutContainer('u');
			setRangeSelection('today');
			return true;
		}
		if (key === 'i') {
			flashShortcutContainer('i');
			startTour();
			return true;
		}
		return false;
	};

	if (shortcutBar) {
		shortcutBar.addEventListener('click', (event) => {
			const target = event.target instanceof HTMLElement ? event.target : null;
			if (!target) {
				return;
			}
			const chip = target.closest('[data-shortcut-key]');
			if (!(chip instanceof HTMLElement)) {
				return;
			}
			const shortcutKey = chip.getAttribute('data-shortcut-key') || '';
			if (!shortcutKey) {
				return;
			}
			event.preventDefault();
			runShortcutAction(shortcutKey);
		});
	}

	// Trap focus on the API key input while in login mode.
	document.addEventListener('focusin', (event) => {
		if (!isLoginMode() || !el.apiKeyInput) {
			return;
		}
		if (event.target !== el.apiKeyInput) {
			el.apiKeyInput.focus();
		}
	}, true);

	document.addEventListener('keydown', (event) => {
		if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
			return;
		}
		// In login mode swallow everything except keys typed into the API key input.
		if (isLoginMode()) {
			const onInput = event.target === el.apiKeyInput;
			if (!onInput) {
				event.preventDefault();
				event.stopPropagation();
			}
			return;
		}
		if (String(event.key || '').toLowerCase() === 'escape') {
			if (state.searchBarExpanded && el.sportsSearchInput && !el.sportsSearchInput.disabled) {
				event.preventDefault();
				state.searchBarExpanded = false;
				syncSearchInputMode();
				persistRefreshViewState();
				return;
			}
			event.preventDefault();
			runShortcutAction('escape');
			return;
		}
		if ((event.key === ' ' || event.code === 'Space') && (state.rangeLoading || (el.globalLoadingOverlay && el.globalLoadingOverlay.classList.contains('is-visible')))) {
			event.preventDefault();
			cancelTrackedLoading('Exit loading screen. Request cancelled.');
			return;
		}
		const target = event.target;
		if (target instanceof HTMLElement) {
			const tagName = String(target.tagName || '').toLowerCase();
			const isTypingField = target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select';
			if (isTypingField) {
				return;
			}
		}
		const key = String(event.key || '').toLowerCase();
		if (runShortcutAction(key)) {
			event.preventDefault();
			return;
		}
	});

	// Arrow-key navigation scoped to whichever view is currently visible.
	document.addEventListener('keydown', (event) => {
		if (isLoginMode()) return;
		const key = event.key;
		if (key !== 'ArrowUp' && key !== 'ArrowDown' && key !== 'ArrowLeft' && key !== 'ArrowRight') return;
		// Don't hijack keys when user is typing or has an input focused.
		const active = document.activeElement;
		if (active instanceof HTMLElement) {
			const tag = active.tagName.toLowerCase();
			if (tag === 'input' || tag === 'textarea' || tag === 'select' || active.isContentEditable) return;
		}
		const isCatalog = state.view === 'catalog';
		const container = isCatalog
			? (el.tableWrap && !el.tableWrap.classList.contains('hidden') ? el.tableWrap : null)
			: (el.upcomingWrap && !el.upcomingWrap.classList.contains('hidden') ? el.upcomingWrap : null);
		if (!container) return;
		const selector = isCatalog ? '.sport-row' : '.game-card[data-expand-card]';
		const rows = Array.from(container.querySelectorAll(selector));
		if (!rows.length) return;
		const idx = rows.indexOf(active);
		const delta = (key === 'ArrowDown' || key === 'ArrowRight') ? 1 : -1;
		const next = idx === -1
			? ((key === 'ArrowDown' || key === 'ArrowRight') ? rows[0] : rows[rows.length - 1])
			: rows[Math.max(0, Math.min(rows.length - 1, idx + delta))];
		if (next instanceof HTMLElement) {
			event.preventDefault();
			next.focus();
			next.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
		}
	});
}

init();

document.addEventListener('contextmenu', (event) => event.preventDefault());

// Reliable top-level delegation for dynamically rendered view-more buttons
document.addEventListener('click', (event) => {
	if (!(event.target instanceof Element)) { return; }
	const vmUp = event.target.closest('[data-action="view-more-upcoming"]');
	if (vmUp && el.upcomingWrap && el.upcomingWrap.contains(vmUp)) {
		event.preventDefault();
		event.stopPropagation();
		handleUpcomingViewMoreClick();
		return;
	}
	const vmRec = event.target.closest('[data-action="view-more-recent"]');
	if (vmRec && el.upcomingWrap && el.upcomingWrap.contains(vmRec)) {
		event.preventDefault();
		event.stopPropagation();
		handleRecentResultsViewMoreClick();
	}
});

document.addEventListener('click', (event) => {
	const btn = event.target instanceof Element ? event.target.closest('.backtest-collapse-btn') : null;
	if (!btn) { return; }
	event.stopPropagation();
	const card = btn.closest('.backtest-card');
	if (!card) { return; }
	const collapsed = card.classList.toggle('is-collapsed');
	btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
});

// --- Tour ---
function startTour() {
	if (_tourState.active) {
		return;
	}
	_tourState.active = true;
	_tourState.step = 0;
	_tourState.steps = window.innerWidth < 1199 ? MOBILE_TOUR_STEPS : TOUR_STEPS;
	const overlay = document.getElementById('tourOverlay');
	if (overlay) {
		overlay.classList.add('is-active');
		overlay.setAttribute('aria-hidden', 'false');
		overlay.focus();
	}
	renderTourStep(0);
}

function endTour() {
	_tourState.active = false;
	_tourState.waitingForChip = false;
	document.body.classList.remove('tour-active-waiting');
	const overlay = document.getElementById('tourOverlay');
	if (overlay) {
		overlay.classList.remove('is-active', 'tour-waiting');
		overlay.setAttribute('aria-hidden', 'true');
	}
}

function tourNavigate(delta) {
	if (_tourState.waitingForChip) {
		exitTourWaitingMode();
		_tourState.step = 1;
		renderTourStep(1);
		return;
	}
	const isDesktop = window.innerWidth >= 1199;
	if (_tourState.step === 0 && delta === 1 && isDesktop && _tourState.steps === TOUR_STEPS) {
		enterTourWaitingMode();
		return;
	}
	const next = _tourState.step + delta;
	if (next >= _tourState.steps.length) {
		endTour();
		return;
	}
	if (next < 0) {
		return;
	}
	_tourState.step = next;
	renderTourStep(next);
}

function renderTourStep(index) {
	const step = _tourState.steps[index];
	if (!step) {
		endTour();
		return;
	}
	const target = document.querySelector(step.selector);
	const counter = document.getElementById('tourStepCounter');
	const titleEl = document.getElementById('tourTitle');
	const descEl = document.getElementById('tourDesc');
	const nextBtn = document.getElementById('tourNextBtn');
	if (counter) {
		counter.textContent = (index + 1) + ' of ' + _tourState.steps.length;
	}
	if (titleEl) {
		titleEl.textContent = step.title;
	}
	if (descEl) {
		descEl.textContent = step.desc;
	}
	const isDesktopStep0 = index === 0 && window.innerWidth >= 1199 && _tourState.steps === TOUR_STEPS;
	if (nextBtn) {
		nextBtn.style.display = '';
		nextBtn.textContent = isDesktopStep0 ? 'SPACE' : index === _tourState.steps.length - 1 ? 'Finish' : 'Next →';
	}
	const spotlight = document.getElementById('tourSpotlight');
	if (spotlight) {
		if (target) {
			const rect = target.getBoundingClientRect();
			const pad = 7;
			spotlight.style.top = (rect.top - pad) + 'px';
			spotlight.style.left = (rect.left - pad) + 'px';
			spotlight.style.width = (rect.width + pad * 2) + 'px';
			spotlight.style.height = (rect.height + pad * 2) + 'px';
			spotlight.style.opacity = '1';
		} else {
			spotlight.style.opacity = '0';
		}
	}
	positionTourCard(target, step.position);
	if (target) {
		target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
	}
}

function positionTourCard(target, preferred) {
	const card = document.getElementById('tourCard');
	if (!card) {
		return;
	}
	const vw = window.innerWidth;
	const vh = window.innerHeight;
	const cardW = 320;
	const margin = 14;
	const gap = 14;
	card.style.transform = 'none';
	if (!target) {
		card.style.top = Math.round(vh / 2 - 100) + 'px';
		card.style.left = Math.round(vw / 2 - cardW / 2) + 'px';
		return;
	}
	const rect = target.getBoundingClientRect();
	const cardH = card.offsetHeight || 190;
	const fitsBelow = rect.bottom + gap + cardH + margin < vh;
	const fitsAbove = rect.top - gap - cardH - margin > 0;
	let pos = preferred === 'top' ? (fitsAbove ? 'top' : 'bottom') : (fitsBelow ? 'bottom' : fitsAbove ? 'top' : 'bottom');
	let top = pos === 'bottom' ? rect.bottom + gap : rect.top - gap - cardH;
	let left = rect.left + rect.width / 2 - cardW / 2;
	left = Math.max(margin, Math.min(vw - cardW - margin, left));
	top = Math.max(margin, Math.min(vh - cardH - margin, top));
	card.style.top = top + 'px';
	card.style.left = left + 'px';
}

function initTour() {
	const overlay = document.getElementById('tourOverlay');
	const closeBtn = document.getElementById('tourCloseBtn');
	const nextBtn = document.getElementById('tourNextBtn');
	if (closeBtn) {
		closeBtn.addEventListener('click', (e) => { e.stopPropagation(); endTour(); });
	}
	if (nextBtn) {
		nextBtn.addEventListener('click', (e) => { e.stopPropagation(); tourNavigate(1); });
	}
	// Shortcut bar chip click detection for interactive waiting mode
	const shortcutBar = document.getElementById('desktopShortcutBar');
	if (shortcutBar) {
		shortcutBar.addEventListener('click', (e) => {
			if (!_tourState.waitingForChip) { return; }
			const chip = e.target instanceof Element ? e.target.closest('[data-shortcut-key]') : null;
			if (!chip) { return; }
			const stepIdx = findTourStepForChip(chip.getAttribute('data-shortcut-key') || '');
			if (stepIdx >= 0) {
				exitTourWaitingMode();
				_tourState.step = stepIdx;
				renderTourStep(stepIdx);
			}
		});
	}
	if (overlay) {
		overlay.addEventListener('click', () => { if (_tourState.active && !_tourState.waitingForChip) { tourNavigate(1); } });
		const tourCard = document.getElementById('tourCard');
		if (tourCard) {
			tourCard.addEventListener('click', (e) => e.stopPropagation());
		}
		overlay.addEventListener('keydown', (e) => {
			if (!_tourState.active) {
				return;
			}
			if (e.key === 'Escape') { e.preventDefault(); endTour(); }
			else if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); tourNavigate(1); }
			else if (!_tourState.waitingForChip && (e.key === 'ArrowRight' || e.key === 'Enter')) { e.preventDefault(); tourNavigate(1); }
		});
	}
}

initTour();

if (typeof initTheme === 'function') { initTheme(); }

function findTourStepForChip(chipKey) {
	const upper = String(chipKey || '').toUpperCase();
	const steps = _tourState.steps || [];
	for (let i = 0; i < steps.length; i++) {
		const m = (steps[i].selector || '').match(/\[data-shortcut-key="([^"]+)"\]/);
		if (m && m[1].toUpperCase() === upper) { return i; }
	}
	return -1;
}

function enterTourWaitingMode() {
	_tourState.waitingForChip = true;
	document.body.classList.add('tour-active-waiting');
	const overlay = document.getElementById('tourOverlay');
	if (overlay) { overlay.classList.add('tour-waiting'); overlay.focus(); }
	const counter = document.getElementById('tourStepCounter');
	const titleEl = document.getElementById('tourTitle');
	const descEl = document.getElementById('tourDesc');
	const nextBtn = document.getElementById('tourNextBtn');
	if (counter) { counter.textContent = 'Interactive'; }
	if (titleEl) { titleEl.textContent = 'Explore'; }
	if (descEl) { descEl.textContent = 'Press any shortcut key on your keyboard, or click a button in the bar above, to see what it does.'; }
	if (nextBtn) { nextBtn.style.display = 'none'; }
}

function exitTourWaitingMode() {
	_tourState.waitingForChip = false;
	document.body.classList.remove('tour-active-waiting');
	const overlay = document.getElementById('tourOverlay');
	if (overlay) { overlay.classList.remove('tour-waiting'); }
}
