This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

For the production server, set `APP_ORIGIN` to the browser-facing URL when Atlas
is served on a public hostname. WebSocket upgrades use `WS_ALLOWED_ORIGINS` (a
comma-separated list), then `APP_ORIGIN`, then `APP_URL`. Without those settings,
only loopback HTTP origins on `APP_PORT` are accepted.

Mount the same persistent attachment volume at `UPLOAD_DIR` (default `/app/uploads`)
on every application replica for a given Atlas database. Use a separate volume for
each database, run all replicas with the same filesystem identity, and ensure the
volume supports atomic renames. The server janitor reconciles unreferenced files and
abandoned uploads after a 24-hour grace period. Run the database migrations before
enabling the updated server.

For `POST /api/attachments`, send the multipart `task_id` field before the `file`
part so Atlas can authorize the target before storing upload bytes.

Approval tasks support one approver, decisions, requested changes, resubmission,
targeted inbox notifications, and decision history. See [approval tasks](docs/task-approvals.md)
for permissions, migration `0016`, and the dedicated disposable regression command
`bash tests/p0-regressions.sh approval`.

## Disposable end-to-end tests

Run `bash tests/run-e2e.sh` with Docker Compose, Node.js 24, Python 3, curl, and OpenSSL installed.
For the browser suite, install dependencies with `npm ci` and `npx playwright install chromium`,
then run `bash tests/run-e2e.sh browser`. Each command seeds a new PostgreSQL instance and
removes its test stack when it exits. The suites and the backup and restore scripts require
that stack's identity and verify that HTTP and SQL use the same database before proceeding.

To repeat the membership lookup race cases in an isolated environment, use:

```bash
bash tests/run-e2e.sh timeline-stability          # 50 repetitions, 4 workers
bash tests/run-e2e.sh timeline-stability 100 1    # sequential repetitions
bash tests/run-e2e.sh timeline-stability 100 4    # parallel repetitions
```

The repetition count applies to each of the three cases: cancelled requests,
late responses from a transport that ignores cancellation, and delayed client
hydration before opening the picker. The repetition count
must be 1–500 and the worker count 1–8. This mode uses the
same database/HTTP isolation checks, keeps retries disabled and the normal test
timeout, and removes only its newly created stack on exit. Browser artifacts are
saved in `test-results/<suite>-<stack-name>` so later runner invocations do not
overwrite earlier failure traces. Run `bash tests/run-e2e.sh browser` separately
for the complete browser regression suite.

To repeat the project deletion / automation concurrency regressions, use:

```bash
bash tests/p0-regressions.sh project-delete       # one repetition
bash tests/p0-regressions.sh project-delete 100   # 100 repetitions
```

The repetition count must be 1–500. The suite contains 14 test groups, with
16 controlled interleavings per repetition plus one lock-timeout/recovery case
per run (`16 × repetitions + 1`). It creates and removes only its own disposable
stack; it must not be pointed at an existing database. These cases also run once
in the `integrity` and `all` modes. See [automation locking and rollout notes](docs/automation-rules.md#プロジェクト削除との排他制御)
before applying the application update to an existing environment.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
