// --- Shared runtime constants and pure formatting helpers ---
const STORAGE_KEY = "keieye_home_api_key_v1";
const LEGACY_STORAGE_KEY = "keieye_betting_api_keys";
const SAVED_API_KEYS_KEY = "keieye_saved_api_keys_v1";
const SECURE_MODE_KEY = "keieye_secure_mode_v1";
const SAVED_SPORTS_KEY = "keieye_saved_sports_v1";
const SAVED_SPORTS_BACKUP_KEY = "keieye_saved_sports_backup_v1";
const SAVED_SPORTS_SESSION_KEY = "keieye_saved_sports_session_v1";
const BASE_URL = "https://api.the-odds-api.com/v4";
const CACHE_VERSION = "v1";
const GAME_START_BUFFER_MS = 60 * 1000;
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 365;
const REFRESH_BEFORE_NEXT_GAME_MS = 10 * 60 * 1000;
const DEFAULT_UPCOMING_CARD_WINDOW_HOURS = 24;
const MIN_VISIBLE_WIN_RATE = 50;
const RANGE_SELECTION_KEY = "keieye_selected_range_v1";
const LAST_DATA_LOAD_KEY = "keieye_last_data_load_v1";
const GAME_FILTERS_KEY = "keieye_game_filters_v1";
const REFRESH_VIEW_STATE_KEY = "keieye_refresh_view_state_v1";
const NETWORK_TIMEOUT_MS = 25000;
const MAX_SEARCH_INPUT_LENGTH = 120;
const MAX_API_KEY_LENGTH = 256;
const MAX_SAVED_API_KEYS = 20;

const SPORTSBOOK_KEY = "sportsbet";
const HISTORY_LOOKBACK_DAYS = 3;
const RECENT_RESULTS_LOOKBACK_DAYS = 1;
const MAX_RECENT_RESULTS_LOOKBACK_DAYS = 7;
const ROLLING_HISTORY_MAX_ROWS = 1800;
const ROLLING_HISTORY_MAX_AGE_DAYS = 730;
const HISTORY_RECENT_FORM_DECAY = 0.975;
const PREGAME_PREDICTION_STORE_KEY = "keieye_pregame_predictions_v1";
const PREGAME_PREDICTION_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const BACKTEST_HISTORY_KEY = "keieye_backtest_history_v1";
const BACKTEST_TREND_WINDOW_KEY = "keieye_backtest_trend_window_v1";
const NEXTTEST_HISTORY_KEY = "keieye_nexttest_history_v1";
const EV_TOOLTIP_TEXT = "Compares our probability against the live market odds. If your model says a team has a 60% chance to win, but the bookmaker's odds imply only a 50% chance, you have found +EV (Positive Expected Value).";

const _escapeHtmlMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(value) {
	return String(value).replace(/[&<>"']/g, (ch) => _escapeHtmlMap[ch]);
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
