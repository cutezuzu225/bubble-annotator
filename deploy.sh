#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
REPO="${REPO:-superfive}"
KEY="${KEY:-~/Downloads/bd-key.pem}"
REMOTE_HOST="157.10.162.22"
REMOTE_USER="ubuntu"
IMAGE_NAME="${REPO}/bubble"
CONTAINER_NAME="bubble-app"
TIMESTAMP=$(date +%Y%m%d%H%M%S)
IMAGE_TAG="${IMAGE_NAME}:${TIMESTAMP}"

SSH="ssh -i ${KEY} -o StrictHostKeyChecking=no ${REMOTE_USER}@${REMOTE_HOST}"
SCP="scp -i ${KEY} -o StrictHostKeyChecking=no"

echo "==> Building and pushing image: ${IMAGE_TAG}"
docker buildx build --platform linux/amd64 -t "${IMAGE_TAG}" . --push

echo "==> Removing running container and old images on remote"
${SSH} bash <<EOF
  sudo docker stop ${CONTAINER_NAME} 2>/dev/null || true
  sudo docker rm   ${CONTAINER_NAME} 2>/dev/null || true
  sudo docker images "${IMAGE_NAME}" -q | xargs -r sudo docker rmi -f
EOF

echo "==> Pulling new image on remote: ${IMAGE_TAG}"
${SSH} sudo docker pull "${IMAGE_TAG}"

echo "==> Starting container on remote (port 5001)"
${SSH} sudo docker run -d \
  --name "${CONTAINER_NAME}" \
  --restart unless-stopped \
  -p 5001:5001 \
  "${IMAGE_TAG}"

echo "==> Uploading nginx config"
${SCP} nginx.conf "${REMOTE_USER}@${REMOTE_HOST}:/tmp/bubble-annotate.conf"
${SSH} sudo mv /tmp/bubble-annotate.conf /etc/nginx/sites-available/bubble-anotate.superfive.org.conf

echo "==> Uploading static frontend files"
${SSH} sudo mkdir -p /var/www/bubble

# Resolve hashed filenames from the local repo
APP_JS=$(ls app-*.js)
STYLES_CSS=$(ls styles-*.css)

# Clear all old static files so stale hashed versions don't accumulate
${SSH} bash <<EOF
  sudo find /var/www/bubble -maxdepth 1 \( -name "*.html" -o -name "*.js" -o -name "*.css" \) -delete
EOF

# Upload hashed assets + index.html
${SCP} index.html               "${REMOTE_USER}@${REMOTE_HOST}:/tmp/index.html"
${SCP} "${APP_JS}"              "${REMOTE_USER}@${REMOTE_HOST}:/tmp/${APP_JS}"
${SCP} "${STYLES_CSS}"          "${REMOTE_USER}@${REMOTE_HOST}:/tmp/${STYLES_CSS}"
${SSH} bash <<EOF
  sudo mv /tmp/index.html       /var/www/bubble/index.html
  sudo mv /tmp/${APP_JS}        /var/www/bubble/${APP_JS}
  sudo mv /tmp/${STYLES_CSS}    /var/www/bubble/${STYLES_CSS}
EOF

echo "==> Reloading nginx"
${SSH} sudo nginx -s reload

echo "==> Done. Deployed ${IMAGE_TAG}"
