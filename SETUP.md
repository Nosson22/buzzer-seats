# Marlins Last-Minute Tickets — Setup Guide

## Prerequisites

- Node.js 18+
- PostgreSQL database
- Stripe account (test keys for dev)
- Cloudinary account (free tier works)

---

## Local Development

### 1. Install dependencies

```bash
npm install
```

> **Note:** If your network blocks `@types/estree` (corp firewall), run:
> ```bash
> curl -sL https://registry.npmjs.org/@types/estree/-/estree-1.0.6.tgz -o /tmp/estree.tgz
> curl -sL "https://registry.npmjs.org/@nolyfill/is-core-module/-/is-core-module-1.0.39.tgz" -o /tmp/nolyfill-is-core-module.tgz
> npm install
> ```

### 2. Environment variables

Copy `.env.example` to `.env.local` and fill in your values:

```bash
cp .env.example .env.local
```

Required variables:
| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `NEXTAUTH_SECRET` | Random 32+ char string (`openssl rand -base64 32`) |
| `NEXTAUTH_URL` | App URL (`http://localhost:3000` for dev) |
| `STRIPE_SECRET_KEY` | Stripe secret key (sk_test_...) |
| `STRIPE_PUBLISHABLE_KEY` | Stripe publishable key (pk_test_...) |
| `STRIPE_WEBHOOK_SECRET` | From `stripe listen` output (whsec_...) |
| `CLOUDINARY_CLOUD_NAME` | Your Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Same as STRIPE_PUBLISHABLE_KEY |
| `CRON_SECRET` | Random string to secure the cron endpoint |

### 3. Set up the database

```bash
# Push schema (dev — no migration history)
npm run db:push

# Or run migrations (production)
npm run db:migrate

# Seed with Marlins team, 4 games, and test accounts
npm run db:seed
```

Test accounts created by seed:
- **Admin:** `admin@marlinstickets.com` / `admin1234`
- **Seller:** `seller@example.com` / `seller1234`
- **Buyer:** `buyer@example.com` / `buyer1234`

### 4. Set up Stripe webhook (local)

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

Copy the `whsec_...` value into `NEXT_PUBLIC_STRIPE_WEBHOOK_SECRET` (and `STRIPE_WEBHOOK_SECRET`) in `.env.local`.

### 5. Set up Cloudinary upload preset

1. Log in to Cloudinary
2. Go to Settings → Upload → Upload Presets
3. Add preset named `marlins_tickets` (unsigned, folder: `ticket-verification`)

### 6. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## How the Platform Works

### Timing Logic
- Sellers can list tickets **any time before the game**
- Listings stay **INACTIVE** until exactly **1 hour before game time**
- The `/api/cron/activate-listings` endpoint runs every minute (via Vercel Cron in production) and:
  - **Activates** approved listings when the 1-hour window opens
  - **Expires** all active listings when the game starts
  - Updates game status: `UPCOMING → LIVE → FINISHED`

### Ticket Verification
- Sellers upload screenshots/barcode images when creating a listing
- Admins review images at `/admin` and approve or reject
- Only **APPROVED** listings go live during the window

### Payment Flow
1. Buyer places a bid on an active listing
2. Seller sees bids and clicks "Accept"
3. A Stripe Payment Intent is created (total sale amount)
4. Buyer is redirected to `/checkout` to pay via Stripe Elements
5. On success, Stripe webhook fires → transaction marked COMPLETED
6. Platform keeps 15% commission; seller receives 85% (manual payout or Stripe Connect)

### Commission
- Platform takes **15%** of each completed sale (`COMMISSION_RATE=0.15`)
- `sellerPayout = salePrice × 0.85`
- Change in `.env`: `COMMISSION_RATE=0.12` etc.

---

## Deploying to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel --prod
```

In Vercel dashboard:
1. Add all environment variables from `.env.example`
2. The `vercel.json` configures the cron job to run every minute automatically
3. Connect a PostgreSQL database (Vercel Postgres, Supabase, or Neon)

### Recommended database: Neon (free serverless PostgreSQL)

1. Create a project at [neon.tech](https://neon.tech)
2. Copy the connection string to `DATABASE_URL`
3. Run `npm run db:migrate` to apply schema

---

## Expanding to Other Miami Teams

To add the Miami Heat, Miami Dolphins, or Inter Miami:

```typescript
// Add a new team via admin API or prisma studio
await prisma.team.create({
  data: {
    name: "Miami Heat",
    slug: "heat",
    sport: "basketball",
    city: "Miami",
  }
});
```

Then add games for that team. The frontend filters by `team.slug` — all existing logic works for any team.

---

## File Structure

```
marlins-tickets/
├── app/
│   ├── page.tsx              # Home page
│   ├── games/[id]/           # Game detail + live listings
│   ├── listings/[id]/        # Listing detail + bid form
│   ├── sell/                 # Create listing (sellers)
│   ├── dashboard/            # User dashboard
│   ├── admin/                # Admin: verify tickets, stats
│   ├── login/ register/      # Auth pages
│   ├── checkout/             # Stripe payment
│   └── api/
│       ├── auth/             # NextAuth + registration
│       ├── games/            # Game CRUD
│       ├── listings/         # Listing CRUD + delist
│       ├── bids/             # Place bids + accept
│       ├── transactions/     # Transaction history
│       ├── upload/           # Image upload → Cloudinary
│       ├── admin/            # Admin stats + listing queue
│       ├── webhooks/stripe/  # Stripe webhook handler
│       └── cron/             # Auto-activate + expire listings
├── components/
│   ├── ui/                   # Button, Input, Badge, Navbar, Countdown
│   ├── listings/             # ListingCard
│   ├── games/                # GameCard
│   └── checkout/             # StripeCheckoutForm
├── lib/
│   ├── prisma.ts             # DB client
│   ├── auth.ts               # NextAuth config
│   ├── stripe.ts             # Stripe client + commission calc
│   ├── game-windows.ts       # 1-hour window logic
│   └── utils.ts              # Formatting helpers
├── prisma/
│   ├── schema.prisma         # Full DB schema
│   └── seed.ts               # Dev seed data
└── vercel.json               # Cron job config
```
