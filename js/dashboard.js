// --- Dashboard and Break-Even Analysis ---

function getLikelihoodTierColor(pct) {
	if (!Number.isFinite(pct)) { return '#9bb1cb'; }
	if (pct >= 58) { return '#9ee4b7'; }
	if (pct >= 45) { return '#f5c842'; }
	return '#f2a6a6';
}

function getBreakEvenWindowLabel(isRecent, hoursFilter, isLive) {
  if (isLive) { return 'Live'; }
  if (!hoursFilter) { return isRecent ? 'All Recent' : 'All Upcoming'; }
  if (hoursFilter === 24) { return isRecent ? 'Last 24 HRS' : 'Next 24 HRS'; }
  if (hoursFilter === 48) { return isRecent ? 'Last 48 HRS' : 'Next 48 HRS'; }
  if (hoursFilter === 168) { return isRecent ? 'Last 7 Days' : 'Next Week'; }
  if (hoursFilter === 336) { return 'Next Fortnight'; }
  if (hoursFilter === 720) { return 'Last Month'; }
  if (hoursFilter === 8760) { return 'Last Year'; }
  return (isRecent ? 'Last ' : 'Next ') + hoursFilter + 'hrs';
}
// --- Break-Even Analysis (Upcoming view) ---
function buildUpcomingBreakEvenSection(items, scopeLabel, context) {
const STAKE = 100;
const hoursFilter = Math.max(0, Number(state.upcomingBePickLimit) || 0);
const now = Date.now();
const isRecent = context === 'recent';
const isLive = context === 'live';
const windowLabel = getBreakEvenWindowLabel(isRecent, hoursFilter, isLive);
const allPts = [];
for (const item of (Array.isArray(items) ? items : [])) {
if (!item || !item.prediction || !item.prediction.predictedTeam) { continue; }
const lp = Number(item.prediction.leanPct);
if (!Number.isFinite(lp) || lp <= 0) { continue; }
const oddsRaw = item.predictionOdds
|| getBookmakerOddsForPrediction(item.row, item.oddsRow, item.prediction);
const parsedOdds = Number(oddsRaw);
const odds = Number.isFinite(parsedOdds) && parsedOdds > 1 ? parsedOdds : 2;
const result = isRecent
  ? getPredictionResultForCompletedEvent(item.row, item.prediction.predictedTeam).label
  : '';
allPts.push({
label: (item.home || '') + ' vs ' + (item.away || ''),
sport: item.sportTitle || item.sportKey || '',
start: item.start || '',
odds, lp, result,
predictionLabel: item.betName || (item.prediction.label
? String(item.prediction.label).replace(/^Prediction:\s*/i, '') : '')
});
}
const byTime = function(a, b) { return new Date(a.start).getTime() - new Date(b.start).getTime(); };
const sorted = allPts.slice().sort(byTime);
const pts = sorted.filter(function(p) {
  if (isLive) { return true; }
  if (!hoursFilter) { return true; }
  const startTs = new Date(p.start).getTime();
  if (!Number.isFinite(startTs)) { return true; }
  return isRecent
    ? startTs >= now - hoursFilter * 3600000
    : startTs >= now && startTs <= now + hoursFilter * 3600000;
});
const noPicksHtml = !pts.length
  ? '<p class="backtest-note" style="padding:12px 0">No picks with odds found for this window.</p>'
  : null;
const aboveBE = pts.filter(function(p) { return p.odds >= (100 / p.lp); });
const belowBE = pts.filter(function(p) { return p.odds < (100 / p.lp); });
const avgEv = pts.length ? pts.reduce(function(s, p) { return s + (((p.lp / 100) * p.odds) - 1) * 100; }, 0) / pts.length : 0;
const evSign = avgEv >= 0 ? '+'  : '';
const evColor = avgEv >= 0 ? '#9ee4b7' : '#f2a6a6';

// Reusable chart builder
const buildChart = function(picks, dotColor, gradId, strokeColor, fillColor, borderColor) {
  if (!picks.length) { return '<p class="backtest-note">No picks to chart.</p>'; }
  const W = 560, H = 180, ML = 54, MR = 16, MT = 20, MB = 34;
  const plotW = W - ML - MR, plotH = H - MT - MB;
  const sortedPicks = picks.slice().sort(byTime);
  const cumBalances = [];
  let cum = 0;
  const getPickProfit = function(pick) {
    if (!isRecent) { return STAKE * (pick.odds - 1); }
    if (pick.result === 'Won') { return STAKE * (pick.odds - 1); }
    if (pick.result === 'Lost') { return -STAKE; }
    return 0;
  };
  for (let ci = 0; ci < sortedPicks.length; ci++) { cum += getPickProfit(sortedPicks[ci]); cumBalances.push(cum); }
  const cumMax = Math.max.apply(null, cumBalances);
  const cumPad = Math.max(STAKE * 0.15, Math.abs(cumMax) * 0.12 + STAKE * 0.1);
  const yMax = cumMax + cumPad, yMin = Math.min(0, Math.min.apply(null, cumBalances) - cumPad * 0.3);
  const yRange = Math.max(0.01, yMax - yMin);
  const n = sortedPicks.length;
  const toX = function(i) { return ML + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW); };
  const toY = function(v) { return MT + plotH - ((v - yMin) / yRange) * plotH; };
  const axisY = (MT + plotH).toFixed(1);
  let gridSvg = '', yAxisSvg = '';
  for (let t = 0; t <= 5; t++) {
    const val = yMin + (t / 5) * yRange;
    const y = toY(val).toFixed(1);
    gridSvg += '<line x1="' + ML + '" y1="' + y + '" x2="' + (W - MR) + '" y2="' + y + '" stroke="rgba(100,130,170,0.1)" stroke-width="1"/>';
    yAxisSvg += '<text x="' + (ML - 7) + '" y="' + (Number(y) + 4).toFixed(1) + '" font-size="10" fill="#5a7899" text-anchor="end">$' + val.toFixed(2) + '</text>';
  }
  const refY = toY(0).toFixed(1);
  gridSvg += '<line x1="' + ML + '" y1="' + refY + '" x2="' + (W - MR) + '" y2="' + refY + '" stroke="rgba(180,185,215,0.4)" stroke-width="1.5" stroke-dasharray="5 3"/>';
  yAxisSvg += '<text transform="rotate(-90)" x="-' + (MT + plotH / 2).toFixed(0) + '" y="13" font-size="9" fill="#4a6a8a" text-anchor="middle" letter-spacing="0.06em">PROFIT ($' + STAKE.toFixed(2) + ' stake)</text>';
  const pathD = cumBalances.map(function(b, i) { return (i === 0 ? 'M' : 'L') + toX(i).toFixed(1) + ',' + toY(b).toFixed(1); }).join(' ');
  const areaD = pathD + ' L' + toX(n - 1).toFixed(1) + ',' + refY + ' L' + ML + ',' + refY + ' Z';
  let dotsSvg = '', xAxisSvg = '', runBal = 0;
  const labelStep = Math.max(1, Math.ceil(n / 10));
  for (let i = 0; i < n; i++) {
    const p = sortedPicks[i];
    const pickProfit = getPickProfit(p);
    runBal += pickProfit;
    const cx = toX(i).toFixed(1), cy = toY(runBal).toFixed(1);
    const profitSign = runBal >= 0 ? '+' : '';
    const pickProfitText = pickProfit < 0 ? '-$' + Math.abs(pickProfit).toFixed(2) : '+$' + pickProfit.toFixed(2);
    const tip = escapeHtml([p.label || ('Bet ' + (i + 1)), 'Predicted: ' + (p.predictionLabel || '\u2014'), '$' + STAKE.toFixed(2) + ' \u2192 $' + (p.odds * STAKE).toFixed(2) + ' (odds ' + p.odds.toFixed(2) + ')', 'Result: ' + (p.result || 'Projected'), 'Profit: ' + pickProfitText, 'Running: ' + profitSign + '$' + runBal.toFixed(2)].join('\n'));
    dotsSvg += '<circle cx="' + cx + '" cy="' + cy + '" r="7" fill="rgba(255,255,255,0.05)"/>';
    dotsSvg += '<circle cx="' + cx + '" cy="' + cy + '" r="5" fill="' + dotColor + '" stroke="rgba(0,0,0,0.45)" stroke-width="1.5" style="cursor:pointer"><title>' + tip + '</title></circle>';
    if (n <= 12) { dotsSvg += '<text x="' + cx + '" y="' + (Number(cy) - 11).toFixed(1) + '" font-size="9" fill="' + dotColor + '" text-anchor="middle" font-weight="700" opacity="0.9">' + profitSign + '$' + runBal.toFixed(2) + '</text>'; }
    if (i === 0 || i === n - 1 || i % labelStep === 0) {
      const stamp = p.start ? new Date(p.start) : null;
      const lbl = stamp && Number.isFinite(stamp.getTime()) ? stamp.toLocaleDateString([], { month: 'short', day: 'numeric' }) : String(i + 1);
      xAxisSvg += '<text x="' + cx + '" y="' + (Number(axisY) + 15).toFixed(1) + '" font-size="9" fill="#5a7899" text-anchor="middle">' + escapeHtml(lbl) + '</text>';
    }
  }
  const finalX = toX(n - 1).toFixed(1), badgeY = (MT + plotH / 2).toFixed(1);
  const totalSign = runBal >= 0 ? '+' : '';
  return '<svg class="dashboard-chart-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet">'
    + '<defs><linearGradient id="' + gradId + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="' + fillColor + '"/><stop offset="100%" stop-color="rgba(0,0,0,0)"/></linearGradient></defs>'
    + '<line x1="' + ML + '" y1="' + MT + '" x2="' + ML + '" y2="' + axisY + '" stroke="rgba(100,130,170,0.28)" stroke-width="1"/>'
    + '<line x1="' + ML + '" y1="' + axisY + '" x2="' + (W - MR) + '" y2="' + axisY + '" stroke="rgba(100,130,170,0.28)" stroke-width="1"/>'
    + gridSvg + yAxisSvg
    + '<path d="' + areaD + '" fill="url(#' + gradId + ')"/>'
    + '<path d="' + pathD + '" stroke="' + strokeColor + '" stroke-width="2.5" fill="none" stroke-linejoin="round" stroke-linecap="round"/>'
    + dotsSvg + xAxisSvg
    + '<rect x="' + (Number(finalX) - 28) + '" y="' + (Number(badgeY) - 11) + '" width="58" height="18" rx="5" fill="rgba(14,24,38,0.88)" stroke="' + borderColor + '" stroke-width="1"/>'
    + '<text x="' + (Number(finalX) + 1) + '" y="' + (Number(badgeY) + 4) + '" font-size="10" fill="' + dotColor + '" text-anchor="middle" font-weight="700">' + escapeHtml(totalSign + '$' + runBal.toFixed(2)) + '</text>'
    + '</svg>';
};

