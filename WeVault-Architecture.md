# WeVault / 微迹 — Architecture Design Document

> 你浏览过的每一条朋友圈，都值得被留住。

---

## 1. 产品定位与命名

### 核心洞察

微信朋友圈的「N天可见」机制创造了一个信息黑洞——你亲眼看过的内容，几天后就从你的认知边界消失了。但数据其实还躺在你自己的电脑里，以加密缓存的形式。WeVault 要做的事情很简单：**把属于你的记忆还给你**。

### 命名方案

| 方案 | 中文名 | 英文名 | 含义 | 推荐度 |
|------|--------|--------|------|--------|
| A | 微迹 | WeVault | 微信的痕迹 + vault（保险库），国际化友好 | ★★★★★ |
| B | 拾光 | MomentPin | 拾起时光，pin 住瞬间 | ★★★★ |
| C | 圈忆 | CircleBack | 朋友圈 + 回忆，circle back = 回头看 | ★★★ |

**推荐 A：WeVault / 微迹**。理由：双语自然，技术感强，GitHub 上容易被发现，且不限于朋友圈一个功能（未来可扩展到聊天存档、收藏夹等）。

### Tagline

```
WeVault — Your WeChat, permanently yours.
微迹 — 你浏览过的每一条朋友圈，都值得被留住。
```

---

## 2. 功能模块

### 2.1 Contact Explorer（联系人索引）

**痛点**：微信没有一个好用的联系人全景视图。你想看某个人的朋友圈，得先记得他的名字，手动搜索，点进去。

**方案**：

- **搜索栏**：支持拼音首字母、备注名、昵称、wxid 的 fuzzy match。输入 `zs` 能匹配到「张三」，输入 `lao` 能匹配到备注「老王」
- **联系人卡片网格**：头像 + 昵称 + 备注 + 最近朋友圈摘要，一目了然
- **智能排序**：默认按「最近有朋友圈活动」排序，而非字母序。你最关心的人自然浮到最上面
- **标签分组**：自动提取微信标签（如「同事」「同学」），支持按组浏览
- **统计指标**：每个联系人卡片上显示「已归档 N 条朋友圈」，给用户直观的数据感知

**UI 参考**：左侧列表 + 右侧详情的经典布局（类似 WeChatDataAnalysis 的 sns.vue），但我们做得更精致：

```
┌─────────────────────────────────────────────────────────┐
│  🔍 搜索联系人... [拼音/昵称/备注]                        │
├──────────────┬──────────────────────────────────────────┤
│ 📌 最近活跃   │                                          │
│              │   [联系人详情 / 朋友圈 Timeline]            │
│ 👤 张三  12条 │                                          │
│ 👤 李四   8条 │   ← 点击左侧联系人，右侧展示其朋友圈       │
│ 👤 老王   5条 │                                          │
│              │                                          │
│ 📁 同事       │                                          │
│ 📁 同学       │                                          │
│ 📁 家人       │                                          │
├──────────────┴──────────────────────────────────────────┤
│ Status: Last sync 2 min ago | Vault: 1,234 moments      │
└─────────────────────────────────────────────────────────┘
```

### 2.2 Moment Vault / 时光机（核心功能）

**本质**：一个 per-contact 的朋友圈永久归档和浏览器。

**核心能力**：

1. **永久保存**：一旦你在微信里浏览过某条朋友圈，它就被归档到 Vault 中，即使对方后来设为「三天可见」或删除
2. **时间线浏览**：按时间倒序展示某个联系人的所有朋友圈（包括已过期的），UI 还原微信朋友圈的视觉风格
3. **富媒体还原**：图片（多图九宫格）、视频（如果缓存中有）、位置信息、评论和点赞
4. **时间范围筛选**：按年、月、自定义区间过滤
5. **全文搜索**：搜索朋友圈文字内容（FTS5 全文索引）
6. **导出**：单条/批量导出为 HTML / JSON / 图片合集

**"时光机"体验设计**：

