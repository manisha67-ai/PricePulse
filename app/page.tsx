"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type Product = {
  id: string;
  name: string;
  url: string;
  image_url: string | null;
  current_price: number | null;
  original_price: number | null;
  currency: string;
  availability: string;
  created_at: string;
  updated_at: string;
};

type DealIntelligence = {
  product_id: string;
  current_price: number;
  target_price: number | null;
  historical_low: number | null;
  average_price: number | null;
  price_change_percent: number;
  deal_score: number;
  recommendation: string;
  history_points: number;
};

export default function Home() {
  const [showForm, setShowForm] = useState(false);
  const [showAlerts, setShowAlerts] = useState(false);

  const [url, setUrl] = useState("");
  const [targetPrice, setTargetPrice] = useState("");

  const [products, setProducts] = useState<Product[]>([]);

  const [dealData, setDealData] = useState<
    Record<string, DealIntelligence>
  >({});

  // NEW: store target prices directly from alerts table
  const [targetPrices, setTargetPrices] = useState<
    Record<string, number>
  >({});

  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");

  // --------------------------------
  // Load products
  // --------------------------------

  const loadProducts = async () => {
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Load products error:", error);
      return;
    }

    const loadedProducts = data || [];

    setProducts(loadedProducts);

    // --------------------------------
    // Load target prices directly
    // --------------------------------

    if (loadedProducts.length > 0) {
      const productIds = loadedProducts.map(
        (product) => product.id
      );

      const {
        data: alertRows,
        error: alertError,
      } = await supabase
        .from("alerts")
        .select("product_id, target_price")
        .in("product_id", productIds)
        .eq("is_active", true)
        .order("created_at", {
          ascending: false,
        });

      if (alertError) {
        console.error(
          "Load target prices error:",
          alertError
        );
      } else {
        const targets: Record<string, number> = {};

        (alertRows || []).forEach((alert) => {
          if (
            alert.target_price !== null &&
            alert.target_price !== undefined &&
            targets[alert.product_id] === undefined
          ) {
            targets[alert.product_id] = Number(
              alert.target_price
            );
          }
        });

        setTargetPrices(targets);

        console.log(
          "Target prices loaded:",
          targets
        );
      }
    }
  };

  // --------------------------------
  // Get Deal Intelligence
  // --------------------------------

  const getDealIntelligence = async (
    productId: string
  ): Promise<DealIntelligence | null> => {
    try {
      const response = await fetch(
        "http://127.0.0.1:8000/deal-intelligence",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            product_id: productId,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => null);

        throw new Error(
          errorData?.detail ||
            "Deal intelligence calculation failed."
        );
      }

      const data: DealIntelligence =
        await response.json();

      console.log(
        "Deal Intelligence from backend:",
        data
      );

      // --------------------------------
      // Get target price directly
      // --------------------------------

      const {
        data: alertData,
        error: alertError,
      } = await supabase
        .from("alerts")
        .select("target_price")
        .eq("product_id", productId)
        .eq("is_active", true)
        .order("created_at", {
          ascending: false,
        })
        .limit(1)
        .maybeSingle();

      if (alertError) {
        console.error(
          "Target price lookup error:",
          alertError
        );
      }

      const savedTarget =
        alertData?.target_price !== null &&
        alertData?.target_price !== undefined
          ? Number(alertData.target_price)
          : null;

      const finalTargetPrice =
        savedTarget !== null
          ? savedTarget
          : data.target_price !== null &&
            data.target_price !== undefined
          ? Number(data.target_price)
          : targetPrices[productId] ?? null;

      // Keep targetPrices state updated
      if (finalTargetPrice !== null) {
        setTargetPrices((previous) => ({
          ...previous,
          [productId]: finalTargetPrice,
        }));
      }

      const finalData: DealIntelligence = {
        ...data,
        target_price: finalTargetPrice,
      };

      console.log(
        "Final Deal Intelligence:",
        finalData
      );

      return finalData;
    } catch (error) {
      console.error(
        "Deal intelligence error:",
        error
      );

      return null;
    }
  };

  // --------------------------------
  // Initial load
  // --------------------------------

  useEffect(() => {
    loadProducts();
  }, []);

  // --------------------------------
  // Track Product
  // --------------------------------

  const startTracking = async () => {
    if (!url.trim() || !targetPrice.trim()) {
      alert(
        "Please enter both Product URL and Target Price."
      );
      return;
    }

    const target = Number(targetPrice);

    if (Number.isNaN(target) || target <= 0) {
      alert("Please enter a valid target price.");
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      // --------------------------------
      // STEP 1: Check product price
      // --------------------------------

      const priceResponse = await fetch(
        "http://127.0.0.1:8000/check-price",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: url.trim(),
            target_price: target,
          }),
        }
      );

      if (!priceResponse.ok) {
        const errorData =
          await priceResponse
            .json()
            .catch(() => null);

        throw new Error(
          errorData?.detail ||
            "Backend price check failed."
        );
      }

      const priceData =
        await priceResponse.json();

      console.log(
        "PricePulse backend result:",
        priceData
      );

      // --------------------------------
      // STEP 2: Save product
      // --------------------------------

      const {
        data: insertedProduct,
        error: productError,
      } = await supabase
        .from("products")
        .insert([
          {
            name:
              priceData.name ||
              "Tracked Product",

            url: url.trim(),

            current_price:
              priceData.current_price,

            original_price:
              priceData.current_price,

            currency:
              priceData.currency || "INR",

            availability:
              priceData.availability ||
              "unknown",
          },
        ])
        .select()
        .single();

      if (productError) {
        console.error(
          "Supabase product error:",
          productError
        );

        throw new Error(
          "Could not save product to Supabase."
        );
      }

      console.log(
        "Product saved:",
        insertedProduct
      );

      // --------------------------------
      // STEP 3: Save price history
      // --------------------------------

      const {
        error: historyError,
      } = await supabase
        .from("price_history")
        .insert([
          {
            product_id:
              insertedProduct.id,

            price:
              priceData.current_price,
          },
        ]);

      if (historyError) {
        console.error(
          "Price history error:",
          historyError
        );
      }

      // --------------------------------
      // STEP 4: Save target price
      // --------------------------------

      const {
        error: alertError,
      } = await supabase
        .from("alerts")
        .insert([
          {
            product_id:
              insertedProduct.id,

            target_price:
              target,

            is_active: true,
          },
        ]);

      if (alertError) {
        console.error(
          "Alert error:",
          alertError
        );

        throw new Error(
          "Product saved, but target price could not be saved."
        );
      }

      // IMPORTANT:
      // Immediately store target price in frontend state
      setTargetPrices((previous) => ({
        ...previous,
        [insertedProduct.id]: target,
      }));

      // --------------------------------
      // STEP 5: Deal Intelligence
      // --------------------------------

      const intelligence =
        await getDealIntelligence(
          insertedProduct.id
        );

      if (intelligence) {
        setDealData((previous) => ({
          ...previous,
          [insertedProduct.id]:
            intelligence,
        }));
      }

      // --------------------------------
      // STEP 6: Refresh products
      // --------------------------------

      await loadProducts();

      // --------------------------------
      // STEP 7: Clear form
      // --------------------------------

      setUrl("");
      setTargetPrice("");
      setShowForm(false);

      // --------------------------------
      // STEP 8: Success message
      // --------------------------------

      if (intelligence) {
        setMessage(
          `Product tracked successfully! Target Price: ₹${target.toLocaleString(
            "en-IN"
          )} • Deal Score: ${Math.round(
            intelligence.deal_score
          )}/100 — ${intelligence.recommendation}`
        );
      } else {
        setMessage(
          `Product tracked successfully! Target Price: ₹${target.toLocaleString(
            "en-IN"
          )}`
        );
      }
    } catch (error) {
      console.error(
        "Tracking error:",
        error
      );

      setMessage(
        error instanceof Error
          ? error.message
          : "Could not track this product."
      );
    } finally {
      setSaving(false);
    }
  };

  // --------------------------------
  // Refresh Deal Intelligence
  // --------------------------------

  const refreshIntelligence = async () => {
    if (products.length === 0) {
      return;
    }

    setRefreshing(true);
    setMessage("");

    try {
      const results =
        await Promise.all(
          products.map(async (product) => {
            const result =
              await getDealIntelligence(
                product.id
              );

            return {
              productId: product.id,
              result,
            };
          })
        );

      const updated: Record<
        string,
        DealIntelligence
      > = {};

      results.forEach(
        ({ productId, result }) => {
          if (result) {
            updated[productId] =
              result;
          }
        }
      );

      setDealData(updated);

      // Reload target prices too
      await loadProducts();

      setMessage(
        "Deal Intelligence and target prices refreshed successfully."
      );
    } catch (error) {
      console.error(
        "Refresh intelligence error:",
        error
      );

      setMessage(
        "Could not refresh Deal Intelligence."
      );
    } finally {
      setRefreshing(false);
    }
  };

  // --------------------------------
  // ALERT FEATURE
  // --------------------------------

  const getProductTargetPrice = (
    productId: string
  ): number | null => {
    const directTarget =
      targetPrices[productId];

    if (
      directTarget !== undefined &&
      directTarget !== null
    ) {
      return Number(directTarget);
    }

    const intelligenceTarget =
      dealData[productId]?.target_price;

    if (
      intelligenceTarget !== undefined &&
      intelligenceTarget !== null
    ) {
      return Number(intelligenceTarget);
    }

    return null;
  };

  const isPriceDropAlert = (
    product: Product,
    intelligence?: DealIntelligence
  ) => {
    const currentPrice =
      product.current_price;

    const target =
      getProductTargetPrice(product.id);

    return (
      currentPrice !== null &&
      target !== null &&
      currentPrice <= target
    );
  };

  // --------------------------------
  // Dashboard values
  // --------------------------------

  const intelligenceValues =
    Object.values(dealData);

  const dealsFound =
    intelligenceValues.filter(
      (item) =>
        item.recommendation ===
          "BUY NOW" ||
        item.recommendation ===
          "GOOD DEAL"
    ).length;

  const potentialSavings =
    intelligenceValues.reduce(
      (total, item) => {
        const target =
          getProductTargetPrice(
            item.product_id
          );

        if (
          target !== null &&
          item.current_price > target
        ) {
          return (
            total +
            (item.current_price -
              target)
          );
        }

        return total;
      },
      0
    );

  const activeAlerts =
    products.filter((product) =>
      isPriceDropAlert(
        product,
        dealData[product.id]
      )
    ).length;

  // --------------------------------
  // Recommendation styling
  // --------------------------------

  const getRecommendationStyle = (
    recommendation: string
  ) => {
    switch (recommendation) {
      case "BUY NOW":
        return "bg-green-400/20 text-green-300 border-green-400/30";

      case "GOOD DEAL":
        return "bg-cyan-400/20 text-cyan-300 border-cyan-400/30";

      case "WAIT":
        return "bg-yellow-400/20 text-yellow-300 border-yellow-400/30";

      default:
        return "bg-orange-400/20 text-orange-300 border-orange-400/30";
    }
  };

  // --------------------------------
  // UI
  // --------------------------------

  return (
    <main className="min-h-screen bg-[#06111f] text-white">

      <div className="flex min-h-screen">

        {/* SIDEBAR */}

        <aside className="hidden w-64 border-r border-white/10 bg-[#081827] p-6 lg:block">

          <div className="mb-10">

            <h1 className="text-2xl font-bold">
              Price
              <span className="text-cyan-400">
                Pulse
              </span>
            </h1>

            <p className="mt-1 text-xs text-gray-400">
              Smart Price Intelligence
            </p>

          </div>

          <nav className="space-y-2">

            <button
              className="w-full rounded-xl bg-cyan-400/10 px-4 py-3 text-left text-cyan-300"
            >
              ◉ Dashboard
            </button>

            <button
              onClick={() =>
                setShowForm(true)
              }
              className="w-full rounded-xl px-4 py-3 text-left text-gray-300 hover:bg-white/5"
            >
              ＋ Track Product
            </button>

            <button
              className="w-full rounded-xl px-4 py-3 text-left text-gray-300 hover:bg-white/5"
            >
              ♡ Watchlist
            </button>

            <button
              onClick={() => {
                setShowAlerts(true);

                setTimeout(() => {
                  document
                    .getElementById(
                      "alerts-section"
                    )
                    ?.scrollIntoView({
                      behavior: "smooth",
                    });
                }, 50);
              }}
              className="flex w-full items-center justify-between rounded-xl px-4 py-3 text-left text-gray-300 hover:bg-white/5"
            >
              <span>
                🔔 Alerts
              </span>

              {activeAlerts > 0 && (
                <span className="rounded-full bg-red-400 px-2 py-1 text-xs font-bold text-slate-950">
                  {activeAlerts}
                </span>
              )}
            </button>

            <button
              className="w-full rounded-xl px-4 py-3 text-left text-gray-300 hover:bg-white/5"
            >
              ◫ Analytics
            </button>

          </nav>

          <div className="mt-10 rounded-2xl border border-cyan-400/20 bg-cyan-400/5 p-4">

            <p className="text-sm font-semibold">
              Price Intelligence
            </p>

            <p className="mt-2 text-xs text-gray-400">
              Track prices, detect drops and make
              smarter buying decisions.
            </p>

          </div>

        </aside>

        {/* MAIN */}

        <section className="flex-1 p-5 md:p-8">

          {/* HEADER */}

          <div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">

            <div>

              <p className="text-sm text-gray-400">
                Welcome back
              </p>

              <h2 className="mt-1 text-3xl font-bold">
                Your Price Dashboard
              </h2>

            </div>

            <div className="flex flex-wrap gap-3">

              <button
                onClick={refreshIntelligence}
                disabled={
                  refreshing ||
                  products.length === 0
                }
                className="rounded-xl border border-cyan-400/30 px-5 py-3 font-semibold text-cyan-300 hover:bg-cyan-400/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {refreshing
                  ? "Analyzing..."
                  : "Refresh Intelligence"}
              </button>

              <button
                onClick={() =>
                  setShowForm(true)
                }
                className="rounded-xl bg-cyan-400 px-5 py-3 font-semibold text-slate-950 shadow-lg shadow-cyan-400/20"
              >
                ＋ Track Product
              </button>

            </div>

          </div>

          {/* MESSAGE */}

          {message && (
            <div className="mb-6 rounded-xl border border-cyan-400/30 bg-cyan-400/10 p-4 text-sm text-cyan-200">
              {message}
            </div>
          )}

          {/* STATS */}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">

            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">

              <p className="text-sm text-gray-400">
                Tracked Products
              </p>

              <p className="mt-2 text-3xl font-bold">
                {products.length}
              </p>

            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">

              <p className="text-sm text-gray-400">
                Active Alerts
              </p>

              <p className="mt-2 text-3xl font-bold text-red-300">
                {activeAlerts}
              </p>

            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">

              <p className="text-sm text-gray-400">
                Potential Savings
              </p>

              <p className="mt-2 text-3xl font-bold text-cyan-300">
                ₹
                {potentialSavings.toLocaleString(
                  "en-IN"
                )}
              </p>

            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">

              <p className="text-sm text-gray-400">
                Deals Found
              </p>

              <p className="mt-2 text-3xl font-bold text-cyan-300">
                {dealsFound}
              </p>

            </div>

          </div>

          {/* WATCHLIST */}

          <div className="mt-8">

            <div className="mb-4 flex items-center justify-between">

              <div>

                <h2 className="text-2xl font-bold">
                  Your Watchlist
                </h2>

                <p className="text-sm text-gray-400">
                  Products currently being monitored
                </p>

              </div>

              <button
                onClick={loadProducts}
                className="rounded-lg border border-white/10 px-4 py-2 text-sm text-gray-300 hover:bg-white/5"
              >
                Refresh
              </button>

            </div>

            {products.length === 0 ? (

              <div className="rounded-2xl border border-dashed border-white/20 bg-white/5 p-12 text-center">

                <h3 className="text-xl font-semibold">
                  No products tracked yet
                </h3>

                <p className="mt-2 text-gray-400">
                  Add a product URL to start monitoring
                  its price.
                </p>

                <button
                  onClick={() =>
                    setShowForm(true)
                  }
                  className="mt-6 rounded-xl bg-cyan-400 px-6 py-3 font-semibold text-slate-950"
                >
                  ＋ Track Your First Product
                </button>

              </div>

            ) : (

              <div className="space-y-4">

                {products.map(
                  (product) => {

                    const intelligence =
                      dealData[
                        product.id
                      ];

                    const productTarget =
                      getProductTargetPrice(
                        product.id
                      );

                    const priceDropAlert =
                      isPriceDropAlert(
                        product,
                        intelligence
                      );

                    return (

                      <div
                        key={product.id}
                        className="rounded-2xl border border-cyan-400/40 bg-white/5 p-5"
                      >

                        <div className="flex flex-col justify-between gap-4 md:flex-row">

                          <div className="min-w-0">

                            <div className="flex flex-wrap items-center gap-3">

                              <h3 className="text-lg font-semibold">
                                {product.name}
                              </h3>

                              <span className="rounded-full bg-cyan-400/20 px-3 py-1 text-xs text-cyan-300">
                                Tracking
                              </span>

                              {intelligence && (
                                <span
                                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${getRecommendationStyle(
                                    intelligence.recommendation
                                  )}`}
                                >
                                  {
                                    intelligence.recommendation
                                  }
                                </span>
                              )}

                              <span
                                className={`rounded-full border px-3 py-1 text-xs font-bold ${
                                  priceDropAlert
                                    ? "border-red-400/40 bg-red-400/20 text-red-300"
                                    : "border-yellow-400/30 bg-yellow-400/10 text-yellow-300"
                                }`}
                              >
                                {priceDropAlert
                                  ? "🔔 PRICE DROP ALERT"
                                  : "🟡 Monitoring"}
                              </span>

                            </div>

                            <p className="mt-1 max-w-xl break-all text-sm text-gray-400">
                              {product.url}
                            </p>

                          </div>

                          {intelligence && (
                            <div className="flex items-center gap-2">

                              <span className="text-sm text-gray-400">
                                Deal Score
                              </span>

                              <span className="text-3xl font-bold text-cyan-300">
                                {Math.round(
                                  intelligence.deal_score
                                )}
                              </span>

                              <span className="text-sm text-gray-500">
                                /100
                              </span>

                            </div>
                          )}

                        </div>

                        {/* ALERT MESSAGE */}

                        {priceDropAlert && (
                          <div className="mt-5 rounded-2xl border border-red-400/40 bg-red-400/10 p-5">

                            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">

                              <div>

                                <p className="text-lg font-bold text-red-300">
                                  🔔 Price Drop Alert!
                                </p>

                                <p className="mt-1 text-sm text-gray-300">
                                  Your target price has been reached.
                                  This is a good time to consider buying.
                                </p>

                              </div>

                              <div className="text-left md:text-right">

                                <p className="text-xs text-gray-400">
                                  Current Price
                                </p>

                                <p className="text-2xl font-bold text-red-300">
                                  ₹
                                  {Number(
                                    product.current_price || 0
                                  ).toLocaleString(
                                    "en-IN"
                                  )}
                                </p>

                                <p className="mt-1 text-xs text-gray-400">
                                  Target: ₹
                                  {Number(
                                    productTarget || 0
                                  ).toLocaleString(
                                    "en-IN"
                                  )}
                                </p>

                              </div>

                            </div>

                          </div>
                        )}

                        {/* MONITORING MESSAGE */}

                        {!priceDropAlert &&
                          productTarget !== null && (
                            <div className="mt-5 rounded-xl border border-yellow-400/20 bg-yellow-400/5 p-4">

                              <p className="text-sm font-semibold text-yellow-300">
                                🟡 Price Monitoring Active
                              </p>

                              <p className="mt-1 text-sm text-gray-400">
                                Current price is ₹
                                {Number(
                                  product.current_price || 0
                                ).toLocaleString(
                                  "en-IN"
                                )}
                                . Alert will trigger when it reaches ₹
                                {Number(
                                  productTarget
                                ).toLocaleString(
                                  "en-IN"
                                )}
                                or below.
                              </p>

                            </div>
                          )}

                        {/* MAIN METRICS */}

                        <div className="mt-5 grid gap-4 md:grid-cols-3">

                          <div className="rounded-xl bg-white/10 p-4">

                            <p className="text-xs text-gray-400">
                              Current Price
                            </p>

                            <p className="mt-1 text-2xl font-bold text-cyan-300">
                              ₹
                              {Number(
                                product.current_price || 0
                              ).toLocaleString(
                                "en-IN"
                              )}
                            </p>

                          </div>

                          {/* FIXED TARGET PRICE */}

                          <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-4">

                            <p className="text-xs text-gray-400">
                              Target Price
                            </p>

                            <p className="mt-1 text-2xl font-bold text-cyan-300">

                              {productTarget !== null
                                ? `₹${Number(
                                    productTarget
                                  ).toLocaleString(
                                    "en-IN"
                                  )}`
                                : "Not set"}

                            </p>

                            {productTarget !== null && (
                              <p className="mt-1 text-xs text-gray-500">
                                Saved alert target
                              </p>
                            )}

                          </div>

                          <div className="rounded-xl bg-white/10 p-4">

                            <p className="text-xs text-gray-400">
                              Availability
                            </p>

                            <p className="mt-2 font-semibold text-yellow-300">
                              {product.availability}
                            </p>

                          </div>

                        </div>

                        {/* INTELLIGENCE */}

                        {intelligence ? (

                          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">

                            <div className="rounded-xl border border-white/10 bg-black/10 p-4">

                              <p className="text-xs text-gray-400">
                                Historical Low
                              </p>

                              <p className="mt-1 font-bold">
                                {intelligence.historical_low !==
                                null
                                  ? `₹${Number(
                                      intelligence.historical_low
                                    ).toLocaleString(
                                      "en-IN"
                                    )}`
                                  : "N/A"}
                              </p>

                            </div>

                            <div className="rounded-xl border border-white/10 bg-black/10 p-4">

                              <p className="text-xs text-gray-400">
                                Average Price
                              </p>

                              <p className="mt-1 font-bold">
                                {intelligence.average_price !==
                                null
                                  ? `₹${Number(
                                      intelligence.average_price
                                    ).toLocaleString(
                                      "en-IN"
                                    )}`
                                  : "N/A"}
                              </p>

                            </div>

                            <div className="rounded-xl border border-white/10 bg-black/10 p-4">

                              <p className="text-xs text-gray-400">
                                Price Change
                              </p>

                              <p
                                className={`mt-1 font-bold ${
                                  intelligence.price_change_percent <
                                  0
                                    ? "text-green-300"
                                    : "text-yellow-300"
                                }`}
                              >
                                {intelligence.price_change_percent >
                                0
                                  ? "+"
                                  : ""}
                                {Number(
                                  intelligence.price_change_percent
                                ).toFixed(2)}
                                %
                              </p>

                            </div>

                            <div className="rounded-xl border border-white/10 bg-black/10 p-4">

                              <p className="text-xs text-gray-400">
                                Price Records
                              </p>

                              <p className="mt-1 font-bold">
                                {
                                  intelligence.history_points
                                }
                              </p>

                            </div>

                          </div>

                        ) : (

                          <div className="mt-4 rounded-xl border border-dashed border-white/10 bg-black/10 p-4 text-sm text-gray-400">
                            Deal Intelligence has not been calculated yet.
                            Click <span className="font-semibold text-cyan-300">Refresh Intelligence</span> to analyze this product.
                          </div>

                        )}

                      </div>

                    );
                  }
                )}

              </div>

            )}

          </div>

          {/* ALERTS SECTION */}

          {showAlerts && (
            <div
              id="alerts-section"
              className="mt-8 rounded-2xl border border-red-400/30 bg-red-400/5 p-6"
            >

              <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">

                <div>

                  <p className="text-sm font-semibold text-red-300">
                    🔔 PricePulse Alerts
                  </p>

                  <h2 className="mt-1 text-2xl font-bold">
                    Price Drop Alerts
                  </h2>

                  <p className="mt-2 text-sm text-gray-400">
                    Products that have reached your target price.
                  </p>

                </div>

                <span className="rounded-full bg-red-400/20 px-4 py-2 text-sm font-bold text-red-300">
                  {activeAlerts} Active Alert
                  {activeAlerts !== 1
                    ? "s"
                    : ""}
                </span>

              </div>

              <div className="mt-6 space-y-4">

                {products.filter((product) =>
                  isPriceDropAlert(
                    product,
                    dealData[product.id]
                  )
                ).length === 0 ? (

                  <div className="rounded-xl border border-yellow-400/20 bg-yellow-400/5 p-6">

                    <p className="font-semibold text-yellow-300">
                      🟡 No price drop alerts yet
                    </p>

                    <p className="mt-1 text-sm text-gray-400">
                      PricePulse is monitoring your products.
                      You will see an alert here when the current
                      price reaches your target price.
                    </p>

                  </div>

                ) : (

                  products
                    .filter((product) =>
                      isPriceDropAlert(
                        product,
                        dealData[product.id]
                      )
                    )
                    .map((product) => {

                      const productTarget =
                        getProductTargetPrice(
                          product.id
                        );

                      return (

                        <div
                          key={product.id}
                          className="rounded-xl border border-red-400/30 bg-red-400/10 p-5"
                        >

                          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">

                            <div>

                              <p className="text-lg font-bold text-white">
                                {product.name}
                              </p>

                              <p className="mt-1 text-sm text-red-300">
                                🔔 Your target price has been reached!
                              </p>

                            </div>

                            <div className="text-left md:text-right">

                              <p className="text-xs text-gray-400">
                                Current Price
                              </p>

                              <p className="text-2xl font-bold text-red-300">
                                ₹
                                {Number(
                                  product.current_price || 0
                                ).toLocaleString(
                                  "en-IN"
                                )}
                              </p>

                              <p className="text-xs text-gray-400">
                                Target: ₹
                                {Number(
                                  productTarget || 0
                                ).toLocaleString(
                                  "en-IN"
                                )}
                              </p>

                            </div>

                          </div>

                        </div>

                      );
                    })

                )}

              </div>

            </div>
          )}

          {/* DEAL INTELLIGENCE */}

          <div className="mt-8 rounded-2xl border border-cyan-400/20 bg-cyan-400/5 p-6">

            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">

              <div>

                <p className="text-sm text-cyan-300">
                  Price Intelligence
                </p>

                <h2 className="mt-1 text-xl font-bold">
                  Smart Deal Analysis
                </h2>

                <p className="mt-2 max-w-2xl text-sm text-gray-400">
                  PricePulse evaluates the target price,
                  historical low, average price and price
                  movement to generate a buying recommendation.
                </p>

              </div>

              <button
                onClick={refreshIntelligence}
                disabled={
                  refreshing ||
                  products.length === 0
                }
                className="rounded-xl bg-cyan-400 px-5 py-3 font-semibold text-slate-950 disabled:opacity-50"
              >
                {refreshing
                  ? "Analyzing..."
                  : "Analyze Prices"}
              </button>

            </div>

          </div>

        </section>

      </div>

      {/* TRACK PRODUCT MODAL */}

      {showForm && (

        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">

          <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-[#0b1b2d] p-6 shadow-2xl">

            <div className="flex items-center justify-between">

              <div>

                <h2 className="text-2xl font-bold">
                  Track a Product
                </h2>

                <p className="mt-1 text-sm text-gray-400">
                  Enter a product URL and your desired
                  target price.
                </p>

              </div>

              <button
                onClick={() =>
                  setShowForm(false)
                }
                className="rounded-lg px-3 py-2 text-gray-400 hover:bg-white/5"
              >
                ✕
              </button>

            </div>

            <div className="mt-6 space-y-5">

              <div>

                <label className="mb-2 block text-sm text-gray-300">
                  Product URL
                </label>

                <input
                  value={url}
                  onChange={(e) =>
                    setUrl(e.target.value)
                  }
                  placeholder="Paste product URL here"
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none focus:border-cyan-400"
                />

              </div>

              <div>

                <label className="mb-2 block text-sm text-gray-300">
                  Target Price
                </label>

                <input
                  value={targetPrice}
                  onChange={(e) =>
                    setTargetPrice(
                      e.target.value
                    )
                  }
                  type="number"
                  placeholder="Example: 20000"
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none focus:border-cyan-400"
                />

              </div>

              <button
                onClick={startTracking}
                disabled={saving}
                className="w-full rounded-xl bg-cyan-400 px-5 py-3 font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
              >

                {saving
                  ? "Checking Price..."
                  : "Start Tracking"}

              </button>

            </div>

          </div>

        </div>

      )}

    </main>
  );
}
