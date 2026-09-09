(function () {
  "use strict";

  /* Prevent accidental duplicate pastes from booting the app twice. */
  if (window.__PORTFOLIO_AI_BOOTED__) {
    console.warn("Portfolio AI is already running. Remove duplicate JavaScript copies from CodePen.");
    return;
  }
  window.__PORTFOLIO_AI_BOOTED__ = true;

  var API_KEY = "3c2d42ab66f747fc902da8ae6c4e61f6";
  var API_BASE = "https://api.twelvedata.com";

  var GDELT_NEWS_BASE = "https://api.gdeltproject.org/api/v2/doc/doc";

  var CATALOG_ENDPOINTS = {
    Stocks: "/stocks",
    ETFs: "/etf",
    Forex: "/forex_pairs",
    Crypto: "/cryptocurrencies",
    Commodities: "/commodities"
  };

  var RANGE_CONFIG = {
    Investor: {
      "1 Day": 1,
      "1 Week": 5,
      "1 Month": 21,
      "3 Months": 63,
      "6 Months": 126,
      "1 Year": 252,
      "3 Years": 756,
      "5 Years": 1260,
      "10 Years": 2520
    },
    Trader: {
      "1 Day": 1,
      "1 Week": 5,
      "1 Month": 21,
      "3 Months": 63,
      "6 Months": 126,
      "1 Year": 252
    }
  };

  var MAX_SELECTED_ASSETS = 4;
  var CATALOG_CHUNK_SIZE = 2500;
  var MARKET_LOAD_CONCURRENCY = 2;
  var HISTORICAL_OUTPUT_SIZE = 1000;
  var catalogIndex = {};
  var portfolioNewsTimer = null;
  var symbolSearchCache = {};
  var activeSearchResults = [];
  var activeSearchLoading = false;
  var activeSearchToken = 0;
  var fullDirectoryMode = {};



  var POPULAR_ASSETS = {
    Stocks: [
      { symbol: "NVDA", name: "NVIDIA Corporation", aliases: "nvidia nvidia stock graphics gpu ai chip chips" },
      { symbol: "AAPL", name: "Apple Inc.", aliases: "apple iphone mac" },
      { symbol: "MSFT", name: "Microsoft Corporation", aliases: "microsoft windows azure" },
      { symbol: "AMZN", name: "Amazon.com Inc.", aliases: "amazon aws" },
      { symbol: "GOOGL", name: "Alphabet Inc.", aliases: "google alphabet youtube" },
      { symbol: "META", name: "Meta Platforms Inc.", aliases: "meta facebook instagram whatsapp" },
      { symbol: "TSLA", name: "Tesla Inc.", aliases: "tesla electric cars ev" },
      { symbol: "AMD", name: "Advanced Micro Devices Inc.", aliases: "amd chips processors graphics" }
    ],
    ETFs: [
      { symbol: "SPY", name: "SPDR S&P 500 ETF Trust", aliases: "sp500 s&p 500 s and p 500 index etf" },
      { symbol: "QQQ", name: "Invesco QQQ Trust", aliases: "nasdaq nasdaq 100 tech etf" },
      { symbol: "VOO", name: "Vanguard S&P 500 ETF", aliases: "vanguard sp500 s&p 500 etf" },
      { symbol: "IWM", name: "iShares Russell 2000 ETF", aliases: "russell 2000 small cap etf" }
    ],
    Forex: [
      { symbol: "EUR/USD", name: "Euro / US Dollar", aliases: "eurusd euro dollar euro usd" },
      { symbol: "GBP/USD", name: "British Pound / US Dollar", aliases: "gbpusd pound dollar sterling" },
      { symbol: "USD/JPY", name: "US Dollar / Japanese Yen", aliases: "usdjpy dollar yen" },
      { symbol: "USD/ZAR", name: "US Dollar / South African Rand", aliases: "usdzar dollar rand zar south africa" }
    ],
    Crypto: [
      { symbol: "BTC/USD", name: "Bitcoin / US Dollar", aliases: "bitcoin btc btcusd" },
      { symbol: "ETH/USD", name: "Ethereum / US Dollar", aliases: "ethereum ether eth ethusd" },
      { symbol: "SOL/USD", name: "Solana / US Dollar", aliases: "solana sol solusd" },
      { symbol: "XRP/USD", name: "XRP / US Dollar", aliases: "xrp ripple xrpusd" }
    ],
    Commodities: [
      { symbol: "XAU/USD", name: "Gold / US Dollar", aliases: "gold xau xauusd precious metal" },
      { symbol: "XAG/USD", name: "Silver / US Dollar", aliases: "silver xag xagusd precious metal" }
    ]
  };


  var activeMarket = "Stocks";
  var catalogCache = {};
  var catalogLoading = {};
  var selectedAssets = [];
  var marketData = {};
  var portfolioResults = null;
  var aiState = null;
  var forecastChart = null;
  var searchTimer = null;
  var renderLimit = 48;
  var RENDER_STEP = 48;

  var activeNewsFilter = "portfolio";
  var newsLoading = false;
  var newsCache = {};
  var newsCacheTTL = 30 * 60 * 1000;
  var newsInFlight = {};


  function el(id) {
    return document.getElementById(id);
  }

  function escapeHTML(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function numberFormat(value) {
    if (!isFinite(value)) return "—";
    return Number(value).toLocaleString("en-US", { maximumFractionDigits: 0 });
  }

  function marketPrice(value) {
    if (!isFinite(value)) return "—";
    var decimals = 2;
    if (Math.abs(value) < 10) decimals = 4;
    if (Math.abs(value) < 1) decimals = 5;
    return Number(value).toLocaleString("en-US", {
      minimumFractionDigits: Math.min(2, decimals),
      maximumFractionDigits: decimals
    });
  }

  function money(value) {
    if (!isFinite(value)) return "—";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: value < 10 ? 4 : 2
    }).format(value);
  }

  function percent(value, decimals) {
    if (!isFinite(value)) return "—";
    decimals = typeof decimals === "number" ? decimals : 1;
    return (value * 100).toFixed(decimals) + "%";
  }

  function percentRaw(value, decimals) {
    if (!isFinite(value)) return "—";
    decimals = typeof decimals === "number" ? decimals : 2;
    return (value > 0 ? "+" : "") + Number(value).toFixed(decimals) + "%";
  }


  function classifyDataAccessError(message) {
    var text = String(message || "").toLowerCase();

    if (
      text.indexOf("plan") !== -1 ||
      text.indexOf("subscription") !== -1 ||
      text.indexOf("premium") !== -1 ||
      text.indexOf("not available") !== -1 ||
      text.indexOf("permission") !== -1 ||
      text.indexOf("access") !== -1
    ) {
      return "premium";
    }

    if (
      text.indexOf("credit") !== -1 ||
      text.indexOf("rate limit") !== -1 ||
      text.indexOf("too many") !== -1 ||
      text.indexOf("429") !== -1
    ) {
      return "limit";
    }

    return "error";
  }

  function showDataAccessNotice(type, symbol, rawMessage) {
    var notice = el("dataAccessNotice");
    if (!notice) return;

    notice.classList.remove("hidden", "premium", "warning", "error");

    if (type === "premium") {
      notice.classList.add("premium");
      notice.innerHTML =
        '<span class="access-title">Premium market data required</span>' +
        '<span class="access-copy">' +
          escapeHTML(symbol || "This instrument") +
          ' is not available with the current market-data access. Upgrade your data plan or choose another asset.' +
        '</span>' +
        '<span class="access-action">Upgrade data access</span>';
      return;
    }

    if (type === "limit") {
      notice.classList.add("warning");
      notice.innerHTML =
        '<span class="access-title">Data request limit reached</span>' +
        '<span class="access-copy">The provider has temporarily limited requests. Try again shortly.</span>';
      return;
    }

    notice.classList.add("error");
    notice.innerHTML =
      '<span class="access-title">Market data unavailable</span>' +
      '<span class="access-copy">' +
        escapeHTML(rawMessage || "This instrument could not be loaded right now.") +
      '</span>';
  }

  function clearDataAccessNotice() {
    var notice = el("dataAccessNotice");
    if (!notice) return;
    notice.className = "data-access-notice hidden";
    notice.innerHTML = "";
  }

  function setStatus(message, type) {
    var status = el("systemStatus");
    var dot = document.querySelector(".status-dot");

    if (status) status.textContent = message;
    if (!dot) return;

    dot.classList.remove("status-loading", "status-error", "status-success");
    if (type === "loading") dot.classList.add("status-loading");
    if (type === "error") dot.classList.add("status-error");
    if (type === "success") dot.classList.add("status-success");
  }

  function apiRequest(endpoint, parameters) {
    parameters = parameters || {};

    var params = new URLSearchParams();
    var key;

    for (key in parameters) {
      if (
        Object.prototype.hasOwnProperty.call(parameters, key) &&
        parameters[key] !== undefined &&
        parameters[key] !== null &&
        parameters[key] !== ""
      ) {
        params.append(key, parameters[key]);
      }
    }

    params.append("apikey", API_KEY);

    var url = API_BASE + endpoint + "?" + params.toString();

    return fetch(url)
      .then(function (response) {
        if (!response.ok) {
          throw new Error("Twelve Data returned HTTP " + response.status + ".");
        }
        return response.json();
      })
      .then(function (data) {
        if (data && data.status === "error") {
          throw new Error(data.message || "Twelve Data request failed.");
        }
        if (data && data.code && data.message && !data.data && !data.values) {
          throw new Error(data.message);
        }
        return data;
      });
  }

  /* ========================= THEME ========================= */

  function getPreferredTheme() {
    var saved = localStorage.getItem("portfolioAITheme");
    if (saved === "light" || saved === "dark") return saved;

    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      return "dark";
    }
    return "light";
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("portfolioAITheme", theme);

    var button = el("themeToggle");
    if (button) {
      button.setAttribute(
        "aria-label",
        theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
      );
      button.title = theme === "dark" ? "Light appearance" : "Dark appearance";
    }

    syncTradingViewTickerTheme(theme);

    if (portfolioResults) drawForecastChart();
  }

  function toggleTheme() {
    var current = document.documentElement.getAttribute("data-theme") || "light";
    applyTheme(current === "dark" ? "light" : "dark");
  }

  /* ========================= CATALOGUE ========================= */

  function makeAssetKey(asset) {
    return [asset.market || "Market", asset.symbol || "", asset.exchange || ""].join("|");
  }

  function normalizeCatalogueItem(item, market) {
    item = item || {};

    var symbol = item.symbol || "";
    var name = item.name || item.currency_base || symbol;
    var secondary = "";

    if (market === "Forex" || market === "Crypto") {
      if (item.currency_base && item.currency_quote) {
        name = item.currency_base + " / " + item.currency_quote;
      }
    }

    if (market === "Stocks" || market === "ETFs") {
      secondary = [item.exchange || "", item.country || ""].filter(Boolean).join(" · ");
    } else if (market === "Commodities") {
      secondary = item.category || "Commodity";
    } else if (market === "Forex") {
      secondary = item.currency_group || "Forex";
    } else if (market === "Crypto") {
      secondary = "Crypto";
    }

    var asset = {
      symbol: String(symbol),
      name: String(name || symbol),
      market: market,
      exchange: item.exchange || "",
      country: item.country || "",
      currency: item.currency || "",
      category: item.category || item.type || "",
      secondary: secondary,
      short: String(symbol).replace(/[^A-Za-z0-9]/g, "").slice(0, 5)
    };

    asset.key = makeAssetKey(asset);
    return asset;
  }

  function unwrapCatalogueResponse(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.data)) return data.data;
    if (data && data.result && Array.isArray(data.result)) return data.result;
    return [];
  }


  function runWhenIdle(callback, timeout) {
    if (window.requestIdleCallback) {
      window.requestIdleCallback(callback, {
        timeout: timeout || 1000
      });
    } else {
      window.setTimeout(callback, 0);
    }
  }

  function buildCatalogueIndex(market, list) {
    var index = {};
    var i;

    for (i = 0; i < list.length; i++) {
      index[normalizeAssetSearch(list[i].symbol)] = list[i];
    }

    catalogIndex[market] = index;
  }

  function normalizeCatalogueInChunks(raw, market) {
    return new Promise(function (resolve) {
      var normalized = [];
      var index = 0;

      function processChunk() {
        var end = Math.min(
          index + CATALOG_CHUNK_SIZE,
          raw.length
        );

        for (; index < end; index++) {
          var asset = normalizeCatalogueItem(raw[index], market);

          if (asset && asset.symbol) {
            asset._search = (
              asset.symbol + " " +
              asset.name + " " +
              asset.exchange + " " +
              asset.country + " " +
              asset.category + " " +
              asset.secondary
            ).toLowerCase();

            normalized.push(asset);
          }
        }

        if (index < raw.length) {
          runWhenIdle(processChunk, 60);
        } else {
          buildCatalogueIndex(market, normalized);
          resolve(normalized);
        }
      }

      processChunk();
    });
  }

  function schedulePortfolioNewsRefresh() {
    if (activeNewsFilter !== "portfolio") return;

    setNewsProviderHint(
      "Portfolio changed. Press Refresh if you want headlines for the updated selection.",
      ""
    );
  }


  function loadCatalogue(market, forceReload) {
    if (!forceReload && catalogCache[market]) {
      if (!catalogIndex[market]) {
        buildCatalogueIndex(
          market,
          catalogCache[market]
        );
      }

      renderLimit = RENDER_STEP;
      renderAssetGrid();
      updateCatalogueMeta();
      return Promise.resolve(catalogCache[market]);
    }

    if (catalogLoading[market]) return catalogLoading[market];

    var endpoint = CATALOG_ENDPOINTS[market];
    if (!endpoint) return Promise.reject(new Error("Unknown market catalogue."));

    var status = el("catalogStatus");
    var grid = el("assetGrid");

    if (status) status.textContent = "Loading supported " + market.toLowerCase() + "…";
    if (grid) {
      grid.innerHTML = '<div class="catalog-loader"><span></span><p>Loading Twelve Data catalogue…</p></div>';
    }

    setStatus("Loading " + market.toLowerCase() + " catalogue…", "loading");

    catalogLoading[market] = apiRequest(endpoint, {})
      .then(function (data) {
        var raw = unwrapCatalogueResponse(data);
        if (!raw.length) {
          throw new Error("No supported " + market.toLowerCase() + " were returned.");
        }

        if (status) {
          status.textContent =
            "Preparing " +
            numberFormat(raw.length) +
            " supported instruments…";
        }

        return normalizeCatalogueInChunks(raw, market)
          .then(function (normalized) {
            catalogCache[market] = normalized;
            renderLimit = RENDER_STEP;
            renderAssetGrid();
            updateCatalogueMeta();
            setStatus("Catalogue ready", "success");
            return normalized;
          });
      })
      .catch(function (error) {
        console.error(error);
        setStatus("Catalogue error", "error");

        if (status) status.textContent = "Could not load " + market.toLowerCase() + ".";
        if (grid) {
          grid.innerHTML =
            '<div class="large-empty-state"><div class="empty-icon">!</div><strong>Catalogue unavailable</strong><p>' +
            escapeHTML(error.message) +
            '</p></div>';
        }
        throw error;
      })
      .then(
        function (result) {
          catalogLoading[market] = null;
          return result;
        },
        function (error) {
          catalogLoading[market] = null;
          throw error;
        }
      );

    return catalogLoading[market];
  }

  function getSearchText() {
    var search = el("assetSearch");
    return search ? search.value.trim().toLowerCase() : "";
  }

  function getFilteredCatalogue() {
    var list = catalogCache[activeMarket] || [];
    var query = getSearchText();

    if (!query) return list;

    return list.filter(function (asset) {
      var haystack = asset._search || (
        asset.symbol + " " +
        asset.name + " " +
        asset.exchange + " " +
        asset.country + " " +
        asset.category + " " +
        asset.secondary
      ).toLowerCase();

      return haystack.indexOf(query) !== -1;
    });
  }

  function isSelected(assetKey) {
    var i;
    for (i = 0; i < selectedAssets.length; i++) {
      if (selectedAssets[i].key === assetKey) return true;
    }
    return false;
  }


  function normalizeAssetSearch(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  }

  function popularAssetMatches(asset, query) {
    var q = normalizeAssetSearch(query);
    if (!q) return true;

    var haystack = normalizeAssetSearch(
      asset.symbol + " " +
      asset.name + " " +
      (asset.aliases || "")
    );

    return haystack.indexOf(q) !== -1;
  }

  function findCatalogueAsset(market, quickAsset) {
    var wanted = normalizeAssetSearch(quickAsset.symbol);
    var index = catalogIndex[market];

    if (index && index[wanted]) {
      return index[wanted];
    }

    return {
      symbol: quickAsset.symbol,
      name: quickAsset.name,
      market: market,
      exchange: "",
      country: "",
      key: makeAssetKey({
        symbol: quickAsset.symbol,
        market: market,
        exchange: ""
      })
    };
  }



  function marketMatchesInstrumentType(market, instrumentType) {
    var type = String(instrumentType || "").toLowerCase();

    if (market === "Stocks") {
      return (
        type.indexOf("stock") !== -1 ||
        type.indexOf("equity") !== -1 ||
        type.indexOf("common") !== -1 ||
        type.indexOf("preferred") !== -1 ||
        type.indexOf("reit") !== -1
      );
    }

    if (market === "ETFs") {
      return type.indexOf("etf") !== -1;
    }

    if (market === "Forex") {
      return (
        type.indexOf("currency") !== -1 &&
        type.indexOf("digital") === -1 &&
        type.indexOf("crypto") === -1
      ) || type.indexOf("forex") !== -1;
    }

    if (market === "Crypto") {
      return (
        type.indexOf("digital") !== -1 ||
        type.indexOf("crypto") !== -1
      );
    }

    if (market === "Commodities") {
      return type.indexOf("commodity") !== -1;
    }

    return true;
  }

  function resolveFriendlySearchQuery(query, market) {
    var items = POPULAR_ASSETS[market] || [];
    var normalized = normalizeAssetSearch(query);
    var i;

    for (i = 0; i < items.length; i++) {
      if (popularAssetMatches(items[i], query)) {
        var symbolNorm = normalizeAssetSearch(items[i].symbol);
        var nameNorm = normalizeAssetSearch(items[i].name);

        if (
          normalized === symbolNorm ||
          nameNorm.indexOf(normalized) !== -1 ||
          normalizeAssetSearch(items[i].aliases || "").indexOf(normalized) !== -1
        ) {
          return items[i].symbol;
        }
      }
    }

    return query;
  }

  function normalizeSymbolSearchItem(item, market) {
    var symbol = item.symbol || "";
    if (!symbol) return null;

    var asset = {
      symbol: String(symbol),
      name: String(item.instrument_name || item.name || symbol),
      market: market,
      exchange: item.exchange || "",
      country: item.country || "",
      currency: item.currency || "",
      category: item.instrument_type || "",
      secondary: [item.exchange || "", item.country || ""]
        .filter(Boolean)
        .join(" · "),
      short: String(symbol).replace(/[^A-Za-z0-9]/g, "").slice(0, 5),
      accessPlan:
        item.access && item.access.plan
          ? String(item.access.plan)
          : ""
    };

    asset.key = makeAssetKey(asset);
    asset._search = (
      asset.symbol + " " +
      asset.name + " " +
      asset.exchange + " " +
      asset.country + " " +
      asset.category
    ).toLowerCase();

    return asset;
  }

  function searchSymbolsRemote(query, market) {
    var requested = resolveFriendlySearchQuery(query, market);
    var cacheKey =
      market + "|" + normalizeAssetSearch(requested);

    if (symbolSearchCache[cacheKey]) {
      activeSearchResults = symbolSearchCache[cacheKey];
      activeSearchLoading = false;
      renderAssetGrid();
      return Promise.resolve(activeSearchResults);
    }

    activeSearchLoading = true;
    activeSearchResults = [];
    renderAssetGrid();

    var token = ++activeSearchToken;

    return apiRequest("/symbol_search", {
      symbol: requested,
      outputsize: 30,
      show_plan: "true"
    })
      .then(function (data) {
        if (token !== activeSearchToken) return [];

        var raw =
          data && Array.isArray(data.data)
            ? data.data
            : [];

        var normalized = raw
          .filter(function (item) {
            return marketMatchesInstrumentType(
              market,
              item.instrument_type
            );
          })
          .map(function (item) {
            return normalizeSymbolSearchItem(
              item,
              market
            );
          })
          .filter(Boolean);

        symbolSearchCache[cacheKey] = normalized;
        activeSearchResults = normalized;
        activeSearchLoading = false;
        renderAssetGrid();

        return normalized;
      })
      .catch(function (error) {
        if (token !== activeSearchToken) return [];

        activeSearchLoading = false;
        activeSearchResults = [];
        renderAssetGrid();

        var message = el("assetSearchMessage");
        if (message) {
          message.textContent =
            "Search temporarily unavailable.";
        }

        console.warn("Symbol search failed", error);
        return [];
      });
  }

  function scheduleSymbolSearch() {
    var query = getSearchText();

    clearTimeout(searchTimer);

    if (!query) {
      activeSearchToken++;
      activeSearchLoading = false;
      activeSearchResults = [];
      renderAssetGrid();
      return;
    }

    if (query.length < 2) {
      activeSearchToken++;
      activeSearchLoading = false;
      activeSearchResults = [];
      renderAssetGrid();
      return;
    }

    searchTimer = setTimeout(function () {
      searchSymbolsRemote(query, activeMarket);
    }, 420);
  }

  function renderPopularAssets() {
    var section = el("popularAssetsSection");
    var container = el("popularAssets");
    var search = el("assetSearch");
    var query = search ? search.value.trim() : "";

    if (!section || !container) return;

    if (query) {
      section.classList.add("hidden");
      return;
    }

    section.classList.remove("hidden");

    var items = POPULAR_ASSETS[activeMarket] || [];
    var html = "";

    items.forEach(function (quickAsset) {
      var asset = findCatalogueAsset(activeMarket, quickAsset);
      var selected = selectedAssets.some(function (item) {
        return item.symbol === asset.symbol &&
          item.market === activeMarket;
      });
      var disabled =
        !selected &&
        selectedAssets.length >= MAX_SELECTED_ASSETS;

      html +=
        '<button type="button" class="popular-asset' +
          (selected ? " selected" : "") +
          (disabled ? " disabled" : "") +
          '" data-popular-symbol="' +
          escapeHTML(quickAsset.symbol) +
          '">' +
          '<span class="popular-asset-avatar">' +
            escapeHTML(quickAsset.symbol.replace("/USD", "")) +
          '</span>' +
          '<span class="popular-asset-copy">' +
            '<strong>' + escapeHTML(quickAsset.name) + '</strong>' +
            '<span>' + escapeHTML(quickAsset.symbol) + '</span>' +
          '</span>' +
          '<span class="popular-asset-add">' +
            (selected ? "✓" : "+") +
          '</span>' +
        '</button>';
    });

    container.innerHTML = html;
  }

  function renderAssetGrid() {
    renderPopularAssets();

    var grid = el("assetGrid");
    var showMore = el("showMoreAssets");
    var message = el("assetSearchMessage");
    var status = el("catalogStatus");
    var count = el("catalogCount");
    var query = getSearchText();

    if (!grid) return;

    var fullList = catalogCache[activeMarket];
    var useRemoteSearch =
      !!query &&
      !fullDirectoryMode[activeMarket];

    if (useRemoteSearch) {
      if (query.length < 2) {
        grid.innerHTML =
          '<div class="large-empty-state small">' +
            '<strong>Keep typing</strong>' +
            '<p>Enter at least 2 characters to search the full Twelve Data universe.</p>' +
          '</div>';

        if (showMore) showMore.hidden = true;
        if (message) message.textContent = "";
        if (status) status.textContent = "Instant symbol search";
        if (count) count.textContent = "2+ characters";
        return;
      }

      if (activeSearchLoading) {
        grid.innerHTML =
          '<div class="asset-searching-state">' +
            '<span class="mini-spinner"></span>' +
            '<span>Searching Twelve Data…</span>' +
          '</div>';

        if (showMore) showMore.hidden = true;
        if (message) message.textContent = "";
        if (status) status.textContent = "Searching supported instruments…";
        if (count) count.textContent = "Live search";
        return;
      }

      if (!activeSearchResults.length) {
        grid.innerHTML =
          '<div class="large-empty-state small">' +
            '<strong>No matches yet</strong>' +
            '<p>Try a ticker such as NVDA, a company name such as NVIDIA, or another market category.</p>' +
          '</div>';

        if (showMore) showMore.hidden = true;
        if (message) message.textContent = "0 matches";
        if (status) status.textContent = "Search all supported instruments";
        if (count) count.textContent = "Fast search";
        return;
      }

      renderAssetRows(
        activeSearchResults,
        activeSearchResults.length,
        true
      );

      if (status) {
        status.textContent =
          "Search results for “" + query + "”";
      }

      if (count) {
        count.textContent =
          numberFormat(activeSearchResults.length) +
          " results";
      }

      return;
    }

    if (!fullList) {
      grid.innerHTML =
        '<div class="large-empty-state small">' +
          '<strong>Search instantly or browse the directory</strong>' +
          '<p>Quick Picks and symbol search are ready now. Browse all only if you want the complete ' +
          escapeHTML(activeMarket.toLowerCase()) +
          ' directory.</p>' +
        '</div>';

      if (showMore) showMore.hidden = true;
      if (message) message.textContent = "";
      if (status) {
        status.textContent =
          "Search all supported " +
          activeMarket.toLowerCase() +
          " or use Quick Picks.";
      }
      if (count) count.textContent = "Fast search";
      return;
    }

    var filtered = getFilteredCatalogue();

    renderAssetRows(
      filtered,
      renderLimit,
      false
    );

    if (status) {
      status.textContent =
        "Full " +
        activeMarket.toLowerCase() +
        " directory loaded";
    }

    if (count) {
      count.textContent =
        numberFormat(fullList.length) +
        " instruments";
    }
  }

  function renderAssetRows(list, limit, remoteMode) {
    var grid = el("assetGrid");
    var showMore = el("showMoreAssets");
    var message = el("assetSearchMessage");
    if (!grid) return;

    var visible = list.slice(0, limit);
    var html = "";
    var i;

    if (!list.length) {
      grid.innerHTML =
        '<div class="large-empty-state">' +
          '<div class="empty-icon">⌕</div>' +
          '<strong>No matching instruments</strong>' +
          '<p>Try another name or symbol.</p>' +
        '</div>';

      if (showMore) showMore.hidden = true;
      if (message) message.textContent = "0 matches";
      return;
    }

    for (i = 0; i < visible.length; i++) {
      var asset = visible[i];
      var selected = isSelected(asset.key);
      var secondary =
        asset.secondary ||
        asset.exchange ||
        asset.country ||
        asset.market;

      var planClass =
        asset.accessPlan &&
        asset.accessPlan.toLowerCase() === "basic"
          ? " basic"
          : "";

      var planHTML =
        asset.accessPlan
          ? '<span class="search-access-badge' +
            planClass +
            '">' +
            escapeHTML(asset.accessPlan) +
            '</span>'
          : "";

      html +=
        '<button type="button" class="asset-row' +
        (selected ? " selected" : "") +
        '" data-asset-key="' + escapeHTML(asset.key) + '">' +

          '<span class="asset-main">' +
            '<span class="asset-avatar">' +
              escapeHTML(asset.symbol.slice(0, 4)) +
            '</span>' +

            '<span class="asset-copy">' +
              '<span class="asset-title-line">' +
                '<strong>' + escapeHTML(asset.symbol) + '</strong>' +
                '<span>' +
                  escapeHTML(asset.name) +
                  planHTML +
                '</span>' +
              '</span>' +
              '<span class="asset-subline">' +
                escapeHTML(secondary) +
              '</span>' +
            '</span>' +
          '</span>' +

          '<span class="asset-select-control">' +
            (selected ? "✓" : "+") +
          '</span>' +

        '</button>';
    }

    grid.innerHTML = html;

    if (showMore) {
      showMore.hidden =
        remoteMode ||
        visible.length >= list.length;

      showMore.textContent = "Show more";
    }

    if (message) {
      message.textContent =
        remoteMode
          ? numberFormat(list.length) + " matches"
          : numberFormat(visible.length) +
            " of " +
            numberFormat(list.length);
    }
  }


  function updateCatalogueMeta() {
    var list = catalogCache[activeMarket];
    var status = el("catalogStatus");
    var count = el("catalogCount");

    if (!list) {
      if (count) count.textContent = "—";
      return;
    }

    if (status) {
      status.textContent = "Twelve Data supported " + activeMarket.toLowerCase();
    }
    if (count) {
      count.textContent = numberFormat(list.length) + " instruments";
    }
  }

  function setActiveMarket(market) {
    activeMarket = market;
    renderLimit = RENDER_STEP;
    activeSearchToken++;
    activeSearchResults = [];
    activeSearchLoading = false;

    var tabs =
      document.querySelectorAll(".market-tab");
    var i;

    for (i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle(
        "active",
        tabs[i].getAttribute("data-market") === market
      );
    }

    var search = el("assetSearch");
    if (search) {
      search.value = "";
      search.placeholder =
        "Search " +
        market.toLowerCase() +
        " by name or symbol…";
    }

    renderPopularAssets();
    renderAssetGrid();
  }


  function findCatalogueAssetByKey(key) {
    var i;

    for (i = 0; i < activeSearchResults.length; i++) {
      if (activeSearchResults[i].key === key) {
        return activeSearchResults[i];
      }
    }

    var market;
    for (market in catalogCache) {
      if (
        Object.prototype.hasOwnProperty.call(
          catalogCache,
          market
        )
      ) {
        var list = catalogCache[market] || [];

        for (i = 0; i < list.length; i++) {
          if (list[i].key === key) return list[i];
        }
      }
    }

    return null;
  }

  function toggleAssetByKey(key) {
    var i;
    for (i = 0; i < selectedAssets.length; i++) {
      if (selectedAssets[i].key === key) {
        delete marketData[key];
        selectedAssets.splice(i, 1);
        portfolioResults = null;
        renderSelectedAssets();
        renderAssetGrid();
        updatePortfolioSummary();
        schedulePortfolioNewsRefresh();
        return;
      }
    }

    var asset = findCatalogueAssetByKey(key);
    if (!asset) return;

    if (selectedAssets.length >= MAX_SELECTED_ASSETS) {
          setStatus("Starter access supports up to 4 assets per analysis. Remove one selected asset to add another.", "warning");
          return;
        }
        selectedAssets.push(asset);
    portfolioResults = null;
    renderSelectedAssets();
    renderAssetGrid();
    updatePortfolioSummary();
    schedulePortfolioNewsRefresh();
  }


  function updatePlanLimitUI() {
    var count = selectedAssets.length;
    var countEl = el("planLimitCount");
    var row = document.querySelector(".plan-limit-row");

    if (countEl) {
      countEl.textContent =
        count + " / " + MAX_SELECTED_ASSETS;
    }

    if (row) {
      if (count >= MAX_SELECTED_ASSETS) {
        row.classList.add("at-limit");
      } else {
        row.classList.remove("at-limit");
      }
    }
  }

  function renderSelectedAssets() {
    updatePlanLimitUI();
    var tray = el("selectedAssetsTray");
    var count = el("assetCount");
    if (count) count.textContent = selectedAssets.length;
    if (!tray) return;

    if (!selectedAssets.length) {
      tray.innerHTML = '<div class="selection-placeholder">Your selected assets will appear here</div>';
      updateOverview();
      return;
    }

    var html = "";
    var i;
    for (i = 0; i < selectedAssets.length; i++) {
      var asset = selectedAssets[i];
      html +=
        '<div class="selected-chip">' +
        '<span>' + escapeHTML(asset.symbol) + '</span>' +
        '<small>' + escapeHTML(asset.market) + '</small>' +
        '<button type="button" data-remove-key="' + escapeHTML(asset.key) + '" aria-label="Remove ' + escapeHTML(asset.symbol) + '">×</button>' +
        '</div>';
    }
    tray.innerHTML = html;
    renderPopularAssets();
    updateOverview();
  }

  function updatePortfolioSummary() {
    var summary = el("portfolioSummary");
    if (!summary) return;

    if (!selectedAssets.length) {
      summary.textContent = "Select one or more assets.";
      return;
    }

    var markets = {};
    selectedAssets.forEach(function (asset) {
      markets[asset.market] = true;
    });

    var marketCount = Object.keys(markets).length;
    summary.textContent =
      selectedAssets.length +
      " asset" +
      (selectedAssets.length === 1 ? "" : "s") +
      " across " +
      marketCount +
      " market" +
      (marketCount === 1 ? "" : "s") +
      ".";
  }

  /* ========================= HORIZONS ========================= */

  function populateHorizons() {
    var strategy = el("strategy");
    var horizon = el("horizon");
    if (!strategy || !horizon) return;

    var config = RANGE_CONFIG[strategy.value] || RANGE_CONFIG.Investor;
    var previous = horizon.value;
    var names = Object.keys(config);

    horizon.innerHTML = "";
    names.forEach(function (name) {
      var option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      horizon.appendChild(option);
    });

    if (config[previous]) horizon.value = previous;
    else if (config["1 Year"]) horizon.value = "1 Year";
  }

  /* ========================= MARKET DATA ========================= */

  function requestParametersForAsset(asset) {
    var params = { symbol: asset.symbol };
    if ((asset.market === "Stocks" || asset.market === "ETFs") && asset.exchange) {
      params.exchange = asset.exchange;
    }
    return params;
  }

  function fetchQuote(asset) {
    return apiRequest("/quote", requestParametersForAsset(asset)).then(function (data) {
      var price = Number(data.close || data.price);
      if (!isFinite(price) || price <= 0) throw new Error("No valid current quote returned.");

      return {
        price: price,
        open: Number(data.open),
        high: Number(data.high),
        low: Number(data.low),
        previousClose: Number(data.previous_close),
        change: Number(data.change),
        percentChange: Number(data.percent_change),
        exchange: data.exchange || asset.exchange || "",
        currency: data.currency || asset.currency || "",
        datetime: data.datetime || "",
        timestamp: data.timestamp || null
      };
    });
  }

  function fetchPrice(asset) {
    return apiRequest("/price", requestParametersForAsset(asset)).then(function (data) {
      var price = Number(data.price);
      if (!isFinite(price) || price <= 0) throw new Error("No valid current price returned.");
      return price;
    });
  }

  function fetchHistoricalData(asset) {
    var params = requestParametersForAsset(asset);
    params.interval = "1day";
    params.outputsize = HISTORICAL_OUTPUT_SIZE;

    return apiRequest("/time_series", params).then(function (data) {
      if (!data || !Array.isArray(data.values)) {
        throw new Error("No historical series returned.");
      }

      var prices = data.values
        .map(function (row) {
          return Number(row.close);
        })
        .filter(function (value) {
          return isFinite(value) && value > 0;
        })
        .reverse();

      if (prices.length < 20) {
        throw new Error("Not enough daily history for analysis.");
      }

      return prices;
    });
  }

  function loadOneAsset(asset, index) {
    setStatus(
      "Loading " + asset.symbol + " · " + (index + 1) + "/" + selectedAssets.length,
      "loading"
    );

    var existing = marketData[asset.key];
    var quote = null;
    var latestPrice = null;

    var quotePromise = fetchQuote(asset)
      .then(function (result) {
        quote = result;
        latestPrice = result.price;
        return true;
      })
      .catch(function () {
        return fetchPrice(asset)
          .then(function (price) {
            latestPrice = price;
            return true;
          })
          .catch(function (error) {
            console.warn(
              "Current price unavailable for " +
              asset.symbol,
              error
            );
            return false;
          });
      });

    var historyPromise;

    if (
      existing &&
      existing.prices &&
      existing.prices.length
    ) {
      historyPromise = Promise.resolve(existing.prices);
    } else {
      historyPromise = fetchHistoricalData(asset);
    }

    return Promise.all([
      quotePromise,
      historyPromise
    ])
      .then(function (results) {
        var prices = results[1];
        var analysis = analyseAsset(asset, prices);

        analysis.quote = quote;
        analysis.latestPrice =
          isFinite(latestPrice) && latestPrice > 0
            ? latestPrice
            : prices[prices.length - 1];

        analysis.signal = calculateSignal(analysis);
        marketData[asset.key] = analysis;

        return {
          ok: true,
          asset: asset
        };
      })
      .catch(function (error) {
        console.error(
          "Unable to load " + asset.symbol,
          error
        );

        return {
          ok: false,
          asset: asset,
          error: error
        };
      });
  }

  function runWithConcurrency(items, limit, worker) {
    return new Promise(function (resolve) {
      var results = new Array(items.length);
      var nextIndex = 0;
      var active = 0;

      function launch() {
        if (
          nextIndex >= items.length &&
          active === 0
        ) {
          resolve(results);
          return;
        }

        while (
          active < limit &&
          nextIndex < items.length
        ) {
          (function (index) {
            active++;

            worker(items[index], index)
              .then(function (result) {
                results[index] = result;
              })
              .catch(function (error) {
                results[index] = {
                  ok: false,
                  asset: items[index],
                  error: error
                };
              })
              .then(function () {
                active--;
                launch();
              });
          })(nextIndex);

          nextIndex++;
        }
      }

      launch();
    });
  }



  function batchSymbolForAsset(asset) {
    if (
      (asset.market === "Stocks" ||
       asset.market === "ETFs") &&
      asset.exchange
    ) {
      return asset.symbol + ":" + asset.exchange;
    }

    return asset.symbol;
  }

  function batchLookup(data, asset) {
    if (!data) return null;

    if (
      data.values ||
      data.close ||
      data.price
    ) {
      return data;
    }

    var token = batchSymbolForAsset(asset);
    var candidates = [
      token,
      asset.symbol,
      token.toUpperCase(),
      asset.symbol.toUpperCase()
    ];

    var source =
      data.data &&
      !Array.isArray(data.data)
        ? data.data
        : data;

    var i;
    for (i = 0; i < candidates.length; i++) {
      if (
        source &&
        Object.prototype.hasOwnProperty.call(
          source,
          candidates[i]
        )
      ) {
        var direct = source[candidates[i]];
        return direct && direct.data
          ? direct.data
          : direct;
      }
    }

    var targetSymbol =
      normalizeAssetSearch(asset.symbol);
    var key;

    for (key in source) {
      if (
        Object.prototype.hasOwnProperty.call(
          source,
          key
        ) &&
        normalizeAssetSearch(key)
          .indexOf(targetSymbol) === 0
      ) {
        var found = source[key];
        return found && found.data
          ? found.data
          : found;
      }
    }

    return null;
  }

  function parseHistoryPayload(payload) {
    if (
      !payload ||
      payload.status === "error" ||
      !Array.isArray(payload.values)
    ) {
      return null;
    }

    var prices = payload.values
      .map(function (row) {
        return Number(row.close);
      })
      .filter(function (value) {
        return isFinite(value) && value > 0;
      })
      .reverse();

    return prices.length >= 20
      ? prices
      : null;
  }

  function parseQuotePayload(payload) {
    if (!payload || payload.status === "error") {
      return null;
    }

    var price = Number(
      payload.close || payload.price
    );

    if (!isFinite(price) || price <= 0) {
      return null;
    }

    return {
      price: price,
      open: Number(payload.open),
      high: Number(payload.high),
      low: Number(payload.low),
      previousClose: Number(
        payload.previous_close
      ),
      change: Number(payload.change),
      percentChange: Number(
        payload.percent_change
      ),
      exchange: payload.exchange || "",
      currency: payload.currency || "",
      datetime: payload.datetime || "",
      timestamp: payload.timestamp || null
    };
  }

  function loadInitialHistoryBatch(assets) {
    var symbols = assets
      .map(batchSymbolForAsset)
      .join(",");

    return apiRequest("/time_series", {
      symbol: symbols,
      interval: "1day",
      outputsize: HISTORICAL_OUTPUT_SIZE
    }).then(function (data) {
      return assets.map(function (asset) {
        var payload = batchLookup(
          data,
          asset
        );

        var prices =
          parseHistoryPayload(payload);

        if (!prices) {
          return {
            ok: false,
            asset: asset,
            error: new Error(
              "No usable history returned."
            )
          };
        }

        var analysis =
          analyseAsset(asset, prices);

        analysis.quote = null;
        analysis.latestPrice =
          prices[prices.length - 1];
        analysis.signal =
          calculateSignal(analysis);

        marketData[asset.key] = analysis;

        return {
          ok: true,
          asset: asset
        };
      });
    });
  }

  function refreshQuotesBatch(assets) {
    var symbols = assets
      .map(batchSymbolForAsset)
      .join(",");

    return apiRequest("/quote", {
      symbol: symbols
    }).then(function (data) {
      return assets.map(function (asset) {
        var analysis =
          marketData[asset.key];

        if (!analysis) {
          return {
            ok: false,
            asset: asset,
            error: new Error(
              "Historical analysis is not loaded."
            )
          };
        }

        var quote =
          parseQuotePayload(
            batchLookup(data, asset)
          );

        if (quote) {
          analysis.quote = quote;
          analysis.latestPrice = quote.price;
          analysis.signal =
            calculateSignal(analysis);

          return {
            ok: true,
            asset: asset
          };
        }

        return {
          ok: true,
          asset: asset,
          staleQuote: true
        };
      });
    });
  }

  function loadMarketData() {
    if (!selectedAssets.length) {
      alert("Choose at least one asset first.");
      return Promise.resolve(false);
    }

    var loadButton = el("loadMarketData");
    var refreshButton = el("refreshPricesMini");
    var notice = el("dataNotice");

    if (loadButton) loadButton.disabled = true;
    if (refreshButton) refreshButton.disabled = true;

    clearDataAccessNotice();

    var missingHistory =
      selectedAssets.filter(function (asset) {
        var existing =
          marketData[asset.key];

        return !(
          existing &&
          existing.prices &&
          existing.prices.length
        );
      });

    var promise;

    if (missingHistory.length) {
      setStatus(
        "Loading portfolio history…",
        "loading"
      );

      if (notice) {
        notice.textContent =
          "Loading selected assets in one batch request…";
      }

      promise =
        loadInitialHistoryBatch(
          selectedAssets.slice()
        );
    } else {
      setStatus(
        "Refreshing live quotes…",
        "loading"
      );

      if (notice) {
        notice.textContent =
          "Refreshing selected prices in one batch request…";
      }

      promise =
        refreshQuotesBatch(
          selectedAssets.slice()
        );
    }

    return promise
      .then(function (results) {
        var failures =
          results.filter(function (result) {
            return !result.ok;
          });

        var successes =
          results.length -
          failures.length;

        renderMarketData();
        renderAssetAnalysis();
        renderSignals();
        renderAIAdvisor();
        renderTradePlanner();

        if (successes > 0) {
          setStatus(
            failures.length
              ? "Markets partially updated"
              : "Markets updated",
            failures.length
              ? "loading"
              : "success"
          );
        } else {
          setStatus(
            "Market data unavailable",
            "error"
          );
        }

        if (notice) {
          if (!failures.length) {
            notice.textContent =
              "Updated " +
              successes +
              " selected instrument" +
              (successes === 1 ? "" : "s") +
              " using a batched request.";
          } else {
            var failedNames =
              failures
                .slice(0, 4)
                .map(function (item) {
                  return item.asset.symbol;
                })
                .join(", ");

            notice.textContent =
              "Loaded " +
              successes +
              " of " +
              results.length +
              ". Unavailable: " +
              failedNames +
              ".";
          }
        }

        return successes > 0;
      })
      .catch(function (error) {
        console.error(error);

        var accessType =
          classifyDataAccessError(
            error &&
            error.message
              ? error.message
              : error
          );

        showDataAccessNotice(
          accessType,
          "",
          error &&
          error.message
            ? error.message
            : String(error)
        );

        setStatus(
          "Market data error",
          "error"
        );

        if (notice) {
          notice.textContent =
            "The market-data request could not be completed.";
        }

        return false;
      })
      .then(function (success) {
        if (loadButton) {
          loadButton.disabled = false;
        }

        if (refreshButton) {
          refreshButton.disabled = false;
        }

        return success;
      });
  }


  function renderMarketData() {
    var container = el("marketData");
    if (!container) return;

    var html = "";

    selectedAssets.forEach(function (asset) {
      var analysis = marketData[asset.key];
      if (!analysis) return;

      var quote = analysis.quote || {};
      var change = Number(quote.percentChange);
      var hasChange = isFinite(change) && isFinite(analysis.latestPrice) && analysis.latestPrice > 0;
      var exchange = quote.exchange || asset.exchange || asset.market;
      var timestamp = quote.datetime || "Latest available";

      html +=
        '<article class="market-quote">' +
        '<div class="quote-top">' +
        '<div class="quote-identity">' +
        '<div class="quote-symbol">' + escapeHTML(asset.short || "•") + '</div>' +
        '<div><strong>' + escapeHTML(asset.symbol) + '</strong><small>' + escapeHTML(asset.name) + '</small></div>' +
        '</div>' +
        '<div class="quote-price"><strong class="' +
        ((!isFinite(analysis.latestPrice) || analysis.latestPrice <= 0) ? "market-price-unavailable" : "") +
        '">' +
        ((!isFinite(analysis.latestPrice) || analysis.latestPrice <= 0) ? "Data unavailable" : marketPrice(analysis.latestPrice)) +
        '</strong>' +
        (hasChange
          ? '<span class="quote-change ' + (change >= 0 ? "positive" : "negative") + '">' + percentRaw(change) + '</span>'
          : "") +
        '</div></div>' +
        '<div class="quote-footer"><span>' + escapeHTML(exchange) + '</span><span>' + escapeHTML(timestamp) + '</span></div>' +
        '</article>';
    });

    if (!html) {
      html = '<div class="large-empty-state"><div class="empty-icon">↗</div><strong>No market data yet</strong><p>Choose assets and refresh their prices.</p></div>';
    }

    container.innerHTML = html;
    updateOverview();
  }

  /* ========================= STATISTICS ========================= */

  function calculateReturns(prices) {
    var returns = [];
    var i;
    for (i = 1; i < prices.length; i++) {
      if (prices[i - 1] > 0 && prices[i] > 0) {
        returns.push(Math.log(prices[i] / prices[i - 1]));
      }
    }
    return returns;
  }

  function mean(values) {
    if (!values.length) return 0;
    var sum = 0;
    var i;
    for (i = 0; i < values.length; i++) sum += values[i];
    return sum / values.length;
  }

  function standardDeviation(values) {
    if (values.length < 2) return 0;
    var avg = mean(values);
    var total = 0;
    var i;
    for (i = 0; i < values.length; i++) total += Math.pow(values[i] - avg, 2);
    return Math.sqrt(total / (values.length - 1));
  }

  function percentile(values, p) {
    if (!values.length) return 0;
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var index = (sorted.length - 1) * p;
    var lower = Math.floor(index);
    var upper = Math.ceil(index);
    if (lower === upper) return sorted[lower];
    var weight = index - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }

  function simpleReturn(prices, periods) {
    if (!prices || prices.length < 2) return 0;

    var end = prices.length - 1;
    var start = Math.max(0, end - periods);

    if (prices[start] <= 0 || prices[end] <= 0) return 0;
    return prices[end] / prices[start] - 1;
  }

  function movingAverage(prices, periods) {
    if (!prices || !prices.length) return 0;

    var start = Math.max(0, prices.length - periods);
    var slice = prices.slice(start);
    return mean(slice);
  }

  function analyseAsset(asset, prices) {
    var returns = calculateReturns(prices);
    var dailyMean = mean(returns);
    var dailyVolatility = standardDeviation(returns);
    var positiveDays = returns.filter(function (value) {
      return value > 0;
    }).length;

    var latest = prices[prices.length - 1];
    var ma10 = movingAverage(prices, 10);
    var ma20 = movingAverage(prices, 20);
    var ma50 = movingAverage(prices, 50);

    var recentReturns = returns.slice(Math.max(0, returns.length - 20));
    var recentVolatility =
      standardDeviation(recentReturns) * Math.sqrt(252);

    return {
      key: asset.key,
      asset: asset,
      prices: prices,
      returns: returns,
      dailyMean: dailyMean,
      dailyVolatility: dailyVolatility,
      annualReturn: Math.exp(dailyMean * 252) - 1,
      annualVolatility: dailyVolatility * Math.sqrt(252),
      recentVolatility: recentVolatility,
      winRate: returns.length ? positiveDays / returns.length : 0,
      momentum5: simpleReturn(prices, 5),
      momentum20: simpleReturn(prices, 20),
      momentum60: simpleReturn(prices, 60),
      ma10: ma10,
      ma20: ma20,
      ma50: ma50,
      latestPrice: latest
    };
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function signedFeature(value, scale) {
    if (!isFinite(value) || !scale) return 0;
    return clamp(value / scale, -1, 1);
  }

  function calculateSignal(analysis) {
    var price = analysis.latestPrice;
    var ma20 = analysis.ma20;
    var ma50 = analysis.ma50;

    var momentum5Score =
      signedFeature(analysis.momentum5, 0.035) * 22;

    var momentum20Score =
      signedFeature(analysis.momentum20, 0.09) * 28;

    var trendPriceScore = 0;
    if (price > 0 && ma20 > 0) {
      trendPriceScore =
        signedFeature((price / ma20) - 1, 0.045) * 20;
    }

    var trendAverageScore = 0;
    if (ma20 > 0 && ma50 > 0) {
      trendAverageScore =
        signedFeature((ma20 / ma50) - 1, 0.06) * 18;
    }

    var winRateScore =
      signedFeature(analysis.winRate - 0.50, 0.10) * 12;

    var directionalScore =
      momentum5Score +
      momentum20Score +
      trendPriceScore +
      trendAverageScore +
      winRateScore;

    directionalScore = clamp(directionalScore, -100, 100);

    var volatilityPenalty = 0;
    if (isFinite(analysis.recentVolatility)) {
      volatilityPenalty =
        clamp((analysis.recentVolatility - 0.18) * 35, 0, 20);
    }

    var confidence =
      clamp(48 + Math.abs(directionalScore) * 0.48 - volatilityPenalty, 35, 92);

    var label = "Neutral";
    if (directionalScore >= 16) label = "Bullish";
    if (directionalScore <= -16) label = "Bearish";

    var trend = "Flat";
    if (price > ma20 && ma20 > ma50) trend = "Uptrend";
    else if (price < ma20 && ma20 < ma50) trend = "Downtrend";
    else if (price > ma20) trend = "Improving";
    else if (price < ma20) trend = "Weakening";

    var momentum = "Mixed";
    if (analysis.momentum5 > 0 && analysis.momentum20 > 0) {
      momentum = "Positive";
    } else if (
      analysis.momentum5 < 0 &&
      analysis.momentum20 < 0
    ) {
      momentum = "Negative";
    }

    return {
      label: label,
      score: directionalScore,
      confidence: confidence,
      trend: trend,
      momentum: momentum
    };
  }

  function pearsonCorrelation(valuesA, valuesB) {
    var length = Math.min(valuesA.length, valuesB.length, 90);
    if (length < 10) return 0;

    var a = valuesA.slice(valuesA.length - length);
    var b = valuesB.slice(valuesB.length - length);
    var meanA = mean(a);
    var meanB = mean(b);
    var numerator = 0;
    var sumA = 0;
    var sumB = 0;
    var i;

    for (i = 0; i < length; i++) {
      var da = a[i] - meanA;
      var db = b[i] - meanB;
      numerator += da * db;
      sumA += da * da;
      sumB += db * db;
    }

    if (sumA <= 0 || sumB <= 0) return 0;
    return numerator / Math.sqrt(sumA * sumB);
  }

  function buildAIState() {
    var available = [];

    selectedAssets.forEach(function (asset) {
      var analysis = marketData[asset.key];

      if (
        analysis &&
        analysis.signal &&
        isFinite(analysis.latestPrice) &&
        analysis.latestPrice > 0
      ) {
        available.push({
          asset: asset,
          analysis: analysis,
          signal: analysis.signal
        });
      }
    });

    if (!available.length) {
      aiState = null;
      return null;
    }

    var bullish = 0;
    var bearish = 0;
    var neutral = 0;
    var confidenceTotal = 0;
    var directionTotal = 0;
    var strongest = available[0];

    available.forEach(function (item) {
      if (item.signal.label === "Bullish") bullish++;
      else if (item.signal.label === "Bearish") bearish++;
      else neutral++;

      confidenceTotal += item.signal.confidence;
      directionTotal += item.signal.score;

      if (
        Math.abs(item.signal.score) * item.signal.confidence >
        Math.abs(strongest.signal.score) * strongest.signal.confidence
      ) {
        strongest = item;
      }
    });

    var correlations = [];
    var maxAbsCorrelation = 0;
    var maxCorrelationPair = null;
    var i;
    var j;

    for (i = 0; i < available.length; i++) {
      for (j = i + 1; j < available.length; j++) {
        var corr = pearsonCorrelation(
          available[i].analysis.returns,
          available[j].analysis.returns
        );

        correlations.push(Math.abs(corr));

        if (Math.abs(corr) > maxAbsCorrelation) {
          maxAbsCorrelation = Math.abs(corr);
          maxCorrelationPair = {
            first: available[i].asset.symbol,
            second: available[j].asset.symbol,
            value: corr
          };
        }
      }
    }

    var averageCorrelation =
      correlations.length ? mean(correlations) : 0;

    var mixedDirections = bullish > 0 && bearish > 0;
    var averageConfidence = confidenceTotal / available.length;
    var averageDirection = directionTotal / available.length;

    var highVolatilityCount = available.filter(function (item) {
      return item.analysis.recentVolatility >= 0.55;
    }).length;

    var verdict = "WAIT";
    var bias = "No clear directional edge";

    if (averageDirection >= 16) bias = "Bullish bias";
    else if (averageDirection <= -16) bias = "Bearish bias";
    else if (mixedDirections) bias = "Mixed directional exposure";
    else bias = "Neutral bias";

    if (
      available.length > 1 &&
      (maxAbsCorrelation >= 0.85 || highVolatilityCount >= 2)
    ) {
      verdict = "HIGH RISK";
    } else if (mixedDirections) {
      verdict = "SELECTIVE";
    } else if (
      Math.abs(averageDirection) >= 24 &&
      averageConfidence >= 58
    ) {
      verdict = "ALIGNED";
    } else if (
      strongest.signal.confidence >= 58 &&
      Math.abs(strongest.signal.score) >= 18
    ) {
      verdict = available.length > 1 ? "SELECTIVE" : "ALIGNED";
    }

    var riskLevel = "Moderate";
    if (
      maxAbsCorrelation >= 0.85 ||
      highVolatilityCount >= 2
    ) {
      riskLevel = "High";
    } else if (
      averageCorrelation < 0.35 &&
      highVolatilityCount === 0
    ) {
      riskLevel = "Lower";
    }

    aiState = {
      available: available,
      bullish: bullish,
      bearish: bearish,
      neutral: neutral,
      strongest: strongest,
      averageConfidence: averageConfidence,
      averageDirection: averageDirection,
      averageCorrelation: averageCorrelation,
      maxAbsCorrelation: maxAbsCorrelation,
      maxCorrelationPair: maxCorrelationPair,
      mixedDirections: mixedDirections,
      highVolatilityCount: highVolatilityCount,
      verdict: verdict,
      bias: bias,
      riskLevel: riskLevel,
      unavailableCount: selectedAssets.length - available.length
    };

    return aiState;
  }

  function aiNarrative(state) {
    if (!state) {
      return "Load market data so I can evaluate your selected assets.";
    }

    var parts = [];

    if (state.mixedDirections) {
      parts.push(
        "Your selected assets are sending conflicting directional signals, so treating them as one trade idea would be weak."
      );
    } else if (state.verdict === "ALIGNED") {
      parts.push(
        "The stronger signals are broadly aligned, which gives the portfolio a clearer directional bias."
      );
    } else if (state.verdict === "HIGH RISK") {
      parts.push(
        "The current combination carries elevated concentration or volatility risk, so opening every position together would increase exposure."
      );
    } else {
      parts.push(
        "The data does not show a strong enough portfolio-wide edge to justify treating every selected asset as an entry."
      );
    }

    parts.push(
      state.strongest.asset.symbol +
      " currently has the strongest " +
      state.strongest.signal.label.toLowerCase() +
      " setup at " +
      state.strongest.signal.confidence.toFixed(0) +
      "% confidence."
    );

    if (state.unavailableCount > 0) {
      parts.push(
        state.unavailableCount +
        " selected instrument" +
        (state.unavailableCount === 1 ? " is" : "s are") +
        " excluded because usable market data is not currently available."
      );
    }

    return parts.join(" ");
  }

  function aiWarningText(state) {
    if (!state) return null;

    if (
      state.maxCorrelationPair &&
      state.maxAbsCorrelation >= 0.75
    ) {
      return {
        level: state.maxAbsCorrelation >= 0.85 ? "danger" : "warning",
        title: "Concentration detected",
        text:
          state.maxCorrelationPair.first +
          " and " +
          state.maxCorrelationPair.second +
          " have a high recent return correlation of " +
          state.maxCorrelationPair.value.toFixed(2) +
          ". Multiple positions may behave more like one larger exposure."
      };
    }

    if (state.mixedDirections) {
      return {
        level: "warning",
        title: "Conflicting exposure",
        text:
          "Bullish and bearish signals are mixed across the selected assets. Focus on the strongest setup instead of forcing the whole basket into one direction."
      };
    }

    if (state.highVolatilityCount > 0) {
      return {
        level: "warning",
        title: "Volatility elevated",
        text:
          state.highVolatilityCount +
          " selected asset" +
          (state.highVolatilityCount === 1 ? " is" : "s are") +
          " showing elevated recent volatility. Position sizing matters more when volatility expands."
      };
    }

    return {
      level: "",
      title: "Diversification check",
      text:
        state.available.length > 1
          ? "No major concentration warning is visible from the recent return relationships currently loaded."
          : "Only one valid asset is loaded, so cross-asset diversification cannot be evaluated yet."
    };
  }

  function renderAIAdvisor() {
    var container = el("aiAdvisor");
    var status = el("aiAdvisorStatus");

    if (!container) return;

    var state = buildAIState();

    if (!state) {
      if (status) {
        status.textContent = "Waiting for data";
        status.className = "ai-advisor-status";
      }

      container.innerHTML =
        '<div class="ai-empty-state">' +
          '<div class="ai-orb">AI</div>' +
          '<div>' +
            '<strong>Choose assets and load market data.</strong>' +
            '<p>Portfolio AI will explain whether your selections are aligned, conflicting, concentrated or better treated selectively.</p>' +
          '</div>' +
        '</div>';
      return;
    }

    if (status) {
      status.textContent = "Analysis ready";
      status.className = "ai-advisor-status ready";
    }

    var warning = aiWarningText(state);
    var verdictClass = state.verdict.toLowerCase().replace(" ", "-");
    var strongestClass = state.strongest.signal.label.toLowerCase();
    var strongestArrow =
      state.strongest.signal.label === "Bullish"
        ? "↑"
        : state.strongest.signal.label === "Bearish"
          ? "↓"
          : "→";

    var signalsHTML = "";

    state.available.forEach(function (item) {
      var directionClass = item.signal.label.toLowerCase();
      var arrow =
        item.signal.label === "Bullish"
          ? "↑"
          : item.signal.label === "Bearish"
            ? "↓"
            : "→";

      signalsHTML +=
        '<div class="ai-signal-row">' +
          '<div class="ai-signal-name">' +
            '<strong>' + escapeHTML(item.asset.symbol) + '</strong>' +
            '<small>' +
              escapeHTML(item.signal.trend) +
              " · " +
              escapeHTML(item.signal.momentum) +
              " momentum" +
            '</small>' +
          '</div>' +
          '<span class="ai-direction-badge ' +
            directionClass +
          '">' +
            arrow + " " + escapeHTML(item.signal.label) +
          '</span>' +
          '<div class="ai-signal-meter" title="Confidence">' +
            '<span style="width:' +
              item.signal.confidence.toFixed(0) +
              '%"></span>' +
          '</div>' +
        '</div>';
    });

    container.innerHTML =
      '<div class="ai-overview">' +

        '<div class="ai-guidance-main">' +
          '<div class="ai-verdict-row">' +
            '<div class="ai-verdict-copy">' +
              '<span class="ai-verdict-kicker">AI PORTFOLIO VIEW</span>' +
              '<strong class="ai-verdict ' +
                verdictClass +
              '">' +
                escapeHTML(state.verdict) +
              '</strong>' +
              '<span class="ai-bias">' +
                escapeHTML(state.bias) +
              '</span>' +
            '</div>' +

            '<div class="ai-confidence">' +
              '<span>Signal confidence</span>' +
              '<strong>' +
                state.averageConfidence.toFixed(0) +
                '%</strong>' +
            '</div>' +
          '</div>' +

          '<p class="ai-narrative">' +
            escapeHTML(aiNarrative(state)) +
          '</p>' +

          '<div class="ai-warning ' +
            escapeHTML(warning.level) +
          '">' +
            '<span class="ai-warning-icon">' +
              (warning.level === "danger" ? "!" : "◇") +
            '</span>' +
            '<div>' +
              '<strong>' + escapeHTML(warning.title) + '</strong>' +
              '<span>' + escapeHTML(warning.text) + '</span>' +
            '</div>' +
          '</div>' +
        '</div>' +

        '<aside class="ai-guidance-side">' +
          '<div class="ai-strongest">' +
            '<span class="ai-side-label">STRONGEST SETUP</span>' +
            '<div class="ai-strongest-symbol">' +
              '<strong>' +
                escapeHTML(state.strongest.asset.symbol) +
              '</strong>' +
              '<span class="ai-direction-badge ' +
                strongestClass +
              '">' +
                strongestArrow +
                " " +
                escapeHTML(state.strongest.signal.label) +
              '</span>' +
            '</div>' +
          '</div>' +

          '<div class="ai-side-stat">' +
            '<span>Confidence</span>' +
            '<strong>' +
              state.strongest.signal.confidence.toFixed(0) +
              '%</strong>' +
          '</div>' +

          '<div class="ai-side-stat">' +
            '<span>Trend</span>' +
            '<strong>' +
              escapeHTML(state.strongest.signal.trend) +
            '</strong>' +
          '</div>' +

          '<div class="ai-side-stat">' +
            '<span>Momentum</span>' +
            '<strong>' +
              escapeHTML(state.strongest.signal.momentum) +
            '</strong>' +
          '</div>' +

          '<div class="ai-side-stat">' +
            '<span>Portfolio risk</span>' +
            '<strong>' +
              escapeHTML(state.riskLevel) +
            '</strong>' +
          '</div>' +

          '<div class="ai-side-stat">' +
            '<span>Bull / Bear / Neutral</span>' +
            '<strong>' +
              state.bullish +
              " / " +
              state.bearish +
              " / " +
              state.neutral +
            '</strong>' +
          '</div>' +
        '</aside>' +

      '</div>' +

      '<div class="ai-signal-list">' +
        signalsHTML +
      '</div>';
  }

  function answerAIQuestionGeneric(question) {
    var state = buildAIState();
    var text = String(question || "").toLowerCase();

    if (!state) {
      return "I need usable market data first. Select assets, refresh the prices and historical data, then ask again.";
    }

    var strongest = state.strongest;

    if (
      text.indexOf("strong") !== -1 ||
      text.indexOf("best") !== -1 ||
      text.indexOf("focus") !== -1
    ) {
      return (
        strongest.asset.symbol +
        " is currently the strongest setup. It is " +
        strongest.signal.label.toLowerCase() +
        " with " +
        strongest.signal.confidence.toFixed(0) +
        "% confidence, a " +
        strongest.signal.trend.toLowerCase() +
        " structure and " +
        strongest.signal.momentum.toLowerCase() +
        " momentum. That does not guarantee the next move, but it has the clearest alignment in the data currently loaded."
      );
    }

    if (
      text.indexOf("all") !== -1 ||
      text.indexOf("multi") !== -1 ||
      text.indexOf("multiple") !== -1 ||
      text.indexOf("basket") !== -1
    ) {
      if (state.verdict === "ALIGNED") {
        return (
          "The selected assets are more aligned than conflicting, but that still does not make opening every position automatically smart. Check correlation and size the combined exposure as one portfolio, especially if several positions can move together."
        );
      }

      if (state.verdict === "HIGH RISK") {
        return (
          "I would not treat all selected assets as separate opportunities right now. The portfolio is showing elevated concentration or volatility risk. Opening every position could multiply the same underlying exposure."
        );
      }

      return (
        "I would be selective rather than opening all of them together. The signals are not sufficiently aligned. " +
        strongest.asset.symbol +
        " currently has the clearest setup."
      );
    }

    if (
      text.indexOf("risk") !== -1 ||
      text.indexOf("danger") !== -1 ||
      text.indexOf("correlation") !== -1
    ) {
      var warning = aiWarningText(state);
      return (
        warning.title +
        ": " +
        warning.text +
        " Current portfolio risk is classified as " +
        state.riskLevel.toLowerCase() +
        "."
      );
    }

    if (
      text.indexOf("direction") !== -1 ||
      text.indexOf("bull") !== -1 ||
      text.indexOf("bear") !== -1 ||
      text.indexOf("lean") !== -1
    ) {
      return (
        "The portfolio currently has a " +
        state.bias.toLowerCase() +
        ". I see " +
        state.bullish +
        " bullish, " +
        state.bearish +
        " bearish and " +
        state.neutral +
        " neutral signal" +
        (state.available.length === 1 ? "" : "s") +
        ". " +
        strongest.asset.symbol +
        " has the strongest directional conviction."
      );
    }

    if (
      text.indexOf("wait") !== -1 ||
      text.indexOf("trade") !== -1 ||
      text.indexOf("enter") !== -1 ||
      text.indexOf("open") !== -1
    ) {
      if (state.verdict === "WAIT") {
        return (
          "The portfolio-wide edge is weak right now. Waiting is reasonable because the direction and confidence are not strong enough to justify treating the basket as a high-conviction setup."
        );
      }

      if (state.verdict === "SELECTIVE") {
        return (
          "The data supports selective attention rather than a basket entry. Focus on " +
          strongest.asset.symbol +
          " and compare its setup with your own entry rules before taking a position."
        );
      }

      if (state.verdict === "HIGH RISK") {
        return (
          "The main issue is not simply direction; it is combined risk. Reduce the number of simultaneous exposures or wait for volatility and correlation to improve."
        );
      }

      return (
        "The signals are relatively aligned, but this is still a probability-based view rather than a trade instruction. " +
        strongest.asset.symbol +
        " currently carries the clearest setup."
      );
    }

    if (
      text.indexOf("why") !== -1 ||
      text.indexOf("explain") !== -1
    ) {
      return aiNarrative(state);
    }

    return (
      aiNarrative(state) +
      " Ask me about the strongest setup, whether the assets should be traded together, the main risk, or the current directional bias."
    );
  }

function moneyQuestionKind(question) {
  var q = String(question || "").toLowerCase();
  return (
    q.indexOf("how much") >= 0 ||
    q.indexOf("enough") >= 0 ||
    q.indexOf("afford") >= 0 ||
    q.indexOf("capital") >= 0 ||
    q.indexOf("profit") >= 0 ||
    q.indexOf("make money") >= 0 ||
    q.indexOf("real money") >= 0 ||
    q.indexOf("significant") >= 0 ||
    q.indexOf("add") >= 0 ||
    q.indexOf("need") >= 0 ||
    q.indexOf("worth") >= 0
  );
}

function extractDollarAmount(question) {
  var q = String(question || "");
  var m = q.match(/\$?\s*([0-9]+(?:\.[0-9]+)?)(?:\s*(k|K))?/);
  if (!m) return null;
  var n = Number(m[1]);
  if (!isFinite(n)) return null;
  if (m[2]) n = n * 1000;
  return n;
}

function plainMoney(v) {
  var n = Number(v);
  if (!isFinite(n)) return "$0";
  return "$" + Math.round(n).toLocaleString("en-US");
}

function answerMoneyQuestion(question) {
  var d = capitalAdequacyData();
  var capital = Number(d.capital || capitalNumber("investment", 0));
  var amountInQuestion = extractDollarAmount(question);
  var q = String(question || "").toLowerCase();

  if (!capital || capital <= 0) {
    return "Enter your portfolio amount first. Then I can answer in actual USD amounts instead of percentages.";
  }

  var targetPractical = Number(d.minimum || 0);
  var targetComfort = Number(d.comfortable || 0);
  var selectedCount = Number(d.count || (selectedAssets ? selectedAssets.length : 0));

  if (q.indexOf("add") >= 0 && amountInQuestion !== null) {
    var newTotal = capital + amountInQuestion;
    var verdict = targetPractical > 0 && newTotal >= targetPractical
      ? "That would put the portfolio into a more practical capital range for the assets you selected."
      : "That helps, but the portfolio would still be capital-constrained for the assets you selected.";
    return "Add " + plainMoney(amountInQuestion) + " and your portfolio goes from " + plainMoney(capital) + " to " + plainMoney(newTotal) + ". " + verdict;
  }

  if (q.indexOf("profit") >= 0 && amountInQuestion !== null && (q.indexOf("make") >= 0 || q.indexOf("need") >= 0)) {
    var p5 = amountInQuestion / 0.05;
    var p10 = amountInQuestion / 0.10;
    var p20 = amountInQuestion / 0.20;
    return "To make about " + plainMoney(amountInQuestion) + " profit, the capital needed depends on the market move. Rough guide: 5% gain -> about " + plainMoney(p5) + " capital; 10% gain -> about " + plainMoney(p10) + "; 20% gain -> about " + plainMoney(p20) + ". There is no capital amount that guarantees that profit.";
  }

  if (q.indexOf("significant") >= 0 || q.indexOf("real money") >= 0 || q.indexOf("make money") >= 0 || q.indexOf("profit") >= 0) {
    var next1 = Math.max(capital * 2, 500);
    var next2 = Math.max(capital * 4, 1000);
    if (targetPractical > capital) next1 = Math.max(next1, targetPractical);
    if (targetComfort > capital) next2 = Math.max(next2, targetComfort);

    return "With " + plainMoney(capital) + ", your dollar gains will naturally be small unless the asset makes a very large move. At a 10% gain: " + plainMoney(capital) + " makes about " + plainMoney(capital * 0.10) + "; " + plainMoney(next1) + " makes about " + plainMoney(next1 * 0.10) + "; " + plainMoney(next2) + " makes about " + plainMoney(next2 * 0.10) + ". If you want a more noticeable dollar impact, a sensible next capital step is around " + plainMoney(next1) + ". That is not a profit guarantee; it simply makes the same percentage move worth more dollars.";
  }

  if (targetPractical > 0) {
    if (capital >= targetPractical) {
      var room = Math.max(0, targetComfort - capital);
      if (room > 0) {
        return "Your " + plainMoney(capital) + " is enough for this selected portfolio. You do not need to add more to make it practical. About " + plainMoney(room) + " more would only give you extra breathing room.";
      }
      return "Your " + plainMoney(capital) + " is already enough for this selected portfolio. You do not need to add more just to make it practical.";
    }

    var add = Math.max(0, targetPractical - capital);
    return "Add about " + plainMoney(add) + " more. That takes you from " + plainMoney(capital) + " to about " + plainMoney(targetPractical) + ", where this selected portfolio becomes more practical.";
  }

  if (selectedCount) {
    return "You currently have " + plainMoney(capital) + " across " + selectedCount + " selected asset" + (selectedCount === 1 ? "" : "s") + ". Run the analysis and I will give you an exact USD add-on.";
  }

  return "You currently have " + plainMoney(capital) + ". Select the asset or portfolio you want to test and I will answer in exact USD amounts.";
}

function answerAIQuestion(question) {
  if (moneyQuestionKind(question)) {
    return answerMoneyQuestion(question);
  }
  return answerAIQuestionGeneric(question);
}


  function submitAIQuestion(question) {
    var answer = el("aiAnswer");
    var button = el("aiAskButton");

    if (!answer) return;

    var cleanQuestion =
      String(question || "").trim();

    if (!cleanQuestion) {
      answer.className = "ai-answer";
      answer.innerHTML =
        '<span class="ai-answer-label">AI</span>' +
        '<p>Ask me about the strongest setup, portfolio direction, risk, correlation or whether the selected positions make sense together.</p>';
      return;
    }

    if (!selectedAssets.length) {
      answer.className = "ai-answer";
      answer.innerHTML =
        '<span class="ai-answer-label">AI</span>' +
        '<p>Select at least one asset first. Once an asset is selected, I can load its market data and analyse the setup for you.</p>';
      return;
    }

    var needsData =
      selectedAssets.some(function (asset) {
        return !marketData[asset.key];
      });

    if (button) {
      button.disabled = true;
      button.textContent =
        needsData ? "Analysing…" : "Thinking…";
    }

    answer.className =
      "ai-answer thinking";
    answer.innerHTML =
      '<span class="ai-answer-label">AI</span>' +
      '<p>' +
        (
          needsData
            ? "Loading the selected market data and building the analysis…"
            : "Reading the current portfolio signals…"
        ) +
      '</p>';

    var ready =
      needsData
        ? loadMarketData()
        : Promise.resolve(true);

    ready
      .then(function (success) {
        if (!success && needsData) {
          answer.className =
            "ai-answer";
          answer.innerHTML =
            '<span class="ai-answer-label">AI</span>' +
            '<p>I could not load enough usable market data to answer that yet. Try refreshing the market feed or choose another instrument.</p>';
          return;
        }

        renderAIAdvisor();

        var response =
          answerAIQuestion(cleanQuestion);

        answer.className =
          "ai-answer";
        answer.innerHTML =
          '<span class="ai-answer-label">AI</span>' +
          '<p>' +
            escapeHTML(response) +
          '</p>';
      })
      .catch(function (error) {
        console.error(
          "Portfolio AI question error",
          error
        );

        answer.className =
          "ai-answer";
        answer.innerHTML =
          '<span class="ai-answer-label">AI</span>' +
          '<p>Something interrupted the analysis. The rest of the dashboard is still available, so try the question again.</p>';
      })
      .then(function () {
        if (button) {
          button.disabled = false;
          button.textContent = "Ask AI";
        }
      });
  }



  function randomBlock(returns, blockSize) {
    if (returns.length <= blockSize) return returns.slice();
    var start = Math.floor(Math.random() * (returns.length - blockSize + 1));
    return returns.slice(start, start + blockSize);
  }

  function runMonteCarlo(investment, analysedAssets, horizonDays, simulationCount) {
    var terminalValues = [];
    var drawdowns = [];
    var paths = [];
    var chartPathCount = Math.min(100, simulationCount);
    var blockSize = 1;
    var simulation;

    if (horizonDays > 5) blockSize = 3;
    if (horizonDays > 21) blockSize = 5;

    for (simulation = 0; simulation < simulationCount; simulation++) {
      var value = investment;
      var peak = investment;
      var maxDrawdown = 0;
      var path = [value];
      var day;

      for (day = 0; day < horizonDays; day++) {
        var portfolioReturn = 0;
        var weight = 1 / analysedAssets.length;
        var a;

        for (a = 0; a < analysedAssets.length; a++) {
          portfolioReturn += mean(randomBlock(analysedAssets[a].returns, blockSize)) * weight;
        }

        value *= Math.exp(portfolioReturn);
        if (value > peak) peak = value;

        var drawdown = (value - peak) / peak;
        if (drawdown < maxDrawdown) maxDrawdown = drawdown;
        if (simulation < chartPathCount) path.push(value);
      }

      terminalValues.push(value);
      drawdowns.push(maxDrawdown);
      if (simulation < chartPathCount) paths.push(path);
    }

    var profitable = terminalValues.filter(function (value) {
      return value > investment;
    }).length;

    var median = percentile(terminalValues, 0.50);

    return {
      terminalValues: terminalValues,
      paths: paths,
      p10: percentile(terminalValues, 0.10),
      median: median,
      p90: percentile(terminalValues, 0.90),
      probabilityProfit: profitable / simulationCount,
      stressDrawdown: percentile(drawdowns, 0.10),
      horizonReturn: investment > 0 ? (median / investment) - 1 : 0,
      projectedProfit: median - investment,
      annualisedReturn: horizonDays > 0 ? Math.pow(median / investment, 252 / horizonDays) - 1 : 0
    };
  }

  /* ========================= FORECAST ========================= */

  function calculateForecast() {
    var investment = Number(el("investment") ? el("investment").value : 0);
    if (!isFinite(investment) || investment <= 0) {
      alert("Enter a valid investment amount.");
      return;
    }

    if (!selectedAssets.length) {
      alert("Choose at least one asset.");
      return;
    }

    var strategy = el("strategy") ? el("strategy").value : "Investor";
    var horizonName = el("horizon") ? el("horizon").value : "1 Year";
    var simulations = Number(el("simulations") ? el("simulations").value : 2500);
    simulations = Math.max(1000, Math.min(25000, simulations || 2500));
    var horizonDays = RANGE_CONFIG[strategy][horizonName];

    var missing = selectedAssets.some(function (asset) {
      return !marketData[asset.key];
    });

    var ready = missing ? loadMarketData() : Promise.resolve(true);

    ready.then(function (success) {
      if (!success) return;

      var analysedAssets = selectedAssets
        .map(function (asset) { return marketData[asset.key]; })
        .filter(Boolean);

      if (!analysedAssets.length) {
        alert("No selected assets have enough historical data to analyse.");
        return;
      }

      var button = el("generatePortfolio");
      var buttonText = button ? button.querySelector("span") : null;
      if (button) button.disabled = true;
      if (buttonText) buttonText.textContent = "Analysing…";

      setStatus("Running " + numberFormat(simulations) + " simulations…", "loading");

      window.setTimeout(function () {
        try {
          var result = runMonteCarlo(investment, analysedAssets, horizonDays, simulations);
          portfolioResults = result;
          portfolioResults.investment = investment;
          portfolioResults.strategy = strategy;
          portfolioResults.horizonName = horizonName;
          portfolioResults.horizonDays = horizonDays;
          portfolioResults.simulationCount = simulations;
          portfolioResults.assets = analysedAssets.map(function (item) { return item.asset; });

          renderKPIs();
          renderScenarios();
          renderSignals();
          renderAssetAnalysis();
          renderAIAdvisor();
          renderTradePlanner();
          drawForecastChart();

          var subtitle = el("chartSubtitle");
          if (subtitle) {
            subtitle.textContent =
              money(investment) +
              " starting value · " +
              horizonName +
              " · " +
              numberFormat(simulations) +
              " simulations · " +
              analysedAssets.map(function (item) {
                return item.asset.symbol;
              }).join(" · ");
          }

          setStatus("Analysis complete", "success");
          updateOverview();
          updatePremiumIntelligence();
          setAppView("intelligence");
        } catch (error) {
          console.error(error);
          setStatus("Analysis error", "error");
          alert("Analysis error:\n\n" + error.message);
        }

        if (button) button.disabled = false;
        if (buttonText) buttonText.textContent = "Run analysis";
      }, 50);
    });
  }

  function renderKPIs() {
    if (!portfolioResults) return;

    var expectedValue = el("expectedValue");
    var projectedProfit = el("projectedProfit");
    var probability = el("profitProbability");
    var expectedReturn = el("expectedReturn");
    var drawdown = el("maxDrawdown");
    var expectedValueNote = el("expectedValueNote");
    var projectedProfitNote = el("projectedProfitNote");
    var expectedReturnNote = el("expectedReturnNote");

    var profit = portfolioResults.projectedProfit;
    var horizonReturn = portfolioResults.horizonReturn;
    var horizonName = portfolioResults.horizonName || "selected horizon";

    if (expectedValue) {
      expectedValue.textContent = money(portfolioResults.median);
    }

    if (projectedProfit) {
      projectedProfit.textContent =
        (profit > 0 ? "+" : "") + money(profit);

      projectedProfit.classList.remove(
        "kpi-value-positive",
        "kpi-value-negative"
      );

      projectedProfit.classList.add(
        profit >= 0
          ? "kpi-value-positive"
          : "kpi-value-negative"
      );
    }

    if (probability) {
      probability.textContent =
        percent(portfolioResults.probabilityProfit);
    }

    if (expectedReturn) {
      expectedReturn.textContent =
        (horizonReturn > 0 ? "+" : "") +
        percent(horizonReturn);
    }

    if (drawdown) {
      drawdown.textContent =
        percent(portfolioResults.stressDrawdown);
    }

    if (expectedValueNote) {
      expectedValueNote.textContent =
        "Median simulated value after " + horizonName.toLowerCase();
    }

    if (projectedProfitNote) {
      projectedProfitNote.textContent =
        "Median change from " +
        money(portfolioResults.investment);
    }

    if (expectedReturnNote) {
      expectedReturnNote.textContent =
        "Median return over " + horizonName.toLowerCase();
    }

    renderForecastMoneySummary();
  }

  function renderForecastMoneySummary() {
    var container = el("forecastMoneySummary");

    if (!container || !portfolioResults) return;

    var investment = portfolioResults.investment;
    var median = portfolioResults.median;
    var p10 = portfolioResults.p10;
    var p90 = portfolioResults.p90;
    var profit = median - investment;
    var returnPct =
      investment > 0
        ? (median / investment) - 1
        : 0;
    var profitClass =
      profit >= 0 ? "positive" : "negative";

    container.innerHTML =
      '<div class="forecast-money-grid">' +

        '<div class="forecast-money-block primary">' +
          '<span class="forecast-money-label">' +
            escapeHTML(portfolioResults.horizonName) +
            ' median forecast' +
          '</span>' +
          '<strong class="forecast-money-value">' +
            money(median) +
          '</strong>' +
          '<span class="forecast-money-change ' +
            profitClass +
          '">' +
            (profit > 0 ? "+" : "") +
            money(profit) +
            " (" +
            (returnPct > 0 ? "+" : "") +
            percent(returnPct) +
            ")" +
          '</span>' +
        '</div>' +

        '<div class="forecast-money-block">' +
          '<span class="forecast-money-label">Starting investment</span>' +
          '<strong class="forecast-money-value">' +
            money(investment) +
          '</strong>' +
          '<span class="forecast-money-change">' +
            numberFormat(portfolioResults.simulationCount) +
            " simulations" +
          '</span>' +
        '</div>' +

        '<div class="forecast-money-block">' +
          '<span class="forecast-money-label">Likely outcome range</span>' +
          '<div class="forecast-money-range">' +
            '<strong>' + money(p10) + '</strong>' +
            '<span>to</span>' +
            '<strong>' + money(p90) + '</strong>' +
          '</div>' +
          '<span class="forecast-money-change">' +
            "10th–90th percentile" +
          '</span>' +
        '</div>' +

      '</div>';
  }

  function renderScenarios() {
    var container = el("scenarioResults");
    if (!container || !portfolioResults) return;

    var scenarios = [
      {
        title: "Stress case",
        subtitle: "10th percentile",
        value: portfolioResults.p10
      },
      {
        title: "Base case",
        subtitle: "Median outcome",
        value: portfolioResults.median
      },
      {
        title: "Upside case",
        subtitle: "90th percentile",
        value: portfolioResults.p90
      }
    ];

    var html = "";

    scenarios.forEach(function (scenario) {
      var moneyChange =
        scenario.value - portfolioResults.investment;

      var percentChange =
        scenario.value / portfolioResults.investment - 1;

      var cssClass =
        moneyChange >= 0 ? "positive" : "negative";

      html +=
        '<div class="scenario-card">' +
          '<span>' +
            escapeHTML(scenario.title) +
          '</span>' +

          '<small>' +
            escapeHTML(scenario.subtitle) +
          '</small>' +

          '<strong>' +
            money(scenario.value) +
          '</strong>' +

          '<em class="' + cssClass + '">' +
            (percentChange > 0 ? "+" : "") +
            percent(percentChange) +
          '</em>' +

          '<div class="scenario-money-change ' +
            cssClass +
          '">' +
            (moneyChange > 0 ? "+" : "") +
            money(moneyChange) +
          '</div>' +
        '</div>';
    });

    container.innerHTML = html;
  }

  function plannerNumber(id, fallback) {
    var input = el(id);
    var value =
      input
        ? Number(input.value)
        : fallback;

    if (!isFinite(value)) {
      return fallback;
    }

    return value;
  }

  function plannerDirection(signal) {
    if (!signal) return "WAIT";
    if (signal.label === "Bullish") {
      return "LONG";
    }
    if (signal.label === "Bearish") {
      return "SHORT";
    }
    return "WAIT";
  }

  function plannerUnitLabel(asset) {
    if (!asset) return "units";
    if (
      asset.market === "Stocks" ||
      asset.market === "ETFs"
    ) {
      return "shares";
    }
    if (asset.market === "Forex") {
      return "base units";
    }
    if (asset.market === "Crypto") {
      return "coins";
    }
    return "units";
  }

  function plannerUnits(value, asset) {
    if (!isFinite(value)) return "—";

    var decimals = 2;

    if (
      asset &&
      asset.market === "Stocks"
    ) {
      decimals = 2;
    } else if (
      asset &&
      asset.market === "ETFs"
    ) {
      decimals = 2;
    } else if (
      asset &&
      asset.market === "Forex"
    ) {
      decimals = 0;
    } else if (
      Math.abs(value) < 1
    ) {
      decimals = 5;
    }

    return Number(value).toLocaleString(
      "en-US",
      {
        maximumFractionDigits:
          decimals
      }
    );
  }

  function buildTradePlan() {
    var investment =
      Math.max(
        0,
        plannerNumber(
          "investment",
          10000
        )
      );

    var riskPerTradePct =
      clamp(
        plannerNumber(
          "riskPerTrade",
          1
        ),
        0.1,
        10
      );

    var maxOpenRiskPct =
      clamp(
        plannerNumber(
          "maxOpenRisk",
          3
        ),
        0.5,
        20
      );

    var stopPct =
      clamp(
        plannerNumber(
          "stopDistance",
          2
        ),
        0.1,
        25
      );

    var rewardRisk =
      clamp(
        plannerNumber(
          "rewardRisk",
          2
        ),
        0.5,
        10
      );

    var leverage =
      clamp(
        plannerNumber(
          "plannerLeverage",
          1
        ),
        1,
        100
      );

    var available = [];

    selectedAssets.forEach(
      function (asset) {
        var analysis =
          marketData[asset.key];

        if (
          analysis &&
          isFinite(
            analysis.latestPrice
          ) &&
          analysis.latestPrice > 0 &&
          analysis.signal
        ) {
          available.push({
            asset: asset,
            analysis: analysis,
            direction:
              plannerDirection(
                analysis.signal
              )
          });
        }
      }
    );

    var actionable =
      available.filter(
        function (item) {
          return (
            item.direction !==
            "WAIT"
          );
        }
      );

    var actionableCount =
      actionable.length;

    var requestedRiskBudget =
      investment *
      (
        riskPerTradePct /
        100
      );

    var totalRiskCap =
      investment *
      (
        maxOpenRiskPct /
        100
      );

    var allocatedRiskBudget =
      actionableCount
        ? Math.min(
            requestedRiskBudget,
            totalRiskCap /
              actionableCount
          )
        : 0;

    var stopFraction =
      stopPct / 100;

    var targetFraction =
      stopFraction *
      rewardRisk;

    var plans =
      available.map(
        function (item) {
          var asset =
            item.asset;
          var analysis =
            item.analysis;
          var direction =
            item.direction;
          var entry =
            analysis.latestPrice;

          var riskBudget =
            direction === "WAIT"
              ? 0
              : allocatedRiskBudget;

          var notional =
            stopFraction > 0
              ? riskBudget /
                stopFraction
              : 0;

          var units =
            entry > 0
              ? notional / entry
              : 0;

          var stopPrice =
            entry;

          var targetPrice =
            entry;

          if (
            direction === "LONG"
          ) {
            stopPrice =
              entry *
              (1 - stopFraction);

            targetPrice =
              entry *
              (1 + targetFraction);
          } else if (
            direction === "SHORT"
          ) {
            stopPrice =
              entry *
              (1 + stopFraction);

            targetPrice =
              entry *
              (1 - targetFraction);
          }

          var potentialLoss =
            notional *
            stopFraction;

          var potentialProfit =
            potentialLoss *
            rewardRisk;

          var margin =
            leverage > 0
              ? notional /
                leverage
              : notional;

          var standardLotEquivalent =
            asset.market === "Forex"
              ? units / 100000
              : null;

          return {
            asset: asset,
            analysis: analysis,
            direction: direction,
            entry: entry,
            stopPrice: stopPrice,
            targetPrice: targetPrice,
            riskBudget: riskBudget,
            notional: notional,
            units: units,
            potentialLoss:
              potentialLoss,
            potentialProfit:
              potentialProfit,
            margin: margin,
            leverage: leverage,
            standardLotEquivalent:
              standardLotEquivalent
          };
        }
      );

    return {
      investment: investment,
      riskPerTradePct:
        riskPerTradePct,
      maxOpenRiskPct:
        maxOpenRiskPct,
      stopPct: stopPct,
      rewardRisk:
        rewardRisk,
      leverage: leverage,
      availableCount:
        available.length,
      actionableCount:
        actionableCount,
      requestedRiskBudget:
        requestedRiskBudget,
      allocatedRiskBudget:
        allocatedRiskBudget,
      totalRiskCap:
        totalRiskCap,
      plannedOpenRisk:
        allocatedRiskBudget *
        actionableCount,
      plans: plans
    };
  }

  function positionSizeDisplay(plan) {
    if (
      !plan ||
      plan.direction === "WAIT"
    ) {
      return {
        primary: "No position",
        secondary:
          "WAIT signal · no directional size proposed",
        note:
          "Portfolio AI is not proposing a trade size while the directional signal is neutral."
      };
    }

    var asset =
      plan.asset || {};
    var market =
      asset.market || "";
    var unitsText =
      plannerUnits(
        plan.units,
        asset
      );

    if (market === "Forex") {
      var lots =
        plan.standardLotEquivalent;

      return {
        primary:
          Number(lots).toFixed(3) +
          " lots",
        secondary:
          unitsText +
          " base units",
        note:
          "Forex lot estimate uses 100,000 base units as one standard lot. Your broker's contract and margin rules still apply."
      };
    }

    if (
      market === "Stocks" ||
      market === "ETFs"
    ) {
      return {
        primary:
          unitsText +
          (
            market === "Stocks"
              ? " shares"
              : " ETF shares"
          ),
        secondary:
          money(
            plan.notional
          ) +
          " notional exposure",
        note:
          "Share quantity is calculated from the risk budget and stop distance. Fractional-share availability depends on the broker."
      };
    }

    if (market === "Crypto") {
      return {
        primary:
          unitsText +
          " coins",
        secondary:
          money(
            plan.notional
          ) +
          " notional exposure",
        note:
          "Crypto quantity is shown in asset units. Exchange minimum sizes, fees and leverage rules can differ."
      };
    }

    if (market === "Commodities") {
      return {
        primary:
          unitsText +
          " exposure units",
        secondary:
          money(
            plan.notional
          ) +
          " notional exposure",
        note:
          "Commodity and CFD lot sizes are broker-specific. Portfolio AI will not label this as an exact broker lot without contract specifications."
      };
    }

    return {
      primary:
        unitsText +
        " units",
      secondary:
        money(
          plan.notional
        ) +
        " notional exposure",
      note:
        "Position quantity is calculated from the selected risk budget and stop distance."
    };
  }

  function renderPositionSizeRecommendation(
    plan,
    state
  ) {
    var sizing =
      positionSizeDisplay(plan);

    if (
      !plan ||
      plan.direction === "WAIT"
    ) {
      return (
        '<div class="trade-size-recommendation">' +
          '<div class="trade-size-primary">' +
            '<span>POSITION SIZE</span>' +
            '<strong>' +
              escapeHTML(
                sizing.primary
              ) +
            '</strong>' +
            '<small>' +
              escapeHTML(
                sizing.secondary
              ) +
            '</small>' +
          '</div>' +
          '<div class="trade-size-why">' +
            '<strong>Why?</strong>' +
            '<p>' +
              escapeHTML(
                sizing.note
              ) +
            '</p>' +
          '</div>' +
        '</div>'
      );
    }

    var actualRiskPct =
      state.investment > 0
        ? (
            plan.riskBudget /
            state.investment
          ) * 100
        : 0;

    return (
      '<div class="trade-size-recommendation">' +
        '<div class="trade-size-primary">' +
          '<span>RISK-BASED POSITION SIZE</span>' +
          '<strong>' +
            escapeHTML(
              sizing.primary
            ) +
          '</strong>' +
          '<small>' +
            escapeHTML(
              sizing.secondary
            ) +
          '</small>' +
        '</div>' +

        '<div class="trade-size-why">' +
          '<strong>Why this size?</strong>' +
          '<p>' +
            'With ' +
            money(
              state.investment
            ) +
            ' of capital, this setup is allocated approximately ' +
            actualRiskPct.toFixed(2) +
            '% (' +
            money(
              plan.riskBudget
            ) +
            ') of planned risk. A ' +
            state.stopPct.toFixed(1) +
            '% stop distance produces this position size so that a stop-out is approximately equal to the risk budget.' +
          '</p>' +
          '<div class="trade-size-warning">' +
            escapeHTML(
              sizing.note
            ) +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }


  function tradeMapPositions(plan) {
    if (
      !plan ||
      plan.direction === "WAIT"
    ) {
      return null;
    }

    var values = [
      plan.stopPrice,
      plan.entry,
      plan.targetPrice
    ];

    var minValue =
      Math.min.apply(
        null,
        values
      );

    var maxValue =
      Math.max.apply(
        null,
        values
      );

    var range =
      maxValue - minValue;

    if (
      !isFinite(range) ||
      range <= 0
    ) {
      return {
        stop: 10,
        entry: 50,
        target: 90
      };
    }

    function position(value) {
      return (
        8 +
        (
          (value - minValue) /
          range
        ) *
        84
      );
    }

    return {
      stop:
        position(
          plan.stopPrice
        ),
      entry:
        position(
          plan.entry
        ),
      target:
        position(
          plan.targetPrice
        )
    };
  }

  function renderTradeMap(plan) {
    if (
      !plan ||
      plan.direction === "WAIT"
    ) {
      return (
        '<div class="trade-map">' +
          '<div class="trade-map-head">' +
            '<strong>Stop loss & take profit map</strong>' +
            '<span>WAIT signal</span>' +
          '</div>' +
          '<div class="trade-map-explainer">' +
            'No stop-loss or take-profit scenario is plotted because Portfolio AI currently has a neutral directional signal for this asset.' +
          '</div>' +
        '</div>'
      );
    }

    var pos =
      tradeMapPositions(plan);

    var riskLeft =
      Math.min(
        pos.stop,
        pos.entry
      );

    var riskWidth =
      Math.abs(
        pos.entry - pos.stop
      );

    var rewardLeft =
      Math.min(
        pos.entry,
        pos.target
      );

    var rewardWidth =
      Math.abs(
        pos.target - pos.entry
      );

    return (
      '<div class="trade-map">' +

        '<div class="trade-map-head">' +
          '<strong>Stop loss & take profit map</strong>' +
          '<span>' +
            escapeHTML(
              plan.direction
            ) +
            ' scenario</span>' +
        '</div>' +

        '<div class="trade-level-track">' +
          '<div class="trade-level-line"></div>' +

          '<div class="trade-level-zone risk" style="left:' +
            riskLeft.toFixed(2) +
            '%;width:' +
            riskWidth.toFixed(2) +
            '%"></div>' +

          '<div class="trade-level-zone reward" style="left:' +
            rewardLeft.toFixed(2) +
            '%;width:' +
            rewardWidth.toFixed(2) +
            '%"></div>' +

          '<span class="trade-level-marker stop" style="left:' +
            pos.stop.toFixed(2) +
            '%"></span>' +
          '<span class="trade-level-marker entry" style="left:' +
            pos.entry.toFixed(2) +
            '%"></span>' +
          '<span class="trade-level-marker target" style="left:' +
            pos.target.toFixed(2) +
            '%"></span>' +

          '<span class="trade-level-label stop" style="left:' +
            pos.stop.toFixed(2) +
            '%">STOP LOSS</span>' +
          '<span class="trade-level-label entry" style="left:' +
            pos.entry.toFixed(2) +
            '%">ENTRY</span>' +
          '<span class="trade-level-label target" style="left:' +
            pos.target.toFixed(2) +
            '%">TAKE PROFIT</span>' +
        '</div>' +

        '<div class="trade-level-values">' +
          '<div class="trade-level-value stop">' +
            '<span>STOP LOSS</span>' +
            '<strong>' +
              marketPrice(
                plan.stopPrice
              ) +
            '</strong>' +
          '</div>' +

          '<div class="trade-level-value">' +
            '<span>ENTRY</span>' +
            '<strong>' +
              marketPrice(
                plan.entry
              ) +
            '</strong>' +
          '</div>' +

          '<div class="trade-level-value target">' +
            '<span>TAKE PROFIT</span>' +
            '<strong>' +
              marketPrice(
                plan.targetPrice
              ) +
            '</strong>' +
          '</div>' +
        '</div>' +

        '<div class="trade-map-explainer">' +
          (
            plan.direction === "LONG"
              ? 'For this LONG scenario, the stop loss sits below entry and the take-profit level sits above entry.'
              : 'For this SHORT scenario, the stop loss sits above entry and the take-profit level sits below entry.'
          ) +
          ' If the stop is reached, the planned loss is approximately ' +
          money(
            plan.potentialLoss
          ) +
          '. If the take-profit level is reached, the scenario profit is approximately ' +
          money(
            plan.potentialProfit
          ) +
          ', before spreads, slippage, fees and broker-specific execution.' +
        '</div>' +

      '</div>'
    );
  }


  function renderTradePlanner() {
    var summary =
      el("tradePlannerSummary");
    var grid =
      el("tradePlannerGrid");

    if (!summary || !grid) {
      return;
    }

    var state =
      buildTradePlan();

    if (!state.availableCount) {
      summary.innerHTML =
        '<div class="large-empty-state small">' +
          '<strong>Load market data to build a trade plan</strong>' +
          '<p>The planner needs current prices and Portfolio AI signals before calculating risk-based sizes.</p>' +
        '</div>';

      grid.innerHTML = "";
      return;
    }

    var riskClass =
      state.plannedOpenRisk <=
      state.totalRiskCap + 0.01
        ? "trade-risk-ok"
        : "trade-risk-warning";

    summary.innerHTML =
      '<div class="trade-summary-card">' +
        '<span>CAPITAL</span>' +
        '<strong>' +
          money(
            state.investment
          ) +
        '</strong>' +
        '<small>Uses Initial investment above</small>' +
      '</div>' +

      '<div class="trade-summary-card">' +
        '<span>RISK / ACTIVE SETUP</span>' +
        '<strong>' +
          money(
            state.allocatedRiskBudget
          ) +
        '</strong>' +
        '<small>' +
          percent(
            state.investment
              ? state.allocatedRiskBudget /
                state.investment
              : 0,
            2
          ) +
          ' of capital</small>' +
      '</div>' +

      '<div class="trade-summary-card">' +
        '<span>PLANNED OPEN RISK</span>' +
        '<strong class="' +
          riskClass +
        '">' +
          money(
            state.plannedOpenRisk
          ) +
        '</strong>' +
        '<small>Cap: ' +
          money(
            state.totalRiskCap
          ) +
          ' (' +
          state.maxOpenRiskPct.toFixed(1) +
          '%)</small>' +
      '</div>' +

      '<div class="trade-summary-card">' +
        '<span>ACTIONABLE SETUPS</span>' +
        '<strong>' +
          state.actionableCount +
          ' / ' +
          state.availableCount +
        '</strong>' +
        '<small>Neutral signals remain WAIT</small>' +
      '</div>';

    var html = "";

    state.plans.forEach(
      function (plan) {
        var directionClass =
          plan.direction === "LONG"
            ? "long"
            : (
                plan.direction === "SHORT"
                  ? "short"
                  : "wait"
              );

        var lotText =
          plan.standardLotEquivalent ===
          null
            ? "—"
            : Number(
                plan.standardLotEquivalent
              ).toFixed(3);

        var unitLabel =
          plannerUnitLabel(
            plan.asset
          );

        html +=
          '<article class="trade-plan-card">' +

            '<div class="trade-plan-head">' +
              '<div class="trade-plan-title">' +
                '<strong>' +
                  escapeHTML(
                    plan.asset.symbol
                  ) +
                '</strong>' +
                '<small>' +
                  escapeHTML(
                    plan.asset.name ||
                    plan.asset.market
                  ) +
                  ' · ' +
                  escapeHTML(
                    plan.analysis.signal.trend
                  ) +
                  ' · ' +
                  plan.analysis.signal.confidence.toFixed(0) +
                  '% signal confidence' +
                '</small>' +
              '</div>' +

              '<span class="trade-direction ' +
                directionClass +
              '">' +
                plan.direction +
              '</span>' +
            '</div>' +

            '<div class="trade-plan-metrics">' +

              '<div class="trade-metric">' +
                '<span>ENTRY</span>' +
                '<strong>' +
                  marketPrice(
                    plan.entry
                  ) +
                '</strong>' +
              '</div>' +

              '<div class="trade-metric">' +
                '<span>STOP</span>' +
                '<strong>' +
                  (
                    plan.direction === "WAIT"
                      ? "—"
                      : marketPrice(
                          plan.stopPrice
                        )
                  ) +
                '</strong>' +
              '</div>' +

              '<div class="trade-metric">' +
                '<span>TARGET</span>' +
                '<strong>' +
                  (
                    plan.direction === "WAIT"
                      ? "—"
                      : marketPrice(
                          plan.targetPrice
                        )
                  ) +
                '</strong>' +
              '</div>' +

              '<div class="trade-metric">' +
                '<span>POSITION SIZE</span>' +
                '<strong>' +
                  (
                    plan.direction === "WAIT"
                      ? "—"
                      : plannerUnits(
                          plan.units,
                          plan.asset
                        ) +
                        " " +
                        unitLabel
                  ) +
                '</strong>' +
              '</div>' +

              '<div class="trade-metric">' +
                '<span>NOTIONAL</span>' +
                '<strong>' +
                  (
                    plan.direction === "WAIT"
                      ? "—"
                      : money(
                          plan.notional
                        )
                  ) +
                '</strong>' +
              '</div>' +

              '<div class="trade-metric">' +
                '<span>' +
                  (
                    plan.asset.market === "Forex"
                      ? "STD LOT EQ."
                      : "SIZE TYPE"
                  ) +
                '</span>' +
                '<strong>' +
                  (
                    plan.direction === "WAIT"
                      ? "—"
                      : (
                          plan.asset.market === "Forex"
                            ? lotText
                            : (
                                plan.asset.market === "Stocks" ||
                                plan.asset.market === "ETFs"
                                  ? "Shares"
                                  : (
                                      plan.asset.market === "Crypto"
                                        ? "Coins"
                                        : "Broker specific"
                                    )
                              )
                        )
                  ) +
                '</strong>' +
              '</div>' +

              '<div class="trade-metric">' +
                '<span>EST. MARGIN</span>' +
                '<strong>' +
                  (
                    plan.direction === "WAIT"
                      ? "—"
                      : money(
                          plan.margin
                        )
                  ) +
                '</strong>' +
              '</div>' +

            '</div>' +

            renderPositionSizeRecommendation(
              plan,
              state
            ) +

            renderTradeMap(
              plan
            ) +

            '<div class="trade-plan-foot">' +
              '<span>' +
                (
                  plan.direction === "WAIT"
                    ? "Neutral signal: no directional size is proposed."
                    : (
                        "Risk budget " +
                        money(
                          plan.riskBudget
                        ) +
                        " · Potential loss " +
                        money(
                          plan.potentialLoss
                        ) +
                        " · Scenario profit at target " +
                        money(
                          plan.potentialProfit
                        )
                      )
                ) +
              '</span>' +

              '<span>' +
                state.stopPct.toFixed(1) +
                '% stop · ' +
                state.rewardRisk.toFixed(1) +
                ':1 reward/risk · ' +
                state.leverage.toFixed(0) +
                '× margin preview' +
              '</span>' +
            '</div>' +

          '</article>';
      }
    );

    grid.innerHTML = html;
  
    updateTradeDuckSummary();
  }


  function renderSignals() {
    var container = el("signals");
    if (!container) return;

    var html = "";

    selectedAssets.forEach(function (asset) {
      var analysis = marketData[asset.key];
      if (!analysis || !analysis.signal) return;

      var signal = analysis.signal;
      var cssClass = signal.label.toLowerCase();
      var barValue = clamp(
        50 + signal.score / 2,
        0,
        100
      );

      html +=
        '<div class="signal-card">' +
          '<div class="signal-top">' +
            '<strong>' + escapeHTML(asset.symbol) + '</strong>' +
            '<span class="signal-badge ' +
              cssClass +
            '">' +
              escapeHTML(signal.label) +
            '</span>' +
          '</div>' +

          '<div class="signal-score-row">' +
            '<span>Directional score</span>' +
            '<span>' +
              (signal.score > 0 ? "+" : "") +
              signal.score.toFixed(0) +
            '</span>' +
          '</div>' +

          '<div class="signal-bar">' +
            '<div style="width:' +
              barValue.toFixed(0) +
              '%"></div>' +
          '</div>' +

          '<div class="signal-detail">' +
            escapeHTML(signal.trend) +
            " · " +
            escapeHTML(signal.momentum) +
            " momentum · " +
            signal.confidence.toFixed(0) +
            "% confidence" +
          '</div>' +
        '</div>';
    });

    if (!html) {
      html =
        '<div class="large-empty-state small">' +
          '<strong>No signals yet</strong>' +
          '<p>Load market data to calculate direction and confidence.</p>' +
        '</div>';
    }

    container.innerHTML = html;
  }

  function renderAssetAnalysis() {
    var container = el("assetResults");
    if (!container) return;

    var html = "";
    selectedAssets.forEach(function (asset) {
      var analysis = marketData[asset.key];
      if (!analysis) return;

      html +=
        '<div class="asset-analysis-row">' +
        '<div class="asset-analysis-name"><strong>' + escapeHTML(asset.symbol) + '</strong><small>' + escapeHTML(asset.name) + '</small></div>' +
        '<div class="asset-stat"><span>PRICE</span><strong>' + marketPrice(analysis.latestPrice) + '</strong></div>' +
        '<div class="asset-stat"><span>ANNUAL RETURN</span><strong>' + percent(analysis.annualReturn) + '</strong></div>' +
        '<div class="asset-stat"><span>VOLATILITY</span><strong>' + percent(analysis.annualVolatility) + '</strong></div>' +
        '<div class="asset-stat"><span>WIN RATE</span><strong>' + percent(analysis.winRate) + '</strong></div>' +
        '<div class="asset-stat"><span>AI TREND</span><strong>' + escapeHTML(analysis.signal ? analysis.signal.trend : "—") + '</strong></div>' +
        '</div>';
    });

    if (!html) {
      html = '<div class="large-empty-state small"><strong>No asset analysis yet</strong><p>Selected instruments will appear here after market data loads.</p></div>';
    }
    container.innerHTML = html;
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function drawForecastChart() {
    var canvas = el("forecastChart");
    if (!canvas || !portfolioResults || typeof Chart === "undefined") return;

    if (forecastChart) {
      forecastChart.destroy();
      forecastChart = null;
    }

    var result = portfolioResults;
    var medianPath = [];
    var downsidePath = [];
    var upsidePath = [];
    var day;

    for (day = 0; day <= result.horizonDays; day++) {
      var values = result.paths
        .map(function (path) { return path[day]; })
        .filter(function (value) { return isFinite(value); });

      if (!values.length) continue;
      medianPath.push({ x: day, y: percentile(values, 0.50) });
      downsidePath.push({ x: day, y: percentile(values, 0.10) });
      upsidePath.push({ x: day, y: percentile(values, 0.90) });
    }

    var textSecondary = cssVar("--text-secondary") || "#86868b";
    var border = cssVar("--border") || "rgba(0,0,0,.08)";
    var blue = cssVar("--blue") || "#0071e3";
    var green = cssVar("--green") || "#248a3d";
    var red = cssVar("--red") || "#d70015";

    forecastChart = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: {
        datasets: [
          { label: "Downside", data: downsidePath, borderColor: red, borderWidth: 2, pointRadius: 0, tension: 0.3 },
          { label: "Median", data: medianPath, borderColor: blue, borderWidth: 3, pointRadius: 0, tension: 0.3 },
          { label: "Upside", data: upsidePath, borderColor: green, borderWidth: 2, pointRadius: 0, tension: 0.3 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 500 },
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (context) {
                return context.dataset.label + ": " + money(context.parsed.y);
              }
            }
          }
        },
        scales: {
          x: {
            type: "linear",
            grid: { color: border },
            border: { display: false },
            ticks: { color: textSecondary },
            title: { display: true, text: "Trading days", color: textSecondary }
          },
          y: {
            grid: { color: border },
            border: { display: false },
            ticks: {
              color: textSecondary,
              callback: function (value) { return money(value); }
            }
          }
        }
      }
    });
  }


  /* ========================= MARKETAUX NEWS ========================= */

  function gdeltNewsRequest(parameters) {
    parameters = parameters || {};

    var params =
      new URLSearchParams();
    var key;

    for (key in parameters) {
      if (
        Object.prototype.hasOwnProperty.call(
          parameters,
          key
        ) &&
        parameters[key] !== undefined &&
        parameters[key] !== null &&
        parameters[key] !== ""
      ) {
        params.append(
          key,
          parameters[key]
        );
      }
    }

    params.set("mode", "artlist");
    params.set("format", "json");
    params.set("sort", "datedesc");
    params.set("maxrecords", "12");
    params.set("timespan", "48h");

    var requestUrl =
      GDELT_NEWS_BASE +
      "?" +
      params.toString();

    return fetch(requestUrl)
      .then(function (response) {
        return response.text()
          .then(function (bodyText) {
            if (!response.ok) {
              var httpError =
                new Error(
                  "HTTP " +
                  response.status +
                  (bodyText
                    ? " · " +
                      bodyText.slice(0, 220)
                    : "")
                );

              httpError.status =
                response.status;
              httpError.requestUrl =
                requestUrl;
              httpError.responseText =
                bodyText;
              throw httpError;
            }

            var data;

            try {
              data =
                JSON.parse(bodyText);
            } catch (parseError) {
              var nonJsonError =
                new Error(
                  "Non-JSON response" +
                  (bodyText
                    ? " · " +
                      bodyText.slice(0, 220)
                    : "")
                );

              nonJsonError.status =
                response.status;
              nonJsonError.requestUrl =
                requestUrl;
              nonJsonError.responseText =
                bodyText;
              throw nonJsonError;
            }

            if (
              !data ||
              !Array.isArray(data.articles)
            ) {
              var shapeError =
                new Error(
                  "Unexpected GDELT response format."
                );

              shapeError.status =
                response.status;
              shapeError.requestUrl =
                requestUrl;
              shapeError.responseText =
                bodyText;
              throw shapeError;
            }

            data.__requestUrl =
              requestUrl;

            return data;
          });
      });
  }


  function cleanNewsSymbol(symbol) {
    symbol = String(symbol || "");

    if (symbol.indexOf("/") !== -1) {
      return symbol.split("/")[0];
    }

    return symbol;
  }

  function cleanNewsQueryTerm(value) {
    return String(value || "")
      .replace(/[()]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function newsAssetSearchTerms(asset) {
    var terms = [];
    var symbol =
      cleanNewsQueryTerm(
        asset.symbol || ""
      );
    var name =
      cleanNewsQueryTerm(
        asset.name || ""
      );

    if (
      asset.market === "Forex"
    ) {
      var forexText =
        symbol.replace("/", " ");

      if (forexText) {
        terms.push(
          '"' + forexText + '"'
        );
      }

      return terms;
    }

    if (
      asset.market === "Crypto"
    ) {
      var cryptoBase =
        symbol.split("/")[0];

      if (name) {
        terms.push(
          '"' + name + '"'
        );
      } else if (cryptoBase) {
        terms.push(cryptoBase);
      }

      return terms;
    }

    if (
      asset.market === "Commodities"
    ) {
      if (name) {
        terms.push(
          '"' + name + '"'
        );
      } else if (symbol) {
        terms.push(symbol);
      }

      return terms;
    }

    if (symbol) {
      terms.push(symbol);
    }

    if (
      name &&
      name.toLowerCase() !==
        symbol.toLowerCase()
    ) {
      terms.push(
        '"' + name + '"'
      );
    }

    return terms;
  }

  function buildPortfolioNewsQuery() {
    var allTerms = [];
    var seen = {};

    selectedAssets
      .slice(0, 4)
      .forEach(function (asset) {
        newsAssetSearchTerms(asset)
          .forEach(function (term) {
            var key =
              term.toLowerCase();

            if (!seen[key]) {
              seen[key] = true;
              allTerms.push(term);
            }
          });
      });

    if (!allTerms.length) {
      return buildNewsQuery(
        "markets"
      );
    }

    if (allTerms.length === 1) {
      return allTerms[0];
    }

    return (
      "(" +
      allTerms.join(" OR ") +
      ")"
    );
  }

  function buildNewsQuery(filter) {
    if (filter === "portfolio") {
      return buildPortfolioNewsQuery();
    }

    if (filter === "stocks") {
      return (
        '("stock market" OR equities OR earnings OR "Wall Street")'
      );
    }

    if (filter === "crypto") {
      return (
        '(bitcoin OR ethereum OR cryptocurrency OR blockchain)'
      );
    }

    if (filter === "forex") {
      return (
        '(forex OR currencies OR "foreign exchange" OR "central bank")'
      );
    }

    if (filter === "commodities") {
      return (
        '(gold OR silver OR oil OR commodities)'
      );
    }

    if (
      filter === "south-africa"
    ) {
      return (
        '("South Africa" OR rand OR JSE OR Johannesburg)'
      );
    }

    return (
      '("financial markets" OR "stock market" OR economy OR earnings)'
    );
  }

  function buildNewsParameters(filter) {
    return {
      query:
        buildNewsQuery(filter)
    };
  }

  function buildFallbackNewsParameters() {
    return {
      query:
        '"financial markets"'
    };
  }


  function parseNewsDate(value) {
    var text =
      String(value || "");

    if (/^\d{14}$/.test(text)) {
      return new Date(
        Date.UTC(
          Number(text.slice(0, 4)),
          Number(text.slice(4, 6)) - 1,
          Number(text.slice(6, 8)),
          Number(text.slice(8, 10)),
          Number(text.slice(10, 12)),
          Number(text.slice(12, 14))
        )
      );
    }

    return new Date(value);
  }

  function formatNewsTime(value) {
    if (!value) return "Latest";

    var date =
      parseNewsDate(value);

    if (isNaN(date.getTime())) {
      return "Latest";
    }

    var seconds = Math.max(
      0,
      Math.floor(
        (Date.now() - date.getTime()) / 1000
      )
    );

    if (seconds < 60) return "Just now";
    if (seconds < 3600) {
      return (
        Math.floor(seconds / 60) +
        "m ago"
      );
    }

    if (seconds < 86400) {
      return (
        Math.floor(seconds / 3600) +
        "h ago"
      );
    }

    if (seconds < 604800) {
      return (
        Math.floor(seconds / 86400) +
        "d ago"
      );
    }

    return date.toLocaleDateString(
      "en-US",
      {
        month: "short",
        day: "numeric"
      }
    );
  }

  function articleSource(article) {
    if (article.domain) {
      return article.domain
        .replace(/^www\./, "");
    }

    try {
      return new URL(article.url)
        .hostname.replace("www.", "");
    } catch (error) {
      return "Financial news";
    }
  }

  function scoreHeadlineSentiment(title) {
    var text =
      String(title || "")
        .toLowerCase();

    var positiveWords = [
      "gain",
      "gains",
      "rise",
      "rises",
      "rally",
      "rallies",
      "surge",
      "surges",
      "beat",
      "beats",
      "growth",
      "strong",
      "record high",
      "upgrade",
      "upbeat",
      "profit",
      "profits",
      "bullish",
      "rebound",
      "recovery"
    ];

    var negativeWords = [
      "fall",
      "falls",
      "drop",
      "drops",
      "plunge",
      "plunges",
      "loss",
      "losses",
      "weak",
      "warning",
      "downgrade",
      "selloff",
      "sell-off",
      "slump",
      "recession",
      "bearish",
      "miss",
      "misses",
      "risk",
      "crash"
    ];

    var score = 0;
    var i;

    for (
      i = 0;
      i < positiveWords.length;
      i++
    ) {
      if (
        text.indexOf(
          positiveWords[i]
        ) !== -1
      ) {
        score += 1;
      }
    }

    for (
      i = 0;
      i < negativeWords.length;
      i++
    ) {
      if (
        text.indexOf(
          negativeWords[i]
        ) !== -1
      ) {
        score -= 1;
      }
    }

    if (score > 0) {
      return {
        label: "Positive tone",
        className: "positive",
        score: score
      };
    }

    if (score < 0) {
      return {
        label: "Negative tone",
        className: "negative",
        score: score
      };
    }

    return {
      label: "Neutral tone",
      className: "neutral",
      score: 0
    };
  }

  function renderNews(data) {
    var grid =
      el("newsGrid");
    var status =
      el("newsStatus");

    if (!grid) return;

    var articles =
      data &&
      Array.isArray(data.articles)
        ? data.articles.slice(0, 6)
        : [];

    if (!articles.length) {
      grid.innerHTML =
        '<div class="news-fallback-state">' +
          '<strong>No matching headlines right now</strong>' +
          '<p>Try another category or refresh later. Portfolio analysis, prices and AI guidance are unaffected.</p>' +
        '</div>';

      if (status) {
        status.textContent =
          "No matching headlines returned";
      }

      return;
    }

    var html = "";
    var i;

    for (
      i = 0;
      i < articles.length;
      i++
    ) {
      var article =
        articles[i] || {};
      var featured =
        i === 0;
      var sentiment =
        scoreHeadlineSentiment(
          article.title
        );

      var imageHtml;

      if (article.socialimage) {
        imageHtml =
          '<img class="news-image" src="' +
          escapeHTML(
            article.socialimage
          ) +
          '" alt="" loading="lazy" ' +
          'onerror="this.style.display=\'none\'">';
      } else {
        imageHtml =
          '<div class="news-image-fallback">↗</div>';
      }

      html +=
        '<article class="news-card' +
        (featured ? " featured" : "") +
        '">' +

          '<div class="news-image-wrap">' +
            imageHtml +
          '</div>' +

          '<div class="news-content">' +

            '<div class="news-source-row">' +
              '<span class="news-source">' +
                escapeHTML(
                  articleSource(article)
                ) +
              '</span>' +

              '<span class="news-time">' +
                escapeHTML(
                  formatNewsTime(
                    article.seendate
                  )
                ) +
              '</span>' +
            '</div>' +

            '<h3 class="news-title">' +
              escapeHTML(
                article.title ||
                "Financial market update"
              ) +
            '</h3>' +

            '<p class="news-description">' +
              escapeHTML(
                article.language
                  ? "Global financial coverage · " +
                    article.language
                  : "Global financial coverage"
              ) +
            '</p>' +

            '<div class="news-entity-row">' +
              '<span class="news-entity news-sentiment ' +
                sentiment.className +
              '">' +
                escapeHTML(
                  sentiment.label
                ) +
              '</span>' +

              '<span class="news-source-pill">GDELT</span>' +
            '</div>' +

            (
              article.url
                ? '<a class="news-link" href="' +
                  escapeHTML(
                    article.url
                  ) +
                  '" target="_blank" rel="noopener noreferrer">' +
                    'Read source <span>↗</span>' +
                  '</a>'
                : ""
            ) +

          '</div>' +
        '</article>';
    }

    grid.innerHTML = html;

    if (status) {
      status.textContent =
        "Live global headlines · " +
        articles.length +
        " stories";
    }
  }


  function getNewsRequestKey(filter) {
    return (
      filter +
      "|" +
      buildNewsQuery(filter)
    );
  }


  function getNewsCacheKey(filter) {
    var key = filter;

    if (filter === "portfolio") {
      key += "|" +
        selectedAssets
          .map(function (asset) {
            return cleanNewsSymbol(asset.symbol);
          })
          .filter(Boolean)
          .sort()
          .join(",");
    }

    return key;
  }

  function getCachedNews(filter) {
    var entry =
      newsCache[getNewsCacheKey(filter)];

    if (!entry) return null;

    return {
      data: entry.data,
      fetchedAt: entry.fetchedAt,
      fresh:
        Date.now() - entry.fetchedAt <
        newsCacheTTL
    };
  }

  function setCachedNews(filter, data) {
    newsCache[getNewsCacheKey(filter)] = {
      data: data,
      fetchedAt: Date.now()
    };
  }

  function newsCacheAge(timestamp) {
    var seconds = Math.max(
      0,
      Math.floor(
        (Date.now() - timestamp) / 1000
      )
    );

    if (seconds < 60) return "just now";

    var minutes =
      Math.floor(seconds / 60);

    if (minutes < 60) {
      return minutes + " min ago";
    }

    return (
      Math.floor(minutes / 60) +
      " hr ago"
    );
  }

  function setNewsProviderHint(text, state) {
    var hint = el("newsProviderHint");
    if (!hint) return;

    hint.textContent = text;
    hint.className =
      "news-provider-hint" +
      (state ? " " + state : "");
  }

  function renderNewsDiagnostic(error) {
    var grid =
      el("newsGrid");

    if (!grid || !error) {
      return;
    }

    var message =
      error.message ||
      "Unknown news service error.";

    var diagnostic =
      document.createElement("div");

    diagnostic.className =
      "news-diagnostic";

    diagnostic.innerHTML =
      '<strong>News diagnostic:</strong> ' +
      escapeHTML(message);

    grid.appendChild(
      diagnostic
    );
  }

  function renderNewsServiceFallback(
    cached,
    message
  ) {
    var grid =
      el("newsGrid");
    var status =
      el("newsStatus");

    if (
      cached &&
      cached.data
    ) {
      renderNews(cached.data);

      if (status) {
        status.textContent =
          "Showing cached headlines";
      }

      setNewsProviderHint(
        "Live news is temporarily unavailable, so cached headlines are being shown.",
        "limited"
      );

      return;
    }

    if (grid) {
      grid.innerHTML =
        '<div class="news-fallback-state">' +
          '<strong>Live headlines temporarily unavailable</strong>' +
          '<p>' +
            escapeHTML(
              message ||
              "The external news service could not be reached."
            ) +
            ' Portfolio analysis, prices and AI guidance are unaffected.' +
          '</p>' +
        '</div>';
    }

    if (status) {
      status.textContent =
        "News temporarily unavailable";
    }

    setNewsProviderHint(
      "The News Hub failed gracefully; the rest of Portfolio AI is still fully available.",
      "limited"
    );
  }


  function loadNews(forceRefresh) {
    var filter =
      activeNewsFilter;

    var requestKey =
      getNewsRequestKey(filter);

    var cached =
      getCachedNews(filter);

    var grid =
      el("newsGrid");
    var status =
      el("newsStatus");
    var hint =
      el("newsPortfolioHint");
    var refresh =
      el("newsRefresh");

    if (
      !forceRefresh &&
      cached &&
      cached.fresh
    ) {
      renderNews(cached.data);

      if (status) {
        status.textContent =
          "Cached · " +
          newsCacheAge(
            cached.fetchedAt
          );
      }

      setNewsProviderHint(
        "Showing cached headlines. No external request was sent.",
        "cached"
      );

      return Promise.resolve(true);
    }

    if (
      !forceRefresh &&
      newsInFlight[requestKey]
    ) {
      if (status) {
        status.textContent =
          "News request already in progress…";
      }

      setNewsProviderHint(
        "Duplicate news request prevented.",
        "cached"
      );

      return newsInFlight[
        requestKey
      ];
    }

    if (refresh) {
      refresh.disabled = true;
    }

    if (grid) {
      grid.innerHTML =
        '<div class="catalog-loader">' +
          '<span></span>' +
          '<p>Loading financial news…</p>' +
        '</div>';
    }

    if (status) {
      status.textContent =
        forceRefresh
          ? "Refreshing headlines…"
          : "Loading live financial headlines…";
    }

    if (hint) {
      if (
        filter === "portfolio" &&
        selectedAssets.length
      ) {
        hint.textContent =
          "Following " +
          selectedAssets
            .slice(0, 4)
            .map(function (asset) {
              return asset.symbol;
            })
            .join(" · ");
      } else if (
        filter === "portfolio"
      ) {
        hint.textContent =
          "No assets selected · showing general markets";
      } else {
        hint.textContent =
          "Global news via GDELT";
      }
    }

    setNewsProviderHint(
      forceRefresh
        ? "Manual refresh: fetching live global headlines…"
        : "Fetching live global headlines…",
      ""
    );

    function finishRequest(result) {
      delete newsInFlight[
        requestKey
      ];

      if (refresh) {
        refresh.disabled = false;
      }

      return result;
    }

    function handleSuccess(data) {
      setCachedNews(
        filter,
        data
      );

      renderNews(data);

      if (status) {
        status.textContent =
          "Updated just now";
      }

      setNewsProviderHint(
        "Headlines cached for 30 minutes. Local tone scoring is calculated in your browser.",
        "provider-ok"
      );

      return true;
    }

    function finalFailure(error) {
      console.error(
        "GDELT news error:",
        error
      );

      renderNewsServiceFallback(
        cached,
        error &&
        error.message
          ? error.message
          : "The global news service could not be reached."
      );

      renderNewsDiagnostic(
        error
      );

      return false;
    }

    var primaryParameters =
      buildNewsParameters(filter);

    var requestPromise =
      gdeltNewsRequest(
        primaryParameters
      )
        .then(handleSuccess)
        .catch(function (primaryError) {
          console.warn(
            "Primary GDELT query failed. Retrying once with a simple market query.",
            primaryError
          );

          if (status) {
            status.textContent =
              "Retrying with a simpler news query…";
          }

          setNewsProviderHint(
            "The first news query was rejected or unavailable. Retrying once with a simple market query.",
            ""
          );

          return gdeltNewsRequest(
            buildFallbackNewsParameters()
          )
            .then(function (data) {
              setCachedNews(
                filter,
                data
              );

              renderNews(data);

              if (status) {
                status.textContent =
                  "Updated using fallback query";
              }

              setNewsProviderHint(
                "A simplified GDELT query succeeded. Headlines are cached for 30 minutes.",
                "provider-ok"
              );

              return true;
            })
            .catch(function (fallbackError) {
              fallbackError.message =
                "Primary: " +
                primaryError.message +
                " | Fallback: " +
                fallbackError.message;

              return finalFailure(
                fallbackError
              );
            });
        })
        .then(finishRequest);

    newsInFlight[
      requestKey
    ] = requestPromise;

    return requestPromise;
  }


  function setNewsFilter(filter) {
    activeNewsFilter = filter;

    var tabs =
      document.querySelectorAll(".news-tab");

    var i;

    for (i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle(
        "active",
        tabs[i].getAttribute("data-news-filter") === filter
      );
    }

    loadNews(false);
  }


  /* ========================= EVENTS ========================= */

  function setPortfolioFrozen(frozen) {
    var shell =
      el("portfolioFreezeShell");
    var button =
      el("freezePortfolio");

    if (!shell || !button) {
      return;
    }

    shell.classList.toggle(
      "is-frozen",
      frozen
    );

    button.setAttribute(
      "aria-pressed",
      frozen
        ? "true"
        : "false"
    );

    var label =
      button.querySelector(
        ".freeze-label"
      );

    if (label) {
      label.textContent =
        frozen
          ? "Unfreeze portfolio"
          : "Freeze portfolio";
    }

    try {
      localStorage.setItem(
        "portfolio-ai-freeze",
        frozen
          ? "1"
          : "0"
      );
    } catch (error) {
      // Storage can be unavailable in some embedded previews.
    }
  }

  function restorePortfolioFrozen() {
    var frozen = false;

    try {
      frozen =
        localStorage.getItem(
          "portfolio-ai-freeze"
        ) === "1";
    } catch (error) {
      frozen = false;
    }

    setPortfolioFrozen(
      frozen
    );
  }

  function toggleTradeGuide() {
    var body =
      el("tradeGuideBody");
    var button =
      el("toggleTradeGuide");

    if (!body || !button) {
      return;
    }

    var willHide =
      !body.hidden;

    body.hidden =
      willHide;

    button.setAttribute(
      "aria-expanded",
      willHide
        ? "false"
        : "true"
    );

    button.textContent =
      willHide
        ? "Show guide"
        : "Hide guide";
  }




  var tradingViewTickerTheme = "";

  function tradingViewTickerConfig(theme) {
    return {
      symbols: [
        {
          proName: "SP:SPX",
          title: "S&P 500"
        },
        {
          proName: "NASDAQ:NDX",
          title: "Nasdaq 100"
        },
        {
          proName: "DJ:DJI",
          title: "Dow Jones"
        },
        {
          proName: "NASDAQ:AAPL",
          title: "Apple"
        },
        {
          proName: "NASDAQ:NVDA",
          title: "NVIDIA"
        },
        {
          proName: "NASDAQ:MSFT",
          title: "Microsoft"
        },
        {
          proName: "NASDAQ:TSLA",
          title: "Tesla"
        },
        {
          proName: "BITSTAMP:BTCUSD",
          title: "Bitcoin"
        },
        {
          proName: "BITSTAMP:ETHUSD",
          title: "Ethereum"
        },
        {
          proName: "FX_IDC:EURUSD",
          title: "EUR / USD"
        },
        {
          proName: "FX_IDC:GBPUSD",
          title: "GBP / USD"
        },
        {
          proName: "FX_IDC:USDZAR",
          title: "USD / ZAR"
        },
        {
          proName: "OANDA:XAUUSD",
          title: "Gold"
        },
        {
          proName: "OANDA:XAGUSD",
          title: "Silver"
        }
      ],
      showSymbolLogo: true,
      isTransparent: false,
      displayMode: "regular",
      theme:
        theme === "dark"
          ? "dark"
          : "light",
      locale: "en"
    };
  }

  function resolvedPortfolioTheme(theme) {
    var current =
      theme ||
      document.documentElement.getAttribute(
        "data-theme"
      ) ||
      document.body.getAttribute(
        "data-theme"
      ) ||
      getPreferredTheme();

    return String(current)
      .toLowerCase()
      .indexOf("dark") >= 0
        ? "dark"
        : "light";
  }

  function syncTradingViewTickerTheme(theme) {
    var resolvedTheme =
      resolvedPortfolioTheme(theme);

    if (
      tradingViewTickerTheme ===
      resolvedTheme
    ) {
      return;
    }

    tradingViewTickerTheme =
      resolvedTheme;

    renderTradingViewTicker(
      resolvedTheme
    );
  }

  function renderTradingViewTicker(theme) {
    var holder =
      el("portfolioTradingViewTicker");

    if (!holder) {
      return;
    }

    holder.innerHTML =
      '<div class="tradingview-widget-container__widget"></div>' +
      '<div class="market-pulse-placeholder">Loading live market prices…</div>';

    var script =
      document.createElement(
        "script"
      );

    script.type =
      "text/javascript";

    script.src =
      "https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js";

    script.async = true;

    script.text =
      JSON.stringify(
        tradingViewTickerConfig(
          theme
        )
      );

    script.onload =
      function () {
        var placeholder =
          holder.querySelector(
            ".market-pulse-placeholder"
          );

        if (placeholder) {
          window.setTimeout(
            function () {
              if (
                holder.querySelector(
                  "iframe"
                )
              ) {
                placeholder.style.display =
                  "none";
              }
            },
            450
          );
        }
      };

    script.onerror =
      function () {
        var placeholder =
          holder.querySelector(
            ".market-pulse-placeholder"
          );

        if (placeholder) {
          placeholder.textContent =
            "Market feed temporarily unavailable.";
        }
      };

    holder.appendChild(script);
  }

  function attachMarketTicker() {
    var currentTheme =
      document.documentElement.getAttribute(
        "data-theme"
      ) ||
      getPreferredTheme();

    currentTheme =
      resolvedPortfolioTheme(
        currentTheme
      );

    renderTradingViewTicker(
      currentTheme
    );

    tradingViewTickerTheme =
      currentTheme;
  }


  var premiumForecastHorizon = "3M";

  function premiumClamp(v,a,b){return Math.max(a,Math.min(b,v));}

  function premiumData(){
    var s=buildAIState();
    if(!s){return null;}
    var a=s.analyses||[];
    var rows=a.map(function(x){
      var c=Number(x.signal.confidence)||50;
      var sc=x.signal.label==="Bullish"?50+c*.5:x.signal.label==="Bearish"?50-c*.5:50+(c-50)*.12;
      return {item:x,score:premiumClamp(sc,4,96)};
    });
    rows.sort(function(a,b){return b.score-a.score;});
    var vr=a.slice().sort(function(a,b){return (Number(b.analysis.volatility)||0)-(Number(a.analysis.volatility)||0);});
    var score=rows.length?rows.reduce(function(t,r){return t+r.score;},0)/rows.length:50;
    var conf=a.length?a.reduce(function(t,r){return t+(Number(r.signal.confidence)||50);},0)/a.length:0;
    return {state:s,rows:rows,best:rows.length?rows[0].item:null,risk:vr.length?vr[0]:null,score:Math.round(score),confidence:Math.round(conf)};
  }

  function premiumFactor(){
    return {"1D":.04,"1W":.12,"1M":.34,"3M":1,"6M":1.45,"1Y":2.05}[premiumForecastHorizon]||1;
  }

  function premiumOutcome(){
    if(!portfolioResults){return null;}
    var inv=Number(el("investment")?el("investment").value:0), med=Number(portfolioResults.median);
    if(!isFinite(inv)||inv<=0||!isFinite(med)){return null;}
    return ((med-inv)/inv)*premiumFactor();
  }


  function capitalAssetMarket(asset) {
    var value = String(
      asset && (
        asset.marketType ||
        asset.category ||
        asset.type ||
        asset.assetType ||
        asset.market ||
        ""
      )
    ).toLowerCase();

    if (value.indexOf("forex") >= 0 || value.indexOf("fx") >= 0) return "Forex";
    if (value.indexOf("crypto") >= 0) return "Crypto";
    if (value.indexOf("commod") >= 0 || value.indexOf("metal") >= 0) return "Commodities";
    if (value.indexOf("etf") >= 0 || value.indexOf("fund") >= 0) return "ETF";
    return "Stocks";
  }

  function capitalNumber(id, fallback) {
    var node = el(id);
    var value = Number(node ? node.value : fallback);
    return isFinite(value) ? value : fallback;
  }

  function capitalAdequacyData() {
    var capital = capitalNumber("investment", 0);
    var assets = selectedAssets || [];
    var count = assets.length;

    if (!capital || capital <= 0 || !count) {
      return {
        status: "WAITING",
        badge: "Portfolio required",
        capital: capital,
        count: count,
        minimum: 0,
        comfortable: 0,
        perAsset: count ? capital / count : 0,
        markets: [],
        message: "Enter your USD investment amount and select assets to check whether the capital is practical for the portfolio."
      };
    }

    var riskPct = capitalNumber("riskPerTrade", 1);
    var stopPct = capitalNumber("stopDistance", 2);
    var markets = [];
    var weights = {
      "Stocks": 1.00,
      "ETF": 0.85,
      "Forex": 1.15,
      "Crypto": 0.65,
      "Commodities": 1.20
    };

    var complexity = 0;
    assets.forEach(function(asset){
      var market = capitalAssetMarket(asset);
      if (markets.indexOf(market) < 0) markets.push(market);
      complexity += weights[market] || 1;
    });

    /*
      Practical-capital heuristic:
      - $500 base working allocation per average selected instrument.
      - Market complexity adjusts the base.
      - Tighter risk budgets and tighter stops require more capital headroom.
      - This is a portfolio practicality assessment, not a broker minimum.
    */
    var basePerAsset = 500;
    var riskAdjustment = riskPct > 0 ? premiumClamp(1 / riskPct, 0.65, 2.0) : 2;
    var stopAdjustment = stopPct > 0 ? premiumClamp(2 / stopPct, 0.70, 1.65) : 1.65;
    var diversificationAdjustment = count >= 4 ? 1.10 : 1;
    var marketAdjustment = complexity / count;

    var minimum = basePerAsset * count * marketAdjustment * riskAdjustment * stopAdjustment;
    minimum *= diversificationAdjustment;
    minimum = Math.ceil(minimum / 100) * 100;

    var comfortable = Math.ceil((minimum * 1.35) / 100) * 100;
    var ratio = capital / minimum;

    var status, badge, message;

    if (ratio >= 1.35) {
      status = "SUFFICIENT";
      badge = "Well funded";
      message = "Your capital is sufficient for this selected portfolio under the current Portfolio AI risk and sizing assumptions. You have useful headroom for diversification and position sizing.";
    } else if (ratio >= 1) {
      status = "SUFFICIENT";
      badge = "Practical";
      message = "Your capital is sufficient for the selected portfolio, although position sizes may be relatively modest. The current mix remains practical under your risk settings.";
    } else if (ratio >= 0.65) {
      status = "LIMITED";
      badge = "Usable with constraints";
      message = "Your capital can support this portfolio, but spreading it across all selected assets may create small positions. Fewer assets or additional capital would improve flexibility.";
    } else {
      status = "INSUFFICIENT";
      badge = "Capital constrained";
      message = "Your capital is not practical for the full selected portfolio under the current risk settings. Consider reducing the number of assets, widening the capital base, or reviewing the risk setup.";
    }

    return {
      status: status,
      badge: badge,
      capital: capital,
      count: count,
      minimum: minimum,
      comfortable: comfortable,
      perAsset: capital / count,
      markets: markets,
      message: message
    };
  }

  function capitalUSD(value) {
    if (!isFinite(value)) return "$—";
    return "$" + Number(value).toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    });
  }

  function updateCapitalAdequacy() {
    var d = capitalAdequacyData();
    var status = el("capitalStatus");
    var badge = el("capitalStatusBadge");
    var available = el("capitalAvailable");
    var recommended = el("capitalRecommended");
    var count = el("capitalAssetCount");
    var mix = el("capitalMarketMix");
    var perAsset = el("capitalPerAsset");
    var message = el("capitalMessage");
    var card = el("capitalCheckCard");

    if (status) status.textContent = d.status;
    if (badge) badge.textContent = d.badge;
    if (available) available.textContent = d.capital > 0 ? capitalUSD(d.capital) : "$—";
    if (recommended) {
      recommended.textContent = d.minimum > 0
        ? capitalUSD(d.minimum) + "–" + capitalUSD(d.comfortable)
        : "$—";
    }
    if (count) count.textContent = String(d.count);
    if (mix) mix.textContent = d.markets.length ? d.markets.join(" · ") : "No markets selected";
    if (perAsset) perAsset.textContent = d.perAsset > 0 ? capitalUSD(d.perAsset) : "$—";
    if (message) message.textContent = d.message;

    if (card) {
      card.setAttribute("data-capital-status", d.status.toLowerCase());
    }

    var gaugeFill = el("capitalGaugeFill");
    var gaugeMarker = el("capitalGaugeMarker");
    var gaugePct = 0;

    if (d.minimum > 0) {
      gaugePct = premiumClamp((d.capital / d.minimum) * 66.6667, 3, 100);
    }

    if (gaugeFill) gaugeFill.style.width = gaugePct + "%";
    if (gaugeMarker) gaugeMarker.style.left = gaugePct + "%";
    updateCapitalSimpleAnswer();
  }

  function updatePremiumIntelligence(){
    updateCapitalAdequacy();
    var d=premiumData(), o=el("premiumOutlook"),c=el("premiumConfidence"),sc=el("premiumScore"),b=el("premiumBrief"),
        ba=el("premiumBestAsset"),bn=el("premiumBestAssetNote"),ra=el("premiumRiskAsset"),ex=el("premiumExpected"),en=el("premiumExpectedNote");
    if(!d){
      if(o)o.textContent="WAIT"; if(c)c.textContent="— confidence"; if(sc)sc.textContent="—";
      if(b)b.textContent="Run an analysis and Portfolio AI will summarize the outlook, confidence and key risk here.";
      if(ba)ba.textContent="—"; if(ra)ra.textContent="—"; if(ex)ex.textContent="—"; return;
    }
    if(o)o.textContent=d.state.verdict||"SELECTIVE";
    if(c)c.textContent=d.confidence+"% confidence";
    if(sc)sc.textContent=String(d.score);
    if(ba)ba.textContent=d.best?d.best.asset.symbol:"—";
    if(bn)bn.textContent=d.best?d.best.signal.label+" · "+Math.round(d.best.signal.confidence)+"% confidence":"Waiting";
    if(ra)ra.textContent=d.risk?d.risk.asset.symbol:"—";
    var p=premiumOutcome();
    if(ex)ex.textContent=p===null?"—":(p>=0?"+":"")+(p*100).toFixed(1)+"%";
    if(en)en.textContent=premiumForecastHorizon+" scenario · current simulation";
    if(b){
      var text="The portfolio currently has a "+String(d.state.verdict||"selective").toLowerCase()+" posture.";
      if(d.best)text+=" "+d.best.asset.symbol+" has the strongest current quantitative setup.";
      if(d.risk&&(!d.best||d.risk.asset.symbol!==d.best.asset.symbol))text+=" "+d.risk.asset.symbol+" contributes the most volatility.";
      b.textContent=text;
    }

    var quality=el("premiumDataQuality");
    if(quality){
      quality.textContent=d.confidence>=75?"DATA QUALITY STRONG":d.confidence>=55?"DATA QUALITY MODERATE":"DATA QUALITY LIMITED";
    }
    var updated=el("premiumLastUpdated");
    if(updated){
      var now=new Date();
      updated.textContent="UPDATED "+String(now.getHours()).padStart(2,"0")+":"+String(now.getMinutes()).padStart(2,"0");
    }

    var ring=document.querySelector(".premium-score-ring");
    if(ring){
      ring.style.setProperty("--score-angle",Math.round(d.score*3.6)+"deg");
      ring.classList.remove("score-pulse");
      void ring.offsetWidth;
      ring.classList.add("score-pulse");
    }
  }

  function premiumPanel(type){
    var d=premiumData();
    if(!d)return '<div class="premium-empty-detail"><strong>Analysis required</strong><p>Load market data and run the analysis first.</p></div>';
    if(type==="why"){
      var h='<div class="premium-reason-list">';
      d.rows.forEach(function(r){h+='<div class="premium-reason-row"><div><strong>'+escapeHTML(r.item.asset.symbol)+'</strong><small>'+escapeHTML(r.item.signal.label)+'</small></div><span>'+Math.round(r.score)+'/100</span></div>';});
      return h+'</div><div class="premium-callout"><strong>What could change the outlook</strong><p>A reversal in trend, momentum or volatility would reduce confidence in the current posture.</p></div>';
    }
    if(type==="scenarios"){
      var p=premiumOutcome()||0, spread=Math.max(.035,Math.abs(p)*.75);
      return '<div class="premium-scenario-grid"><article><span>UPSIDE</span><strong>'+((p+spread)>=0?"+":"")+((p+spread)*100).toFixed(1)+'%</strong><small>Optimistic range</small></article><article class="base"><span>EXPECTED</span><strong>'+(p>=0?"+":"")+(p*100).toFixed(1)+'%</strong><small>Median scenario</small></article><article><span>DOWNSIDE</span><strong>'+((p-spread)>=0?"+":"")+((p-spread)*100).toFixed(1)+'%</strong><small>Adverse range</small></article></div><p class="premium-method-note">Illustrative quantitative scenarios, not guaranteed price targets.</p>';
    }
    if(type==="risk"){
      var vol=d.risk?premiumClamp((Number(d.risk.analysis.volatility)||.4)*100,12,95):40;
      var vals=[["Concentration",premiumClamp(30+selectedAssets.length*9,20,88)],["Volatility",vol],["Forecast uncertainty",premiumClamp(100-d.confidence,10,90)],["Risk flags",premiumClamp(22+(d.state.warnings?d.state.warnings.length:0)*18,15,95)]];
      var h='<div class="premium-risk-list">';
      vals.forEach(function(x){h+='<div class="premium-risk-row"><div><span>'+x[0]+'</span><strong>'+Math.round(x[1])+'</strong></div><div class="premium-risk-track"><i style="width:'+Math.round(x[1])+'%"></i></div></div>';});
      return h+'</div>';
    }
    return '<div class="premium-stress-intro"><strong>Quick stress test</strong><p>Choose a market shock for an approximate equal-weight portfolio impact.</p></div><div class="premium-stress-presets"><button class="premium-stress-preset" data-stress-value="-10">Nasdaq −10%</button><button class="premium-stress-preset" data-stress-value="-15">Bitcoin −15%</button><button class="premium-stress-preset" data-stress-value="10">Gold +10%</button><button class="premium-stress-preset" data-stress-value="8">USD/ZAR +8%</button></div><div id="premiumStressResult" class="premium-stress-result">Select a scenario.</div>';
  }

  function attachPremiumIntelligence(){
    document.addEventListener("click",function(e){
      var tip=e.target.closest(".info-tip");
      if(tip){
        var existing=document.querySelector(".floating-info-tip");
        if(existing) existing.remove();
        var box=document.createElement("div");
        box.className="floating-info-tip";
        box.textContent=tip.getAttribute("data-tip")||"";
        document.body.appendChild(box);
        var rect=tip.getBoundingClientRect();
        box.style.left=Math.min(rect.left,window.innerWidth-280)+"px";
        box.style.top=(rect.bottom+8)+"px";
        window.setTimeout(function(){if(box&&box.parentNode)box.remove();},5000);
        return;
      }
      var h=e.target.closest("[data-premium-horizon]");
      if(h){premiumForecastHorizon=h.getAttribute("data-premium-horizon")||"3M";Array.prototype.forEach.call(document.querySelectorAll("[data-premium-horizon]"),function(x){x.classList.toggle("active",x===h);});updatePremiumIntelligence();return;}
      var p=e.target.closest("[data-premium-panel]");
      if(p){var panel=el("premiumDetailPanel"),title=el("premiumDetailTitle"),body=el("premiumDetailBody");if(panel&&body){var t=p.getAttribute("data-premium-panel");title.textContent={why:"Why this outlook?",scenarios:"Forecast scenarios",risk:"Portfolio risk radar",whatif:"What-if simulator"}[t]||"Detail";body.innerHTML=premiumPanel(t);panel.hidden=false;}return;}
      if(e.target.closest("#premiumDetailClose")){var panel=el("premiumDetailPanel");if(panel)panel.hidden=true;return;}
      var s=e.target.closest("[data-stress-value]");
      if(s){var r=el("premiumStressResult"),shock=Number(s.getAttribute("data-stress-value")),impact=selectedAssets.length?shock/selectedAssets.length:0;if(r)r.innerHTML='<span>Approx. portfolio impact</span><strong>'+(impact>=0?"+":"")+impact.toFixed(1)+'%</strong><small>Equal-weight sensitivity estimate</small>';}
    });
    var capitalInputs = ["investment","riskPerTrade","stopDistance"];
    capitalInputs.forEach(function(id){
      var node = el(id);
      if (node) {
        node.addEventListener("input", updateCapitalAdequacy);
        node.addEventListener("change", updateCapitalAdequacy);
      }
    });

    updatePremiumIntelligence();
  }


  function setTradeBeginnerMode(showAdvanced) {
    var tradeView = document.querySelector('[data-view="trade"]') || document.querySelector('#tradeView');
    var button = el("tradeModeToggle");
    if (!tradeView) return;

    if (showAdvanced) {
      tradeView.classList.add("trade-show-advanced");
    } else {
      tradeView.classList.remove("trade-show-advanced");
    }

    if (button) {
      button.setAttribute("aria-pressed", showAdvanced ? "true" : "false");
      var label = button.querySelector("span");
      if (label) label.textContent = showAdvanced ? "Simplify trade page" : "Advanced details";
    }

    try {
      localStorage.setItem("portfolio-ai-trade-advanced", showAdvanced ? "1" : "0");
    } catch (e) {}
  }

  function attachTradeBeginnerMode() {
    var button = el("tradeModeToggle");
    var advanced = false;

    try {
      advanced = localStorage.getItem("portfolio-ai-trade-advanced") === "1";
    } catch (e) {}

    setTradeBeginnerMode(advanced);

    if (button) {
      button.addEventListener("click", function() {
        var tradeView = document.querySelector('[data-view="trade"]') || document.querySelector('#tradeView');
        setTradeBeginnerMode(!(tradeView && tradeView.classList.contains("trade-show-advanced")));
      });
    }
  }


  function safeMoney(v) {
    var n = Number(v);
    if (!isFinite(n)) return "$—";
    return "$" + n.toLocaleString("en-US", {minimumFractionDigits:2, maximumFractionDigits:2});
  }

  function updateTradeDuckSummary() {
    var state = null;
    try {
      state = buildAIState();
    } catch (e) {}

    var plan = null;
    try {
      if (state && state.assets && state.assets.length) {
        plan = buildTradePlan(state.assets[0], state);
      }
    } catch (e) {}

    var direction = el("duckDirection");
    var directionNote = el("duckDirectionNote");
    var entry = el("duckEntry");
    var stop = el("duckStop");
    var target = el("duckTarget");
    var size = el("duckSize");
    var sizeNote = el("duckSizeNote");
    var headline = el("tradeDuckHeadline");
    var explain = el("duckExplainText");

    if (!plan) {
      if (direction) direction.textContent = "—";
      if (directionNote) directionNote.textContent = "Waiting for a trade setup";
      if (entry) entry.textContent = "$—";
      if (stop) stop.textContent = "$—";
      if (target) target.textContent = "$—";
      if (size) size.textContent = "—";
      if (headline) headline.textContent = "Pick an asset and Portfolio AI will do the maths.";
      if (explain) explain.textContent = "Keep your risk small. Portfolio AI will handle the numbers.";
      return;
    }

    var dir = String(plan.direction || "WAIT").toUpperCase();
    if (direction) direction.textContent = dir;
    if (directionNote) directionNote.textContent = dir === "WAIT" ? "No clean setup yet" : "Portfolio AI trade direction";
    if (entry) entry.textContent = safeMoney(plan.entry);
    if (stop) stop.textContent = safeMoney(plan.stop);
    if (target) target.textContent = safeMoney(plan.target);

    try {
      var display = positionSizeDisplay(plan);
      if (size) size.textContent = display.primary || "—";
      if (sizeNote) sizeNote.textContent = display.note || "Risk-based position size from your USD capital.";
    } catch (e) {
      if (size) size.textContent = plan.units ? String(plan.units) : "—";
    }

    if (headline) {
      headline.textContent = dir === "WAIT"
        ? "No trade yet — Portfolio AI says wait."
        : dir + " setup ready. Follow the four numbers below.";
    }

    if (explain) {
      if (dir === "WAIT") {
        explain.textContent = "Doing nothing is also a decision. Wait until the setup is clearer.";
      } else {
        explain.textContent = "Enter near the entry price, exit at the stop if wrong, and take profit near the target if right.";
      }
    }
  }

  function updateCapitalSimpleAnswer() {
    var d = capitalAdequacyData();
    var h = el("capitalSimpleHeadline");
    var c = el("capitalSimpleCopy");

    if (!h || !c) return;

    if (!d.capital || !d.count || !d.minimum) {
      h.textContent = "Run the portfolio check";
      c.textContent = "Portfolio AI will tell you the exact USD amount to add, not just a percentage.";
      return;
    }

    if (d.capital >= d.minimum) {
      var extraComfort = Math.max(0, d.comfortable - d.capital);
      h.textContent = "Your $" + Math.round(d.capital).toLocaleString("en-US") + " is enough.";
      c.textContent = extraComfort > 0
        ? "You do not need to add more to make this portfolio practical. About $" + Math.round(extraComfort).toLocaleString("en-US") + " more would only give you extra breathing room."
        : "You already have comfortable capital for this selected portfolio.";
    } else {
      var add = Math.max(0, d.minimum - d.capital);
      h.textContent = "Add about $" + Math.round(add).toLocaleString("en-US") + " more.";
      c.textContent = "That takes you from $" + Math.round(d.capital).toLocaleString("en-US") + " to about $" + Math.round(d.minimum).toLocaleString("en-US") + ", where this selected portfolio becomes more practical.";
    }
  }

  function runPageEntrance(view) {
    if (!view) return;
    view.classList.remove("view-enter");
    void view.offsetWidth;
    view.classList.add("view-enter");
  }

  
