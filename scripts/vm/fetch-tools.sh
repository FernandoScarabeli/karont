#!/bin/bash
# Ubuntu amd64: baixa/extrai pacotes usando os índices APT já configurados.
# Não instala pacotes, não executa maintainer scripts e não usa sudo.
set -euo pipefail
umask 077
state=${1:-benchmarks/tmp/vm-repro}
mkdir -p "$state/packages" "$state/tools"
state=$(realpath "$state")
(
  cd "$state/packages"
  apt-get download genisoimage ipxe-qemu libaio1t64 libcacard0 libdaxctl1 \
    libfdt1 libmpathcmd0 libmpathpersist0 libmultipath0 libndctl6 libpmem1 \
    librdmacm1t64 libslirp0 libusbredirparser1t64 qemu-system-common \
    qemu-system-data qemu-system-x86 qemu-utils seabios
  for package in ./*.deb; do
    dpkg-deb -x "$package" "$state/tools"
    dpkg-deb -f "$package" Package Version
  done > "$state/tool-packages.txt"
)
LD_LIBRARY_PATH="$state/tools/usr/lib/x86_64-linux-gnu" \
  "$state/tools/usr/bin/qemu-system-x86_64" --version
