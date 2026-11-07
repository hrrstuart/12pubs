#!/usr/bin/env bash
# One-time setup on a fresh Ubuntu 24.04 Lightsail instance.
# Run from inside the cloned repo:   bash deploy/setup.sh 12pubs.ie
set -euo pipefail

DOMAIN="${1:-12pubs.ie}"
cd "$(dirname "$0")/.."

echo "==> Installing Node.js 22"
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

echo "==> Installing Caddy (HTTPS + reverse proxy)"
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list > /dev/null
sudo apt-get update
sudo apt-get install -y caddy

echo "==> Installing pm2"
sudo npm install -g pm2

echo "==> Installing the app"
npm ci --omit=dev
# Password for the private stats page at https://$DOMAIN/stats (kept outside the repo)
KEYFILE="$HOME/.12pubs-stats-key"
[ -f "$KEYFILE" ] || openssl rand -hex 12 > "$KEYFILE"
chmod 600 "$KEYFILE"
export STATS_KEY="$(cat "$KEYFILE")"
pm2 start deploy/ecosystem.config.cjs
pm2 save
sudo env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$USER" --hp "$HOME"

echo "==> Pointing Caddy at the app for $DOMAIN"
sed "s/12pubs\.ie/$DOMAIN/g" deploy/Caddyfile | sudo tee /etc/caddy/Caddyfile > /dev/null
sudo systemctl reload caddy

echo
echo "Done. If DNS for $DOMAIN points at this server, https://$DOMAIN is live in a minute or two."
echo "Check the app:  curl -s localhost:3000/healthz"
echo "Logs:           pm2 logs 12pubs"
echo "Stats:          https://$DOMAIN/stats  (any username, password: $STATS_KEY)"
echo "                The password is saved in $KEYFILE"