function attachIOSMotion() {
  document.addEventListener("pointerdown", function(e){
    var button = e.target.closest("button,[data-app-view],.premium-snapshot-grid article,.trade-duck-grid article");
    if (!button) return;
    button.classList.remove("ios-press");
    void button.offsetWidth;
    button.classList.add("ios-press");
    window.setTimeout(function(){ button.classList.remove("ios-press"); }, 280);
  });

  var nav = document.querySelector(".app-navigation");
  if (nav && !nav.querySelector(".ios-nav-lens")) {
    var lens = document.createElement("span");
    lens.className = "ios-nav-lens";
    nav.appendChild(lens);

    function moveLens() {
      var active = nav.querySelector("[data-app-view].active");
      if (!active) return;
      var nr = nav.getBoundingClientRect();
      var ar = active.getBoundingClientRect();
      lens.style.width = ar.width + "px";
      lens.style.height = ar.height + "px";
      lens.style.transform = "translate3d(" + (ar.left - nr.left) + "px," + (ar.top - nr.top) + "px,0)";
    }

    window.addEventListener("resize", moveLens);
    document.addEventListener("click", function(e){
      if (e.target.closest("[data-app-view]")) {
        window.setTimeout(moveLens, 20);
      }
    });
    window.setTimeout(moveLens, 120);
  }
}

