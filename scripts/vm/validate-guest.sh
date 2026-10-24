#!/bin/bash
# Executar como usuário comum dentro da VM, na raiz do checkout.
set -euo pipefail
if test "$(id -u)" = 0; then echo 'Não execute Electron como root.' >&2; exit 1; fi
npm ci
npm run check
npm test
npm run sandbox:diagnose
export EROS_TEST_ENVIRONMENT="Debian13 QEMU10 KVM 2vCPU 4GiB Xvfb1440x1000x24 DBus software-GPU; host workloads uncontrolled"
xvfb-run -a -s '-screen 0 1440x1000x24' dbus-run-session -- bash -euc '
  npm run test:desktop
  EROS_TEST_NOTIFICATIONS=1 npm run test:e2e
  npm run benchmark:series
'
npm run benchmark
npm run benchmark:report
