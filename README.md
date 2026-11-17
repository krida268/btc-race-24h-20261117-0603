# Dip-Buy 360/150/100 — bot trading cbBTC/USDC

[![make.fun · btc-race-24h-20261117-0603](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/krida268/btc-race-24h-20261117-0603/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/krida268/btc-race-24h-20261117-0603/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)

Bot mean-reversion untuk bounty [btc-race-24h-20261117-0603](https://make.fun/bounty/btc-race-24h-20261117-0603): trading Coinbase Wrapped BTC (cbBTC) lawan USDC, menit demi menit, dengan uang kertas $1.000.

## Strategi

Long only, satu posisi, all-in. Harga dalam skala integer 1e5, semua
perbandingan memakai BigInt eksak (basis poin) supaya deterministik.

- **High 360 bar:** H360 = close tertinggi dari 360 bar terakhir (atau
  semua bar yang sudah terlihat bila kurang dari 360). Trading mulai di
  bar ke-120; 120 bar pertama hanya membentuk referensi.
- **Entry (beli):** saat flat dan close bar berjalan >= 150 bps di bawah
  H360, beli seluruh cash dalam 1 order. Fill terjadi di open bar
  berikutnya.
- **Exit target:** saat punya posisi dan close >= 100 bps di atas harga
  fill beli, jual seluruh posisi.
- **Stop-loss:** saat punya posisi dan close <= 100 bps di bawah harga
  fill beli, jual seluruh posisi.
- **Harga fill entry** dibaca dari `batch.fills` (field `price`) pada batch
  setelah order beli dikirim — bukan harga close saat keputusan beli.
  Posisi hanya di-exit setelah harga fill ini diketahui.
- **Fallback anti-nol-trade:** bila sampai close bar ke-1200 belum ada
  satu pun fill beli, beli seluruh cash dan tahan sampai akhir window
  (mengabaikan target maupun stop-loss, ditutup oleh flatten otomatis).
- `max_slippage_bps = 100` untuk semua order. Tidak ada order saat
  `state.warmingUp`. Satu order per reply.

## Cara menjalankan (grade lokal)

```sh
node cli/makefun.mjs grade-local --kit . --bot <repo-ini> --driver process --worktree
```

dijalankan dari direktori kit `btc-race-24h-20261117-0603-kit`. Bot
dijalankan harness sebagai `node main.ts` (Node 22, erasable TypeScript,
tanpa dependensi di luar standard library; shim protokol di-vendor di
`vendor/makefun-bars.ts`).

## Referral

Daftar make.fun lewat referral saya: https://make.fun/r/enzt809f (kode `enzt809f`).