var APP_VIEW_STORAGE_KEY =
    "portfolio-ai-active-view";

  
var appViewOrder = ["overview","portfolio","intelligence","trade","news"];
var currentAnimatedView = null;

function viewIndex(name) {
  var i = appViewOrder.indexOf(String(name || "").toLowerCase());
  return i < 0 ? 0 : i;
}

function setAppView(viewName) {
  var name = String(viewName || "overview").toLowerCase();
  var views = document.querySelectorAll(".app-view");
  var next = document.querySelector('[data-view="' + name + '"]');
  var previous = currentAnimatedView
    ? document.querySelector('[data-view="' + currentAnimatedView + '"]')
    : document.querySelector(".app-view.active,.app-view.is-active,.app-view:not([hidden])");

  if (!next) return;

  var direction = viewIndex(name) >= viewIndex(currentAnimatedView || name) ? 1 : -1;

  if (previous && previous !== next) {
    previous.hidden = false;
    previous.classList.remove("view-enter","view-enter-left","view-enter-right","view-exit-left","view-exit-right");
    previous.classList.add(direction > 0 ? "view-exit-left" : "view-exit-right");

    next.hidden = false;
    next.classList.remove("view-enter","view-enter-left","view-enter-right","view-exit-left","view-exit-right");
    next.classList.add(direction > 0 ? "view-enter-right" : "view-enter-left");

    window.setTimeout(function(){
      views.forEach(function(v){
        var active = v === next;
        v.classList.toggle("active", active);
        v.classList.toggle("is-active", active);
        if (!active) {
          v.hidden = true;
          v.classList.remove("view-enter-left","view-enter-right","view-exit-left","view-exit-right");
        }
      });
      next.classList.remove("view-enter-left","view-enter-right");
    }, 520);
  } else {
    views.forEach(function(v){
      var active = v === next;
      v.classList.toggle("active", active);
      v.classList.toggle("is-active", active);
      v.hidden = !active;
    });
  }

  currentAnimatedView = name;

  document.querySelectorAll("[data-app-view]").forEach(function(btn){
    btn.classList.toggle("active", btn.getAttribute("data-app-view") === name);
  });

  try {
    localStorage.setItem("portfolio-ai-active-view", name);
  } catch (e) {}

  if (name === "trade") {
    window.setTimeout(updateTradeDuckSummary, 120);
  }
}


  function restoreAppView() {
    var saved = "overview";

    try {
      saved =
        localStorage.getItem(
          APP_VIEW_STORAGE_KEY
        ) || "overview";
    } catch (error) {}

    setAppView(
      saved,
      {
        scroll: false,
        instant: true
      }
    );
  }

  