- 进入某人的 Vault 时，顶部展示一个「时间轴」滑块，可以快速跳转到任意月份
- 被微信隐藏的内容（已过期/已删除但本地有缓存的）用一个微妙的 badge 标记："已归档"
- 图片点击后打开 lightbox，支持左右滑动浏览同一条朋友圈的多张图片
- 地理位置信息可以点击在地图上查看（调用系统地图或嵌入 Mapbox）

### 2.3 Sync Dashboard

- **一键提取**：点击按钮执行完整的 decrypt → parse → archive 流程
- **状态监控**：最后同步时间、Vault 大小（条数 + 存储体积）、解密状态
- **增量同步**：只处理上次同步后新增的数据（基于 SnsTimeLine 的 tid + createTime 做 diff）
- **守护模式（可选）**：后台 watchdog 监听微信进程，自动触发增量同步

### 2.4 未来扩展（v2+）

- 聊天记录归档浏览器（Contact Explorer 的自然延伸）
- 年度报告生成（类似 WeChatDataAnalysis 的 Wrapped 功能）
- 数据导出为标准格式（Markdown / PDF / MBOX）

---

## 3. 技术架构

### 3.1 总体分层

```
┌─────────────────────────────────────────────────┐
│                   UI Layer                       │
│         React + Tailwind + Tauri Shell           │
├─────────────────────────────────────────────────┤
│                   API Layer                      │
│         FastAPI (local :8199)                    │
│   /contacts  /moments  /media  /search  /sync   │
├─────────────────────────────────────────────────┤
│                  Data Layer                      │
│     VaultStore (SQLite + FTS5) | MediaVault      │
│     SyncEngine | ContactIndex                    │
├─────────────────────────────────────────────────┤
│                Extractor Layer                   │
│   KeyScanner | DBDecryptor | ImgDecryptor        │
│   XMLParser (SnsTimeLine + zstd)                 │
│         ↑ wraps wechat-decrypt core              │
└─────────────────────────────────────────────────┘
```

### 3.2 Extractor Layer — 不造轮子，只做封装

这一层的核心原则：**不重新实现任何解密逻辑**。直接 wrap `wechat-decrypt` 和 `wechat-db-decrypt-macos` 的已验证代码。

| 模块 | 来源项目 | 我们做什么 |
|------|----------|-----------|
| `KeyScanner` | wechat-decrypt/find_all_keys.py, wechat-db-decrypt-macos | 封装为统一接口，屏蔽 macOS/Windows 差异 |
| `DBDecryptor` | wechat-decrypt/decrypt_db.py | 封装 SQLCipher 4 解密，输出为 plaintext SQLite |
| `ImageDecryptor` | wechat-decrypt/decrypt_sns.py | 封装 XOR + AES-ECB 图片解密逻辑 |
| `XMLParser` | wechat-decrypt/export_sns.py | 复用 `_parse_timeline_xml()` + `_decode_sns_content_blob()`，含 zstd 解压和 XXE 防护 |

**封装方式**：Python submodule 引用，不 fork 不 copy。用 adapter pattern 包一层类型安全的接口：

```python
# wevault/extractor/key_scanner.py
class KeyScanner:
    """Unified interface for WeChat key extraction across platforms."""
    
    def scan(self, wechat_pid: int | None = None) -> list[KeyResult]:
        """Scan WeChat process memory for SQLCipher keys.
        
        Returns list of KeyResult(db_path, cipher_key, salt).
        Requires re-signed WeChat binary on macOS.
        """
        ...

    def check_prerequisites(self) -> PrerequisiteStatus:
        """Check if WeChat is running and accessible."""
        ...
```

### 3.3 Data Layer — 我们自己的数据模型

这是 WeVault 的核心价值——**把微信的加密混沌数据，转化为结构化、可搜索、可持久化的归档**。

#### VaultStore Schema (SQLite + FTS5)

