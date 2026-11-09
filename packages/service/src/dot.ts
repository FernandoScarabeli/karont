import type { DatabaseSync } from "node:sqlite";
import { type Dot, type DotFields, dotFieldsSchema, dotSchema } from "@karont/contract";
import { inTransaction } from "./db.ts";

export function getDot(db: DatabaseSync): Dot {
  const row = db.prepare("SELECT * FROM dots WHERE id='default'").get();
  if (!row) throw new Error("O Dot não foi encontrado.");
  return dotSchema.parse({
    id: row.id,
    name: row.name,
    color: row.color,
    enabled: row.enabled === 1,
    personality: JSON.parse(String(row.personality)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export function updateDot(db: DatabaseSync, patch: Partial<DotFields>): Dot {
  const valid = dotFieldsSchema.partial().parse(patch);
  return inTransaction(db, () => {
    const current = getDot(db);
    const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...fields } = current;
    const next = dotFieldsSchema.parse({ ...fields, ...valid });
    db.prepare(
      `UPDATE dots SET name=?, color=?, enabled=?, personality=?, updated_at=? WHERE id='default'`,
    ).run(
      next.name,
      next.color,
      next.enabled ? 1 : 0,
      JSON.stringify(next.personality),
      new Date().toISOString(),
    );
    return getDot(db);
  });
}
