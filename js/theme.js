// --- Accent colour theming ---
const ACCENT_COLOR_KEY = 'keieye_accent_color_v1';
const ACCENT_DEFAULT = '#eab308';

function hexToRgb(hex) {
	const h = String(hex || ACCENT_DEFAULT).replace('#', '');
	const r = parseInt(h.slice(0, 2), 16) || 74;
	const g = parseInt(h.slice(2, 4), 16) || 144;
	const b = parseInt(h.slice(4, 6), 16) || 217;
	return { r, g, b };
}

function getAccentColor() {
	try { return localStorage.getItem(ACCENT_COLOR_KEY) || ACCENT_DEFAULT; } catch { return ACCENT_DEFAULT; }
}

function saveAccentColor(hex) {
	try { localStorage.setItem(ACCENT_COLOR_KEY, String(hex || ACCENT_DEFAULT)); } catch {}
}

function applyAccentColor(hex) {
	const { r, g, b } = hexToRgb(hex);
	window.__accentRgb = { r, g, b };
	// Perceived luminance: dark accent → white text, light accent → black text
	const lum = 0.299 * r + 0.587 * g + 0.114 * b;
	const tx  = lum > 155 ? '#111111' : '#ffffff';  // foreground on accent bg
	const txS = lum > 155 ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.75)'; // subdued
	let style = document.getElementById('accent-color-style');
	if (!style) {
		style = document.createElement('style');
		style.id = 'accent-color-style';
		document.head.appendChild(style);
	}
	style.textContent = [
		`.table-wrap,.saved-sport-group{border-color:rgba(${r},${g},${b},0.32)!important}`,
		/* catalog containers: accent-tinted backgrounds */
		`.table-wrap{background:linear-gradient(180deg,rgba(${r},${g},${b},0.12),rgba(${Math.round(r*0.6)},${Math.round(g*0.6)},${Math.round(b*0.6)},0.06))!important}`,
		`.subcard{background:rgba(6,8,12,0.98)!important;border-color:rgba(40,50,65,0.7)!important}`,
		`.panel{border-color:rgba(${r},${g},${b},0.28)!important;background:linear-gradient(180deg,rgba(${r},${g},${b},0.07),rgba(${Math.round(r*0.4)},${Math.round(g*0.4)},${Math.round(b*0.4)},0.02))!important}`,
		`.panel-head-row{border-bottom:1px solid rgba(${r},${g},${b},0.22)!important}`,
		`.summary-stat{border-color:rgba(${r},${g},${b},0.22)!important;background:linear-gradient(180deg,rgba(${r},${g},${b},0.1),rgba(${Math.round(r*0.5)},${Math.round(g*0.5)},${Math.round(b*0.5)},0.04))!important}`,
		`.meta-pill,.odds-pill{border-color:rgba(${r},${g},${b},0.32)!important;background:rgba(${r},${g},${b},0.14)!important}`,
		`.meta-pill.tier-neutral{border-color:rgba(${r},${g},${b},0.22)!important;background:rgba(${r},${g},${b},0.1)!important}`,
		`th{background:linear-gradient(180deg,rgba(${r},${g},${b},0.42),rgba(${Math.round(r*0.7)},${Math.round(g*0.7)},${Math.round(b*0.7)},0.32))!important;border-bottom-color:rgba(${r},${g},${b},0.4)!important}`,
		`tbody tr:nth-child(even):not(.prediction-row){background:rgba(${r},${g},${b},0.06)!important}`,
		`td{border-bottom-color:rgba(${r},${g},${b},0.18)!important}`,
		`.sport-row:hover{background:rgba(${r},${g},${b},0.14)!important}`,
		`.sport-row.active{background:rgba(${r},${g},${b},0.22)!important}`,
		`.empty,.loading-panel{border-color:rgba(${r},${g},${b},0.22)!important;background:rgba(${r},${g},${b},0.06)!important}`,
		`.backtest-card{border-color:rgba(${r},${g},${b},0.22)!important;background:linear-gradient(180deg,rgba(${r},${g},${b},0.1),rgba(${Math.round(r*0.5)},${Math.round(g*0.5)},${Math.round(b*0.5)},0.04))!important}`,
		`.backtest-sport-row:hover{background:rgba(${r},${g},${b},0.12)!important;border-color:rgba(${r},${g},${b},0.35)!important}`,
		`.backtest-sport-row.sport-filter-active{background:rgba(${r},${g},${b},0.22)!important;border-color:rgba(${r},${g},${b},0.55)!important}`,
		`.be-stat-btn:hover{border-color:rgba(${r},${g},${b},0.45)!important;background:rgba(${r},${g},${b},0.08)!important}`,
		`.game-card.result-win{border-color:rgba(56,194,124,0.42)!important}`,
		`.game-card.result-loss{border-color:rgba(239,93,93,0.42)!important}`,
		`.game-card.game-card-best{border-color:rgba(245,200,66,0.55)!important}`,
		/* accent for is-current — excludes F (gold) */
		`.shortcut-chip.is-current:not([data-shortcut-key="F"]){border-color:rgba(${r},${g},${b},0.7)!important;background:linear-gradient(180deg,rgba(${r},${g},${b},0.28),rgba(${Math.round(r*0.7)},${Math.round(g*0.7)},${Math.round(b*0.7)},0.28))!important;color:${tx}!important}`,
		`.shortcut-chip.is-current:not([data-shortcut-key="F"]) .shortcut-keycap{color:${tx}}`,
		/* accent for is-active flash — excludes F (gold) */
		`.shortcut-chip.is-active:not([data-shortcut-key="F"]){border-color:rgba(${r},${g},${b},0.96)!important;background:linear-gradient(180deg,rgba(${r},${g},${b},0.92),rgba(${Math.round(r*0.78)},${Math.round(g*0.78)},${Math.round(b*0.78)},0.92))!important;color:${tx}!important;box-shadow:0 0 0 2px rgba(${r},${g},${b},0.3),inset 0 1px 0 rgba(255,255,255,0.12)!important}`,
		`.shortcut-chip.is-active:not([data-shortcut-key="F"]) .shortcut-keycap{color:${tx}}`,
		`.shortcut-chip.is-active:not([data-shortcut-key="F"]) .shortcut-help{color:${txS}}`,
		/* colour picker palette button uses accent */
		`#colorPickerBtn{color:rgba(${r},${g},${b},0.9)!important}`,
		`#settingsBtn{color:rgba(${r},${g},${b},0.9)!important}`,
		`#settingsBtn:hover{color:rgba(${r},${g},${b},1)!important}`,
		`#refreshFeedBtn{color:rgba(${r},${g},${b},0.9)!important}`,
		`#refreshFeedBtn:hover{color:rgba(${r},${g},${b},1)!important}`,
		`#backBtn:not(.catalog-favorite-toggle){border-color:rgba(${r},${g},${b},0.5)!important;background:linear-gradient(180deg,rgba(${r},${g},${b},0.22),rgba(${Math.round(r*0.7)},${Math.round(g*0.7)},${Math.round(b*0.7)},0.14))!important;color:rgba(${r},${g},${b},0.9)!important;box-shadow:0 6px 16px rgba(1,10,22,0.42),inset 0 1px 0 rgba(255,255,255,0.08)!important}`,
		`#backBtn:not(.catalog-favorite-toggle):hover{border-color:rgba(${r},${g},${b},0.75)!important;color:rgba(${r},${g},${b},1)!important}`,
		`#backBtn{color:rgba(${r},${g},${b},0.9)!important}`,
		`#backBtn:hover{color:rgba(${r},${g},${b},1)!important}`,
		/* tooltip popover uses accent */
		`.has-tooltip::after{background:rgba(${r},${g},${b},0.95)!important;border-color:rgba(${r},${g},${b},0.4)!important;color:${tx}!important}`,
		/* loading bar uses accent */
		`.loading-bar{background:rgba(${r},${g},${b},0.1)!important;border-color:rgba(${r},${g},${b},0.28)!important}`,
		`.loading-bar>span{background:linear-gradient(90deg,rgba(${r},${g},${b},0.05),rgba(${r},${g},${b},0.88) 28%,rgba(${Math.min(255,r+60)},${Math.min(255,g+60)},${Math.min(255,b+60)},1) 50%,rgba(${r},${g},${b},0.88) 72%,rgba(${r},${g},${b},0.05))!important;box-shadow:0 0 14px rgba(${r},${g},${b},0.4)!important}`,
		/* status/message bar uses accent */
		`.status{background:linear-gradient(180deg,rgba(${r},${g},${b},0.22),rgba(${Math.round(r*0.7)},${Math.round(g*0.7)},${Math.round(b*0.7)},0.18))!important;border-color:rgba(${r},${g},${b},0.45)!important;color:${tx}!important}`,
		`.status.ok{background:linear-gradient(180deg,rgba(${r},${g},${b},0.96),rgba(${Math.round(r*0.78)},${Math.round(g*0.78)},${Math.round(b*0.78)},0.98))!important;border-color:rgba(${r},${g},${b},0.8)!important;color:${tx}!important}`,
		`.status.error{color:${tx}!important}`,
		`.status.loading::before{border-color:rgba(${r},${g},${b},0.35)!important;border-top-color:rgba(${r},${g},${b},0.95)!important}`,
		/* settings sidenav selects — stronger accent styling */
		`#apiKeyModal .modal-card select:hover{border-color:rgba(${r},${g},${b},0.75)!important}`,
		`#apiKeyModal .modal-card select option{background:rgba(${Math.round(r*0.2)},${Math.round(g*0.2)},${Math.round(b*0.2)},0.98)!important;color:#e6f0fc!important}`,
		/* favourites scope: red hover on sport rows */
		`#tableWrap.scope-favorites .sport-row:hover{background:rgba(239,93,93,0.12)!important}`,
		/* settings modal inputs/selects: dark bg, accent border, light text */
		`#apiKeyModal .modal-card input[type="password"],#apiKeyModal .modal-card input[type="text"],#apiKeyModal .modal-card select{background:rgba(8,16,28,0.96)!important;border-color:rgba(${r},${g},${b},0.5)!important;color:#e6f0fc!important}`,
		`#apiKeyModal .modal-card input[type="password"]::placeholder,#apiKeyModal .modal-card input[type="text"]::placeholder{color:rgba(180,200,230,0.45)!important}`,
		`#apiKeyModal .settings-panel .sport-scope-select{background:rgba(8,16,28,0.96)!important;border-color:rgba(${r},${g},${b},0.5)!important;color:#e6f0fc!important}`,
		`#apiKeyModal .modal-card input:focus,#apiKeyModal .modal-card select:focus{border-color:rgba(${r},${g},${b},0.85)!important;box-shadow:0 0 0 3px rgba(${r},${g},${b},0.18)!important}`,
		`#apiKeyModal .settings-panel .sport-scope-select:focus{border-color:rgba(${r},${g},${b},0.85)!important;box-shadow:0 0 0 3px rgba(${r},${g},${b},0.18)!important}`,
		/* settings panel: scope/range/filter buttons active + hover use accent */
		`.settings-panel .control-btn.is-active,.settings-panel .scope-btn.is-active,.settings-panel .range-btn.is-active,.settings-panel .game-filter-btn.is-active{border-color:rgba(${r},${g},${b},0.88)!important;background:linear-gradient(180deg,rgba(${r},${g},${b},0.9),rgba(${Math.round(r*0.78)},${Math.round(g*0.78)},${Math.round(b*0.78)},0.9))!important;color:${tx}!important}`,
		`.settings-panel .control-btn.is-active:hover,.settings-panel .scope-btn.is-active:hover,.settings-panel .range-btn.is-active:hover,.settings-panel .game-filter-btn.is-active:hover{border-color:rgba(${r},${g},${b},0.7)!important;background:linear-gradient(180deg,rgba(${Math.round(r*0.78)},${Math.round(g*0.78)},${Math.round(b*0.78)},0.9),rgba(${Math.round(r*0.6)},${Math.round(g*0.6)},${Math.round(b*0.6)},0.9))!important;color:${tx}!important}`,
		`.settings-panel .scope-btn:hover,.settings-panel .range-btn:hover,.settings-panel .game-filter-btn:hover{border-color:rgba(${r},${g},${b},0.55)!important;background:rgba(${r},${g},${b},0.18)!important;color:${tx}!important}`,
		/* high-specificity overrides matching exact static CSS selectors */
		`.settings-panel .scope-btn[data-scope="all"].is-active,.settings-panel .scope-btn[data-scope="all"]:hover,.settings-panel .scope-btn[data-scope="all"].is-active:hover,.settings-panel .scope-btn[data-scope="all"]:focus-visible{border-color:rgba(${r},${g},${b},0.88)!important;background:linear-gradient(180deg,rgba(${r},${g},${b},0.9),rgba(${Math.round(r*0.78)},${Math.round(g*0.78)},${Math.round(b*0.78)},0.9))!important;color:${tx}!important}`,
		`.settings-panel .range-btn[data-range="today"].is-active,.settings-panel .range-btn[data-range="today"]:hover,.settings-panel .range-btn[data-range="today"].is-active:hover,.settings-panel .range-btn[data-range="today"]:focus-visible,.settings-panel .range-btn[data-range="pastWeek"].is-active,.settings-panel .range-btn[data-range="pastWeek"]:hover,.settings-panel .range-btn[data-range="pastWeek"].is-active:hover,.settings-panel .range-btn[data-range="pastWeek"]:focus-visible,.settings-panel .range-btn[data-range="live"].is-active,.settings-panel .range-btn[data-range="live"]:hover,.settings-panel .range-btn[data-range="live"].is-active:hover,.settings-panel .range-btn[data-range="live"]:focus-visible,.settings-panel .game-filter-btn.is-active,.settings-panel .game-filter-btn:hover,.settings-panel .game-filter-btn.is-active:hover,.settings-panel .game-filter-btn:focus-visible{border-color:rgba(${r},${g},${b},0.88)!important;background:linear-gradient(180deg,rgba(${r},${g},${b},0.9),rgba(${Math.round(r*0.78)},${Math.round(g*0.78)},${Math.round(b*0.78)},0.9))!important;color:${tx}!important}`,
		/* appbar: accent-tinted dark background */
		`.desktop-shortcut-bar{background:linear-gradient(180deg,rgba(${Math.round(r*0.18)},${Math.round(g*0.18)},${Math.round(b*0.18)},0.99),rgba(${Math.round(r*0.1)},${Math.round(g*0.1)},${Math.round(b*0.1)},0.99))!important;border-top-color:rgba(${r},${g},${b},0.3)!important;border-bottom-color:rgba(${r},${g},${b},0.3)!important}`,
	].join('\n');
	document.documentElement.style.setProperty('--accent-r', r);
	document.documentElement.style.setProperty('--accent-g', g);
	document.documentElement.style.setProperty('--accent-b', b);
}

