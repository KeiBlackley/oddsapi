// --- Network and API response helpers ---
async function fetchWithTimeout(url, timeoutMs = NETWORK_TIMEOUT_MS) {
	const controller = new AbortController();
	const timeout = window.setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || NETWORK_TIMEOUT_MS));
	try {
		return await fetch(url, { signal: controller.signal });
	} catch (error) {
		if (error && error.name === 'AbortError') {
			throw new Error('Request timed out.');
		}
		throw error;
	} finally {
		window.clearTimeout(timeout);
	}
}

async function safeReadJson(response, fallbackValue = null) {
	if (!response) {
		return fallbackValue;
	}
	try {
		return await response.json();
	} catch {
		return fallbackValue;
	}
}

function parseHeaderInteger(value) {
	const raw = String(value || '').trim();
	if (!raw) {
		return NaN;
	}
	const match = raw.match(/-?\d+/);
	if (!match) {
		return NaN;
	}
	const parsed = Number(match[0]);
	return Number.isFinite(parsed) ? parsed : NaN;
}

function getApiCreditsUsedFromResponse(response) {
	if (!response || !response.headers || typeof response.headers.get !== 'function') {
		return 0;
	}
	const lastHeader = response.headers.get('x-requests-last');
	const parsedLast = parseHeaderInteger(lastHeader);
	if (Number.isFinite(parsedLast) && parsedLast >= 0) {
		return parsedLast;
	}

	const usedHeader = response.headers.get('x-requests-used');
	const parsedUsed = parseHeaderInteger(usedHeader);
	if (Number.isFinite(parsedUsed) && parsedUsed >= 0 && parsedUsed <= 10) {
		return parsedUsed;
	}
	return 0;
}

function getApiCreditsUsedFromResponses(responses) {
	if (!Array.isArray(responses) || !responses.length) {
		return 0;
	}
	let total = 0;
	for (const response of responses) {
		total += getApiCreditsUsedFromResponse(response);
	}
	return Math.max(0, Math.trunc(total));
}
