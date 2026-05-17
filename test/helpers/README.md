# Test Helpers

本目录下的所有模块（`arbitraries.js`、未来可能加入的 fake-filesystem / fake-preferences 适配器等）**仅供 spec 的属性测试 / 单元测试使用**。`app/shared/` 与 `android/app/src/main/assets/public/` 下的任何生产代码都**不应**反向 import 任何 `test/` 路径——否则共享层会污染进 APK / Electron 产物。
