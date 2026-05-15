// One-shot script to compute pHash for every product image already in the
// database. Re-runnable: existing rows in product_phashes are upserted by
// (product_id, image_index=0).
//
// Usage:
//   node scripts/backfill-phashes.js
//   node scripts/backfill-phashes.js --force      # re-hash even if already indexed
//
// Skips products whose image is the SVG placeholder.

const dbStore = require("../database/db.js");
const { computePhash, decodeImageInput } = require("./phash.js");

async function main() {
  const force = process.argv.includes("--force");
  const products = dbStore.listAll("products");
  const indexedIds = new Set(
    dbStore.listAllPhashes().map((row) => `${row.product_id}::${row.image_index}`),
  );

  let scanned = 0;
  let indexed = 0;
  let skippedPlaceholder = 0;
  let skippedAlready = 0;
  let failed = 0;

  for (const product of products) {
    scanned += 1;
    if (!product?.id) continue;
    const buffer = decodeImageInput(product.image);
    if (!buffer) {
      skippedPlaceholder += 1;
      continue;
    }
    const key = `${product.id}::0`;
    if (!force && indexedIds.has(key)) {
      skippedAlready += 1;
      continue;
    }
    try {
      const hash = await computePhash(buffer);
      dbStore.indexPhash(product.id, 0, hash);
      indexed += 1;
      process.stdout.write(`  + ${product.id}  ${product.model || ""}  ${hash}\n`);
    } catch (error) {
      failed += 1;
      process.stderr.write(`  ! ${product.id}  ${product.model || ""}  ${error.message}\n`);
    }
  }

  console.log("");
  console.log("---- Backfill complete ----");
  console.log(`  scanned products       : ${scanned}`);
  console.log(`  newly indexed          : ${indexed}`);
  console.log(`  skipped (already)      : ${skippedAlready}`);
  console.log(`  skipped (placeholder)  : ${skippedPlaceholder}`);
  console.log(`  failed                 : ${failed}`);
  console.log(`  total phashes in DB    : ${dbStore.countPhashes()}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