```sql
-- 联系人表（从 wccontact_new2.db 解析，本地持久化）
CREATE TABLE contacts (
    wxid         TEXT PRIMARY KEY,       -- 微信唯一 ID
    nickname     TEXT,                   -- 微信昵称
    remark       TEXT,                   -- 备注名
    avatar_url   TEXT,                   -- 头像 URL
    avatar_local TEXT,                   -- 本地头像路径
    pinyin       TEXT,                   -- 昵称拼音（搜索用）
    remark_py    TEXT,                   -- 备注拼音
    tags         TEXT,                   -- 标签 JSON array
    first_seen   INTEGER,               -- 首次归档时间
    last_active  INTEGER,               -- 最后朋友圈活动时间
    moment_count INTEGER DEFAULT 0      -- 已归档朋友圈条数
);

-- 朋友圈归档表
CREATE TABLE moments (
    id           TEXT PRIMARY KEY,       -- SnsTimeLine tid
    wxid         TEXT NOT NULL,          -- 发布者 wxid
    content      TEXT,                   -- 文字内容
    content_type INTEGER,               -- 1=图文 2=纯文本 3=链接 15=视频...
    create_time  INTEGER NOT NULL,       -- 发布 Unix 时间戳
    location_lat REAL,                   -- 纬度
    location_lng REAL,                   -- 经度
    location_poi TEXT,                   -- POI 名称
    is_private   INTEGER DEFAULT 0,     -- 仅自己可见
    raw_xml      TEXT,                   -- 原始 XML（保底）
    archived_at  INTEGER NOT NULL,       -- 归档时间
    FOREIGN KEY (wxid) REFERENCES contacts(wxid)
);

-- 朋友圈媒体（图片/视频）
CREATE TABLE moment_media (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    moment_id    TEXT NOT NULL,
    seq          INTEGER NOT NULL,       -- 在该条朋友圈中的序号
    media_type   TEXT,                   -- image / video
    width        INTEGER,
    height       INTEGER,
    local_path   TEXT,                   -- 解密后的本地文件路径
    thumb_path   TEXT,                   -- 缩略图路径
    original_url TEXT,                   -- 原始 CDN URL
    file_hash    TEXT,                   -- SHA256 for dedup
    FOREIGN KEY (moment_id) REFERENCES moments(id)
);

-- 评论与点赞
CREATE TABLE moment_interactions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    moment_id    TEXT NOT NULL,
    type         INTEGER,               -- 1=点赞 2=评论
    from_wxid    TEXT,
    from_name    TEXT,
    to_wxid      TEXT,
    to_name      TEXT,
    content      TEXT,
    create_time  INTEGER,
    FOREIGN KEY (moment_id) REFERENCES moments(id)
);

-- 全文搜索虚拟表
CREATE VIRTUAL TABLE moments_fts USING fts5(
    content,
    location_poi,
    content='moments',
    content_rowid='rowid',
    tokenize='unicode61'
);

-- 同步状态追踪
CREATE TABLE sync_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at   INTEGER NOT NULL,
    completed_at INTEGER,
    status       TEXT,                   -- running / completed / failed
    new_moments  INTEGER DEFAULT 0,
    new_contacts INTEGER DEFAULT 0,
    error_msg    TEXT
);
```

#### SyncEngine — 增量同步

```python
class SyncEngine:
    """Incremental sync from WeChat cache to VaultStore."""
    
    def sync(self, full: bool = False) -> SyncResult:
        """Execute a sync cycle.
        
        Workflow:
        1. KeyScanner.scan() → get current cipher keys
        2. DBDecryptor.decrypt(sns.db) → temp plaintext DB
        3. Query SnsTimeLine WHERE tid > last_synced_tid
        4. For each new row:
           a. XMLParser.parse(content) → structured moment
           b. Match + decrypt cached images via ImageDecryptor
           c. Upsert into VaultStore (moments + media + interactions)
        5. Update sync_log
        """
        ...
    
    def watch(self, interval: int = 300):
        """Daemon mode: poll every `interval` seconds."""
        ...
```

#### MediaVault — 解密媒体管理

```
~/.wevault/
├── vault.db              # VaultStore SQLite
├── media/
│   ├── moments/
│   │   ├── {wxid}/
│   │   │   ├── 20250101_120000_0.jpg
│   │   │   ├── 20250101_120000_1.jpg
│   │   │   └── ...
│   ├── avatars/
│   │   ├── {wxid}.jpg
│   │   └── ...
├── sync.lock             # 防止并发同步
└── config.toml           # 用户配置
```

