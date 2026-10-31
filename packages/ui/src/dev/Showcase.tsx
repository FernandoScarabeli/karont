import { useState } from "react";
import { Button, type ButtonSize, type ButtonVariant } from "../components/Button/Button.tsx";
import { Dialog } from "../components/Dialog/Dialog.tsx";
import { IconButton } from "../components/IconButton/IconButton.tsx";
import { TextField } from "../components/TextField/TextField.tsx";
import styles from "./Showcase.module.css";

const palette = [
  { token: "--k-color-bg-app", value: "#0F0F10" },
  { token: "--k-color-bg-sheet", value: "#141415" },
  { token: "--k-color-bg-raised", value: "#19191B" },
  { token: "--k-color-bg-control", value: "#232325" },
  { token: "--k-color-bg-hover", value: "#232325" },
  { token: "--k-color-border", value: "#262627" },
  { token: "--k-color-border-strong", value: "#2E2E30" },
  { token: "--k-color-border-muted", value: "#3A3A3D" },
  { token: "--k-color-text-primary", value: "#EDEDED" },
  { token: "--k-color-text-secondary", value: "#A1A1A6" },
  { token: "--k-color-text-muted", value: "#85858B" },
  { token: "--k-color-primary", value: "#F3EEE3" },
  { token: "--k-color-on-primary", value: "#141415" },
  { token: "--k-color-primary-hover", value: "#FFFFFF" },
  { token: "--k-color-working", value: "#7DB4E0" },
  { token: "--k-color-attention", value: "#E5A93B" },
  { token: "--k-color-danger", value: "#EF7B73" },
  { token: "--k-color-focus", value: "#F3EEE3" },
];

const textSizes = [11, 12, 13, 14, 15, 16, 17, 24, 28] as const;
const buttonVariants: ButtonVariant[] = ["primary", "secondary", "ghost", "danger"];
const buttonSizes: ButtonSize[] = ["sm", "md", "lg"];
const sizeNames: Record<ButtonSize, string> = {
  sm: "Pequeno",
  md: "Médio",
  lg: "Grande",
};

function PlusIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 24 24" width="16">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

export function Showcase() {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <main className={styles.page}>
      <div className={styles.content}>
        <header className={styles.header}>
          <div>
            <h1 className={styles.heading}>Vitrine de componentes</h1>
            <p className={styles.description}>
              Fundamentos visuais e controles reutilizáveis da interface.
            </p>
          </div>
          <p className={styles.notice} role="note">
            Tela de desenvolvimento, temporária
          </p>
        </header>

        <div className={styles.sections}>
          <section className={styles.section}>
            <h2 className={styles.title}>Marca e títulos</h2>
            <div className={styles.brandSamples}>
              <span className={styles.brandTitle}>Nova conversa</span>
              <span className={styles.brandWordmark}>karont</span>
            </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.title}>Paleta de cores</h2>
            <ul className={styles.palette}>
              {palette.map(({ token, value }) => (
                <li className={styles.colorEntry} key={token}>
                  <span
                    aria-hidden="true"
                    className={styles.swatch}
                    style={{ backgroundColor: `var(${token})` }}
                  />
                  <span className={styles.tokenName}>{token}</span>
                  <span className={styles.tokenValue}>{value}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className={styles.section}>
            <h2 className={styles.title}>Escala de texto</h2>
            <ul className={styles.typeScale}>
              {textSizes.map((size) => (
                <li className={styles.typeRow} key={size}>
                  <span className={styles.typeSample} style={{ fontSize: `var(--k-text-${size})` }}>
                    Geist Sans
                  </span>
                  <span className={styles.typeToken}>--k-text-{size}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className={styles.section}>
            <h2 className={styles.title}>Botão</h2>
            <div className={styles.componentList}>
              {buttonVariants.map((variant) => (
                <div className={styles.variantRow} key={variant}>
                  <h3 className={styles.variantName}>{variant}</h3>
                  <div className={styles.controlGroup}>
                    {buttonSizes.map((size) => (
                      <Button iconStart={<PlusIcon />} key={size} size={size} variant={variant}>
                        {sizeNames[size]}
                      </Button>
                    ))}
                    {buttonSizes.map((size) => (
                      <Button disabled key={`disabled-${size}`} size={size} variant={variant}>
                        Desabilitado
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.title}>Botão-ícone</h2>
            <div className={styles.componentList}>
              <div className={styles.variantRow}>
                <h3 className={styles.variantName}>ghost</h3>
                <div className={styles.controlGroup}>
                  <IconButton icon={<PlusIcon />} label="Adicionar" size="sm" />
                  <IconButton icon={<PlusIcon />} label="Adicionar" size="md" />
                  <IconButton icon={<PlusIcon />} label="Fixar" pressed size="md" variant="ghost" />
                  <IconButton disabled icon={<PlusIcon />} label="Adicionar" size="sm" />
                  <IconButton disabled icon={<PlusIcon />} label="Adicionar" size="md" />
                </div>
              </div>
              <div className={styles.variantRow}>
                <h3 className={styles.variantName}>secondary</h3>
                <div className={styles.controlGroup}>
                  <IconButton icon={<PlusIcon />} label="Adicionar" size="sm" variant="secondary" />
                  <IconButton icon={<PlusIcon />} label="Adicionar" size="md" variant="secondary" />
                  <IconButton
                    disabled
                    icon={<PlusIcon />}
                    label="Adicionar"
                    size="sm"
                    variant="secondary"
                  />
                  <IconButton
                    disabled
                    icon={<PlusIcon />}
                    label="Adicionar"
                    size="md"
                    variant="secondary"
                  />
                </div>
              </div>
            </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.title}>Campo</h2>
            <div className={styles.componentList}>
              <TextField
                hint="Exemplo de ajuda para preencher o campo."
                label="Nome"
                placeholder="Minha CLI"
              />
              <TextField
                error="Informe um nome válido."
                label="Comando"
                mono
                value="/opt/tools/minha-cli"
                readOnly
              />
            </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.title}>Diálogo</h2>
            <div className={styles.controlGroup}>
              <Button onClick={() => setDialogOpen(true)} variant="secondary">
                Abrir diálogo
              </Button>
            </div>
            <Dialog
              description="Uma breve explicação sobre a decisão solicitada."
              footer={
                <>
                  <Button onClick={() => setDialogOpen(false)} variant="secondary">
                    Cancelar
                  </Button>
                  <Button onClick={() => setDialogOpen(false)} variant="primary">
                    Confirmar
                  </Button>
                </>
              }
              onClose={() => setDialogOpen(false)}
              open={dialogOpen}
              title="Título do diálogo"
            >
              <TextField autoFocus label="Nome" placeholder="Exemplo" />
            </Dialog>
          </section>
        </div>
      </div>
    </main>
  );
}
