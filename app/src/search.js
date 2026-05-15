import { fuzzyIncludes, normalizeText } from "./utils.js";

export function getSearchableTokens(product, ctx) {
  const tokens = new Set();
  if (!product) {
    return tokens;
  }
  const push = (value) => {
    const trimmed = String(value || "").trim();
    if (trimmed) {
      tokens.add(trimmed);
    }
  };

  push(product.model);
  push(product.modelNormalized);
  push(product.imageAlt);
  push(product.category);

  for (const keyword of product.imageKeywords || []) {
    push(keyword);
  }
  for (const tag of product.tags || []) {
    push(tag);
  }

  const fieldValues = ctx?.valuesByProductId?.get(product.id) || [];
  for (const item of fieldValues) {
    const field = ctx?.customFieldDefinitionsById?.get(item.fieldId);
    if (field?.isSearchable) {
      push(item.valueText);
    }
  }

  return tokens;
}

export function matchProduct(product, query, ctx) {
  if (!product) {
    return false;
  }
  const trimmed = String(query || "").trim();
  if (!trimmed) {
    return true;
  }
  const tokens = getSearchableTokens(product, ctx);
  for (const token of tokens) {
    if (fuzzyIncludes(token, trimmed)) {
      return true;
    }
  }
  return false;
}

export function searchProducts(products, query, ctx) {
  const trimmed = String(query || "").trim();
  if (!trimmed) {
    return products;
  }
  const normalizedQuery = normalizeText(trimmed);
  return products.filter((product) => {
    if (!product) {
      return false;
    }
    if (normalizeText(product.model).includes(normalizedQuery)) {
      return true;
    }
    return matchProduct(product, trimmed, ctx);
  });
}