- 文件名按 `{date}_{time}_{seq}.{ext}` 组织，人类可读
- 使用 SHA256 content hash 做去重，避免重复归档
- 头像独立存储，避免依赖微信 CDN

### 3.4 API Layer — 本地 REST 服务

FastAPI 本地服务，监听 `127.0.0.1:8199`，为 UI 提供数据。

```
GET  /api/contacts?q=zhang&sort=last_active&limit=20
GET  /api/contacts/{wxid}
GET  /api/moments?wxid={wxid}&before={ts}&limit=20
GET  /api/moments/search?q=旅行&wxid={wxid}
GET  /api/media/{moment_id}/{seq}          # 图片/视频文件
GET  /api/stats                            # vault 统计信息
POST /api/sync                             # 触发同步
GET  /api/sync/status                      # 同步状态
WS   /ws/sync                              # 实时同步进度推送
```

### 3.5 UI Layer — React + Tauri

**技术选型理由**：

| 候选方案 | 优点 | 缺点 | 结论 |
|---------|------|------|------|
| Nuxt (Vue) + Electron | WeChatDataAnalysis 已验证 | Electron 太重（200MB+），Nuxt SSR 对本地应用无意义 | ❌ |
| React + Electron | 生态最大 | Electron 体积 | ❌ |
| React + Tauri | 轻量（~5MB），Rust 安全，原生性能 | Tauri 学习曲线 | ✅ |
| React SPA + 浏览器 | 最简单 | 无法后台常驻，体验差 | 备选 |

**推荐 Tauri 2.x + React**：
- 打包体积 ~10MB（vs Electron 200MB+）
- 原生窗口，macOS 沉浸式标题栏
- Rust sidecar 可以直接运行 Python 解密脚本
- 开源友好（MIT license）

**但 v0.1 可以先做 React SPA + 浏览器访问**，快速验证产品逻辑，Tauri 封装放到 v0.2。

#### UI 组件树

```
<App>
├── <Sidebar>
│   ├── <SearchBar />           # 联系人搜索（fuzzy match）
│   ├── <ContactList>           # 联系人列表
│   │   ├── <ContactCard />     # 头像+昵称+备注+统计
│   │   └── ...
│   └── <SyncStatus />          # 底部同步状态条
├── <MainPanel>
│   ├── <ContactHeader />       # 当前联系人头部信息
│   ├── <TimelineSlider />      # 时间轴快速跳转
│   ├── <MomentFeed>            # 朋友圈 feed 流
│   │   ├── <MomentCard>        # 单条朋友圈
│   │   │   ├── <MomentText />  # 文字内容
│   │   │   ├── <ImageGrid />   # 图片九宫格
│   │   │   ├── <LocationPin /> # 位置信息
│   │   │   └── <Interactions/> # 评论+点赞
│   │   └── ...
│   └── <InfiniteScroll />      # 无限滚动加载
└── <Lightbox />                # 图片大图浏览
```

---

## 4. 与现有项目的关系

| 项目 | 我们怎么用 | 不用什么 |
|------|-----------|---------|
| **wechat-decrypt** | 直接引用 key 提取、DB 解密、SNS 图片解密、XML 解析的核心函数 | 不用它的 CLI 入口、Web UI、config 系统 |
| **WeChatDataAnalysis** | 参考 sns.vue 的 UI 交互模式、routers/sns.py 的 API 设计 | 不用它的 Nuxt 前端、Electron 打包、年度总结功能 |
| **wx-cli** | 参考 Rust 的 daemon 架构思路、sns_feed 的查询逻辑 | 不用 CLI 界面（我们做 GUI） |
| **wechat-export-macos** | 参考 macOS 特定的 key 提取方法 | 功能已被 wechat-decrypt 覆盖 |

**原则：Use their engine, build our chassis.**

---

## 5. 项目结构

