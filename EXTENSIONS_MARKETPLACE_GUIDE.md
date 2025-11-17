# 🛒 扩展市场集成指南

## ✅ 已完成配置

### 核心改进
- ✅ 在`product.json`中添加了`extensionsGallery`配置
- ✅ 集成Open VSX Registry作为扩展市场
- ✅ 现在可以浏览、搜索、安装扩展
- ✅ 不再仅显示已安装的扩展

---

## 📦 扩展市场配置

### 使用的市场：Open VSX Registry

**配置详情**：
```json
"extensionsGallery": {
  "serviceUrl": "https://open-vsx.org/vscode/gallery",
  "itemUrl": "https://open-vsx.org/vscode/item",
  "publisherUrl": "https://open-vsx.org/vscode/publisher",
  "resourceUrlTemplate": "https://open-vsx.org/vscode/asset/{publisher}/{name}/{version}/{path}",
  "controlUrl": "",
  "nlsBaseUrl": "https://open-vsx.org/vscode/unpkg"
}
```

### 为什么选择Open VSX？

| 特性 | Open VSX | VS Code Marketplace |
|------|----------|---------------------|
| 开源 | ✅ | ❌ |
| 免费 | ✅ | ✅ |
| API兼容 | ✅ | ✅ |
| 法律问题 | ✅ 无限制 | ⚠️ 仅限官方VS Code |
| 扩展数量 | 较少（~3000+） | 很多（~40000+） |

**重要提示**：微软的VS Code Marketplace有使用限制，仅允许官方VS Code使用。使用Open VSX是完全合法且推荐的方式。

---

## 🚀 使用方法

### 1. 打开扩展视图

**方式1：快捷键**
- Mac: `Cmd+Shift+X`
- Windows/Linux: `Ctrl+Shift+X`

**方式2：菜单**
- 点击左侧活动栏的扩展图标

### 2. 浏览扩展

现在你应该能看到以下视图：

- **🔍 市场**：浏览所有可用扩展
- **💡 推荐**：基于工作区推荐的扩展
- **⭐ 流行**：最受欢迎的扩展
- **📥 已安装**：已安装的扩展
- **🔄 需要更新**：有更新的扩展

### 3. 搜索扩展

在扩展视图顶部的搜索框中：
- 输入扩展名称或关键词
- 按类别搜索：`@category:themes`
- 按标签搜索：`@tag:python`
- 查看流行扩展：`@popular`

### 4. 安装扩展

1. 找到想要的扩展
2. 点击扩展项
3. 点击「安装」按钮
4. 等待安装完成
5. 可能需要重新加载窗口

### 5. 管理扩展

右键点击已安装的扩展可以：
- **禁用**：暂时关闭扩展
- **卸载**：删除扩展
- **更新**：更新到最新版本
- **配置**：设置扩展选项

---

## 🎯 常用扩展推荐

### 编程语言

| 扩展 | 功能 | 搜索关键词 |
|------|------|-----------|
| Python | Python语言支持 | `ms-python.python` |
| Java Extension Pack | Java开发套件 | `vscjava.vscode-java-pack` |
| C/C++ | C/C++语言支持 | `ms-vscode.cpptools` |
| Go | Go语言支持 | `golang.go` |
| Rust | Rust语言支持 | `rust-lang.rust-analyzer` |

### 前端开发

| 扩展 | 功能 | 搜索关键词 |
|------|------|-----------|
| ESLint | JavaScript代码检查 | `dbaeumer.vscode-eslint` |
| Prettier | 代码格式化 | `esbenp.prettier-vscode` |
| Live Server | 实时预览HTML | `ritwickdey.liveserver` |
| Vue | Vue.js支持 | `octref.vetur` |
| React | React代码片段 | `dsznajder.es7-react-js-snippets` |

### 主题和图标

| 扩展 | 功能 | 搜索关键词 |
|------|------|-----------|
| One Dark Pro | 流行的暗色主题 | `zhuangtongfa.material-theme` |
| Material Icon Theme | 文件图标主题 | `pkief.material-icon-theme` |
| Dracula | Dracula主题 | `dracula-theme.theme-dracula` |

### 工具增强

| 扩展 | 功能 | 搜索关键词 |
|------|------|-----------|
| GitLens | Git增强 | `eamodio.gitlens` |
| Remote SSH | 远程SSH开发 | `ms-vscode-remote.remote-ssh` |
| Docker | Docker容器管理 | `ms-azuretools.vscode-docker` |
| REST Client | API测试 | `humao.rest-client` |

---

## 🔧 高级配置

### 切换到其他市场

如果想使用自己的扩展市场，可以修改`product.json`：

#### 选项1：使用VS Code官方市场（⚠️ 法律风险）

```json
"extensionsGallery": {
  "serviceUrl": "https://marketplace.visualstudio.com/_apis/public/gallery",
  "cacheUrl": "https://vscode.blob.core.windows.net/gallery/index",
  "itemUrl": "https://marketplace.visualstudio.com/items",
  "publisherUrl": "https://marketplace.visualstudio.com/publishers",
  "resourceUrlTemplate": "https://{publisher}.vscode-unpkg.net/{publisher}/{name}/{version}/{path}",
  "controlUrl": "https://az764295.vo.msecnd.net/control",
  "nlsBaseUrl": "https://az764295.vo.msecnd.net/nlsbase"
}
```

