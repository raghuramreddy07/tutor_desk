# TutorDesk

TutorDesk is a multi-tenant tutoring-center management API built with Express,
TypeScript, Prisma, and PostgreSQL. Redis and BullMQ power background jobs.

## Requirements

- Node.js 22
- Docker Compose (for local PostgreSQL and Redis)

## Local setup

1. Copy `.env.example` to `.env` and set local-only secrets. Do not commit `.env`
   or share secret values in chat.
2. Install dependencies and start the database and Redis:

   ```powershell
   npm ci
   docker compose up -d db redis
   ```

3. Start the API and worker with the application Compose profile:

   ```powershell
   docker compose --profile application up --build
   ```

   The API container provisions the restricted `tutordesk_app` database role,
   applies migrations, and then starts the API. The worker starts after the API
   is ready.
4. Check the API:

   ```powershell
   Invoke-RestMethod http://localhost:3000/health
   Invoke-RestMethod http://localhost:3000/ready
   ```

   OpenAPI/Swagger documentation is available at
   `http://localhost:3000/docs` when `ENABLE_DOCS=true`.

To run the test suite, make sure PostgreSQL and Redis are available, the
environment variables from `.env.example` are configured, and the test
database has already been migrated using its database-owner connection. Then
run:

```powershell
npx vitest run
```

## Demo data

The demo seed creates a center, owner, teacher, parent, three students, a class,
attendance, and exam results. It is idempotent and is intended for local or
disposable environments only. It refuses to run when `NODE_ENV=production`.

Set a password locally (at least eight characters), explicitly confirm the
seed, and run it:

```powershell
$env:DEMO_PASSWORD = "choose-a-local-demo-password"
$env:DEMO_SEED_CONFIRM = "true"
npm run db:seed:demo
```

The demo owner email defaults to `owner@demo.tutordesk.local`. You can change
it with `DEMO_OWNER_EMAIL`; `DEMO_CENTER_NAME` changes the center's name. All
three demo accounts use the supplied `DEMO_PASSWORD`. Keep the password local;
do not use a production credential or seed a production database.

## API overview

- `POST /auth/signup-center` and `POST /auth/login` — account and session
- `GET /me` — current account and center (Bearer token required)
- `/students`, `/batches`, `/attendance`, and `/exams` — tutoring operations
- `/fee-plans`, `/students/:id/fees`, `/fees`, and `/payments` — fees and
  payment ledger
- `/notifications`, `/jobs`, and `/audit-logs` — operational endpoints
- `GET /health` — process liveness
- `GET /ready` — PostgreSQL and Redis readiness
- `/docs` — Swagger UI when enabled

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the Render Blueprint and
deployment smoke test.