```
wevault/
├── README.md                    # 项目介绍 + 快速上手
├── LICENSE                      # MIT
├── pyproject.toml               # Python 后端 (uv/pip)
├── package.json                 # 前端 (pnpm)
│
├── backend/                     # Python 后端
│   ├── wevault/
│   │   ├── __init__.py
│   │   ├── extractor/           # Layer 1: 封装解密逻辑
│   │   │   ├── __init__.py
│   │   │   ├── key_scanner.py   # 密钥提取
│   │   │   ├── db_decryptor.py  # DB 解密
│   │   │   ├── img_decryptor.py # 图片解密
│   │   │   ├── xml_parser.py    # SnsTimeLine XML 解析
│   │   │   └── platform/       # macOS / Windows 适配
│   │   │       ├── macos.py
│   │   │       └── windows.py
│   │   ├── data/                # Layer 2: 数据层
│   │   │   ├── __init__.py
│   │   │   ├── vault_store.py   # SQLite + FTS5 管理
│   │   │   ├── sync_engine.py   # 增量同步引擎
│   │   │   ├── media_vault.py   # 媒体文件管理
│   │   │   ├── contact_index.py # 联系人索引（拼音等）
│   │   │   └── schema.sql       # DDL
│   │   ├── api/                 # Layer 3: API 服务
│   │   │   ├── __init__.py
│   │   │   ├── server.py        # FastAPI app
│   │   │   ├── routes/
│   │   │   │   ├── contacts.py
│   │   │   │   ├── moments.py
│   │   │   │   ├── media.py
│   │   │   │   ├── search.py
│   │   │   │   └── sync.py
│   │   │   └── ws.py            # WebSocket
│   │   └── config.py            # 配置管理
│   ├── tests/
│   └── vendor/                  # git submodule: wechat-decrypt
│
├── frontend/                    # React 前端
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── sidebar/
│   │   │   │   ├── SearchBar.tsx
│   │   │   │   ├── ContactList.tsx
│   │   │   │   ├── ContactCard.tsx
│   │   │   │   └── SyncStatus.tsx
│   │   │   ├── timeline/
│   │   │   │   ├── MomentFeed.tsx
│   │   │   │   ├── MomentCard.tsx
│   │   │   │   ├── ImageGrid.tsx
│   │   │   │   ├── LocationPin.tsx
│   │   │   │   ├── Interactions.tsx
│   │   │   │   └── TimelineSlider.tsx
│   │   │   ├── lightbox/
│   │   │   │   └── Lightbox.tsx
│   │   │   └── dashboard/
│   │   │       └── Dashboard.tsx
│   │   ├── hooks/
│   │   │   ├── useContacts.ts
│   │   │   ├── useMoments.ts
│   │   │   └── useSyncStatus.ts
│   │   ├── lib/
│   │   │   └── api.ts           # API client
│   │   └── styles/
│   │       └── wechat-theme.css # 微信风格 UI 变量
│   ├── tailwind.config.js
│   └── vite.config.ts
│
├── tauri/                       # Tauri 桌面壳（v0.2）
│   ├── src-tauri/
│   └── tauri.conf.json
│
├── docs/
│   ├── architecture.md          # 本文档
│   ├── setup-guide.md           # 安装指南
│   ├── macos-permissions.md     # macOS 权限说明
│   └── screenshots/             # 项目截图
│
└── scripts/
    ├── setup.sh                 # 一键环境搭建
    ├── sync.sh                  # 手动同步脚本
    └── resign-wechat.sh         # macOS 重签微信脚本
```

---

## 6. 开发路线图

### Phase 0: Spike / PoC（1 周）

- [ ] 在本机成功跑通 wechat-decrypt 提取 sns.db 密钥
- [ ] 解密 sns.db，确认 SnsTimeLine 表结构
- [ ] 解密 5 张 SNS 缓存图片，验证 pipeline
- [ ] 用 SQLite 建好 VaultStore schema，跑通一次完整 sync

### Phase 1: Backend + CLI（2 周）

- [ ] Extractor 封装完成（key_scanner / db_decryptor / img_decryptor / xml_parser）
- [ ] VaultStore + SyncEngine 实现（增量同步 + FTS5）
- [ ] ContactIndex（拼音转换 + fuzzy search）
- [ ] FastAPI server 启动，核心 API 可用
- [ ] CLI 命令：`wevault sync` / `wevault search` / `wevault list`

