# Agent Note：与 YAML 并存的 TOML 组合文件

Status: implemented

[English](2026-11-16-toml-compositions.md) | 中文

## 问题

本仓库的每一份组合都是 YAML：产品随包发布的 bundle 补丁、实验性 bundle、部署方写下的 profile 根配置与补丁层、以及测试它们的夹具。YAML 需要自定义标签（`!!js`）承载表达式，而工具链没有能保留注释的第二个读写器，于是配置文件的程序化改写必然丢掉写在行上方的理由。产品也完全没有受支持的 TOML 方言，尽管 `smol-toml` 早就是 vendored Include 插件的依赖。

## 决定

vendored Include 插件解析并输出同一文档模型的 TOML 方言（[V29](../../../../vendor/README.md)）：根是 `[[entry]]` 表数组，以 `js:` 开头的字符串成为加载器的表达式节点，与 YAML 的 `!!js` 标签产出同一结构，因此同一份组合在两种方言下含义相同。profile 与 bundle 补丁在有 `cordis.toml` / `cordis.patch.toml` 时解析到该文件，否则回落到 YAML 名字，从而允许一个 profile 逐文件迁移，并让现有 profile 全部保持有效。

随包发布的组合现在以 TOML 发布：`packages/bundle` 下的十个 bundle 补丁与十九个实验性 bundle 补丁，其 manifest 指向新文件。`scripts/convert-compositions-to-toml.ts` 负责转换，并把每段连续注释移到它所注释的节点上方——已安装的 `js-yaml` 无法往返保留注释，而作为根 devDependency 引入的 `yaml` 可以。新 profile 在该方言进入生产检出之前仍写 YAML；dev home 自己的组合已是 TOML，profile 根配置按文件名所选方言写出。

## 备选方案

- **JSON 组合。** 否决：完全不能写注释，表达式节点也无处安放，除非再造一套前缀方言。
- **单个根键里的 TOML 内联表（`entry = [{ ... }]`）。** 否决：带嵌套 `config` 的行会变成极长的一行，且无法在单行上方写注释。
- **用已安装的 `js-yaml` 转换。** 否决：它丢掉每一条注释，而注释正是这些组合文件的主要内容。作为根 devDependency 的 `yaml` 只被这个一次性转换器使用。
- **保留 YAML，只加一个读取器。** 否决：配置面等于没变，而要求变的就是它。

## 后果

- 29 份随包发布的组合文件已是 TOML，同名 YAML 已删除；因此本仓库之外任何硬编码 `packages/bundle/<name>/cordis.patch.yml` 的地方都要跟随改动。
- 两道门禁学会了该扩展名：typert 分析器把 `.toml` 视为数据导出（否则解析到 TOML 文件的 bundle 导出会被报成缺失的 TypeScript 源），`scripts/verify-product-use.ts` 接受 `.toml` 说明符。
- 因为生产检出尚未带上该方言，`~/.dsh` 继续用 YAML，而 `~/.dsh-dev` 跑 TOML；`AGENTS.md` 的 home 同步配方在搬入时转换。
- 测试夹具与示例**有意**保持 YAML：它们覆盖回落路径，转换掉就等于删掉「YAML 仍然可用」的覆盖。
