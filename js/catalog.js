// --- Sports catalog rendering, sorting and favourite toggles ---
function getCatalogSortValue(row, field) {
	if (!row || !field) {
		return "";
	}
	if (field === "key") {
		return row && row.key ? String(row.key).toLowerCase() : "";
	}
	if (field === "title") {
		return row && row.title ? String(row.title).toLowerCase() : "";
	}
	if (field === "group") {
		return row && row.group ? String(row.group).toLowerCase() : "";
	}
	if (field === "active") {
		return row && row.active ? 1 : 0;
	}
	if (field === "outrights") {
		return row && row.has_outrights ? 1 : 0;
	}
	return row && row.title ? String(row.title).toLowerCase() : "";
}

function sortCatalogRows(rows) {
	if (!Array.isArray(rows)) {
		return [];
	}
	const field = state.catalogSort && state.catalogSort.field ? state.catalogSort.field : "title";
	const direction = state.catalogSort && state.catalogSort.direction === "desc" ? -1 : 1;
	return rows.slice().sort((a, b) => {
		const aValue = getCatalogSortValue(a, field);
		const bValue = getCatalogSortValue(b, field);
		if (typeof aValue === "number" && typeof bValue === "number") {
			return (aValue - bValue) * direction;
		}
		const comparison = String(aValue || "").localeCompare(String(bValue || ""), undefined, { sensitivity: "base" });
		return comparison * direction;
	});
}

function renderSportsTable(rows) {
	if (!Array.isArray(rows) || !rows.length) {
		state.sportsRows = [];
		state.sportsByKey = {};
		state.activeSportKey = "";
		el.tableWrap.innerHTML = '<div class="empty">No sports returned by API.</div>';
		syncCatalogScopeButtons();
		return;
	}

	const baseRows = rows.slice().sort((a, b) => {
		const aKey = a && a.key ? String(a.key) : "";
		const bKey = b && b.key ? String(b.key) : "";
		const aFav = isSportSaved(aKey) ? 1 : 0;
		const bFav = isSportSaved(bKey) ? 1 : 0;
		if (aFav !== bFav) {
			return bFav - aFav;
		}
		const aTitle = a && a.title ? String(a.title).toLowerCase() : "";
		const bTitle = b && b.title ? String(b.title).toLowerCase() : "";
		return aTitle.localeCompare(bTitle);
	});

	state.sportsRows = baseRows;
	state.sportsByKey = {};
	for (const row of baseRows) {
		if (row && row.key) {
			state.sportsByKey[String(row.key)] = row;
		}
	}
	syncResultsSportScopeDropdown();

	if (state.catalogScope === 'favorites') {
		for (const savedKey of Array.isArray(state.savedSports) ? state.savedSports : []) {
			const key = String(savedKey || '').trim();
			if (!key || state.sportsByKey[key]) {
				continue;
			}
			state.sportsByKey[key] = {
				key,
				title: key,
				group: 'Saved',
				active: true,
				has_outrights: false,
				isUnlistedFavorite: true
			};
		}
	}

	const searchTerm = String(state.catalogSearch || '').trim().toLowerCase();
	const catalogRows = state.catalogScope === 'favorites'
		? (Array.isArray(state.savedSports) ? state.savedSports : []).map((savedKey) => {
			const key = String(savedKey || '').trim();
			if (!key) {
				return null;
			}
			return state.sportsByKey[key] || {
				key,
				title: key,
				group: 'Saved',
				active: true,
				has_outrights: false,
				isUnlistedFavorite: true
			};
		}).filter(Boolean)
		: baseRows;

	const searchFilteredRows = !searchTerm
		? catalogRows
		: catalogRows.filter((row) => {
			const key = row && row.key ? String(row.key) : '';
			const title = row && row.title ? String(row.title) : '';
			const group = row && row.group ? String(row.group) : '';
			return (key + ' ' + title + ' ' + group).toLowerCase().includes(searchTerm);
		});

	const visibleRows = state.catalogScope === 'favorites'
		? searchFilteredRows.filter((row) => {
			const key = row && row.key ? String(row.key) : '';
			return key && isSportSaved(key);
		})
		: searchFilteredRows;

	const sortedVisibleRows = sortCatalogRows(visibleRows);

	if (!sortedVisibleRows.length) {
		el.tableWrap.innerHTML = '<div class="empty">' + escapeHtml(state.catalogScope === 'favorites' ? 'No favourite sports saved yet.' : 'No sports available.') + '</div>';
		syncCatalogScopeButtons();
		return;
	}

	const body = sortedVisibleRows.map((row) => {
		const key = row && row.key ? String(row.key) : "";
		const title = row && row.title ? String(row.title) : "";
		const group = row && row.group ? String(row.group) : "";
		const activeClass = key === state.activeSportKey ? " active" : "";
		const flashClass = state.favoriteFlash && state.favoriteFlash.sportKey === key
			? (state.favoriteFlash.type === 'removed' ? ' flash-removed' : ' flash-saved')
			: '';
		const isSaved = isSportSaved(key);
		const starClass = isSaved ? " active remove-btn" : "";
		const actionLabel = isSaved ? "Remove sport" : "Save sport";
		const actionCardLabel = title || 'Sport';
		const keyCardLabel = group || 'Group';
		return '<tr class="sport-row' + activeClass + flashClass + '" tabindex="0" data-sport-key="' + escapeHtml(key) + '">'
			+ '<td data-label="' + escapeHtml(actionCardLabel) + '"><button type="button" class="star-btn' + starClass + '" data-star-key="' + escapeHtml(key) + '" aria-label="' + escapeHtml(actionLabel) + '" title="' + escapeHtml(actionLabel) + '"></button></td>'
			+ '<td class="mono" data-label="' + escapeHtml(keyCardLabel) + '">' + escapeHtml(key) + '</td>'
			+ '<td data-label="Title">' + escapeHtml(title) + '</td>'
			+ '<td data-label="Group">' + escapeHtml(group) + '</td>'
			+ '</tr>';
	}).join("");

	const actionHeader = state.catalogScope === 'favorites' ? 'Remove' : 'Save';
	const sortArrow = (field) => {
		if (state.catalogSort.field !== field) {
			return '';
		}
		return state.catalogSort.direction === 'asc' ? ' ↑' : ' ↓';
	};

	el.tableWrap.innerHTML = '<table><thead><tr><th>' + escapeHtml(actionHeader) + '</th><th data-sort-field="key" class="sortable-header">Key' + sortArrow('key') + '</th><th data-sort-field="title" class="sortable-header">Title' + sortArrow('title') + '</th><th data-sort-field="group" class="sortable-header">Group' + sortArrow('group') + '</th></tr></thead><tbody>' + body + '</tbody></table>';
	syncCatalogScopeButtons();
}

