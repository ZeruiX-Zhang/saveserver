export const THEMES = [
  {
    id: "apple-blue",
    name: "Apple Blue",
    description: "经典苹果蓝，清爽科技感",
  },
  {
    id: "graphite",
    name: "Graphite",
    description: "石墨灰黑，沉稳高级",
  },
  {
    id: "sage",
    name: "Sage Green",
    description: "鼠尾草绿，沉静仓储",
  },
  {
    id: "warm-sand",
    name: "Warm Sand",
    description: "暖沙米色，温和低刺激",
  },
];

export const DEFAULT_THEME_ID = "apple-blue";

export function isValidThemeId(id) {
  return THEMES.some((theme) => theme.id === id);
}

export function applyTheme(themeId) {
  const id = isValidThemeId(themeId) ? themeId : DEFAULT_THEME_ID;
  document.documentElement.setAttribute("data-theme", id);
  return id;
}

export function getThemeById(themeId) {
  return THEMES.find((theme) => theme.id === themeId) || THEMES[0];
}
