import { NextResponse } from "next/server";

const GAMMA_URL =
  "https://gamma-api.polymarket.com/events?slug=rainbow-fdv-above-one-day-after-launch-676";

export async function GET() {
  try {
    const res = await fetch(GAMMA_URL, { next: { revalidate: 60 } });
    if (!res.ok) throw new Error(`Gamma API ${res.status}`);

    const events = await res.json();
    const event = events?.[0];
    if (!event?.markets?.length) {
      return NextResponse.json({ markets: [] });
    }

    // Sort by groupItemThreshold ascending (0=$70M, 1=$100M, etc.)
    const sorted = [...event.markets].sort(
      (a: any, b: any) =>
        Number(a.groupItemThreshold ?? 999) -
        Number(b.groupItemThreshold ?? 999)
    );

    // Take first two markets, extract Yes odds
    const markets = sorted.slice(0, 2).map((m: any) => {
      const prices = JSON.parse(m.outcomePrices || '["0","0"]');
      return {
        question: m.groupItemTitle || m.question,
        yesOdds: Math.round(Number(prices[0]) * 1000) / 10, // e.g. 74.5
        slug: m.slug,
      };
    });

    return NextResponse.json({ markets });
  } catch (err: any) {
    console.error("Polymarket fetch error:", err.message);
    return NextResponse.json({ markets: [] }, { status: 500 });
  }
}