// Above-BE, below-BE, all-picks, and per-sport chart panels (JS toggles visibility)
const allChartHtml = '<div class="be-chart-panel" id="beChartAll">' + buildChart(pts, '#c4b5fd', 'cg_be_all', 'rgba(196,181,253,0.8)', 'rgba(196,181,253,0.26)', 'rgba(196,181,253,0.35)') + '</div>';
const aboveChartHtml = '<div class="be-chart-panel" id="beChartAbove" style="display:none">' + buildChart(aboveBE, '#9ee4b7', 'cg_be_above', 'rgba(158,228,183,0.8)', 'rgba(158,228,183,0.26)', 'rgba(158,228,183,0.35)') + '</div>';
const belowChartHtml = '<div class="be-chart-panel" id="beChartBelow" style="display:none">' + buildChart(belowBE, '#f2a6a6', 'cg_be_below', 'rgba(242,166,166,0.8)', 'rgba(242,166,166,0.26)', 'rgba(242,166,166,0.35)') + '</div>';
const uniqueSports = [];
pts.forEach(function(p) { if (p.sport && uniqueSports.indexOf(p.sport) === -1) { uniqueSports.push(p.sport); } });
const sportChartsHtml = uniqueSports.map(function(sport) {
  const sportPts = pts.filter(function(p) { return p.sport === sport; });
  var safeSport = sport.replace(/[^a-z0-9]/gi, '_');
  var safeId = 'beChartSport_' + safeSport;
  var safeGradId = 'cg_be_' + safeSport;
  return '<div class="be-chart-panel" id="' + escapeHtml(safeId) + '" style="display:none">' + buildChart(sportPts, '#93c5fd', safeGradId, 'rgba(147,197,253,0.8)', 'rgba(147,197,253,0.26)', 'rgba(147,197,253,0.35)') + '</div>';
}).join('');

