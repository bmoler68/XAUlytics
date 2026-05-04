(function () {
  const config = window.XAULYTICS_DASHBOARD_CONFIG;
  if (!config || !config.supabaseUrl || !config.supabaseAnonKey) {
    document.body.innerHTML =
      "<main style='padding:1rem;font-family:Segoe UI,Arial,sans-serif;'>Missing dashboard config. Copy dashboard/config.example.js to dashboard/config.js and set Supabase URL + anon key.</main>";
    return;
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

  const metals = Array.isArray(config.preciousMetals) ? config.preciousMetals : ["XAU", "XAG", "XPT", "XPD", "XRH"];
  const historyDays = Number(config.historyDays || 120);
  const supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
    db: { schema: config.schema || "xaulytics" },
  });

  const pricesRelation = config.pricesRelation || "metal_prices_current";
  const symbolsRelation = config.symbolsRelation || "metalprice_api_symbols_current";

  let selectedMetal = metals[0];
  let trendChart = null;
  /** @type {Record<string, string>} */
  let symbolLabels = {};

  let currencySelectBound = false;

  function escapeHtml(text) {
    if (text == null || text === "") return "";
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function isoAddDays(iso, days) {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function isoSubtractMonths(iso, months) {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - months);
    return d.toISOString().slice(0, 10);
  }

  /** seriesAsc sorted by pricing_date ascending */
  function findSpotOnOrBefore(seriesAsc, targetIso) {
    let price = null;
    for (let i = seriesAsc.length - 1; i >= 0; i--) {
      if (seriesAsc[i].pricing_date <= targetIso) {
        price = Number(seriesAsc[i].price_base);
        break;
      }
    }
    return price;
  }

  function pctReturn(fromPrice, toPrice) {
    if (fromPrice == null || toPrice == null || Number.isNaN(fromPrice) || Number.isNaN(toPrice) || fromPrice === 0) {
      return null;
    }
    return ((toPrice / fromPrice) - 1) * 100;
  }

  async function fetchSpotSeriesAscending(metal) {
    const { data, error } = await supabase
      .from(pricesRelation)
      .select("pricing_date,price_base")
      .eq("base_currency", currentBaseCurrency)
      .eq("quote_code", metal)
      .order("pricing_date", { ascending: true });
    if (error) throw error;
    return data || [];
  }

  function buildPerformancePeriods(seriesAsc) {
    const empty = [
      { label: "Today", pct: null },
      { label: "30 days", pct: null },
      { label: "6 months", pct: null },
      { label: "1 year", pct: null },
      { label: "5 years", pct: null },
    ];
    if (!seriesAsc.length) return empty;

    const last = seriesAsc[seriesAsc.length - 1];
    const latestDate = last.pricing_date;
    const latestPx = Number(last.price_base);
    const prevRow = seriesAsc.length >= 2 ? seriesAsc[seriesAsc.length - 2] : null;
    const todayPct = prevRow ? pctReturn(Number(prevRow.price_base), latestPx) : null;

    const t30 = isoAddDays(latestDate, -30);
    const t6m = isoSubtractMonths(latestDate, 6);
    const t1y = isoSubtractMonths(latestDate, 12);
    const t5y = isoSubtractMonths(latestDate, 60);

    return [
      { label: "Today", pct: todayPct },
      { label: "30 days", pct: pctReturn(findSpotOnOrBefore(seriesAsc, t30), latestPx) },
      { label: "6 months", pct: pctReturn(findSpotOnOrBefore(seriesAsc, t6m), latestPx) },
      { label: "1 year", pct: pctReturn(findSpotOnOrBefore(seriesAsc, t1y), latestPx) },
      { label: "5 years", pct: pctReturn(findSpotOnOrBefore(seriesAsc, t5y), latestPx) },
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
      "Today compares the latest published day to the prior published day. Other rows use the latest spot vs the last available price on or before the calendar lookback (30 days; 6, 12, and 60 months). Long horizons need enough daily history in the database.";
    tbody.innerHTML = periodRows
      .map((r) => {
        const cls =
          r.pct == null || Number.isNaN(r.pct) ? "" : r.pct >= 0 ? "change-positive" : "change-negative";
        const cell = r.pct == null || Number.isNaN(r.pct) ? "N/A" : pct(r.pct);
        return `<tr><td>${escapeHtml(r.label)}</td><td class="${cls}">${cell}</td></tr>`;
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
      const displayLine = symbolLabels[metal]
        ? `<p class="symbol-display-name">${escapeHtml(symbolLabels[metal])}</p>`
        : "";

      card.innerHTML = `
        <h3>${metal}</h3>
        ${displayLine}
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

    const periodRows = buildPerformancePeriods(spotSeries);
    renderPerformanceTable(periodRows, metal);

    const byDate = new Map();
    for (const row of data || []) {
      const date = row.pricing_date;
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

    renderTrendChart(rows, metal);
    renderHistoryTable(rows);
  }

  function renderTrendChart(rows, metal) {
    const labels = rows.map((r) => r.date);
    const spotData = rows.map((r) => r.spot);
    const spreadData = rows.map((r) => r.spread);
    const ctx = document.getElementById("trend-chart");
    if (trendChart) trendChart.destroy();
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
        maintainAspectRatio: true,
        scales: {
          y: { type: "linear", position: "left" },
          y1: { type: "linear", position: "right", grid: { drawOnChartArea: false } },
        },
      },
    });
  }

  function renderHistoryTable(rows) {
    const tbody = document.getElementById("history-tbody");
    const recent = [...rows].reverse().slice(0, 30);
    tbody.innerHTML = recent
      .map(
        (r) => `
        <tr>
          <td>${r.date}</td>
          <td>${fmt(r.spot, 2)}</td>
          <td>${fmt(r.bid, 2)}</td>
          <td>${fmt(r.ask, 2)}</td>
          <td>${fmt(r.spread, 4)}</td>
          <td>${signed(r.deltaAmount, 2)}</td>
          <td>${pct(r.deltaPercent)}</td>
        </tr>
      `
      )
      .join("");
  }

  function showError(err) {
    const message = err && err.message ? err.message : String(err);
    const cards = document.getElementById("cards");
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
    symbolLabels = await fetchSymbolLabels();
    await loadDashboardData();
  }

  boot().catch(showError);
})();
