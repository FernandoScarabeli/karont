# Resultados locais — Fase 0

Gerado em 2026-10-23T21:28:17.215Z. Uma execução local por cenário, sem garantia estatística.

Host: Intel(R) Core(TM) i3-10100F CPU @ 3.60GHz, 8 CPUs lógicas, 30.00 GiB RAM; linux 7.0.0-38-generic; Node v24.21.0; Electron 45.0.0; Wayland. Consulte os JSONs para a distribuição e os valores brutos.

| Métrica do daemon (um processo Node) | Medição |
|---|---:|
| Início até handshake/ping | 112.37 ms |
| RAM ociosa RSS / PSS | 63.06 / 33.14 MiB |
| CPU ociosa (um núcleo = 100%) | 0.00% |
| RAM streaming RSS / PSS | 63.14 / 33.22 MiB |
| CPU streaming | 0.19% |
| Socket ida e volta p50 / p95 | 0.36 / 0.56 ms |
| Amostras de socket | 200 |

CPU 0,00% significa nenhum tick de CPU contabilizado na janela de aproximadamente 5 s, não ausência absoluta de custo. O streaming deste cenário é somente o contador sintético, sem Electron conectado. O início inclui polling de até 50 ms. O benchmark não mede fsync sob falha elétrica.

## Desktop — aceite bloqueado

A execução com sandbox obrigatório falhou no preflight nativo, antes de iniciar o main Electron. O host não disponibiliza helper SUID válido nem user namespace utilizável para este binário. Consulte [diagnóstico completo](desktop-latest.json). Fechamento/reabertura, tray e consumo do desktop com sandbox permanecem sem validação final neste host.

## Evidência preliminar da interface

A UI foi renderizada e inspecionada em 1440 px e 900 px. As [oito painéis de fluxo e editor](desktop-eight-panels.png) e a [vista compacta](desktop-compact.png) são de uma execução inicial em que o Playwright adicionou sua flag padrão de desativar sandbox. Essa execução foi descartada para o aceite; o código/harness atuais recusam essa condição.

Nessa execução preliminar foram observados: Electron ocioso ~884 MiB RSS somada / 377 MiB PSS e ~2,16% de um núcleo; com streaming/editor ~903 MiB RSS / 393 MiB PSS; abertura ~526 ms e intervalo rAF p95 ~6,1 ms. Esses valores não são benchmark válido da configuração final; o daemon ainda tinha launcher auxiliar e o renderer consultava a cada 250 ms mesmo ocioso. Não se inferem aprovação do orçamento de memória ou segurança desses números.

## Metas propostas e pendências

Abertura <2 s, RAM ociosa <200 MB, CPU ociosa <1% e feedback <100 ms continuam metas propostas. O daemon isolado apresenta consumo baixo nesta carga. A evidência preliminar do desktop excedeu a proposta de RAM, mesmo considerando PSS. É necessário repetir com sandbox e comparar Electron/daemon/total, sem somar RSS como se não houvesse páginas compartilhadas.

Não há resultado de CLIs ou modelos: nenhum foi integrado. Não há validação de GNOME/KDE completos, X11, tray, suspensão real, reinício de sessão nem pacote distribuível. [Procedimento de repetição](../docs/BENCHMARKS.md).