async function loadSportsCatalog(apiKey, options = {}) {
	const shouldSkipLoadStamp = Boolean(options && options.skipLoadStamp === true);
	const forceRefresh = Boolean(options && options.forceRefresh === true);
	let apiCreditsUsed = 0;
	beginBusyOverlay();
	setStatus('Loading sports catalog...', '');
	try {
		const cachedRows = readCache("sports_catalog");
		if (!forceRefresh && Array.isArray(cachedRows) && cachedRows.length) {
			renderSportsTable(cachedRows);
			const visibleCount = state.catalogScope === 'favorites'
				? getLoadedSportsCount()
				: cachedRows.length;
			if (!shouldSkipLoadStamp) {
				const cachedLoadedAt = readCacheTimestamp('sports_catalog');
				markDataLoaded(visibleCount, Number.isFinite(cachedLoadedAt) ? cachedLoadedAt : Date.now());
			}
			setStatus('Sports loaded from cache: ' + visibleCount, 'ok');
			return 0;
		}

		const url = BASE_URL + '/sports/?apiKey=' + encodeURIComponent(apiKey);
		const response = await fetchWithTimeout(url);
		apiCreditsUsed = getApiCreditsUsedFromResponses([response]);
		const payload = await safeReadJson(response, []);

		if (!response.ok) {
			const message = payload && payload.message ? String(payload.message) : (response.statusText || 'Request failed');
			throw new Error(message);
		}

		const rows = Array.isArray(payload) ? payload : [];
		const cacheSavedAt = writeCache("sports_catalog", rows);
		renderSportsTable(rows);
		const visibleCount = state.catalogScope === 'favorites'
			? getLoadedSportsCount()
			: rows.length;
		if (!shouldSkipLoadStamp) {
			markDataLoaded(visibleCount, cacheSavedAt);
		}
		setStatus('Sports loaded: ' + visibleCount, 'ok');
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		const cachedRows = readCache("sports_catalog");
		if (Array.isArray(cachedRows) && cachedRows.length) {
			renderSportsTable(cachedRows);
			setStatus('Live catalog failed: ' + message + '. Showing cached fallback data.', 'error');
		} else {
			setStatus('Failed to load sports catalog: ' + message, 'error');
			el.tableWrap.innerHTML = '<div class="empty">Unable to load sports catalog.</div>';
		}
	} finally {
		endBusyOverlay();
	}
	return apiCreditsUsed;
}
