export const rollbackApprovalConfirmation =
  'Desfazer os arquivos registrados desta worktree? O daemon verificará novamente os conflitos. Efeitos externos não serão revertidos.';

export async function decidePendingApproval(approvalId: string, allow: boolean) {
  if (allow && !window.confirm(rollbackApprovalConfirmation)) return false;
  await window.karont.decideApproval(approvalId, allow);
  return true;
}