function initTheme() {
	const PRESETS = ['#4a90d9','#8b5cf6','#06b6d4','#10b981','#f97316','#ec4899','#ef4444','#eab308','#64748b','#1a1a1a','#e8edf4','#94a3b8'];
	const saved = getAccentColor();
	applyAccentColor(saved);

	const btn      = document.getElementById('colorPickerBtn');
	const modal    = document.getElementById('colorPickerModal');
	const input    = document.getElementById('accentColorInput');
	const closeBtn = document.getElementById('colorPickerCloseBtn');
	const resetBtn = document.getElementById('colorPickerResetBtn');
	const preview  = document.getElementById('colorPickerPreview');
	const swatches = document.getElementById('colorPickerSwatches');

	function updateUi(hex) {
		if (input)   { input.value = hex; }
		if (preview) { preview.style.background = hex; }
		if (swatches) {
			swatches.querySelectorAll('.color-swatch').forEach(function(s) {
				s.classList.toggle('is-active', s.getAttribute('data-color').toLowerCase() === hex.toLowerCase());
			});
		}
	}

	updateUi(saved);

	if (btn && modal) {
		btn.addEventListener('click', function(e) {
			e.stopPropagation();
			const isOpen = modal.classList.contains('is-open');
			modal.classList.toggle('is-open', !isOpen);
			modal.setAttribute('aria-hidden', isOpen ? 'true' : 'false');
		});
		document.addEventListener('click', function(e) {
			if (modal.classList.contains('is-open') && !modal.contains(e.target) && e.target !== btn) {
				modal.classList.remove('is-open');
				modal.setAttribute('aria-hidden', 'true');
			}
		});
	}

	if (closeBtn && modal) {
		closeBtn.addEventListener('click', function() {
			modal.classList.remove('is-open');
			modal.setAttribute('aria-hidden', 'true');
		});
	}

	if (swatches) {
		swatches.addEventListener('click', function(e) {
			const swatch = e.target instanceof Element ? e.target.closest('.color-swatch') : null;
			if (!swatch) { return; }
			const hex = swatch.getAttribute('data-color');
			applyAccentColor(hex);
			saveAccentColor(hex);
			updateUi(hex);
		});
	}

	if (input) {
		input.addEventListener('input', function() {
			applyAccentColor(input.value);
			saveAccentColor(input.value);
			updateUi(input.value);
		});
	}

	if (resetBtn) {
		resetBtn.addEventListener('click', function() {
			applyAccentColor(ACCENT_DEFAULT);
			saveAccentColor(ACCENT_DEFAULT);
			updateUi(ACCENT_DEFAULT);
		});
	}
}
