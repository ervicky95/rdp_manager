# RDP Manager

Personal Windows VM management web app built with Next.js, TypeScript, Tailwind CSS, and Cloudflare Workers/D1.

## Features

- Manage 20–40 temporary Windows VMs
- Mobile-first responsive UI
- Dashboard with VM overview (CPU, RAM, disk, RDP status)
- VM actions: Restart, Shutdown, View Logs, Settings, Delete
- Cloudflare D1 database for persistence
- Outbound-only agent communication (no inbound ports)

## Tech Stack

| Component | Technology |
|-----------|------------|
| Web Framework | Next.js 15 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| Hosting | Cloudflare Workers |
| Database | Cloudflare D1 (SQLite) |
| Windows Agent | C# .NET 8 (future) |

## Getting Started

### Prerequisites

- Node.js 20+
- npm or yarn
- Wrangler CLI (`npm install -g wrangler`)
- .NET SDK 8.0 (for Windows agent)

### Installation

```bash
# Install dependencies
npm install

# Create local D1 database
npx wrangler d1 create rdp-manager-db

# Apply migrations locally
npx wrangler d1 migrations apply rdp-manager-db --local

# Start development server
npm run dev
```

### Development Commands

```bash
# Start Next.js dev server
npm run dev

# Start Cloudflare Workers dev server
npm run cf:dev

# Type checking
npm run type-check

# Linting
npm run lint

# Production build
npm run build

# Vinext build (for Cloudflare Workers deployment)
npm run build:vinext

# Deploy to Cloudflare (vinext)
npm run deploy:vinext

# Database commands
npm run cf:db:create      # Create remote D1 database
npm run cf:db:migrate     # Apply migrations to remote
npm run cf:db:migrate:local # Apply migrations locally
```

### Vinext Deployment Command

The exact vinext deployment command is:
```bash
vinext-cloudflare deploy --config dist/server/wrangler.json
```

This command is available via `npm run deploy:vinext` after running `npm run build:vinext`.

## D1 Database Instructions

### Local Development

Local D1 database is used during development. The database ID in `wrangler.jsonc` must remain the placeholder `<your-database-id>`.

```bash
# Apply migrations to local database
npm run cf:db:migrate:local
```

### Production Preparation

1. Create a production D1 database:
   ```bash
   npx wrangler d1 create rdp-manager-db
   ```

2. Update `wrangler.jsonc` with the production database ID (only for production deployment, never commit this change).

3. Apply migrations to production:
   ```bash
   npx wrangler d1 migrations apply rdp-manager-db
   ```

**Important:** Never commit a real database ID to version control. The placeholder `<your-database-id>` must remain in the committed `wrangler.jsonc`.

## Secret Management

### Required Secrets

The following secrets must be configured in Cloudflare Workers (via `wrangler secret put` or Cloudflare dashboard):

| Secret | Description |
|--------|-------------|
| `ADMIN_BOOTSTRAP_SECRET` | Temporary secret for first administrator setup. **Must be removed after first admin is created.** |
| `JWT_SECRET` | Secret for signing JWT session tokens. Generate with `openssl rand -base64 32`. |
| `ENROLLMENT_TOKEN_SECRET` | HMAC key for storing enrollment-token digests. Generate with `openssl rand -base64 32`. |
| `AGENT_CREDENTIAL_SECRET` | HMAC key for storing agent-credential digests. Generate with `openssl rand -base64 32`. |

### Setting Secrets

```bash
# Set secrets for production
npx wrangler secret put ADMIN_BOOTSTRAP_SECRET
npx wrangler secret put JWT_SECRET
npx wrangler secret put ENROLLMENT_TOKEN_SECRET
npx wrangler secret put AGENT_CREDENTIAL_SECRET

# For local development, create .dev.vars file (never commit)
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your local secret values
```

**Security note:** Enrollment tokens and agent credentials are never stored as
plaintext. The server keeps only HMAC-SHA256 digests, and the plaintext agent
credential is returned to the agent exactly once during enrollment. Neither is
ever exposed to the browser, and neither is written to logs.

### First Administrator Setup

1. Set `ADMIN_BOOTSTRAP_SECRET` in Cloudflare secrets or `.dev.vars`.
2. Navigate to `/setup` in the web app.
3. Enter the bootstrap secret and create the first administrator account.
4. **Immediately remove `ADMIN_BOOTSTRAP_SECRET` from secrets after setup.**
5. The bootstrap secret is single-use and expires after first admin creation.

