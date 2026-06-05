export function attachParentsFromLevels(rows) {
  const hasLevels = rows.some(row => row.level !== undefined);
  const hasAnyParent = rows.some(row => row.parentId);
  if (!hasLevels || hasAnyParent) return rows;

  const stack = [];
  rows.forEach(row => {
    const level = row.level || 0;
    while (stack.length && (stack[stack.length - 1].level || 0) >= level) stack.pop();
    row.parentId = stack.length ? stack[stack.length - 1].id : null;
    stack.push(row);
  });
  return rows;
}

export function buildTree(rows) {
  const byId = {};
  rows.forEach(row => {
    byId[row.id] = row;
  });

  const children = {};
  const roots = [];
  rows.forEach(row => {
    const parentId = row.parentId && byId[row.parentId] ? row.parentId : null;
    if (!parentId) roots.push(row);
    else (children[parentId] = children[parentId] || []).push(row);
  });

  const sorter = (a, b) => (a.level || 0) - (b.level || 0) || String(a.object).localeCompare(String(b.object));
  roots.sort(sorter);
  Object.values(children).forEach(items => items.sort(sorter));
  return { byId, children, roots };
}