const legendHtml = '<div class="dashboard-legend">'
+ '<span class="dashboard-legend-item"><span class="dashboard-legend-dot" style="background:#9ee4b7"></span>Above break-even</span>'
+ '<span class="dashboard-legend-item"><span class="dashboard-legend-dot" style="background:#f2a6a6"></span>Below break-even</span>'
+ '</div>';

return '<section class="backtest-card be-upcoming-section" aria-label="Break-even analysis">'
+ '<div class="backtest-head">'
+ '<h3 class="be-graph-title">' + escapeHtml(windowLabel) + '</h3>'
+ '<button type="button" class="backtest-collapse-btn" aria-expanded="true" aria-label="Collapse"><i class="fa-solid fa-chevron-down" aria-hidden="true"></i></button>'
+ '</div>'
+ (noPicksHtml || (allChartHtml + aboveChartHtml + belowChartHtml + sportChartsHtml))
+ legendHtml
+ '<div class="summary-strip" id="beUpcomingStrip">'
+ '<div class="summary-stat be-upcoming-filter be-stat-btn" data-be-upcoming-filter="above" title="Click to filter games"><span class="summary-label">Above break-even</span><strong style="color:#9ee4b7">' + escapeHtml(String(aboveBE.length)) + '</strong></div>'
+ '<div class="summary-stat be-upcoming-filter be-stat-btn" data-be-upcoming-filter="below" title="Click to filter games"><span class="summary-label">Below break-even</span><strong style="color:#f2a6a6">' + escapeHtml(String(belowBE.length)) + '</strong></div>'
+ '<div class="summary-stat"><span class="summary-label">Avg EV</span><strong style="color:' + evColor + '">' + escapeHtml(evSign + avgEv.toFixed(1) + '%') + '</strong></div>'
+ '<div class="summary-stat"><span class="summary-label">Picks</span>'
+ '<select id="beUpcomingPickLimit" class="sport-scope-select" style="margin-top:4px" aria-label="Limit picks">'
+ (isRecent
  ? [
      [0, 'All Recent'], [24, 'Last 24h'], [48, 'Last 48h'], [720, 'Last Month'], [8760, 'Last Year']
    ]
  : [
      [0, 'All Upcoming'], [24, 'Next 24h'], [48, 'Next 48h'], [168, 'Next Week'], [336, 'Next Fortnight']
    ]
  ).map(function(opt) { return '<option value="' + opt[0] + '"' + (opt[0] === hoursFilter ? ' selected' : '') + '>' + escapeHtml(opt[1]) + '</option>'; }).join('')
