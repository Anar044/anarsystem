#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/opt/smarthoreca-zkteco-gateway
ENV_DIR=/etc/smarthoreca
SERVICE_NAME=smarthoreca-zkteco-gateway

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20+ is required before running this installer."
  exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Node.js 20+ required; found $(node -v)"
  exit 1
fi

sudo mkdir -p "$APP_DIR" "$APP_DIR/data" "$ENV_DIR"
sudo cp -r src package.json config.example.json "$APP_DIR"/

if [ ! -f "$APP_DIR/config.json" ]; then
  sudo cp "$APP_DIR/config.example.json" "$APP_DIR/config.json"
fi

if [ ! -f "$ENV_DIR/zkteco-gateway.env" ]; then
  sudo cp deploy/zkteco-gateway.env.example "$ENV_DIR/zkteco-gateway.env"
  sudo chmod 600 "$ENV_DIR/zkteco-gateway.env"
  echo "Created $ENV_DIR/zkteco-gateway.env — replace ZK_GATEWAY_ADMIN_KEY before production use."
fi

sudo chown -R www-data:www-data "$APP_DIR"
sudo cp deploy/smarthoreca-zkteco-gateway.service "/etc/systemd/system/$SERVICE_NAME.service"
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

sleep 1
curl -fsS http://127.0.0.1:8088/health || true
echo
echo "Gateway service installed."
echo "Next: configure Nginx/DNS and set matching ZK_GATEWAY_URL + ZK_GATEWAY_ADMIN_KEY in SmartHoreca server environment."