function ensurePrimaryNavigationStructure() {
  var nav = document.querySelector(".app-navigation");
  if (!nav) return;

  var expected = [
    ["overview","⌂","Overview"],
    ["portfolio","◉","Portfolio"],
    ["intelligence","✦","Intelligence"],
    ["trade","↗","Trade"],
    ["news","▤","News"]
  ];

  var existing = nav.querySelectorAll("[data-app-view]");
  if (existing.length === 5) return;

  nav.innerHTML = "";

  expected.forEach(function(item, index){
    var button = document.createElement("button");
    button.type = "button";
    button.className = "app-nav-item" + (index === 0 ? " active" : "");
    button.setAttribute("data-app-view", item[0]);

    var icon = document.createElement("span");
    icon.className = "ios-nav-icon";
    icon.setAttribute("aria-hidden","true");
    icon.textContent = item[1];

    var label = document.createElement("span");
    label.className = "ios-nav-label";
    label.textContent = item[2];

    button.appendChild(icon);
    button.appendChild(label);
    nav.appendChild(button);
  });
}

function attachAppNavigation() {
    document.addEventListener(
      "click",
      function (event) {
        var target =
          event.target.closest(
            "[data-app-view],[data-open-view]"
          );

        if (!target) {
          return;
        }

        var viewName =
          target.getAttribute(
            "data-app-view"
          ) ||
          target.getAttribute(
            "data-open-view"
          );

        if (!viewName) {
          return;
        }

        if (
          target.tagName
            .toLowerCase() === "a"
        ) {
          event.preventDefault();
        }

        setAppView(viewName);
      }
    );
  }

  function updateOverview() {
    var count =
      selectedAssets.length;

    var markets = {};

    selectedAssets.forEach(
      function (asset) {
        markets[asset.market] = true;
      }
    );

    var marketCount =
      Object.keys(markets).length;

    var loadedCount =
      selectedAssets.filter(
        function (asset) {
          return !!marketData[asset.key];
        }
      ).length;

    var assetCount =
      el("overviewAssetCount");

    var assetNote =
      el("overviewAssetNote");

    var marketCountEl =
      el("overviewMarketCount");

    var dataStatus =
      el("overviewDataStatus");

    var analysisStatus =
      el("overviewAnalysisStatus");

    var statusTitle =
      el("overviewStatusTitle");

    var overviewLead =
      el("overviewLead");

    if (assetCount) {
      assetCount.textContent =
        String(count);
    }

    if (assetNote) {
      assetNote.textContent =
        count
          ? count +
            " of " +
            MAX_SELECTED_ASSETS +
            " selected"
          : "None selected";
    }

    if (marketCountEl) {
      marketCountEl.textContent =
        String(marketCount);
    }

    if (dataStatus) {
      if (!count) {
        dataStatus.textContent =
          "Not loaded";
      } else if (
        loadedCount === count
      ) {
        dataStatus.textContent =
          "Ready";
      } else if (loadedCount) {
        dataStatus.textContent =
          loadedCount +
          "/" +
          count +
          " loaded";
      } else {
        dataStatus.textContent =
          "Waiting";
      }
    }

    if (analysisStatus) {
      analysisStatus.textContent =
        portfolioResults
          ? "Ready"
          : loadedCount
            ? "Ready to run"
            : "Waiting";
    }

    if (statusTitle) {
      if (portfolioResults) {
        statusTitle.textContent =
          "Analysis ready";
      } else if (count) {
        statusTitle.textContent =
          loadedCount === count
            ? "Ready to analyse"
            : "Portfolio selected";
      } else {
        statusTitle.textContent =
          "Ready to begin";
      }
    }

    if (overviewLead) {
      if (portfolioResults) {
        overviewLead.textContent =
          "Your analysis is ready. Review the key numbers below, then open Intelligence for the full forecast or Trade to plan risk.";
      } else if (count) {
        overviewLead.textContent =
          "Your portfolio is taking shape. Load market data in Portfolio, then run the analysis to unlock signals, forecasts and trade planning.";
      } else {
        overviewLead.textContent =
          "Start by choosing the markets you want to follow. Portfolio AI will turn the data into a simple view of direction, risk and possible outcomes.";
      }
    }

    var list =
      el("overviewPortfolioList");

    if (list) {
      if (!count) {
        list.innerHTML =
          '<div class="overview-empty">' +
          '<strong>No assets selected yet.</strong>' +
          '<span>Your portfolio will appear here as soon as you add your first asset.</span>' +
          '</div>';
      } else {
        var listHTML = "";

        selectedAssets.forEach(
          function (asset) {
            listHTML +=
              '<div class="overview-portfolio-chip">' +
              '<span class="overview-portfolio-dot">' +
              escapeHTML(
                asset.short ||
                asset.symbol
                  .replace("/", "")
                  .slice(0, 2)
              ) +
              '</span>' +
              '<div>' +
              '<strong>' +
              escapeHTML(asset.symbol) +
              '</strong>' +
              '<small>' +
              escapeHTML(asset.market) +
              '</small>' +
              '</div>' +
              '</div>';
          }
        );

        list.innerHTML =
          listHTML;
      }
    }

    var expectedValue =
      el("overviewExpectedValue");

    var expectedNote =
      el("overviewExpectedNote");

    var profitProbability =
      el("overviewProfitProbability");

    if (expectedValue) {
      expectedValue.textContent =
        portfolioResults
          ? money(
              portfolioResults.median
            )
          : "—";
    }

    if (expectedNote) {
      expectedNote.textContent =
        portfolioResults
          ? "Median simulated value after " +
            String(
              portfolioResults.horizonName ||
              "the selected horizon"
            ).toLowerCase()
          : "Run an analysis to populate this.";
    }

    if (profitProbability) {
      profitProbability.textContent =
        portfolioResults
          ? percent(
              portfolioResults.probabilityProfit
            )
          : "—";
    }

    var direction =
      el("overviewDirection");

    var directionNote =
      el("overviewDirectionNote");

    var currentAIState =
      buildAIState();

    if (direction) {
      direction.textContent =
        currentAIState
          ? currentAIState.verdict
          : "—";
    }

    if (directionNote) {
      if (
        currentAIState &&
        currentAIState.strongest
      ) {
        directionNote.textContent =
          currentAIState.strongest.asset.symbol +
          " · " +
          currentAIState.strongest.signal.label;
      } else {
        directionNote.textContent =
          "Waiting for market data";
      }
    }
  }

  function updateSectionDock() {
    var links =
      Array.prototype.slice.call(
        document.querySelectorAll(
          ".section-dock-link"
        )
      );

    if (!links.length) {
      return;
    }

    var currentId = "build";

    links.forEach(
      function (link) {
        var href =
          link.getAttribute("href");

        if (!href) return;

        var target =
          document.querySelector(href);

        if (
          target &&
          target.getBoundingClientRect().top <= 170
        ) {
          currentId =
            href.replace("#", "");
        }
      }
    );

    links.forEach(
      function (link) {
        link.classList.toggle(
          "active",
          link.getAttribute("href") ===
          "#" + currentId
        );
      }
    );
  }

  function attachAppleUX() {
    var dockLinks =
      document.querySelectorAll(
        ".section-dock-link"
      );

    Array.prototype.forEach.call(
      dockLinks,
      function (link) {
        link.addEventListener(
          "click",
          function () {
            Array.prototype.forEach.call(
              dockLinks,
              function (item) {
                item.classList.remove(
                  "active"
                );
              }
            );

            link.classList.add(
              "active"
            );
          }
        );
      }
    );

    window.addEventListener(
      "scroll",
      updateSectionDock,
      { passive: true }
    );

    updateSectionDock();
  }


  function attachEvents() {
    var freezePortfolio =
      el("freezePortfolio");

    if (freezePortfolio) {
      freezePortfolio.addEventListener(
        "click",
        function () {
          var pressed =
            freezePortfolio.getAttribute(
              "aria-pressed"
            ) === "true";

          setPortfolioFrozen(
            !pressed
          );
        }
      );
    }

    var toggleTradeGuideButton =
      el("toggleTradeGuide");

    if (toggleTradeGuideButton) {
      toggleTradeGuideButton.addEventListener(
        "click",
        toggleTradeGuide
      );
    }

    var aiForm = el("aiQuestionForm");
    var aiQuestion = el("aiQuestion");
    var aiPromptChips = document.querySelectorAll(".ai-prompt-chip");

    if (aiForm) {
      aiForm.addEventListener("submit", function (event) {
        event.preventDefault();

        var question = aiQuestion
          ? aiQuestion.value.trim()
          : "";

        if (!question) return;

        submitAIQuestion(question);
      });
    }


    var aiAskButton = el("aiAskButton");

    if (aiAskButton) {
      aiAskButton.addEventListener(
        "click",
        function (event) {
          event.preventDefault();

          var question =
            aiQuestion
              ? aiQuestion.value.trim()
              : "";

          submitAIQuestion(question);
        }
      );
    }

    Array.prototype.forEach.call(
      aiPromptChips,
      function (button) {
        button.addEventListener("click", function () {
          var question =
            button.getAttribute("data-ai-question") || "";

          if (aiQuestion) {
            aiQuestion.value = question;
          }

          submitAIQuestion(question);
        });
      }
    );


    [
      "investment",
      "riskPerTrade",
      "maxOpenRisk",
      "stopDistance",
      "rewardRisk",
      "plannerLeverage"
    ].forEach(
      function (plannerId) {
        var plannerControl =
          el(plannerId);

        if (!plannerControl) {
          return;
        }

        var plannerEvent =
          plannerControl.tagName ===
          "SELECT"
            ? "change"
            : "input";

        plannerControl.addEventListener(
          plannerEvent,
          function () {
            renderTradePlanner();
          }
        );
      }
    );


    var popularAssets = el("popularAssets");
    if (popularAssets) {
      popularAssets.addEventListener("click", function (event) {
        var button = event.target.closest("[data-popular-symbol]");
        if (!button) return;

        var symbol = button.getAttribute("data-popular-symbol");
        var quickItems = POPULAR_ASSETS[activeMarket] || [];
        var quickAsset = null;
        var i;

        for (i = 0; i < quickItems.length; i++) {
          if (quickItems[i].symbol === symbol) {
            quickAsset = quickItems[i];
            break;
          }
        }

        if (!quickAsset) return;

        var asset = findCatalogueAsset(activeMarket, quickAsset);
        var existingIndex = -1;

        for (i = 0; i < selectedAssets.length; i++) {
          if (
            selectedAssets[i].symbol === asset.symbol &&
            selectedAssets[i].market === activeMarket
          ) {
            existingIndex = i;
            break;
          }
        }

        if (existingIndex !== -1) {
          selectedAssets.splice(existingIndex, 1);
        } else {
          if (selectedAssets.length >= MAX_SELECTED_ASSETS) {
            setStatus(
              "Starter access supports up to 4 assets per analysis. Remove one selected asset to add another.",
              "warning"
            );
            return;
          }

          selectedAssets.push(asset);
        }

        renderSelectedAssets();
        renderAssetGrid();

        if (activeNewsFilter === "portfolio") {
          setNewsProviderHint(
            "Portfolio changed. Press Refresh if you want headlines for the updated selection.",
            ""
          );
        }
      });
    }


    document.querySelectorAll(".market-tab").forEach(function (button) {
      button.addEventListener("click", function () {
        setActiveMarket(button.getAttribute("data-market"));
      });
    });

    var themeToggle = el("themeToggle");
    if (themeToggle) themeToggle.addEventListener("click", toggleTheme);

    var grid = el("assetGrid");
    if (grid) {
      grid.addEventListener("click", function (event) {
        var button = event.target.closest ? event.target.closest("[data-asset-key]") : null;
        if (!button) return;
        toggleAssetByKey(button.getAttribute("data-asset-key"));
      });
    }

    var tray = el("selectedAssetsTray");
    if (tray) {
      tray.addEventListener("click", function (event) {
        var button = event.target.closest ? event.target.closest("[data-remove-key]") : null;
        if (!button) return;
        toggleAssetByKey(button.getAttribute("data-remove-key"));
      });
    }

    var search = el("assetSearch");
    if (search) {
      search.addEventListener("input", function () {
        renderLimit = RENDER_STEP;
        scheduleSymbolSearch();
      });
    }

    var clearSearch = el("clearSearch");
    if (clearSearch) {
      clearSearch.addEventListener("click", function () {
        if (!search) return;
        search.value = "";
        renderLimit = RENDER_STEP;
        activeSearchToken++;
        activeSearchLoading = false;
        activeSearchResults = [];
        renderAssetGrid();
        search.focus();
      });
    }

    var showMore = el("showMoreAssets");
    if (showMore) {
      showMore.addEventListener("click", function () {
        renderLimit += RENDER_STEP;
        renderAssetGrid();
      });
    }

    var reload = el("reloadCatalog");
    if (reload) {
      reload.addEventListener("click", function () {
        fullDirectoryMode[activeMarket] = true;
        activeSearchToken++;
        activeSearchLoading = false;
        activeSearchResults = [];

        if (catalogCache[activeMarket]) {
          renderLimit = RENDER_STEP;
          renderAssetGrid();
          return;
        }

        loadCatalogue(activeMarket, false)
          .then(function () {
            var card =
              document.querySelector(".asset-browser-card");
            if (card) {
              card.classList.add("directory-loaded");
            }
          })
          .catch(function () {});
      });
    }

    var strategy = el("strategy");
    if (strategy) strategy.addEventListener("change", populateHorizons);

    var loadButton = el("loadMarketData");
    if (loadButton) loadButton.addEventListener("click", loadMarketData);

    var refreshButton = el("refreshPricesMini");
    if (refreshButton) refreshButton.addEventListener("click", loadMarketData);

    var generateButton = el("generatePortfolio");
    if (generateButton) generateButton.addEventListener("click", calculateForecast);

    document.querySelectorAll(".news-tab").forEach(function (button) {
      button.addEventListener("click", function () {
        setNewsFilter(
          button.getAttribute("data-news-filter")
        );
      });
    });

    var newsRefresh = el("newsRefresh");
    if (newsRefresh) {
      newsRefresh.addEventListener("click", function () {
        loadNews(true);
      });
    }
  }

  function initializeApp() {
    applyTheme(getPreferredTheme());
    populateHorizons();
    renderSelectedAssets();
    renderAIAdvisor();
    updatePortfolioSummary();
    attachEvents();
    attachAppleUX();
    ensurePrimaryNavigationStructure();
  attachAppNavigation();
    attachMarketTicker();
    attachPremiumIntelligence();
  attachTradeBeginnerMode();
  attachIOSMotion();
  updateTradeDuckSummary();
  updateCapitalSimpleAnswer();
    restoreAppView();
    restorePortfolioFrozen();
    setStatus("Ready", "ready");
    updateOverview();

    renderPopularAssets();
    renderAssetGrid();

    if (!window.__PORTFOLIO_AI_GDELT_NEWS_BOOTED_V141__) {
      window.__PORTFOLIO_AI_GDELT_NEWS_BOOTED_V141__ = true;

      runWhenIdle(function () {
        loadNews(false);
      }, 1500);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeApp);
  } else {
    initializeApp();
  }
})();