**注意**：这可能违反微软的服务条款！

#### 选项2：自建扩展市场

你可以搭建私有的Open VSX Registry：
- GitHub: https://github.com/eclipse/openvsx
- 文档: https://github.com/eclipse/openvsx/wiki

---

## 📊 对比：有无市场配置

### 之前（无市场配置）

❌ 只能看到「已安装」视图
❌ 无法浏览扩展
❌ 无法搜索扩展
❌ 无法安装新扩展
❌ 无法更新扩展

### 现在（有市场配置）

✅ 完整的扩展视图
✅ 浏览数千个扩展
✅ 搜索和过滤扩展
✅ 一键安装扩展
✅ 自动检查更新

---

## 🐛 故障排查

### 问题1：扩展视图仍然只显示「已安装」

**原因**：配置未生效，需要重新编译

**解决**：
```bash
cd /Users/caizhongrui/Documents/workspace/boyo/plugin/ide/src/tianhe-zhikai-ide

# 清理并重新编译
npm run clean
npm run compile

# 重启IDE
./scripts/code.sh .
```

### 问题2：无法连接到扩展市场

**原因**：网络问题或代理设置

**解决**：
1. 检查网络连接
2. 设置代理（如需要）：
   ```bash
   export HTTP_PROXY=http://proxy.example.com:8080
   export HTTPS_PROXY=http://proxy.example.com:8080
   ```

### 问题3：搜索很慢或超时

**原因**：Open VSX服务器响应慢

**解决**：
- 切换到更快的镜像（如有）
- 或等待服务器恢复
- 或搭建私有市场

### 问题4：某些扩展找不到

**原因**：Open VSX的扩展数量比官方市场少

**解决**：
- 在Open VSX网站确认扩展是否存在：https://open-vsx.org/
- 联系扩展作者发布到Open VSX
- 或手动下载`.vsix`文件安装

---

## 📝 手动安装扩展

如果某个扩展在Open VSX上找不到，可以手动安装：

### 步骤

1. **下载扩展**
   - 从GitHub Releases
   - 或从官方市场下载`.vsix`文件

2. **安装VSIX文件**
   ```bash
   # 方式1：命令行
   code --install-extension extension.vsix
   
   # 方式2：菜单
   # 扩展视图 → 右上角「...」→「从VSIX安装...」
   ```

3. **重新加载窗口**
   - `Cmd+Shift+P` → 输入「Reload Window」

---

## 🔐 安全性考虑

### 扩展审查

Open VSX和VS Code Marketplace都对扩展进行审查，但：

⚠️ **始终警惕**：
- 检查扩展的发布者
- 查看下载量和评分
- 阅读用户评论
- 查看源代码（开源扩展）
- 审查权限请求

### 权限

扩展可能请求以下权限：
- 文件系统访问
- 网络请求
- 执行命令
- 修改设置

**最佳实践**：
- 只安装必要的扩展
- 定期审查已安装的扩展
- 禁用不常用的扩展

---

## 📈 性能优化

### 扩展启动性能

查看扩展启动时间：
```
Cmd+Shift+P → 输入「Show Running Extensions」
```

### 禁用不需要的扩展

对于特定工作区：
1. 右键点击扩展
2. 选择「在此工作区中禁用」
3. 扩展在其他工作区仍然有效

---

## 🌐 网络配置

### 使用代理

在设置中配置代理：

```json
{
  "http.proxy": "http://proxy.example.com:8080",
  "http.proxyStrictSSL": false
}
```

### 离线使用

1. **预先下载扩展**
   ```bash
   code --install-extension publisher.extension
   ```

2. **缓存扩展**
   - 扩展安装后会缓存在本地
   - 位置：`~/.tianhe-zhikai/extensions/`

---

## 📞 需要帮助？

### 查看日志

1. **开发者工具 → Console**
   ```
   Help → Toggle Developer Tools → Console
   ```

2. **查找扩展相关日志**
   - 搜索：`ExtensionGallery`
   - 搜索：`ExtensionsWorkbench`

### 常见日志消息

**成功**：
```
[ExtensionGalleryService] Gallery service initialized: https://open-vsx.org/vscode/gallery
```

**失败**：
```
[ExtensionGalleryService] Gallery is not available
```

---

## 🎉 快速验证

### 测试步骤

1. **重启IDE**
   ```bash
   ./scripts/code.sh .
   ```

2. **打开扩展视图**
   - `Cmd+Shift+X`

3. **搜索扩展**
   - 输入：`python`
   - 应该能看到Python扩展

4. **安装测试扩展**
   - 安装「Material Icon Theme」
   - 查看是否正常安装

5. **验证市场连接**
   - 点击「推荐」标签
   - 应该能看到推荐的扩展列表

---

## 📚 更多资源

- **Open VSX Registry**: https://open-vsx.org/
- **Open VSX GitHub**: https://github.com/eclipse/openvsx
- **VS Code扩展API**: https://code.visualstudio.com/api
- **发布扩展到Open VSX**: https://github.com/eclipse/openvsx/wiki/Publishing-Extensions

---

**更新日期**: 2025-11-05
**版本**: v1.0 - 扩展市场集成
**状态**: ✅ 已完成并可用

