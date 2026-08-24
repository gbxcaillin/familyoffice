# Deploying to office.gbxps.com

The app runs on a small VPS with Docker. Caddy handles HTTPS automatically.
Total cost: roughly AU$10/month for the server. Everything else is free.

## What you need to sign up for

1. **A VPS provider** — one of:
   - [Binary Lane](https://www.binarylane.com.au) — Australian, billed in AUD,
     Sydney zone. Pick a plan with **2GB RAM** (~AU$8/mo).
   - [DigitalOcean](https://www.digitalocean.com) — Sydney region `SYD1`,
     Basic Droplet, **2GB RAM** (~US$12/mo).
   - [Vultr](https://www.vultr.com) — Sydney region, 2GB RAM (~US$10/mo).

   2GB RAM matters: the Next.js build inside Docker needs it. When creating
   the server choose **Ubuntu 24.04 LTS** and add your SSH key.

That's the only signup. The domain (VentraIP) and repo (GitHub) you already
have; HTTPS certificates come free from Let's Encrypt via Caddy.

## One-time server setup

SSH in as root, then:

```bash
# 1. Install Docker
curl -fsSL https://get.docker.com | sh

# 2. Basic firewall
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable

# 3. Get the code (create a fine-grained GitHub personal access token with
#    read access to this repo: github.com/settings/personal-access-tokens)
git clone https://github.com/gbxcaillin/familyoffice.git
cd familyoffice

# 4. Configure secrets
cp .env.production.example .env.production
openssl rand -base64 48   # paste the output as JWT_SECRET
nano .env.production
```

## Passwords

Generate a bcrypt hash for each of your passwords (run on the server):

```bash
docker run --rm node:22-slim bash -c \
  "npm install --no-save bcryptjs >/dev/null 2>&1 && \
   node -e \"console.log(require('bcryptjs').hashSync(process.argv[1], 12))\" -- \"\$0\"" \
  'your-strong-password-here'
```

Put the resulting `$2b$12$...` strings into `.env.production` as
`USER1_PASSWORD_HASH` / `USER2_PASSWORD_HASH`. Use strong, unique passwords —
this will be on the public internet.

## DNS (VentraIP VIPControl)

Add one record to the gbxps.com zone:

| Type | Hostname            | Value          | TTL  |
|------|---------------------|----------------|------|
| A    | office.gbxps.com | your server IP | 3600 |

## Launch

```bash
cd ~/familyoffice
docker compose up -d --build
```

First build takes a few minutes. Once DNS has propagated, Caddy fetches the
HTTPS certificate automatically on the first request. Visit
https://office.gbxps.com and log in.

## Backups

```bash
chmod +x deploy/backup.sh
crontab -e
# add this line (3am nightly, keeps 14 days):
0 3 * * * /root/familyoffice/deploy/backup.sh >> /var/log/familyoffice-backup.log 2>&1
```

Backups land in `deploy/backups/`. Periodically copy one off the server
(e.g. `scp` to your laptop) — a backup on the same machine doesn't protect
against the server itself dying.

## Updating the app

```bash
cd ~/familyoffice
git pull
docker compose up -d --build
```

Data is untouched by updates: the database and uploads live in `data/` and
`uploads/` on the host, mounted into the container.

## Moving your existing data up

The database you've built locally can be copied straight to the server:

```bash
scp data/familyoffice.db root@YOUR_SERVER_IP:~/familyoffice/data/
scp -r uploads/* root@YOUR_SERVER_IP:~/familyoffice/uploads/  # if any
docker compose restart app
```

## Security notes

- Login is rate limited: 5 failed attempts per IP triggers a 15-minute lockout.
- Caddy adds HSTS and other hardening headers; all traffic is HTTPS.
- The app container runs as a non-root user; the database is never in the
  Docker image or the git repo.
- Keep the server patched: `apt update && apt upgrade` occasionally, or enable
  unattended-upgrades.