function refreshIOSNavLens() {
  var nav = document.querySelector(".app-navigation");
  if (!nav) return;
  var lens = nav.querySelector(".ios-nav-lens");
  var active = nav.querySelector("[data-app-view].active");
  if (!lens || !active) return;

  var nr = nav.getBoundingClientRect();
  var ar = active.getBoundingClientRect();

  lens.style.width = ar.width + "px";
  lens.style.height = ar.height + "px";
  lens.style.transform =
    "translate3d(" +
    (ar.left - nr.left) +
    "px," +
    (ar.top - nr.top) +
    "px,0)";
}

document.addEventListener("click", function(event) {
  if (event.target.closest("[data-app-view],[data-open-view]")) {
    window.setTimeout(refreshIOSNavLens, 35);
    window.setTimeout(refreshIOSNavLens, 180);
  }
});
window.addEventListener("resize", refreshIOSNavLens);
window.setTimeout(refreshIOSNavLens, 250);



function ensureActiveNavVisible() {
  var nav = document.querySelector(".app-navigation");
  if (!nav) return;
  if (window.innerWidth > 700) return;

  var active = nav.querySelector("[data-app-view].active");
  if (!active) return;

  try {
    active.scrollIntoView({
      behavior: "smooth",
      inline: "center",
      block: "nearest"
    });
  } catch (e) {
    nav.scrollLeft = Math.max(0, active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2);
  }
}

document.addEventListener("click", function(event) {
  if (event.target.closest("[data-app-view]")) {
    window.setTimeout(ensureActiveNavVisible, 80);
  }
});

window.addEventListener("resize", function() {
  window.setTimeout(ensureActiveNavVisible, 80);
});

window.setTimeout(ensureActiveNavVisible, 300);
