export const LOCATION_CODE_PATTERN = /^([A-Za-z0-9一-鿿]+)[\-\/_·: ]+([A-Za-z0-9一-鿿]+)[\-\/_·: ]+(?:L[\-_]?)?(\d{1,3})$/i;

export function parseLocationCode(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) {
    return { ok: false, reason: "二维码内容为空" };
  }

  const match = value.match(LOCATION_CODE_PATTERN);
  if (!match) {
    return { ok: false, reason: "二维码格式应为：仓库-货架-层数" };
  }

  const [, warehouse, shelf, levelDigits] = match;
  const levelNo = Number(levelDigits);
  if (!Number.isFinite(levelNo) || levelNo <= 0) {
    return { ok: false, reason: "层数必须是正整数" };
  }

  return {
    ok: true,
    warehouse: warehouse.trim().toUpperCase(),
    shelf: shelf.trim().toUpperCase(),
    levelNo,
    raw: value,
  };
}

export function formatLocationCode(warehouse, shelf, levelNo) {
  const w = String(warehouse || "").trim().toUpperCase();
  const s = String(shelf || "").trim().toUpperCase();
  const l = Number(levelNo);
  if (!w || !s || !Number.isFinite(l)) {
    return "";
  }
  return `${w}-${s}-L${String(l).padStart(2, "0")}`;
}