## Windows Agent Installation

### Prerequisites

- Windows Server 2022, 2025, Azure Edition, Windows 10, or Windows 11
- .NET 8.0 Runtime (included in self-contained publish)
- Administrator privileges for installation

### Installation Steps

1. **Build the agent** (on Windows or via cross-compile):
   ```bash
   cd VickyVM.Agent
   dotnet publish -c Release -r win-x64 --self-contained true -o ./publish
   ```

2. **Copy the published files** to the target Windows VM (e.g., `C:\Program Files\VickyVM.Agent\`).

3. **Run the installer as Administrator**:
   ```powershell
   # From the publish directory
   .\install.ps1 -EnrollmentToken "YOUR_ENROLLMENT_TOKEN" -ServerUrl "https://your-worker.your-subdomain.workers.dev"
   ```

   The installer will:
   - Install the Windows Service
   - Configure automatic startup
   - Configure service recovery (restart on failure)
   - Start the service
   - The agent will enroll using the provided token

4. **Verify installation**:
   ```powershell
   Get-Service VickyVM.Agent
   # Should show Status: Running
   ```

### Uninstallation

```powershell
# Run as Administrator
.\uninstall.ps1
```

The uninstaller will:
- Stop the service
- Remove the service
- Remove only this application's files and configuration
- Never remove user files or Windows system files

### Agent Configuration

The agent reads configuration from `appsettings.json` in the installation directory:

```json
{
  "ServerUrl": "https://your-worker.your-subdomain.workers.dev",
  "PollIntervalSeconds": 60,
  "LogLevel": "Information",
  "DataDirectory": "C:\\ProgramData\\VickyVM.Agent",
  "EnrollmentTokenPath": "C:\\ProgramData\\VickyVM.Agent\\enrollment.token"
}
```

### Enrollment Behavior

1. **User adds a VM** — the server creates a temporary enrollment token (single-use, expires after 30 minutes).
2. **User runs `install.ps1 -EnrollmentToken ...` on Windows** — the installer writes the token to a permission-restricted file (`enrollment.token` in the data directory) and starts the service.
3. **Agent enrolls** — sends the token over HTTPS to `/api/agent/enroll`; the server validates it, creates the agent, and returns an agent credential **only to the agent**.
4. **Agent stores the credential** — protected with DPAPI on Windows.
5. **Agent polls** every ~60 seconds over HTTPS with the credential. Polling is lightweight: it only exchanges allowlisted commands and compact events (no CPU/RAM/disk/RDP metrics). Full status is user-triggered and is outside this phase.
6. The enrollment token is consumed on use; the plaintext credential is never stored or logged.

### Security Properties

- Enrollment tokens are single-use and expiring; the server stores only their digest.
- Agent credentials are stored only as digests and returned exactly once.
- Agent credentials are never exposed to the browser and never logged.
- Windows passwords and Azure credentials are never stored.

### Local Maintenance (Agent)

The agent runs a safe local maintenance task automatically:

- **Frequency**: Maximum 2 runs per 24 hours (12-hour minimum interval)
- **Grace period**: 15 minutes after service start before first run
- **Timeout**: 60 seconds maximum per run
- **Scope**: Only cleans agent-owned directories under `DataDirectory`:
  - `Logs/` — agent log files older than 30 days
  - `Temp/` — temporary files (`*.tmp`, `*.temp`) older than 7 days
  - `Cache/` — cache files (`*.cache`) older than 14 days
- **Safety**: Never deletes user files (Documents, Downloads, Desktop, etc.), databases, Windows system files, or files outside approved directories. Never kills processes — only logs high-resource processes for operator review.

## Safe Testing Instructions

### Local Development Testing

1. **Web App Only** (no agent):
   ```bash
   npm run dev
   # Visit http://localhost:3000
   ```

2. **With Local Worker** (simulates Cloudflare Workers):
   ```bash
   npm run cf:dev
   # Visit http://localhost:8787
   ```

3. **With Vinext** (full Cloudflare Workers simulation):
   ```bash
   npm run dev:vinext
   # Visit http://localhost:3001
   ```

### Agent Testing (Windows VM Required)

1. **Unit Tests** (cross-platform):
   ```bash
   cd VickyVM.Agent
   dotnet test
   ```

2. **Integration Testing** (requires Windows):
   - Deploy web app to Cloudflare Workers (staging)
   - Create enrollment token in web dashboard
   - Install agent on test Windows VM
   - Verify enrollment, polling, commands, health monitoring

3. **Manual Test Checklist**:
   - [ ] Agent installs as Windows Service
   - [ ] Service starts automatically on boot
   - [ ] Service recovers after crash
   - [ ] Agent enrolls with valid token
   - [ ] Agent rejects invalid/expired token
   - [ ] Agent polls every ~60 seconds
   - [ ] Restart command executes
   - [ ] Shutdown command executes
   - [ ] Status command returns fresh metrics
   - [ ] RDP health check works
   - [ ] RDP recovery restarts TermService/UmRdpService
   - [ ] Safe maintenance runs (max 2x/24h)
   - [ ] Logs rotate (30-day retention)
   - [ ] Delete removes only app data

### Security Testing

- Verify no inbound ports opened by agent
- Verify outbound HTTPS only
- Verify enrollment tokens are single-use
- Verify agent credentials never exposed to browser
- Verify passwords never stored in plain text
- Verify rate limiting on restart/shutdown

## Project Structure

```
src/
├── app/
│   ├── api/vms/           # REST API routes
│   │   ├── route.ts       # GET/POST /api/vms
│   │   ├── [id]/route.ts  # GET/DELETE /api/vms/:id
│   │   ├── [id]/logs/     # GET /api/vms/:id/logs
│   │   ├── [id]/settings/ # GET/PUT /api/vms/:id/settings
│   │   ├── [id]/restart/  # POST /api/vms/:id/restart
│   │   └── [id]/shutdown/ # POST /api/vms/:id/shutdown
│   ├── dashboard/         # Dashboard page
│   ├── login/             # Login page
│   └── page.tsx           # Home page
├── components/
│   ├── ui/                # Reusable UI components
│   ├── Header.tsx
│   ├── VMCard.tsx
│   ├── VMList.tsx
│   └── ...
├── lib/
│   ├── db/                # Database layer
│   │   ├── client.ts
│   │   └── vm.ts          # VM repository
│   └── mock-data.ts       # Mock data for UI development
├── types/
│   ├── vm.ts              # VM types
│   └── db.ts              # Database types
├── worker/                # Cloudflare Worker entry
└── globals.css
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/vms` | List all VMs |
| POST | `/api/vms` | Create new VM |
| GET | `/api/vms/:id` | Get VM details |
| DELETE | `/api/vms/:id` | Delete VM record (UI only) |
| GET | `/api/vms/:id/logs` | Get VM logs |
| GET | `/api/vms/:id/settings` | Get VM settings |
| PUT | `/api/vms/:id/settings` | Update VM settings |
| POST | `/api/vms/:id/restart` | Queue restart command |
| POST | `/api/vms/:id/shutdown` | Queue shutdown command |
| GET | `/api/health` | Lightweight health check (used by the agent ping) |
| POST | `/api/agent/enroll` | Agent enrolls with a single-use enrollment token, receives a credential |
| POST | `/api/agent/poll` | Agent polls with its credential; receives allowlisted commands and compact events |
| POST | `/api/vms/:id/enrollment-token` | Re-mint an enrollment token for an existing VM |

## Database Schema

### Tables

- **vms** — VM inventory with metrics (CPU, RAM, disk, RDP status)
- **vm_settings** — Per-VM monitoring thresholds and options
- **logs** — Agent and system logs
- **commands** — Pending/queued commands (restart, shutdown)
- **enrollment_tokens** — Temporary enrollment tokens
- **agents** — Registered agents with credentials
- **audit_logs** — Audit trail for sensitive operations
- **sessions** — User sessions

### Key Constraints

- `DELETE /api/vms/:id` only removes the web-app record — never contacts the VM or Azure
- Restart/Shutdown create pending commands in D1; agent executes on next poll
- All queries use parameterized statements

## Security

- No Azure API, credentials, or SDKs
- Agent communicates via outbound HTTPS only
- No inbound management ports
- No arbitrary command execution
- No security evasion techniques
- Enrollment tokens are single-use and expire
- Agent credentials protected via DPAPI on Windows
- Secure session cookies (HttpOnly, SameSite, Secure)
- Rate limiting on sensitive operations
- 30-day log retention with automatic cleanup

## License

Private project — not for distribution.