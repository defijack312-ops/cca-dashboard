"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

interface Stats {
  total_usdc: number;
  total_bids: number;
  unique_wallets: number;
  avg_bid: number;
  median_bid: number;
  pct_bids_lt_50: number;
  pct_bids_lt_100: number;
  top10_share: number;
  top50_share: number;
  updated_at: string;
}

interface WalletRow {
  address: string;
  total_usdc: number;
  bid_count: number;
  last_bid_time: string | null;
  ens_name: string | null;
}

function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

function formatPct(value: number): string {
  return `${value.toFixed(1)}%`;
}

function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function timeAgo(dateString: string): string {
  const now = new Date();
  const then = new Date(dateString);
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

const AUCTION_URL = "https://app.uniswap.org/explore/auctions/base/0x7e867b47a94df05188c08575e8B9a52F3F69c469";

export default function CCADashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState(60);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResult, setSearchResult] = useState<{ found: boolean; rank?: number; message?: string } | null>(null);
  const [highlightedRank, setHighlightedRank] = useState<number | null>(null);
  const [auctionTimeLeft, setAuctionTimeLeft] = useState<{ h: number; m: number; s: number; ended: boolean }>({ h: 0, m: 0, s: 0, ended: false });

  const fetchData = useCallback(async () => {
    try {
      const { data: statsData } = await supabase
        .from("cca_stats_latest")
        .select("*")
        .eq("id", "base_usdc_to_cca")
        .single();
      if (statsData) setStats(statsData as Stats);

      const { data: walletData } = await supabase
        .from("cca_wallets")
        .select("address, total_usdc, bid_count, last_bid_time, ens_name")
        .order("total_usdc", { ascending: false })
        .limit(5000);
      if (walletData) setWallets(walletData as WalletRow[]);

      setLastFetch(new Date());
      setCountdown(60);
    } catch (err) {
      console.error("Error fetching data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); const i = setInterval(fetchData, 60_000); return () => clearInterval(i); }, [fetchData]);
  useEffect(() => { const t = setInterval(() => setCountdown((p) => (p > 0 ? p - 1 : 60)), 1000); return () => clearInterval(t); }, []);

  // Auction ends at 10:00 AM EST Feb 5, 2026 = 15:00 UTC
  useEffect(() => {
    const AUCTION_END = new Date("2026-02-05T15:00:00Z").getTime();
    const tick = () => {
      const diff = AUCTION_END - Date.now();
      if (diff <= 0) {
        setAuctionTimeLeft({ h: 0, m: 0, s: 0, ended: true });
      } else {
        const h = Math.floor(diff / 3_600_000);
        const m = Math.floor((diff % 3_600_000) / 60_000);
        const s = Math.floor((diff % 60_000) / 1000);
        setAuctionTimeLeft({ h, m, s, ended: false });
      }
    };
    tick();
    const i = setInterval(tick, 1000);
    return () => clearInterval(i);
  }, []);

  const handleSearch = () => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) { setSearchResult(null); setHighlightedRank(null); return; }
    const index = wallets.findIndex(
      (w) =>
        w.address.toLowerCase() === q ||
        w.address.toLowerCase().startsWith(q) ||
        (w.ens_name && w.ens_name !== "_none" && w.ens_name.toLowerCase().includes(q))
    );
    if (index !== -1) {
      const rank = index + 1;
      setSearchResult({ found: true, rank });
      setHighlightedRank(rank);
      setTimeout(() => { const row = document.getElementById(`wallet-row-${rank}`); if (row) row.scrollIntoView({ behavior: "smooth", block: "center" }); }, 100);
      setTimeout(() => setHighlightedRank(null), 5000);
    } else {
      setSearchResult({ found: false, message: "Wallet not found in top 1,000. They may not have bid yet or are ranked lower." });
      setHighlightedRank(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a1628] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-2 border-orange-500/30 border-t-yellow-400 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400 font-mono text-sm tracking-widest uppercase">
            Loading auction data...
          </p>
        </div>
      </div>
    );
  }

  const statCards = stats
    ? [
        { label: "Total USDC", value: formatUsd(stats.total_usdc), accent: "from-red-500 to-orange-500", glow: "shadow-red-500/20", icon: "◆" },
        { label: "Total Bids", value: formatNumber(stats.total_bids), accent: "from-orange-500 to-yellow-500", glow: "shadow-orange-500/20", icon: "▲" },
        { label: "Unique Wallets", value: formatNumber(stats.unique_wallets), accent: "from-yellow-500 to-green-500", glow: "shadow-yellow-500/20", icon: "●" },
        { label: "Avg Bid", value: formatUsd(stats.avg_bid), accent: "from-green-500 to-emerald-500", glow: "shadow-green-500/20", icon: "◈" },
        { label: "Median Bid", value: formatUsd(stats.median_bid), accent: "from-emerald-500 to-blue-500", glow: "shadow-emerald-500/20", icon: "◇" },
        { label: "Bids < $50", value: formatPct(stats.pct_bids_lt_50), accent: "from-blue-500 to-indigo-500", glow: "shadow-blue-500/20", icon: "▽" },
        { label: "Bids < $100", value: formatPct(stats.pct_bids_lt_100), accent: "from-indigo-500 to-violet-500", glow: "shadow-indigo-500/20", icon: "□" },
        { label: "Top 10 Share", value: formatPct(stats.top10_share), accent: "from-violet-500 to-fuchsia-500", glow: "shadow-violet-500/20", icon: "★" },
      ]
    : [];

  return (
    <div className="min-h-screen bg-[#0a1628] text-gray-100">
      {/* Subtle dot grid */}
      <div
        className="fixed inset-0 opacity-[0.02] pointer-events-none"
        style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, rgba(255,255,255,0.3) 1px, transparent 0)`,
          backgroundSize: "32px 32px",
        }}
      />
      {/* Subtle rainbow glow at top */}
      <div
        className="fixed top-0 left-0 right-0 h-1 opacity-60 pointer-events-none"
        style={{
          background: "linear-gradient(90deg, #ef4444, #f97316, #eab308, #22c55e, #3b82f6, #8b5cf6, #d946ef)",
        }}
      />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* ── Header ─────────────────────────────────────── */}
        <div className="mb-10">
          <div className="flex items-start justify-between gap-4">
            {/* Left side — title */}
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
                <span className="text-xs font-mono text-gray-500 tracking-[0.25em] uppercase">
                  Live · Base Network
                </span>
              </div>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
                <a
                  href={AUCTION_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:opacity-80 transition-opacity"
                >
                  <span
                    className="bg-clip-text text-transparent"
                    style={{
                      backgroundImage: "linear-gradient(90deg, #ef4444, #f97316, #eab308, #22c55e, #3b82f6, #8b5cf6)",
                    }}
                  >
                    $RNBW CCA
                  </span>
                </a>
                <span className="text-gray-500 ml-3 text-2xl font-light">
                  Auction Dashboard
                </span>
              </h1>
            </div>

            {/* Right side — auction countdown */}
            <div className="flex-shrink-0">
              <div
                className="rounded-xl border overflow-hidden"
                style={{
                  borderColor: auctionTimeLeft.ended ? "rgba(239,68,68,0.4)" : "rgba(234,179,8,0.3)",
                  background: "linear-gradient(135deg, rgba(15,31,58,0.9), rgba(10,22,40,0.9))",
                }}
              >
                <div
                  className="h-0.5"
                  style={{
                    background: auctionTimeLeft.ended
                      ? "#ef4444"
                      : "linear-gradient(90deg, #ef4444, #f97316, #eab308, #22c55e, #3b82f6)",
                  }}
                />
                <div className="px-4 py-3 text-center">
                  <div className="text-[10px] font-mono tracking-[0.2em] uppercase text-gray-500 mb-1.5">
                    {auctionTimeLeft.ended ? "Auction Ended" : "Auction Ends In"}
                  </div>
                  {auctionTimeLeft.ended ? (
                    <div className="text-lg font-bold font-mono text-red-400">
                      ENDED
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 font-mono">
                      <div className="text-center">
                        <span className="text-2xl font-bold text-white">{String(auctionTimeLeft.h).padStart(2, "0")}</span>
                        <span className="text-[9px] block text-gray-600 -mt-0.5">HRS</span>
                      </div>
                      <span className="text-yellow-500 text-xl font-bold -mt-3">:</span>
                      <div className="text-center">
                        <span className="text-2xl font-bold text-white">{String(auctionTimeLeft.m).padStart(2, "0")}</span>
                        <span className="text-[9px] block text-gray-600 -mt-0.5">MIN</span>
                      </div>
                      <span className="text-yellow-500 text-xl font-bold -mt-3">:</span>
                      <div className="text-center">
                        <span
                          className="text-2xl font-bold bg-clip-text text-transparent"
                          style={{
                            backgroundImage: "linear-gradient(90deg, #f97316, #eab308)",
                          }}
                        >
                          {String(auctionTimeLeft.s).padStart(2, "0")}
                        </span>
                        <span className="text-[9px] block text-gray-600 -mt-0.5">SEC</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-4 text-xs font-mono font-semibold text-gray-500">
            {lastFetch && (
              <span>Updated {timeAgo(lastFetch.toISOString())}</span>
            )}
            <span className="text-gray-700">·</span>
            <span>Next refresh in {countdown}s</span>
            <button
              onClick={fetchData}
              className="ml-2 px-2 py-0.5 rounded border border-gray-700 hover:border-orange-500/60 hover:text-orange-400 transition-colors"
            >
              ↻ Refresh
            </button>
            <a
              href={AUCTION_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-2 px-3 py-0.5 rounded border border-orange-500/30 text-orange-400 hover:bg-orange-500/10 transition-colors"
            >
              Bid on Uniswap ↗
            </a>
            <span className="text-gray-700">·</span>
            <span className="text-gray-500">
              donate ETH/Base:{" "}
              <a
                href="https://basescan.org/address/0x7d8b958786261f0b48e4f7b55787f5f2dad8f114"
                target="_blank"
                rel="noopener noreferrer"
                className="text-orange-400/70 hover:text-orange-400 transition-colors"
              >
                0x7d8b...f114
              </a>
            </span>
          </div>
        </div>

        {/* ── Stat Cards ─────────────────────────────────── */}
        {stats ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-10">
            {statCards.map((card) => (
              <div
                key={card.label}
                className={`
                  relative overflow-hidden rounded-xl 
                  bg-gradient-to-br from-[#0f1f3a]/80 to-[#0a1628]/40
                  border border-blue-900/40
                  backdrop-blur-sm
                  shadow-lg ${card.glow}
                  hover:border-blue-800/60 hover:shadow-xl
                  transition-all duration-300
                  group
                `}
              >
                <div
                  className={`h-0.5 bg-gradient-to-r ${card.accent} opacity-60 group-hover:opacity-100 transition-opacity`}
                />
                <div className="p-4 sm:p-5">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] font-mono tracking-[0.2em] uppercase text-gray-500">
                      {card.label}
                    </span>
                    <span className="text-blue-900 text-sm">{card.icon}</span>
                  </div>
                  <div className="text-xl sm:text-2xl font-bold tracking-tight text-white">
                    {card.value}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 text-gray-600 font-mono text-sm">
            No stats data yet. Run the sync endpoint first.
          </div>
        )}

        {/* ── Leaderboard ────────────────────────────────── */}
        <div className="rounded-xl border border-blue-900/40 bg-[#0f1f3a]/40 backdrop-blur-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-blue-900/40">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-sm font-semibold tracking-wide text-gray-200">
                  Leaderboard
                </h2>
                <p className="text-[10px] font-mono text-gray-600 mt-0.5 tracking-wider uppercase">
                  All wallets by USDC contributed
                </p>
              </div>
              <span className="text-xs font-mono text-gray-600">
                {wallets.length} wallets
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative flex-1 max-w-md">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  placeholder="Search by address or ENS name..."
                  className="w-full bg-[#0a1628]/80 border border-blue-900/50 rounded-lg px-3 py-2 text-sm font-mono text-gray-300 placeholder-gray-600 focus:outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/20 transition-all"
                />
              </div>
              <button
                onClick={handleSearch}
                className="px-4 py-2 rounded-lg bg-orange-500/10 border border-orange-500/30 text-orange-400 text-sm font-mono hover:bg-orange-500/20 transition-colors"
              >
                Find
              </button>
              {searchQuery && (
                <button
                  onClick={() => { setSearchQuery(""); setSearchResult(null); setHighlightedRank(null); }}
                  className="px-3 py-2 rounded-lg border border-blue-900/50 text-gray-500 text-sm font-mono hover:text-gray-300 transition-colors"
                >
                  ✕
                </button>
              )}
            </div>
            {searchResult && (
              <div className={`mt-2 text-xs font-mono ${searchResult.found ? "text-green-400" : "text-amber-400"}`}>
                {searchResult.found
                  ? `Found at rank #${searchResult.rank}`
                  : searchResult.message}
              </div>
            )}
          </div>

          {wallets.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-[10px] font-mono tracking-[0.2em] uppercase text-gray-600">
                    <th className="px-5 py-3 text-left">#</th>
                    <th className="px-5 py-3 text-left">Wallet</th>
                    <th className="px-5 py-3 text-right">Total USDC</th>
                    <th className="px-5 py-3 text-right">Bids</th>
                    <th className="px-5 py-3 text-right">Last Bid</th>
                    <th className="px-5 py-3 text-right">Share</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-blue-900/30">
                  {wallets.map((wallet, index) => {
                    const share =
                      stats && stats.total_usdc > 0
                        ? (wallet.total_usdc / stats.total_usdc) * 100
                        : 0;
                    const isTop3 = index < 3;

                    return (
                      <tr
                        key={wallet.address}
                        id={`wallet-row-${index + 1}`}
                        className={`transition-all duration-500 group ${
                          highlightedRank === index + 1
                            ? "bg-orange-500/10 ring-1 ring-orange-500/30"
                            : "hover:bg-blue-900/20"
                        }`}
                      >
                        <td className="px-5 py-3.5">
                          <span
                            className={`
                              inline-flex items-center justify-center w-6 h-6 rounded-md text-xs font-mono
                              ${
                                isTop3
                                  ? "text-yellow-400 border border-yellow-500/30"
                                  : "text-gray-600"
                              }
                            `}
                            style={isTop3 ? {
                              background: "linear-gradient(135deg, rgba(239,68,68,0.15), rgba(249,115,22,0.15), rgba(234,179,8,0.15))",
                            } : undefined}
                          >
                            {index + 1}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          <a
                            href={`https://basescan.org/address/${wallet.address}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-sm text-gray-400 hover:text-orange-400 transition-colors"
                            title={wallet.address}
                          >
                            {wallet.ens_name && wallet.ens_name !== "_none"
                              ? <span className="text-yellow-300">{wallet.ens_name}</span>
                              : shortenAddress(wallet.address)}
                            <span className="text-gray-700 group-hover:text-gray-500 ml-1.5 text-[10px]">
                              ↗
                            </span>
                          </a>
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <span
                            className={`font-mono text-sm ${
                              isTop3 ? "text-white font-semibold" : "text-gray-300"
                            }`}
                          >
                            {formatUsd(wallet.total_usdc)}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-right font-mono text-sm text-gray-500">
                          {formatNumber(wallet.bid_count)}
                        </td>
                        <td className="px-5 py-3.5 text-right font-mono text-sm text-gray-500">
                          {wallet.last_bid_time ? timeAgo(wallet.last_bid_time) : "—"}
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 h-1 rounded-full bg-blue-900/40 overflow-hidden">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  background: "linear-gradient(90deg, #ef4444, #f97316, #eab308, #22c55e)",
                                  width: `${Math.min(share, 100)}%`,
                                }}
                              />
                            </div>
                            <span className="font-mono text-xs text-gray-500 w-12 text-right">
                              {formatPct(share)}
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-12 text-gray-600 font-mono text-sm">
              No wallet data yet. Run the sync endpoint first.
            </div>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────── */}
        <div className="mt-8 text-center">
          <p className="text-[10px] font-mono text-gray-600 tracking-wider">
            <a
              href={AUCTION_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-500 hover:text-orange-400 transition-colors"
            >
              $RNBW CCA Auction on Uniswap
            </a>
            {" · "}
            <a
              href="https://basescan.org/address/0x7e867b47a94df05188c08575e8B9a52F3F69c469"
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-600 hover:text-orange-400 transition-colors"
            >
              0x7e86...9469
            </a>
            {" · "}
            USDC on Base
            {stats && (
              <>
                {" · "}
                Last sync: {timeAgo(stats.updated_at)}
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
