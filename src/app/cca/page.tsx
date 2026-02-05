"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";

// ─── Supabase Client (uses PUBLIC keys — safe for browser) ───
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ─── Types ───────────────────────────────────────────────────
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

// ─── Helper: Format numbers nicely ──────────────────────────
function formatUsd(value: number): string {
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`;
  }
  if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(1)}K`;
  }
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

// ─── Main Component ──────────────────────────────────────────
export default function CCADashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState(60);

  const fetchData = useCallback(async () => {
    try {
      const { data: statsData } = await supabase
        .from("cca_stats_latest")
        .select("*")
        .eq("id", "base_usdc_to_cca")
        .single();

      if (statsData) {
        setStats(statsData as Stats);
      }

      const { data: walletData } = await supabase
        .from("cca_wallets")
        .select("address, total_usdc, bid_count, last_bid_time, ens_name")
        .order("total_usdc", { ascending: false })
        .limit(100);

      if (walletData) {
        setWallets(walletData as WalletRow[]);
      }

      setLastFetch(new Date());
      setCountdown(60);
    } catch (err) {
      console.error("Error fetching data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 60));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-2 border-cyan-500/30 border-t-cyan-400 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400 font-mono text-sm tracking-widest uppercase">
            Loading auction data...
          </p>
        </div>
      </div>
    );
  }

  const statCards = stats
    ? [
        {
          label: "Total USDC",
          value: formatUsd(stats.total_usdc),
          accent: "from-cyan-500 to-blue-600",
          glow: "shadow-cyan-500/20",
          icon: "◆",
        },
        {
          label: "Total Bids",
          value: formatNumber(stats.total_bids),
          accent: "from-emerald-500 to-teal-600",
          glow: "shadow-emerald-500/20",
          icon: "▲",
        },
        {
          label: "Unique Wallets",
          value: formatNumber(stats.unique_wallets),
          accent: "from-violet-500 to-purple-600",
          glow: "shadow-violet-500/20",
          icon: "●",
        },
        {
          label: "Avg Bid",
          value: formatUsd(stats.avg_bid),
          accent: "from-amber-500 to-orange-600",
          glow: "shadow-amber-500/20",
          icon: "◈",
        },
        {
          label: "Median Bid",
          value: formatUsd(stats.median_bid),
          accent: "from-pink-500 to-rose-600",
          glow: "shadow-pink-500/20",
          icon: "◇",
        },
        {
          label: "Bids < $50",
          value: formatPct(stats.pct_bids_lt_50),
          accent: "from-sky-500 to-indigo-600",
          glow: "shadow-sky-500/20",
          icon: "▽",
        },
        {
          label: "Bids < $100",
          value: formatPct(stats.pct_bids_lt_100),
          accent: "from-lime-500 to-green-600",
          glow: "shadow-lime-500/20",
          icon: "□",
        },
        {
          label: "Top 10 Share",
          value: formatPct(stats.top10_share),
          accent: "from-red-500 to-orange-600",
          glow: "shadow-red-500/20",
          icon: "★",
        },
      ]
    : [];

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-gray-100">
      <div
        className="fixed inset-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, rgba(255,255,255,0.3) 1px, transparent 0)`,
          backgroundSize: "32px 32px",
        }}
      />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* ── Header ───────────────────────────────────────── */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            <span className="text-xs font-mono text-gray-500 tracking-[0.25em] uppercase">
              Live · Base Network
            </span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
            <span className="bg-gradient-to-r from-cyan-400 via-blue-400 to-violet-400 bg-clip-text text-transparent">
              CCA Auction
            </span>
            <span className="text-gray-600 ml-3 text-2xl font-light">
              Dashboard
            </span>
          </h1>
          <div className="mt-3 flex items-center gap-4 text-xs font-mono text-gray-600">
            {lastFetch && (
              <span>Updated {timeAgo(lastFetch.toISOString())}</span>
            )}
            <span className="text-gray-700">·</span>
            <span>Next refresh in {countdown}s</span>
            <button
              onClick={fetchData}
              className="ml-2 px-2 py-0.5 rounded border border-gray-800 hover:border-cyan-800 hover:text-cyan-400 transition-colors"
            >
              ↻ Refresh
            </button>
          </div>
        </div>

        {/* ── Stat Cards ───────────────────────────────────── */}
        {stats ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-10">
            {statCards.map((card) => (
              <div
                key={card.label}
                className={`
                  relative overflow-hidden rounded-xl 
                  bg-gradient-to-br from-gray-900/80 to-gray-900/40
                  border border-gray-800/60
                  backdrop-blur-sm
                  shadow-lg ${card.glow}
                  hover:border-gray-700/80 hover:shadow-xl
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
                    <span className="text-gray-700 text-sm">{card.icon}</span>
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

        {/* ── Leaderboard ──────────────────────────────────── */}
        <div className="rounded-xl border border-gray-800/60 bg-gray-900/40 backdrop-blur-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-800/60 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold tracking-wide text-gray-200">
                Leaderboard
              </h2>
              <p className="text-[10px] font-mono text-gray-600 mt-0.5 tracking-wider uppercase">
                Top 100 wallets by USDC contributed
              </p>
            </div>
            <span className="text-xs font-mono text-gray-700">
              {wallets.length} wallets
            </span>
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
                <tbody className="divide-y divide-gray-800/40">
                  {wallets.map((wallet, index) => {
                    const share =
                      stats && stats.total_usdc > 0
                        ? (wallet.total_usdc / stats.total_usdc) * 100
                        : 0;
                    const isTop3 = index < 3;

                    return (
                      <tr
                        key={wallet.address}
                        className="hover:bg-gray-800/30 transition-colors group"
                      >
                        <td className="px-5 py-3.5">
                          <span
                            className={`
                              inline-flex items-center justify-center w-6 h-6 rounded-md text-xs font-mono
                              ${
                                isTop3
                                  ? "bg-gradient-to-br from-cyan-500/20 to-blue-500/20 text-cyan-400 border border-cyan-500/30"
                                  : "text-gray-600"
                              }
                            `}
                          >
                            {index + 1}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          <a
                            href={`https://basescan.org/address/${wallet.address}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-sm text-gray-400 hover:text-cyan-400 transition-colors"
                            title={wallet.address}
                          >
                            {wallet.ens_name && wallet.ens_name !== "_none"
                              ? <span className="text-cyan-300">{wallet.ens_name}</span>
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
                            <div className="w-16 h-1 rounded-full bg-gray-800 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500"
                                style={{ width: `${Math.min(share, 100)}%` }}
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

        {/* ── Footer ───────────────────────────────────────── */}
        <div className="mt-8 text-center">
          <p className="text-[10px] font-mono text-gray-700 tracking-wider">
            CCA Contract:{" "}
            <a
              href="https://basescan.org/address/0x7e867b47a94df05188c08575e8B9a52F3F69c469"
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-600 hover:text-cyan-500 transition-colors"
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
