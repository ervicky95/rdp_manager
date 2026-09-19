# PROJECT_SPEC.md — Personal Windows VM Management Web App

## Overview
A personal web application to manage temporary Windows VMs (20–40 VMs). The app runs on Cloudflare Workers with D1 database. A C# .NET 8 Windows agent runs on each VM and communicates outbound via HTTPS only.

---

## Technology Stack

| Component | Technology |
|-----------|------------|
| Web Framework | Next.js (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| Hosting | Cloudflare Workers |
| Database | Cloudflare D1 (SQLite) |
| Windows Agent | C# .NET 8 |

---

## Permanent Requirements

### Infrastructure & Networking
- **No Azure API** — The web app must not call Azure APIs.
- **No Azure credentials** — The web app must not store or use Azure credentials.
- **No Azure SDK** — The web app must not reference Azure SDKs.
- **Agent communication** — Windows agent communicates with web app through **outbound HTTPS only**.
- **No inbound management port** — The agent must not listen on any port for management.
- **Supported Windows versions** — Agent must work on:
  - Windows Server 2022
  - Windows Server 2025
  - Windows Server Azure Edition
  - Windows 10 (where supported)
  - Windows 11 (where supported)
- **Same installer for every VM** — Single installer package works across all supported versions.

### UI/UX
- **Mobile-first** — Responsive design, works on phone screens first.
- **Scale** — Manage 20–40 temporary VMs.

### VM Lifecycle — Critical Definitions
| Action | Meaning |
|--------|---------|
| **Restart** | Reboot the Windows VM **through the agent** (agent initiates OS reboot). |
| **Shutdown** | Shut down Windows **through the agent** (agent initiates OS shutdown). |
| **Delete** | **ONLY** delete the VM record from this web application's database/UI. Must **never** contact the VM. Must **never** affect Azure or any external infrastructure. |

### Operational Constraints
- **No automatic VM reboot or shutdown** — The web app must never automatically reboot or shut down VMs.
- **RDP health monitored independently** — RDP connectivity health checks must be separate from RDP login attempts.
- **Agent survives RDP issues** — Agent must continue working when RDP is stuck at "Configuring remote session" or similar states.

### Security — Absolute Prohibitions
- **Never execute arbitrary commands** received from the web UI.
- **Never implement** Defender bypass, stealth techniques, hidden persistence, or any security evasion.
- The agent only executes a **pre-defined, allowlisted set of actions** (restart, shutdown, health reporting, config updates).

---

## Out of Scope for This Phase
- Windows agent implementation (C# .NET 8)
- Database functionality / D1 schema / migrations
- Authentication / authorization
- VM creation / provisioning logic
- RDP connection handling
- Health check scheduling

---

## Phase 1 Deliverables (This Phase)
- [x] PROJECT_SPEC.md
- [ ] Next.js + TypeScript + Tailwind CSS configured
- [ ] Cloudflare Workers + D1 basic structure (wrangler.toml, types)
- [ ] Basic responsive homepage
- [ ] README.md with local development commands
- [ ] `npm install` and `npm run build` succeed

---

## Phase 2.5 Approved RDP and Safe Maintenance Changes

### RDP Checking
- No RDP check every minute.
- Automatic local RDP checks are maximum two times in 24 hours.
- Manual Get Status and Check RDP actions are available in the web dashboard.
- Automatic checks do not upload full CPU, RAM, disk, and RDP metrics.

### RDP Recovery
- RDP recovery checks TermService, waits approximately 15 seconds, checks again, and may restart UmRdpService once if still unhealthy.
- Never reboot or shut down the VM automatically for RDP recovery.
- Never change firewall rules automatically.

### Safe Maintenance
- Safe maintenance may run maximum two times in 24 hours.
- Safe maintenance may clean only approved temporary files and old agent-owned logs.
- Never delete user data, application data, databases, Windows system files, or Recycle Bin data.
- Never close random applications.
- Never kill arbitrary processes or Windows system processes.
- Record high CPU and RAM processes instead of killing them.
- The agent must start after Windows reboot and recover after service failure.