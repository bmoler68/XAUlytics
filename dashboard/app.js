(function () {
  const config = window.XAULYTICS_DASHBOARD_CONFIG;
  if (!config || !config.supabaseUrl || !config.supabaseAnonKey) {
    document.body.innerHTML =
      "<main style='padding:1rem;font-family:Segoe UI,Arial,sans-serif;'>Missing dashboard config. Copy dashboard/config.example.js to dashboard/config.js and set Supabase URL + anon key.</main>";
    return;
  }

  function assertSupabaseConfig(cfg) {
    const urlStr = String(cfg.supabaseUrl || "").trim();
    let u;
    try {
      u = new URL(urlStr);
    } catch {
      throw new Error("supabaseUrl must be a valid URL");
    }
    const local =
      u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
    if (u.protocol === "http:" && !local) {
      throw new Error("supabaseUrl must use https:// unless it targets localhost");
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      throw new Error("supabaseUrl must use http: or https:");
    }
    const key = String(cfg.supabaseAnonKey || "").trim();
    if (key.length < 30) {
      throw new Error("supabaseAnonKey is missing or too short (use the project anon key from Supabase)");
    }
  }

  function escapeHtml(text) {
    if (text == null || text === "") return "";
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  try {
    assertSupabaseConfig(config);
  } catch (e) {
    const msg = e && e.message ? e.message : "Invalid dashboard configuration.";
    document.body.innerHTML = `<main style='padding:1rem;font-family:Segoe UI,Arial,sans-serif;'>${escapeHtml(msg)}</main>`;
    return;
  }

  /** Postgres identifiers only (schema / relation names). */
  function sanitizeDbIdentifier(id, fallback) {
    const s = String(id ?? "").trim();
    return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s) ? s : fallback;
  }

  const SESSION_KEY = "xaulytics_base_currency";

  const baseOptions = Array.isArray(config.baseCurrencies) && config.baseCurrencies.length
    ? [...new Set(config.baseCurrencies.map((c) => String(c).trim().toUpperCase()).filter(Boolean))]
    : ["USD", "CAD", "AUD", "EUR", "GBP"];

  let currentBaseCurrency = (config.baseCurrency || baseOptions[0] || "USD").toUpperCase();
  if (!baseOptions.includes(currentBaseCurrency)) {
    currentBaseCurrency = baseOptions[0];
  }
  try {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (stored && baseOptions.includes(stored)) {
      currentBaseCurrency = stored;
    }
  } catch {
    /* ignore private mode */
  }

  const DEFAULT_METALS = ["XAU", "XAG", "XPT", "XPD", "XRH"];
  const metalsRaw = Array.isArray(config.preciousMetals) ? config.preciousMetals : DEFAULT_METALS;
  const metals = (() => {
    const cleaned = [
      ...new Set(
        metalsRaw
          .map((m) => String(m).trim().toUpperCase())
          .filter((m) => /^[A-Z][A-Z0-9]{1,11}$/.test(m))
      ),
    ];
    return cleaned.length ? cleaned : DEFAULT_METALS;
  })();

  const historyDays = Number(config.historyDays || 120);
  const dbSchema = sanitizeDbIdentifier(config.schema, "xaulytics");
  const supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
    db: { schema: dbSchema },
  });

  const pricesRelation = sanitizeDbIdentifier(config.pricesRelation, "metal_prices_current");
  const symbolsRelation = sanitizeDbIdentifier(config.symbolsRelation, "metalprice_api_symbols_current");

  /**
   * PostgREST caps unbounded selects (commonly 1000 rows). Ascending order without a limit
   * returns the oldest slice only, so "latest" was not today — performance Today was wrong.
   */
  const PERFORMANCE_SPOT_ROW_LIMIT = Math.min(
    Math.max(Number(config.performanceSpotRowLimit) || 5000, 500),
    50000
  );

  let selectedMetal = metals[0];
  let trendChart = null;
  let lastDetailRows = [];
  /** @type {Record<string, string>} */
  let symbolLabels = {};

  let currencySelectBound = false;
  let resizeBound = false;

  /** DB/API may return `date` or ISO datetime; string compare must use one shape or anchors break (e.g. 5y → N/A). */
  function normalizePricingDate(value) {
    if (value == null || value === "") return "";
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.toISOString().slice(0, 10);
    }
    const s = String(value);
    return s.length >= 10 ? s.slice(0, 10) : s;
  }

  function isoSubtractMonths(iso, months) {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - months);
    return d.toISOString().slice(0, 10);
  }

  /** Same calendar day N calendar years earlier (UTC). */
  function isoSubtractYears(iso, years) {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCFullYear(d.getUTCFullYear() - years);
    return d.toISOString().slice(0, 10);
  }

  /** Calendar anchor dates for performance (exact-date spot lookups). */
  function performanceAnchorIsoDates(latestDate) {
    const y = Number(latestDate.slice(0, 4));
    return [
      isoSubtractMonths(latestDate, 1),
      isoSubtractMonths(latestDate, 6),
      isoSubtractYears(latestDate, 1),
      isoSubtractYears(latestDate, 5),
      `${y}-01-01`,
    ];
  }

  /** Map pricing_date (normalized) → spot; deduped series has one row per day. */
  function spotMapFromSeries(seriesAsc) {
    const m = new Map();
    for (const r of seriesAsc) {
      const d = normalizePricingDate(r.pricing_date);
      if (!d) continue;
      m.set(d, Number(r.price_base));
    }
    return m;
  }

  function getSpotExact(spotByDate, targetIso) {
    const k = normalizePricingDate(targetIso);
    if (!k || !spotByDate.has(k)) return null;
    return spotByDate.get(k);
  }

  function pctReturn(fromPrice, toPrice) {
    if (fromPrice == null || toPrice == null || Number.isNaN(fromPrice) || Number.isNaN(toPrice) || fromPrice === 0) {
      return null;
    }
    return ((toPrice / fromPrice) - 1) * 100;
  }

  function returnAmount(fromPrice, toPrice) {
    if (fromPrice == null || toPrice == null || Number.isNaN(fromPrice) || Number.isNaN(toPrice)) {
      return null;
    }
    return toPrice - fromPrice;
  }

  /** One row per calendar day (last wins). Spot-only series; bid/ask rows are never queried here. */
  function dedupeSpotRowsByDateAscending(rowsAsc) {
    const out = [];
    for (const r of rowsAsc) {
      const row = { pricing_date: normalizePricingDate(r.pricing_date), price_base: r.price_base };
      if (!row.pricing_date) continue;
      if (out.length && out[out.length - 1].pricing_date === row.pricing_date) {
        out[out.length - 1] = row;
      } else {
        out.push(row);
      }
    }
    return out;
  }

  async function fetchSpotSeriesAscending(metal) {
    const { data, error } = await supabase
      .from(pricesRelation)
      .select("pricing_date,price_base")
      .eq("base_currency", currentBaseCurrency)
      .eq("quote_code", metal)
      .order("pricing_date", { ascending: false })
      .limit(PERFORMANCE_SPOT_ROW_LIMIT);
    if (error) throw error;
    const rows = data || [];
    rows.reverse();
    return dedupeSpotRowsByDateAscending(rows);
  }

  /**
   * Load spots for exact calendar dates (e.g. 5y anchor). The rolling series fetch is capped
   * by PostgREST row limits (~1000 default), so dates years ago are often missing from seriesAsc alone.
   */
  async function fetchSpotPricesForDates(metal, isoDates) {
    const unique = [...new Set(isoDates.map((d) => normalizePricingDate(d)).filter(Boolean))];
    if (!unique.length) return new Map();
    const { data, error } = await supabase
      .from(pricesRelation)
      .select("pricing_date,price_base")
      .eq("base_currency", currentBaseCurrency)
      .eq("quote_code", metal)
      .in("pricing_date", unique);
    if (error) throw error;
    const m = new Map();
    for (const r of data || []) {
      const d = normalizePricingDate(r.pricing_date);
      if (d) m.set(d, Number(r.price_base));
    }
    return m;
  }

  function buildPerformancePeriods(seriesAsc, anchorSpots) {
    const empty = [
      { label: "Today", amount: null, pct: null },
      { label: "YTD", amount: null, pct: null },
      { label: "1 month", amount: null, pct: null },
      { label: "6 months", amount: null, pct: null },
      { label: "1 year", amount: null, pct: null },
      { label: "5 years", amount: null, pct: null },
    ];
    if (!seriesAsc.length) return empty;

    const last = seriesAsc[seriesAsc.length - 1];
    const latestDate = normalizePricingDate(last.pricing_date);
    const latestPx = Number(last.price_base);
    const prevRow = seriesAsc.length >= 2 ? seriesAsc[seriesAsc.length - 2] : null;
    const prevPx = prevRow ? Number(prevRow.price_base) : null;
    const todayPct = prevRow ? pctReturn(prevPx, latestPx) : null;
    const todayAmt = prevRow ? returnAmount(prevPx, latestPx) : null;

    const t1m = isoSubtractMonths(latestDate, 1);
    const t6m = isoSubtractMonths(latestDate, 6);
    const t1y = isoSubtractYears(latestDate, 1);
    const t5y = isoSubtractYears(latestDate, 5);

    const spotByDate = spotMapFromSeries(seriesAsc);
    if (anchorSpots && anchorSpots.size) {
      for (const [k, v] of anchorSpots) {
        spotByDate.set(k, v);
      }
    }
    const p1m = getSpotExact(spotByDate, t1m);
    const p6m = getSpotExact(spotByDate, t6m);
    const p1y = getSpotExact(spotByDate, t1y);
    const p5y = getSpotExact(spotByDate, t5y);

    const dataYear = Number(latestDate.slice(0, 4));
    const ytdStartIso = `${dataYear}-01-01`;
    const pYtd = getSpotExact(spotByDate, ytdStartIso);

    return [
      { label: "Today", amount: todayAmt, pct: todayPct },
      { label: "YTD", amount: returnAmount(pYtd, latestPx), pct: pctReturn(pYtd, latestPx) },
      { label: "1 month", amount: returnAmount(p1m, latestPx), pct: pctReturn(p1m, latestPx) },
      { label: "6 months", amount: returnAmount(p6m, latestPx), pct: pctReturn(p6m, latestPx) },
      { label: "1 year", amount: returnAmount(p1y, latestPx), pct: pctReturn(p1y, latestPx) },
      { label: "5 years", amount: returnAmount(p5y, latestPx), pct: pctReturn(p5y, latestPx) },
    ];
  }

  function renderPerformanceTable(periodRows, metal) {
    const tbody = document.getElementById("performance-tbody");
    const cap = document.getElementById("performance-caption");
    const head = document.getElementById("performance-heading");
    if (!tbody || !cap || !head) return;
    const display = symbolLabels[metal];
    head.textContent = display
      ? `Spot performance (${display}, ${metal}, ${currentBaseCurrency})`
      : `Spot performance (${metal}, ${currentBaseCurrency})`;
    const intro = display
      ? `${display} (${metal}). `
      : "";
    cap.textContent =
      intro +
      `Today compares the latest published day to the prior published day. Each other period uses the spot on the exact same calendar day in the prior month, six months earlier, one calendar year earlier, or five calendar years earlier (UTC), compared to the latest day. YTD uses the spot on January 1 of the data year only when that exact date exists. N/A shows when history is not present.`;
    tbody.innerHTML = periodRows
      .map((r) => {
        const cls =
          r.pct == null || Number.isNaN(r.pct) ? "" : r.pct >= 0 ? "change-positive" : "change-negative";
        let cell;
        if (
          r.pct == null ||
          Number.isNaN(r.pct) ||
          r.amount == null ||
          Number.isNaN(r.amount)
        ) {
          cell = "N/A";
        } else {
          cell = `${signed(r.amount, 2)} ${currentBaseCurrency} (${pct(r.pct)})`;
        }
        return `<tr><td>${escapeHtml(r.label)}</td><td class="${cls}">${escapeHtml(cell)}</td></tr>`;
      })
      .join("");
  }

  function setupBaseCurrencySelect() {
    const sel = document.getElementById("base-currency-select");
    if (!sel) return;

    sel.innerHTML = baseOptions.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
    sel.value = currentBaseCurrency;

    if (!currencySelectBound) {
      currencySelectBound = true;
      sel.addEventListener("change", () => {
        currentBaseCurrency = sel.value;
        try {
          sessionStorage.setItem(SESSION_KEY, currentBaseCurrency);
        } catch {
          /* ignore */
        }
        loadDashboardData().catch(showError);
      });
    } else {
      sel.value = currentBaseCurrency;
    }
  }

  async function fetchSymbolLabels() {
    const { data, error } = await supabase
      .from(symbolsRelation)
      .select("symbol_code,display_name")
      .in("symbol_code", metals);
    if (error) {
      console.warn("Could not load symbol display names:", error.message);
      return {};
    }
    const map = {};
    for (const row of data || []) {
      if (row.symbol_code) map[row.symbol_code] = row.display_name || row.symbol_code;
    }
    return map;
  }

  function fmt(value, digits) {
    if (value == null || Number.isNaN(value)) return "N/A";
    return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
  }

  function signed(value, digits) {
    if (value == null || Number.isNaN(value)) return "N/A";
    const sign = value > 0 ? "+" : "";
    return `${sign}${fmt(value, digits)}`;
  }

  function pct(value) {
    if (value == null || Number.isNaN(value)) return "N/A";
    const sign = value > 0 ? "+" : "";
    return `${sign}${fmt(value, 2)}%`;
  }

  function calcDelta(currentSpot, priorSpot) {
    if (currentSpot == null || priorSpot == null || priorSpot === 0) {
      return { amount: null, percent: null };
    }
    const amount = currentSpot - priorSpot;
    return { amount, percent: (amount / priorSpot) * 100 };
  }

  async function fetchLatestPricingDate() {
    const { data, error } = await supabase
      .from(pricesRelation)
      .select("pricing_date")
      .eq("base_currency", currentBaseCurrency)
      .eq("quote_code", metals[0])
      .order("pricing_date", { ascending: false })
      .limit(1);
    if (error) throw error;
    if (!data || data.length === 0) {
      throw new Error(`No market data for base currency ${currentBaseCurrency}. Run ETL for this base or choose another.`);
    }
    return data[0].pricing_date;
  }

  async function fetchPreviousPricingDate(latestDate) {
    const { data, error } = await supabase
      .from(pricesRelation)
      .select("pricing_date")
      .eq("base_currency", currentBaseCurrency)
      .eq("quote_code", metals[0])
      .lt("pricing_date", latestDate)
      .order("pricing_date", { ascending: false })
      .limit(1);
    if (error) throw error;
    return data && data.length ? data[0].pricing_date : null;
  }

  async function fetchRowsByDate(pricingDate) {
    if (!pricingDate) return [];
    const quoteCodes = [];
    for (const metal of metals) {
      quoteCodes.push(metal, `${metal}-BID`, `${metal}-ASK`);
    }
    const { data, error } = await supabase
      .from(pricesRelation)
      .select("pricing_date,quote_code,base_currency,price_base")
      .eq("base_currency", currentBaseCurrency)
      .eq("pricing_date", pricingDate)
      .in("quote_code", quoteCodes);
    if (error) throw error;
    return data || [];
  }

  function rowsToSnapshot(rows) {
    const map = new Map(rows.map((r) => [r.quote_code, Number(r.price_base)]));
    const cards = {};
    for (const metal of metals) {
      const spot = map.get(metal) ?? null;
      const bid = map.get(`${metal}-BID`) ?? null;
      const ask = map.get(`${metal}-ASK`) ?? null;
      cards[metal] = {
        spot,
        bid,
        ask,
        spread: bid != null && ask != null ? ask - bid : null,
      };
    }
    return cards;
  }

  function renderCards(latestDate, latestSnap, priorSnap) {
    const cardsEl = document.getElementById("cards");
    cardsEl.innerHTML = "";
    document.getElementById("as-of-label").textContent = `As of ${latestDate} 23:59:59 GMT (${currentBaseCurrency})`;

    for (const metal of metals) {
      const now = latestSnap[metal] || {};
      const prev = priorSnap[metal] || {};
      const delta = calcDelta(now.spot, prev.spot);
      const changeClass =
        delta.amount == null ? "" : delta.amount >= 0 ? "change-positive" : "change-negative";

      const card = document.createElement("article");
      card.className = `card ${selectedMetal === metal ? "selected" : ""}`;
      const cardTitle = symbolLabels[metal]
        ? `${escapeHtml(symbolLabels[metal])} (${escapeHtml(metal)})`
        : escapeHtml(metal);

      card.innerHTML = `
        <h3>${cardTitle}</h3>
        <div class="spot">${fmt(now.spot, 2)} ${currentBaseCurrency}</div>
        <div class="metric-row"><span>Bid</span><span>${fmt(now.bid, 2)}</span></div>
        <div class="metric-row"><span>Ask</span><span>${fmt(now.ask, 2)}</span></div>
        <div class="metric-row"><span>Spread</span><span>${fmt(now.spread, 4)}</span></div>
        <div class="metric-row ${changeClass}"><span>Day Change</span><span>${signed(delta.amount, 2)}</span></div>
        <div class="metric-row ${changeClass}"><span>Day Change %</span><span>${pct(delta.percent)}</span></div>
      `;
      card.addEventListener("click", () => {
        selectedMetal = metal;
        renderCards(latestDate, latestSnap, priorSnap);
        loadDetail(metal).catch(showError);
      });
      cardsEl.appendChild(card);
    }
  }

  async function loadDetail(metal) {
    const label = symbolLabels[metal];
    document.getElementById("detail-title").textContent = label ? `${label} (${metal})` : `${metal} Trend`;
    document.getElementById("detail-subtitle").textContent = `${currentBaseCurrency} spot, bid, ask, and spread history`;

    const codes = [metal, `${metal}-BID`, `${metal}-ASK`];
    const [histResult, spotSeries] = await Promise.all([
      supabase
        .from(pricesRelation)
        .select("pricing_date,quote_code,price_base")
        .eq("base_currency", currentBaseCurrency)
        .in("quote_code", codes)
        .order("pricing_date", { ascending: false })
        .limit(historyDays * 3),
      fetchSpotSeriesAscending(metal).catch((e) => {
        console.warn("Spot series for performance table:", e);
        return [];
      }),
    ]);
    const { data, error } = histResult;
    if (error) throw error;

    const lastSpot = spotSeries.length ? spotSeries[spotSeries.length - 1] : null;
    const latestSpotDate = lastSpot ? normalizePricingDate(lastSpot.pricing_date) : "";
    let anchorSpots = new Map();
    if (latestSpotDate) {
      try {
        anchorSpots = await fetchSpotPricesForDates(metal, performanceAnchorIsoDates(latestSpotDate));
      } catch (e) {
        console.warn("Performance anchor spots:", e);
      }
    }

    const periodRows = buildPerformancePeriods(spotSeries, anchorSpots);
    renderPerformanceTable(periodRows, metal);

    const byDate = new Map();
    for (const row of data || []) {
      const date = normalizePricingDate(row.pricing_date);
      if (!date) continue;
      if (!byDate.has(date)) byDate.set(date, { date, spot: null, bid: null, ask: null });
      const item = byDate.get(date);
      if (row.quote_code === metal) item.spot = Number(row.price_base);
      if (row.quote_code === `${metal}-BID`) item.bid = Number(row.price_base);
      if (row.quote_code === `${metal}-ASK`) item.ask = Number(row.price_base);
    }

    const rows = Array.from(byDate.values())
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .slice(-historyDays)
      .map((r, idx, arr) => {
        const prior = idx > 0 ? arr[idx - 1] : null;
        const spread = r.bid != null && r.ask != null ? r.ask - r.bid : null;
        const delta =
          prior && r.spot != null && prior.spot != null && prior.spot !== 0
            ? { amount: r.spot - prior.spot, percent: ((r.spot - prior.spot) / prior.spot) * 100 }
            : { amount: null, percent: null };
        return { ...r, spread, deltaAmount: delta.amount, deltaPercent: delta.percent };
      });

    lastDetailRows = rows;
    renderTrendChart(rows, metal);
    renderHistoryTable(rows);
  }

  function renderTrendChart(rows, metal) {
    const ctx = document.getElementById("trend-chart");
    if (!ctx) return;
    const labels = rows.map((r) => r.date);
    const spotData = rows.map((r) => r.spot);
    const spreadData = rows.map((r) => r.spread);
    if (trendChart) trendChart.destroy();
    const narrow = window.matchMedia("(max-width: 640px)").matches;
    const tickSize = narrow ? 9 : 11;
    trendChart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: `${metal} Spot (${currentBaseCurrency})`,
            data: spotData,
            borderColor: "#f59e0b",
            tension: 0.2,
            yAxisID: "y",
          },
          {
            label: "Spread",
            data: spreadData,
            borderColor: "#22d3ee",
            tension: 0.2,
            yAxisID: "y1",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            labels: {
              boxWidth: narrow ? 12 : 40,
              padding: narrow ? 8 : 12,
              font: { size: narrow ? 10 : 12 },
            },
          },
        },
        scales: {
          x: {
            ticks: {
              maxRotation: narrow ? 50 : 0,
              minRotation: narrow ? 40 : 0,
              autoSkip: true,
              maxTicksLimit: narrow ? 8 : 12,
              font: { size: tickSize },
            },
          },
          y: {
            type: "linear",
            position: "left",
            ticks: { font: { size: tickSize } },
          },
          y1: {
            type: "linear",
            position: "right",
            grid: { drawOnChartArea: false },
            ticks: { font: { size: tickSize } },
          },
        },
      },
    });
  }

  function renderHistoryTable(rows) {
    const tbody = document.getElementById("history-tbody");
    const recent = [...rows].reverse().slice(0, 30);
    tbody.innerHTML = recent
      .map(
        (r) => {
          const changeClass =
            r.deltaAmount == null || Number.isNaN(r.deltaAmount)
              ? ""
              : r.deltaAmount >= 0
                ? "change-positive"
                : "change-negative";
          return `
        <tr>
          <td data-label="Date">${escapeHtml(r.date)}</td>
          <td data-label="Spot">${fmt(r.spot, 2)}</td>
          <td data-label="Bid">${fmt(r.bid, 2)}</td>
          <td data-label="Ask">${fmt(r.ask, 2)}</td>
          <td data-label="Spread">${fmt(r.spread, 4)}</td>
          <td data-label="Daily Change" class="${changeClass}">${signed(r.deltaAmount, 2)}</td>
          <td data-label="Daily Change %" class="${changeClass}">${pct(r.deltaPercent)}</td>
        </tr>
      `;
        }
      )
      .join("");
  }

  function setupResponsiveChartRerender() {
    if (resizeBound) return;
    resizeBound = true;
    let lastViewport = window.matchMedia("(max-width: 640px)").matches;
    let timer = null;

    window.addEventListener("resize", () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const nowViewport = window.matchMedia("(max-width: 640px)").matches;
        if (nowViewport !== lastViewport && lastDetailRows.length) {
          lastViewport = nowViewport;
          renderTrendChart(lastDetailRows, selectedMetal);
        }
      }, 150);
    });
  }

  function showError(err) {
    const message = err && err.message ? err.message : String(err);
    const cards = document.getElementById("cards");
    if (!cards) return;
    cards.innerHTML = `<article class="card">Error loading dashboard data: ${escapeHtml(message)}</article>`;
  }

  async function loadDashboardData() {
    const latestDate = await fetchLatestPricingDate();
    const priorDate = await fetchPreviousPricingDate(latestDate);
    const [latestRows, priorRows] = await Promise.all([fetchRowsByDate(latestDate), fetchRowsByDate(priorDate)]);
    const latestSnap = rowsToSnapshot(latestRows);
    const priorSnap = rowsToSnapshot(priorRows);
    renderCards(latestDate, latestSnap, priorSnap);
    await loadDetail(selectedMetal);
  }

  async function boot() {
    setupBaseCurrencySelect();
    setupResponsiveChartRerender();
    symbolLabels = await fetchSymbolLabels();
    await loadDashboardData();
  }

  boot().catch(showError);
})();
