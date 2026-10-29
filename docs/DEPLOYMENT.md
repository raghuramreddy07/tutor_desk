# Deployment

TutorDesk includes a Render Blueprint in [`render.yaml`](../render.yaml). It
defines the API web service, background worker, managed PostgreSQL database,
and Key Value (Redis) instance.

## Render setup

1. Push the repository to a Git provider supported by Render and create a
   Blueprint from the repository, selecting `render.yaml`.
2. Review the service and database plans shown by Render before applying the
   Blueprint; these resources may incur charges.
3. The Blueprint generates `JWT_SECRET` and `TUTORDESK_APP_PASSWORD` in a
   shared secret environment group. Keep both values private. Do not put
   credentials in source control or paste them into chat.
4. After the API service is created, confirm its public URL in the Render
   dashboard. Set `APP_URL` and `CORS_ORIGINS` on both the API and worker to
   that exact HTTPS origin (without a trailing slash), replacing the example
   `https://tutordesk-api.onrender.com` if Render assigned a different
   hostname. Set `CORS_ORIGINS` to the frontend origin or comma-separated
   frontend origins when a separate frontend is deployed.
5. Deploy the API. Its pre-deploy command runs `prisma migrate deploy` against
   the database owner connection and then runs
   `scripts/provision-app-role.cjs`. The script provisions the restricted
   `tutordesk_app` role and grants only the required table privileges. At
   runtime, the API and worker use
   `scripts/set-app-database-url.cjs` to build their application connection
   URL from the database URL and generated role password. Do not change
   `DATABASE_URL`, `DIRECT_URL`, or `TUTORDESK_APP_PASSWORD` without reviewing
   this flow.
6. Confirm the API health check uses `/ready`, and that both the API and worker
   have started successfully. The worker needs the same PostgreSQL, Redis, and
   secret environment settings as the API.

The application requires a strong, non-placeholder `JWT_SECRET`, at least one
valid non-wildcard origin in `CORS_ORIGINS`, and database and Redis URLs. The
Blueprint sets production mode, enables the trusted proxy setting for Render,
and disables public API docs by default. Enable docs only if you intend to
expose them.

## Deployment smoke test

Run these commands in PowerShell. Replace the base URL with the API's actual
Render URL. The signup creates a new center and owner account, so use a unique
email for each run.

```powershell
$baseUrl = "https://your-api.onrender.com"

Invoke-RestMethod "$baseUrl/health"
Invoke-RestMethod "$baseUrl/ready"

$email = "smoke-$([guid]::NewGuid().ToString('N'))@example.test"
$password = "local-smoke-password-change-me"
$signupBody = @{
  name = "Deployment Smoke Test"
  email = $email
  password = $password
  centerName = "Deployment Smoke Test Center"
} | ConvertTo-Json

$signup = Invoke-RestMethod `
  -Method Post `
  -Uri "$baseUrl/auth/signup-center" `
  -ContentType "application/json" `
  -Body $signupBody

$me = Invoke-RestMethod `
  -Method Get `
  -Uri "$baseUrl/me" `
  -Headers @{ Authorization = "Bearer $($signup.accessToken)" }

$me
```

Expected results:

- `/health` returns `status: "ok"`.
- `/ready` returns HTTP 200 and both `database` and `redis` checks are `true`.
- Signup returns HTTP 201 with an `accessToken`.
- `/me` returns the created user, center, and `OWNER` role.

Do not use a real person's personal details for smoke-test data. Remove
temporary smoke-test accounts using the application's supported account
management process; do not delete tenant data directly from PostgreSQL.

## Demo seed

The demo seed is intended only for local or disposable non-production
databases. See [the README](../README.md#demo-data) for opt-in instructions.
It refuses to run when `NODE_ENV=production`; do not weaken that guard or run
demo seeding on a production database.
