# PriceProof

**Is today's sale price really cheap?** PriceProof tracks the prices of phones, laptops and headphones across Vietnamese online electronics stores, several times a day, and shows how big each advertised discount really is.

[![ci](https://github.com/qhao15/priceproof/actions/workflows/ci.yml/badge.svg)](https://github.com/qhao15/priceproof/actions/workflows/ci.yml)

> 🚧 **Work in progress.** The foundations are done; the price collector is being built now so that price history exists before the 12.12 sales. Progress is tracked on the [PriceProof Roadmap](https://github.com/users/qhao15/projects) board.

## The problem

During big sales (11.11, Black Friday, 12.12, Tết), stores show a struck-through "original price" and a large discount badge. Sometimes that original price, or the price itself, was raised shortly before the sale, so the real saving is much smaller than advertised.

## How the real discount is measured

PriceProof compares the current price with **the lowest price in the 30 days before that price started**, the same reference EU rules require for advertised price reductions.

> A store advertises **−20%: 25.000.000 ₫ → 20.000.000 ₫**.
> The lowest price in the 30 days before was 21.000.000 ₫, so the real discount is **4.8%**.

Every price gets a neutral label:

| Label | Meaning |
|---|---|
| Real discount | At least 5% below the previous 30-day low, close to what the store advertises |
| Smaller than advertised | The advertised discount is at least 5 points bigger than the real one |
| Not below the previous 30-day low | A discount is advertised, but the price was this low or lower in the last 30 days |
| Normal price | No meaningful discount |
| Not enough history | Less than 7 days of data |
| Out of stock | Not available right now |

## Planned features

- **Price collector:** HTTP and headless-browser crawlers that store only price changes, run hourly on GitHub Actions or continuously on a PC
- **Product matching:** recognizes the same product across stores despite messy titles, without merging look-alikes such as "X5" and "X5 Pro"
- **Product pages:** every store's price on one chart, with sale periods shaded and the real discount explained with numbers
- **Real Deals page, watchlists and alerts:** target prices with in-app and email alerts
- **Chrome extension:** price history and the real discount right on a store's product page
- **Admin tools:** store health, automatic pausing when a store blocks the crawler, match review, suspicious-price review
- **Two fictional demo stores** for testing and demos, clearly labeled as simulated
- Vietnamese and English

## Tech stack

TypeScript everywhere, in a pnpm monorepo:

| Part | Tech |
|---|---|
| Collector | Node.js, Crawlee (HTTP + Playwright), Zod |
| API | NestJS, JWT auth, Swagger, official MongoDB driver |
| Shared packages | `@priceproof/shared` (price logic, normalization), `@priceproof/contracts` (Zod API schemas shared by API, web and extension) |
| Database | MongoDB Atlas (free tier) |
| Web | React, MUI, AG Grid, Apache ECharts |
| Extension | WXT + React (Manifest V3) |
| Tests and CI | Vitest, supertest, mongodb-memory-server, GitHub Actions |
| Hosting | Free tiers only: Render, GitHub Actions, MongoDB Atlas |

## Run it locally

Requirements: Node.js 24+, pnpm, and a free MongoDB Atlas cluster.

```bash
pnpm install
cp .env.example .env          # then set MONGODB_URI
pnpm db:ping                  # check the database connection
pnpm dev                      # API on http://localhost:3000 (GET /api/v1/health)
```

Checks: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.

## Repository layout

```text
apps/
  api/          NestJS REST API
  collector/    price collector and background jobs
packages/
  shared/       pure logic shared by the collector and the API
  contracts/    Zod schemas for every API request and response
```

The web app, the Chrome extension and the demo stores will be added under `apps/` as they are built.

## Data ethics

- Collects only public data: product title, price, list price, stock status and link. No reviews, images, descriptions or personal data.
- Respects robots.txt, identifies itself honestly, and sends one request at a time at a low rate. If a store blocks the crawler, it stops instead of working around it.
- Uses neutral wording backed by numbers and never ranks or names stores in published reports.
- Marketplaces (Shopee, Lazada, TikTok Shop) are out of scope.
