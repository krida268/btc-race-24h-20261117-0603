// Dip-Buy 360/150/100 + stop-loss 100 bps + fallback bar 1200.
//
// Mean-reversion bot, long only, satu posisi, all-in, untuk CBBTC/USDC di
// make.fun btc-race-24h-20261117-0603.
//
// Idenya: harga cbBTC bergerak menit demi menit di sekitar trennya. Ketika
// close jatuh >= 150 bps di bawah high 360 bar terakhir, itu dianggap
// pantulan yang wajar untuk dibeli (beli seluruh cash). Posisi dilepas
// ketika harga pulih >= 100 bps di atas harga fill beli, atau dipotong
// ketika jatuh >= 100 bps di bawah harga fill beli. Kalau sampai bar
// ke-1200 belum pernah ada fill beli sama sekali, beli seluruh cash dan
// tahan sampai akhir window (fallback anti-nol-trade).
//
// Semua keputusan hanya dari bar yang sudah diterima. Tanpa acak, tanpa
// jam dinding, tanpa network, tanpa baca file/env. Semua perbandingan
// harga memakai BigInt eksak dalam basis poin (bps) supaya deterministik.

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const MAX_SLIPPAGE_BPS = 100;

// Jendela high dan ambang-ambang strategi, dalam basis poin.
const LOOKBACK_BARS = 360;
const WARMUP_BARS = 120;
const FALLBACK_BAR = 1200;
const DIP_BPS = 150;
const TARGET_BPS = 100;
const STOP_BPS = 100;
const BPS_DENOM = 10000n;

// Riwayat close yang sudah terlihat, urut waktu. Hanya dipakai untuk
// menghitung high 360 bar terakhir; bar tertua dibuang begitu lewat 360.
const closes: bigint[] = [];

// Harga fill order beli yang sedang dipegang (null kalau flat atau harga
// fill-nya belum terlihat di batch berikutnya). Exit target dan stop-loss
// selalu diukur dari harga ini, bukan dari close saat keputusan beli.
let entryFillPrice: bigint | null = null;

// Client id order beli/jual yang sudah dikirim tapi fill-nya belum
// dilaporkan. Selama ada yang pending, jangan kirim order sejenis lagi.
let pendingBuyId: string | null = null;
let pendingSellId: string | null = null;

// True begitu ada satu fill beli yang pernah terlihat (dipakai fallback).
let everBought = false;

// Client id order beli fallback yang sedang menunggu fill. Posisi fallback
// baru dikunci (tanpa target/stop-loss) begitu fill-nya terlihat, bukan
// saat ordernya dikirim: kalau order fallback ditolak, posisi dip yang
// masuk sesudahnya tetap boleh di-exit normal.
let fallbackBuyId: string | null = null;

// True begitu fill beli fallback terlihat; posisi fallback dipegang sampai
// akhir window dan mengabaikan target maupun stop-loss.
let fallbackHolding = false;

// High tertinggi dari 360 bar terakhir (termasuk bar berjalan).
function high360(): bigint {
  let high = 0n;
  const start = closes.length > LOOKBACK_BARS ? closes.length - LOOKBACK_BARS : 0;
  for (let i = start; i < closes.length; i++) {
    if (closes[i]! > high) high = closes[i]!;
  }
  return high;
}

// Lipat fills dari batch berjalan ke dalam state strategi: catat harga
// fill beli, bersihkan pending yang sudah terjawab, dan tandai bila
// posisi sudah tertutup oleh fill jual.
function applyFills(batch: Batch): void {
  for (const fill of batch.fills) {
    if (fill.symbol !== SYMBOL) continue;
    if (fill.status !== 'filled') {
      if (fill.client_id === pendingBuyId) pendingBuyId = null;
      if (fill.client_id === pendingSellId) pendingSellId = null;
      if (fill.client_id === fallbackBuyId) fallbackBuyId = null;
      continue;
    }
    if (fill.side === 'buy') {
      if (fill.client_id === pendingBuyId) pendingBuyId = null;
      if (fill.client_id === fallbackBuyId) {
        fallbackBuyId = null;
        fallbackHolding = true;
      }
      entryFillPrice = BigInt(fill.price);
      everBought = true;
    } else if (fill.side === 'sell') {
      if (fill.client_id === pendingSellId) pendingSellId = null;
      entryFillPrice = null;
    }
  }
}

await runBars({
  onBatch(state: BarsState, batch: Batch) {
    applyFills(batch);

    // Jangan kirim order apa pun selama warm-up harness.
    if (state.warmingUp) return [];

    const close = state.close(SYMBOL);
    if (close === null) return [];

    // Catat close bar berjalan sebelum mengambil keputusan apa pun.
    closes.push(close);
    if (closes.length > LOOKBACK_BARS) closes.shift();

    const position = state.positions.get(SYMBOL);
    const heldQty = position === undefined ? 0n : position.qty;

    // --- Keluar dari posisi: target recovery atau stop-loss. ---
    // Hanya bila posisi ada, harga fill entry sudah diketahui, bukan
    // posisi fallback, dan belum ada order jual yang pending.
    if (heldQty > 0n && entryFillPrice !== null && !fallbackHolding && pendingSellId === null) {
      // Perbandingan eksak tanpa pembulatan: target = close >= entry x 1,0100,
      // stop = close <= entry x 0,9900 (keduanya dalam bps, cross-multiplied).
      const hitTarget = close * BPS_DENOM >= entryFillPrice * BigInt(BPS_DENOM + BigInt(TARGET_BPS));
      const hitStop = close * BPS_DENOM <= entryFillPrice * BigInt(BPS_DENOM - BigInt(STOP_BPS));
      if (hitTarget || hitStop) {
        const sellId = `s${state.seq}`;
        pendingSellId = sellId;
        return [
          {
            side: 'sell',
            symbol: SYMBOL,
            qty: heldQty,
            max_slippage_bps: MAX_SLIPPAGE_BPS,
            client_id: sellId,
          },
        ];
      }
      return [];
    }

    // --- Masuk posisi: masih dalam 120 bar pertama, jangan trading. ---
    if (state.seq < WARMUP_BARS) return [];

    // Flat, tidak ada beli yang pending: cek sinyal dip atau fallback.
    if (heldQty === 0n && pendingBuyId === null && state.cash > 0n) {
      // Fallback anti-nol-trade: di bar 1200 belum pernah ada fill beli.
      if (state.seq >= FALLBACK_BAR && !everBought) {
        const buyId = `b${state.seq}`;
        pendingBuyId = buyId;
        fallbackBuyId = buyId;
        return [
          {
            side: 'buy',
            symbol: SYMBOL,
            notional_quote_units: state.cash,
            max_slippage_bps: MAX_SLIPPAGE_BPS,
            client_id: buyId,
          },
        ];
      }

      // Sinyal dip: close >= 150 bps di bawah high 360 bar terakhir.
      const high = high360();
      if (high > 0n && close * BPS_DENOM < high * BigInt(BPS_DENOM - BigInt(DIP_BPS))) {
        const buyId = `b${state.seq}`;
        pendingBuyId = buyId;
        return [
          {
            side: 'buy',
            symbol: SYMBOL,
            notional_quote_units: state.cash,
            max_slippage_bps: MAX_SLIPPAGE_BPS,
            client_id: buyId,
          },
        ];
      }
    }

    return [];
  },
});
