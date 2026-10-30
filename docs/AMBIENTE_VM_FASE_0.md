# SPEC-001 — ambiente Linux separado

A VM usada é descartável, com kernel próprio, **Debian 13 genericcloud**, QEMU 10.2.1/KVM, 2 vCPUs e 4096 MiB. O host Ubuntu mantém AppArmor e os três sysctls restritivos originais. Não há container privilegiado, montagem de diretórios do host, helper SUID instalado ou exceção AppArmor. Rede NAT de usuário, SSH somente em `127.0.0.1:22220`, chave exclusiva em diretório ignorado pelo Git. O acesso pré-existente a `/dev/kvm` foi suficiente.

O vídeo padrão do QEMU e o firmware SeaBIOS precisam estar disponíveis. A tentativa inicial com `-vga none` encerrou antes de completar o boot com KVM; TCG não chegou ao SSH durante a janela observada. A configuração com vídeo padrão/ROMs localizadas iniciou normalmente. Isso não foi uma falha do Electron. O QEMU extraído pode avisar sobre `kvmvapic.bin` ausente; o guest iniciou e reportou KVM. Não se recomenda usar TCG para comparar desempenho com estas rodadas.

## Reprodução

No host Ubuntu amd64, com índices APT confiáveis já configurados, QEMU existente ou pacotes disponíveis para download e acesso a KVM:

```bash
bash scripts/vm/fetch-tools.sh
mkdir -p benchmarks/tmp/vm-repro
cd benchmarks/tmp/vm-repro
curl -fLO https://cloud.debian.org/images/cloud/trixie/latest/debian-13-genericcloud-amd64.qcow2
curl -fLO https://cloud.debian.org/images/cloud/trixie/latest/SHA512SUMS
grep '  debian-13-genericcloud-amd64.qcow2$' SHA512SUMS | sha512sum --check -
cd ../../..
KARONT_QEMU_PREFIX="$PWD/benchmarks/tmp/vm-repro/tools/usr" \
  bash scripts/vm/start.sh benchmarks/tmp/vm-repro/debian-13-genericcloud-amd64.qcow2
```

O checksum precisa ser conferido com sucesso **antes** de iniciar a imagem. A URL `latest` muda; preserve imagem, manifesto e digest para repetir a mesma versão. O ensaio atual verificou SHA512 publicado por HTTPS; não realizou verificação PGP independente. Os pacotes host foram apenas extraídos com `dpkg-deb -x`, sem instalação ou scripts administrativos. A lista de pacotes em [tool-packages.txt](../benchmarks/spec001/tool-packages.txt) identifica os usados; revisões futuras dos repositórios podem mudar dependências.

O cloud-init cria o usuário `karont`, sem senha/SSH root, e provisiona dependências **dentro da VM**, inclusive Node 24.21.0, cujo tarball é conferido pelo SHASUMS256 oficial. Não execute `provision-guest.sh` no host. Espere existir `/var/lib/karont-guest-ready`; em outro terminal:

```bash
ssh -i benchmarks/tmp/vm-repro/id_ed25519 \
  -o UserKnownHostsFile=benchmarks/tmp/vm-repro/known_hosts \
  -o StrictHostKeyChecking=accept-new -p 22220 karont@127.0.0.1 \
  'test -f /var/lib/karont-guest-ready'
```

Copie somente o checkout para `/home/karont/karont` usando tar/scp, excluindo `.git`, `node_modules`, `dist` e **todo** `benchmarks/tmp` (contém discos e chave privada). Não encaminhe o SSH agent nem credenciais. Mantenha `package-lock.json`. Na VM, como `karont`, na raiz do checkout:

```bash
bash scripts/vm/validate-guest.sh
```

Esse script executa `npm ci`, check, os testes, diagnóstico, desktop, cinco rodadas desktop+daemon, benchmark isolado e relatório. `set -e` interrompe em falha; não converte preflight em sucesso. `benchmark:series` também preserva manifesto incompleto e retorna erro se qualquer rodada falhar. A primeira execução avulsa não entra nas cinco rodadas da série. Não há limpeza de caches do SO nem alteração de modo de energia.

Copie de volta `benchmarks/runs/`, `benchmarks/series/`, JSONs atuais e diagnóstico. Preserve a evidência do host em outro caminho antes de substituir `*-latest`. Encerre a VM ao terminar; o processo QEMU permanece em primeiro plano no terminal que o lançou. Chaves/discos em `benchmarks/tmp/` são locais e não devem ser publicados.

## Limites

O display do ensaio é **Xvfb 1440×1000×24**, sessão D-Bus, sem compositor GNOME/KDE, aceleração gráfica física ou tray interativo. AppArmor permanece carregado no guest; user namespaces funcionam sob a política padrão Debian, sem exceção instalada. A verificação efetiva é feita no renderer Electron real, não inferida da sonda `unshare`.

Fechamento usa `BrowserWindow.close()`, não um clique físico. SIGSTOP/SIGCONT de main+daemon testa prazos/reconexão e identidade sob atraso de execução; não reproduz suspensão ACPI, logind ou timekeeping de todas as máquinas. GNOME/KDE, Wayland, clique real no X/tray, suspensão física, escalas e hardware sob pressão de RAM continuam pendentes. A VM de 4 GiB não prova desempenho de hardware de baixa RAM.

Fontes: [imagens oficiais Debian](https://www.debian.org/distrib/), [NoCloud/cloud-init](https://docs.cloud-init.io/en/latest/reference/datasources/nocloud.html), [restrições AppArmor do Ubuntu](https://documentation.ubuntu.com/security/security-features/privilege-restriction/apparmor/). Nenhum procedimento de desativação global foi aplicado.

Os scripts de preparação foram derivados dos comandos usados nesta execução e passaram por `bash -n`. O ensaio real foi provisionado por esses comandos/cloud-init; não foi realizado um segundo provisionamento completo a partir dos wrappers finais. A suíte e a série foram executadas de fato, com saída preservada; a disponibilidade de um wrapper não foi contada como teste aprovado.
