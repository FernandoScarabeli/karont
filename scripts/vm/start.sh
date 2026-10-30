#!/bin/bash
# Lança SOMENTE uma VM; sem sudo, mounts do host ou mudanças de segurança.
# Requer imagem qcow2 já verificada e ferramentas QEMU/genisoimage disponíveis.
set -euo pipefail
umask 077
image=$(realpath "${1:?Uso: start.sh imagem-verificada.qcow2 [diretorio-local]}")
state=${2:-benchmarks/tmp/vm-repro}
mkdir -p "$state"
state=$(realpath "$state")
tools=${KARONT_QEMU_PREFIX:-/usr}
qemu="$tools/bin/qemu-system-x86_64"
img="$tools/bin/qemu-img"
iso="$tools/bin/genisoimage"
export LD_LIBRARY_PATH="$tools/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
test -r /dev/kvm && test -w /dev/kvm
for executable in "$qemu" "$img" "$iso"; do test -x "$executable"; done
if test ! -f "$state/id_ed25519"; then ssh-keygen -q -t ed25519 -N '' -f "$state/id_ed25519"; fi
python3 - "$state" "$(dirname "$0")/provision-guest.sh" <<'PY'
import pathlib,sys
p=pathlib.Path(sys.argv[1]); script=pathlib.Path(sys.argv[2]).read_text()
key=(p/'id_ed25519.pub').read_text().strip()
(p/'user-data').write_text('#cloud-config\nusers:\n  - name: karont\n    shell: /bin/bash\n    lock_passwd: true\n    ssh_authorized_keys:\n      - '+key+'\ndisable_root: true\nssh_pwauth: false\nwrite_files:\n  - path: /root/karont-provision.sh\n    permissions: "0700"\n    content: |\n'+''.join('      '+l+'\n' for l in script.splitlines())+'runcmd:\n  - [bash, /root/karont-provision.sh]\n')
(p/'meta-data').write_text('instance-id: karont-spec001\nlocal-hostname: karont-spec001\n')
PY
"$iso" -quiet -output "$state/seed.iso" -volid CIDATA -joliet -rock "$state/user-data" "$state/meta-data"
if test ! -f "$state/guest.qcow2"; then
  "$img" create -f qcow2 -F qcow2 -b "$image" "$state/guest.qcow2" 24G
fi
# Serial, porta SSH e chave privados ao ensaio; sem bridge nem guest access ao repo.
# A janela de teste é Xvfb DENTRO do guest. O vídeo virtual padrão é necessário no boot.
exec "$qemu" -enable-kvm -cpu host -smp 2 -m 4096 \
  -L "$tools/share/seabios" -bios "$tools/share/seabios/bios-256k.bin" \
  -drive "file=$state/guest.qcow2,if=virtio,format=qcow2" \
  -drive "file=$state/seed.iso,media=cdrom,readonly=on" \
  -netdev user,id=net0,hostfwd=tcp:127.0.0.1:22220-:22 \
  -device virtio-net-pci,netdev=net0,romfile= -display none \
  -serial "file:$state/serial.log" -monitor none -no-reboot