+ '</select></div>'
+ '</div>'
+ '</section>';
}

function initUpcomingBreakEvenFilter() {
if (!el.upcomingWrap) { return; }
if (el.upcomingWrap.dataset.beFilterBound === 'true') { return; }
el.upcomingWrap.dataset.beFilterBound = 'true';
el.upcomingWrap.addEventListener('change', function(e) {
if (!(e.target instanceof Element)) { return; }
const sel = e.target.closest('#beUpcomingPickLimit');
if (!sel) { return; }
const val = Number(sel.value);
state.upcomingBePickLimit = Number.isFinite(val) && val >= 0 ? val : 0;
if (state.view === 'recent') {
  state.recentResultsLookbackDays = val > 0
    ? Math.max(1, Math.ceil(val / 24))
    : MAX_RECENT_RESULTS_LOOKBACK_DAYS;
  rerenderActiveResultsView();
  if (state.activeSportKey) {
    loadRecentResultsForSport(state.activeSportKey, state.apiKey, { forceRefresh: true });
  } else {
    loadRecentResultsForSelectedScope(state.apiKey, { forceRefresh: true });
  }
  return;
}
const activeBeEl = el.upcomingWrap.querySelector('.be-stat-btn.be-stat-active[data-be-upcoming-filter]');
const activeBeFilter = activeBeEl ? activeBeEl.getAttribute('data-be-upcoming-filter') : null;
const activeSportEl = el.upcomingWrap.querySelector('[data-sport-filter].sport-filter-active');
const activeSportFilter = activeSportEl ? activeSportEl.getAttribute('data-sport-filter') : null;
rerenderActiveResultsView();
if (activeBeFilter) {
  el.upcomingWrap.querySelectorAll('.be-stat-btn[data-be-upcoming-filter]').forEach(function(b) {
    if (b.getAttribute('data-be-upcoming-filter') === activeBeFilter) { b.click(); }
  });
}
if (activeSportFilter) {
  el.upcomingWrap.querySelectorAll('[data-sport-filter]').forEach(function(r) {
    if (r.getAttribute('data-sport-filter') === activeSportFilter) { r.click(); }
  });
}
});
el.upcomingWrap.addEventListener('click', function(e) {
const target = e.target instanceof Element ? e.target : null;
if (!target) { return; }

// Sport filter: click on a per-sport row to highlight that sport's cards
const sportRow = target.closest('[data-sport-filter]');
if (sportRow) {
const sport = sportRow.getAttribute('data-sport-filter');
const isActive = sportRow.classList.contains('sport-filter-active');
el.upcomingWrap.querySelectorAll('[data-sport-filter].sport-filter-active').forEach(function(r) { r.classList.remove('sport-filter-active'); });
const allCards = el.upcomingWrap.querySelectorAll('.game-card[data-sport]');
const section = el.upcomingWrap.querySelector('.be-upcoming-section');
const titleEl = section ? section.querySelector('.be-graph-title') : null;
const selectedWindowLabel = getBreakEvenWindowLabel(state.view === 'recent', Number(state.upcomingBePickLimit) || 0, state.timeRange === 'live');
const showChart = function(id, title) {
  if (!section) { return; }
  section.querySelectorAll('.be-chart-panel').forEach(function(p) { p.style.display = 'none'; });
  const panel = section.querySelector('#' + id);
  if (panel) { panel.style.display = ''; }
  if (titleEl) { titleEl.textContent = selectedWindowLabel; }
};
if (isActive) {
  allCards.forEach(function(c) { c.classList.remove('dash-highlighted', 'be-card-dimmed'); });
  showChart('beChartAll', 'All Picks');
} else {
  sportRow.classList.add('sport-filter-active');
  const safeId = 'beChartSport_' + sport.replace(/[^a-z0-9]/gi, '_');
  showChart(safeId, sport);
  allCards.forEach(function(c) {
    const match = c.getAttribute('data-sport') === sport;
    c.classList.toggle('be-card-dimmed', !match);
    c.classList.toggle('dash-highlighted', match);
  });
}
return;   // exit click handler after sport filter
}

const btn = target.closest('[data-be-upcoming-filter]');
if (!btn) { return; }
const filter = btn.getAttribute('data-be-upcoming-filter');
const isActive = btn.classList.contains('be-stat-active');
el.upcomingWrap.querySelectorAll('.be-stat-btn[data-be-upcoming-filter]').forEach(function(b) { b.classList.remove('be-stat-active'); });
const cards = el.upcomingWrap.querySelectorAll('.game-card[data-be-status]');

// Switch chart panel and title
const section = el.upcomingWrap.querySelector('.be-upcoming-section');
const titleEl = section ? section.querySelector('.be-graph-title') : null;
const showChart = function(id, title) {
  if (!section) { return; }
  section.querySelectorAll('.be-chart-panel').forEach(function(p) { p.style.display = 'none'; });
  const panel = section.querySelector('#' + id);
  if (panel) { panel.style.display = ''; }
  if (titleEl) { titleEl.textContent = getBreakEvenWindowLabel(state.view === 'recent', Number(state.upcomingBePickLimit) || 0, state.timeRange === 'live'); }
};

if (isActive) {
  showChart('beChartAll', 'All Picks');
  el.upcomingWrap.querySelectorAll('.game-card').forEach(function(c) { c.classList.remove('be-card-dimmed', 'result-win', 'result-loss'); });
} else {
  btn.classList.add('be-stat-active');
  showChart(filter === 'above' ? 'beChartAbove' : 'beChartBelow', filter === 'above' ? 'Above Break-Even' : 'Below Break-Even');
  el.upcomingWrap.querySelectorAll('.game-card').forEach(function(c) {
    const status = c.getAttribute('data-be-status');
    const show = status && ((filter === 'above' && status === 'above') || (filter === 'below' && status === 'below'));
    c.classList.toggle('be-card-dimmed', !show);
    if (show) { c.classList.add(filter === 'above' ? 'result-win' : 'result-loss'); }
  });
}
});
}