### Phase 2: Web UI（2 周）

- [ ] Contact Explorer（搜索 + 列表 + 卡片）
- [ ] Moment Feed（时间线 + 图片九宫格 + 评论）
- [ ] Image Lightbox
- [ ] Timeline Slider（时间跳转）
- [ ] Sync Dashboard

### Phase 3: Polish + Package（1 周）

- [ ] Tauri 封装为 macOS 桌面应用
- [ ] 一键安装脚本
- [ ] README + 截图 + GIF demo
- [ ] GitHub Release + Homebrew formula

---

## 7. 差异化：为什么不直接用现有项目？

| 维度 | wechat-decrypt | WeChatDataAnalysis | WeVault (ours) |
|------|---------------|-------------------|----------------|
| **定位** | 解密工具库 | 全功能分析平台 | 朋友圈归档专精 |
| **体积** | 轻量 (Python) | 重（Nuxt + Electron） | 轻量（React + Tauri ~10MB） |
| **朋友圈** | 导出 HTML/JSON | 有浏览但与其他功能耦合 | 核心功能，精心打磨 |
| **搜索** | 无 | 基础 | FTS5 + 拼音 fuzzy match |
| **增量同步** | 无（每次全量） | 有（但与 realtime sync 耦合） | 独立的 SyncEngine |
| **数据持久化** | 临时输出 | 依赖原始加密 DB | 独立 VaultStore |
| **联系人体验** | 无 | 有但不是重点 | 一等公民：搜索、排序、分组 |
| **可扩展性** | 单文件脚本 | monolith | 分层架构，可插拔 |

**一句话**：现有项目要么太底层（纯工具），要么太庞大（全功能平台）。WeVault 取一个精准的切口——**朋友圈归档**，做到极致。

---

## 8. 技术风险与对策

| 风险 | 概率 | 影响 | 对策 |
|------|------|------|------|
| 微信更新导致密钥提取失效 | 中 | 高 | 上游项目跟进快（wechat-decrypt 持续更新），我们用 submodule 跟踪 |
| macOS Hardened Runtime 变更 | 低 | 高 | 提供详细的重签指南 + 自动化脚本 |
| 图片缓存格式变更 | 低 | 中 | 保留 raw_xml + original_url 兜底 |
| SQLCipher 版本升级 | 低 | 高 | wechat-decrypt 已处理 3.x → 4.x 迁移 |
| 腾讯法律风险 | 低 | 中 | 项目仅操作用户本地数据，不涉及网络爬取或协议逆向 |

---

## 9. 开源策略

### License

MIT — 最大化社区采用。

### README 结构

```markdown
# WeVault / 微迹
> Your WeChat moments, permanently yours.

[截图 / GIF demo]

## Features
- 🔍 Contact Explorer with fuzzy search
- ⏳ Moment Vault — never lose a moment again
- 📸 Full media archive with image decryption
- 🔄 Incremental sync
- 💻 macOS native app (Tauri)

## Quick Start
## How It Works
## Screenshots
## FAQ
## Contributing
## Credits & Upstream Projects
```

### 社区策略

- 中英双语 README
- 提供截图和 GIF demo（开源项目的第一印象决定 star 数）
- Issue template 分类：bug / feature request / 微信版本兼容性
- CONTRIBUTING.md 说明如何贡献
- 在 Credits 中充分致谢上游项目

---

## 10. 命名最终确认

功能名称映射：

| 内部模块 | 面向用户的名称 | 说明 |
|---------|--------------|------|
| Contact Explorer | 通讯录 | 左侧面板 |
| Moment Vault | 时光机 | 核心朋友圈浏览 |
| Sync Dashboard | 同步中心 | 设置与状态 |
| Full-text Search | 搜一搜 | 致敬微信搜索 |
| Image Lightbox | 图片浏览 | 全屏看图 |

项目名：**WeVault / 微迹**
Slogan：**你浏览过的每一条朋友圈，都值得被留住。**
Hero Feature：**时光机 — 看 ta 的「全部」朋友圈**
