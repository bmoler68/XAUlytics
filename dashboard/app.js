(function () {
  const config = window.XAULYTICS_DASHBOARD_CONFIG;
  if (!config || !config.supabaseUrl || !config.supabaseAnonKey) {
    document.body.innerHTML =
      "<main style='padding:1rem;font-family:Segoe UI,Arial,sans-serif;'>Missing dashboard config. Copy dashboard/config.example.js to dashboard/config.js and set Supabase URL + anon key.</main>";
    return;
  }

  const baseCurrency = (config.baseCurrency || "USD").toUpperCase();
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

  function escapeHtml(text) {
    if (text == null || text === "") return "";
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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
      .eq("base_currency", baseCurrency)
      .eq("quote_code", metals[0])
      .order("pricing_date", { ascending: false })
      .limit(1);
    if (error) throw error;
    if (!data || data.length === 0) throw new Error("No market data rows found.");
    return data[0].pricing_date;
  }

  async function fetchPreviousPricingDate(latestDate) {
    const { data, error } = await supabase
      .from(pricesRelation)
      .select("pricing_date")
      .eq("base_currency", baseCurrency)
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
      .eq("base_currency", baseCurrency)
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
    document.getElementById("as-of-label").textContent = `As of ${latestDate} (${baseCurrency})`;

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
        <div class="spot">${fmt(now.spot, 2)} ${baseCurrency}</div>
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
    document.getElementById("detail-subtitle").textContent = `${baseCurrency} spot, bid, ask, and spread history`;

    const codes = [metal, `${metal}-BID`, `${metal}-ASK`];
    const { data, error } = await supabase
      .from(pricesRelation)
      .select("pricing_date,quote_code,price_base")
      .eq("base_currency", baseCurrency)
      .in("quote_code", codes)
      .order("pricing_date", { ascending: false })
      .limit(historyDays * 3);
    if (error) throw error;

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
        const delta = prior && r.spot != null && prior.spot != null && prior.spot !== 0
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
            label: `${metal} Spot (${baseCurrency})`,
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
    cards.innerHTML = `<article class="card">Error loading dashboard data: ${message}</article>`;
  }

  async function boot() {
    symbolLabels = await fetchSymbolLabels();
    const latestDate = await fetchLatestPricingDate();
    const priorDate = await fetchPreviousPricingDate(latestDate);
    const [latestRows, priorRows] = await Promise.all([fetchRowsByDate(latestDate), fetchRowsByDate(priorDate)]);
    const latestSnap = rowsToSnapshot(latestRows);
    const priorSnap = rowsToSnapshot(priorRows);
    renderCards(latestDate, latestSnap, priorSnap);
    await loadDetail(selectedMetal);
  }

  boot().catch(showError);
})();
