function normalizeReferenceName(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .toLocaleLowerCase("ru-RU");
}

export function referenceTypeParts(typeStr) {
  const raw = String(typeStr || "");
  const found = [];
  const expression = /(справочник|перечисление)\s*\.\s*([^;]+)/gi;
  let match;

  while ((match = expression.exec(raw))) {
    const kind =
      match[1].toLocaleLowerCase("ru-RU") === "перечисление"
        ? "enum"
        : "reference";

    const shortName = String(match[2] || "").trim();

    if (shortName) {
      found.push({
        kind,
        shortName,
        fullType: `${kind === "enum" ? "Перечисление" : "Справочник"}.${shortName}`
      });
    }
  }

  const unique = [];
  const seen = new Set();

  found.forEach(item => {
    const key = `${item.kind}:${normalizeReferenceName(item.shortName)}`;

    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
  });

  return unique;
}

export function referenceRootMask(kind) {
  return kind === "enum"
    ? /^_enum\d+(?:x\d+)?$/i
    : /^_reference\d+(?:x\d+)?$/i;
}

function rootsByMask(rows, mask) {
  return (Array.isArray(rows) ? rows : []).filter(row =>
    mask.test(String((row && row.internal) || ""))
  );
}

function normalizeMaxDepth(value) {
  const source = value || 5;
  const numeric = Math.max(1, Math.min(5, Number(source)));
  return Number.isFinite(numeric) ? numeric : 5;
}

export function chainHasTarget(chain, targetTable) {
  const normalizedTarget = String(targetTable || "").toLowerCase();

  return (Array.isArray(chain) ? chain : []).some(step =>
    String((step && step.targetTable) || "").toLowerCase() === normalizedTarget
  );
}

export function chainText(chain) {
  return (Array.isArray(chain) ? chain : [])
    .map(step => `${step && step.refInternal} -> ${step && step.targetTable}`)
    .join(" / ");
}

export function resolveReferenceTarget(row, context = {}) {
  const parts = referenceTypeParts(row && row.type);

  if (parts.length !== 1) {
    return {
      status: parts.length > 1 ? "ambiguous" : "unknown_type",
      target: null,
      candidates: [],
      kind: null,
      reason: parts.length > 1
        ? "multiple_business_types"
        : "missing_business_type"
    };
  }

  const spec = parts[0];
  const rows = Array.isArray(context.rows) ? context.rows : [];
  const roots = rootsByMask(rows, referenceRootMask(spec.kind));

  if (!roots.length) {
    return {
      status: "missing_kind_root",
      target: null,
      candidates: [],
      kind: spec.kind,
      spec
    };
  }

  const fullNorm = normalizeReferenceName(spec.fullType);
  const shortNorm = normalizeReferenceName(spec.shortName);

  const decide = (matches, method) => {
    if (matches.length === 1) {
      return {
        status: "resolved",
        target: matches[0],
        candidates: matches,
        kind: spec.kind,
        spec,
        method
      };
    }

    if (matches.length > 1) {
      return {
        status: "ambiguous",
        target: null,
        candidates: matches,
        kind: spec.kind,
        spec,
        method
      };
    }

    return null;
  };

  let result = decide(
    roots.filter(root =>
      normalizeReferenceName(root && root.type) === fullNorm
    ),
    "exact_type"
  );

  if (!result) {
    result = decide(
      roots.filter(root =>
        normalizeReferenceName(root && root.object) === shortNorm
      ),
      "exact_short_name"
    );
  }

  if (!result) {
    result = decide(
      roots.filter(root =>
        normalizeReferenceName(root && root.title).includes(fullNorm)
      ),
      "title_full_type"
    );
  }

  if (!result) {
    const candidates = roots.filter(root => {
      const values = [
        root && root.object,
        root && root.title,
        root && root.type
      ].map(normalizeReferenceName);

      return values.some(value =>
        value &&
        (
          value.includes(shortNorm) ||
          shortNorm.includes(value)
        )
      );
    });

    return {
      status: "not_found",
      target: null,
      candidates,
      kind: spec.kind,
      spec
    };
  }

  if (result.status !== "resolved") {
    return result;
  }

  const chain = Array.isArray(context.chain) ? context.chain : [];
  const targetTable = String(
    (result.target && (result.target.internal || result.target.object)) || ""
  );

  if (chain.length >= normalizeMaxDepth(context.maxDepth)) {
    return {
      ...result,
      status: "max_depth",
      target: null,
      resolvedTarget: result.target
    };
  }

  if (chainHasTarget(chain, targetTable)) {
    return {
      ...result,
      status: "cycle",
      target: null,
      resolvedTarget: result.target
    };
  }

  return result;
}

