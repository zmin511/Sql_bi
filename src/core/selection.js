export function isStructuralSqlName(name) {
  const value = String(name || "").trim();

  return /^_(?:Document|Reference|Catalog|Enum|InfoRg|AccumRg|Const|Chrc|CKinds)\d+(?:X\d+)?(?:_VT\d+(?:X\d+)?)?$/i.test(
    value
  );
}

export function isSelectableField(row, context = {}) {
  if (!row) return false;

  const internal = String(row.internal || "").trim();

  if (!/^_[A-Za-z][A-Za-z0-9_]*$/.test(internal)) return false;
  if (isStructuralSqlName(internal)) return false;

  if (
    context.kind !== "synth" &&
    context.hasOriginalChildren
  ) {
    return false;
  }

  return true;
}