// --- App bootstrapping and event wiring ---
function init() {
	const appbars = Array.from(document.querySelectorAll('.appbar, .secondary-appbar'));
	const scrollSources = [window];
	if (appbars.length) {
		let lastScrollY = window.scrollY || 0;
		let lastDirection = 'up';
		const getScrollPosition = (source) => {
			if (source === window) {
				return window.scrollY || 0;
			}
			return source && source instanceof HTMLElement ? source.scrollTop : 0;
		};
		const getAppbarHideThreshold = () => {
			return appbars.reduce((total, bar) => total + bar.getBoundingClientRect().height, 0);
		};
		const updateAppbarVisibility = () => {
			const currentScrollY = getScrollPosition(window);
			const deltaY = currentScrollY - lastScrollY;
			const hasMeaningfulMovement = Math.abs(deltaY) > 6;
			if (hasMeaningfulMovement) {
				lastDirection = deltaY > 0 ? 'down' : 'up';
			}
			const threshold = getAppbarHideThreshold();
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
		for (const source of scrollSources) {
			source.addEventListener('scroll', updateAppbarVisibility, { passive: true });
		}
		window.addEventListener('resize', updateAppbarVisibility, { passive: true });
		updateAppbarVisibility();
	}

	const apiKey = requireLoginOrRedirect();
	state.apiKey = apiKey || "";
	state.savedSports = loadSavedSports();
	state.catalogScope = state.savedSports.length ? 'favorites' : 'all';
	state.timeRange = getSavedRangeSelection();
	state.timeRangeSelected = true;
	state.lastLoadedAt = getLastLoadedTimestamp();
	syncCatalogScopeButtons();
	setView('catalog');
	if (state.apiKey) {
		const savedRange = getSavedRangeSelection();
		setRangeSelection(savedRange);
		preloadAllRangeViews(state.apiKey);
	}

	el.settingsBtn.addEventListener('click', () => openApiKeyModal());
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

	if (el.sportsSearchInput) {
		el.sportsSearchInput.addEventListener('input', (event) => {
			const nextValue = event.target && event.target.value ? String(event.target.value).trim() : '';
			if (state.view === 'catalog') {
				state.catalogSearch = nextValue;
				renderSportsTable(state.sportsRows);
				return;
			}
			state.resultsSearch = nextValue;
			rerenderActiveResultsView();
		});
	}

	document.querySelectorAll('.scope-btn').forEach((button) => {
		if (button.dataset.scopeBound === 'true') {
			return;
		}
		button.dataset.scopeBound = 'true';
		button.addEventListener('click', () => {
			const scopeKey = button.getAttribute('data-scope') || 'all';
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

	el.backBtn.addEventListener('click', () => {
		state.activeSportKey = "";
		state.rangeButtonsEnabled = true;
		state.timeRangeSelected = false;
		setView('catalog');
		setStatus('Showing sports catalog', 'ok');
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
		if (!state.apiKey) {
			openApiKeyModal();
			return;
		}
		loadUpcomingForSport(sportKey, state.apiKey);
	});

	function logoutCurrentUser() {
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

	el.logoutBtn.addEventListener('click', () => {
		logoutCurrentUser();
	});

	if (el.swapApiKeyBtn) {
		el.swapApiKeyBtn.addEventListener('click', () => {
			logoutCurrentUser();
		});
	}
	document.addEventListener('keydown', (event) => {
		if (event.key === 'Escape' && el.predictionInfoModal && el.predictionInfoModal.classList.contains('is-open')) {
			closePredictionInfoModal();
		}
	});
}

init();