export function validateJoinChain(chain, context = {}) {
  const steps = Array.isArray(chain) ? chain : [];
  const rows = Array.isArray(context.rows) ? context.rows : [];
  const maxDepth = normalizeMaxDepth(context.maxDepth);

  if (!steps.length) {
    return {
      ok: false,
      status: "unknown_type",
      reason: "empty_chain"
    };
  }

  if (steps.length > maxDepth) {
    return {
      ok: false,
      status: "max_depth",
      reason: "chain_too_deep"
    };
  }

  const seen = new Set();

  for (const step of steps) {
    const table = String((step && step.targetTable) || "");
    const kind = step && step.targetKind;

    if (kind !== "reference" && kind !== "enum") {
      return {
        ok: false,
        status: "unknown_type",
        reason: "missing_target_kind"
      };
    }

    const mask = referenceRootMask(kind);

    if (!mask.test(table)) {
      return {
        ok: false,
        status: "unknown_type",
        reason: "invalid_target_table"
      };
    }

    const key = table.toLowerCase();

    if (seen.has(key)) {
      return {
        ok: false,
        status: "cycle",
        reason: "repeated_target"
      };
    }

    seen.add(key);

    const roots = rootsByMask(rows, mask).filter(root =>
      String((root && root.internal) || "").toLowerCase() === key
    );

    if (roots.length !== 1) {
      return {
        ok: false,
        status: roots.length > 1 ? "ambiguous" : "not_found",
        reason: "target_root_changed"
      };
    }
  }

  return {
    ok: true,
    status: "resolved"
  };
}

export const validateReferenceChain = validateJoinChain;

export function detectReferenceCycle(chain) {
  const seen = new Set();

  for (const step of Array.isArray(chain) ? chain : []) {
    const targetTable = String(
      (step && step.targetTable) || ""
    ).toLowerCase();

    if (seen.has(targetTable)) {
      return {
        cycle: true,
        targetTable,
        reason: "repeated_target"
      };
    }

    seen.add(targetTable);
  }

  return {
    cycle: false,
    targetTable: null,
    reason: null
  };
}

export function referenceChainSignature(chain) {
  const steps = Array.isArray(chain) ? chain : [];

  if (!steps.length) {
    return null;
  }

  const values = [];

  for (const step of steps) {
    const refInternal = String(
      (step && step.refInternal) || ""
    );

    const targetTable = String(
      (step && step.targetTable) || ""
    );

    if (!refInternal || !targetTable) {
      return null;
    }

    values.push(`${refInternal}->${targetTable}`);
  }

  return values.join("/");
}

export function createSyntheticReferenceId({
  baseTopId,
  chainLength,
  tableInternal,
  fieldInternal
} = {}) {
  const base = String(baseTopId || "");
  const table = String(tableInternal || "");
  const field = String(fieldInternal || "");
  const length = Number(chainLength);

  if (
    !base ||
    !table ||
    !field ||
    !Number.isInteger(length) ||
    length < 1
  ) {
    return null;
  }

  return `s:${base}:${length}:${table}:${field}`;
}

export function buildSyntheticReferenceMeta({
  baseTopId,
  chain,
  tableInternal,
  field,
  displayPath,
  displayPrefix
} = {}) {
  const normalizedBaseTopId = String(baseTopId || "");
  const normalizedTable = String(tableInternal || "");
  const normalizedChain = Array.isArray(chain)
    ? chain.map(step => ({ ...step }))
    : [];

  const normalizedField = field && typeof field === "object"
    ? {
        object: String(field.object || ""),
        title: String(field.title || field.object || ""),
        internal: String(field.internal || field.object || ""),
        type: String(field.type || "")
      }
    : null;

  if (
    !normalizedBaseTopId ||
    !normalizedTable ||
    !normalizedChain.length ||
    !normalizedField ||
    !normalizedField.internal
  ) {
    return null;
  }

  const normalizedDisplayPath = String(displayPath || "");
  const normalizedDisplayPrefix = String(
    displayPrefix || normalizedDisplayPath
  );

  return {
    baseTopId: normalizedBaseTopId,
    chain: normalizedChain,
    tableInternal: normalizedTable,
    field: normalizedField,
    displayPath: normalizedDisplayPath,
    displayPrefix: normalizedDisplayPrefix
  };
}