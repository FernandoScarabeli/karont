#!/bin/bash
# Executado pelo cloud-init SOMENTE no guest descartável, nunca no host.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl xz-utils git build-essential \
  libgtk-3-0 libnotify4 libnss3 libasound2t64 libgbm1 libxss1 libatk-bridge2.0-0 \
  python3-dbus xvfb xauth dbus-x11 openbox x11-utils apparmor-utils
node_version=v24.21.0
cd /tmp
curl -fLO "https://nodejs.org/dist/$node_version/node-$node_version-linux-x64.tar.xz"
curl -fLO "https://nodejs.org/dist/$node_version/SHASUMS256.txt"
grep "  node-$node_version-linux-x64.tar.xz$" SHASUMS256.txt | sha256sum --check -
tar -xJf "node-$node_version-linux-x64.tar.xz" -C /usr/local --strip-components=1
# Não instala helper SUID, não altera sysctl, AppArmor nem permissões do Electron.
touch /var/lib/karont-guest-ready
