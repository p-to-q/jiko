# Omi 之外的开源随身与桌面语音硬件调研

Status: **research synthesis; not a hardware selection or production-readiness claim**
Last reviewed: **2026-09-18 (Asia/Shanghai)**

## 结论先行

对 Jiko 最有用的参照不是另一个“AI 吊坠”的宣传规格，而是三种已经暴露真实工程边界的系统：

1. **Satellite1 / ReSpeaker** 说明桌面语音硬件应把确定性的采集、AEC、增益、静音和恢复放在音频边缘，把 STT、TTS 和产品逻辑留给本地 Linux 主机；
2. **SenseCAP Watcher** 说明双 MCU/SoC 只有在职责、固件、分区和恢复工具都被分别管理时才成立；
3. **Open Interpreter 01 Light** 公开展示了一个有 BOM、固件和工业设计工作的硬件原型仍可能因制造投入与用户价值不匹配而停止量产。

这些项目共同支持 Jiko 当前的分层方向：先用 Raspberry Pi 5/CM5 或笔记本拥有共享核心、本地 STT/TTS、结果与更新；以 USB/I²S 音频前端或可选 ESP32-S3 只承担有测量依据的实时工作。没有证据支持把 STT、TTS、三路 reading 或产品状态机塞进 MCU，也没有证据支持现在就做自定义主计算板。

最接近“可直接借”的是：

- Satellite1 的 **ESP32-S3 + 可独立升级 XMOS**、原始音频旁路、版本探测和首启刷写；
- ReSpeaker 的 **已量产 USB 音频基线、处理/原始通道配置和 DFU 失败史**；
- Watcher 的 **版本化事件模块、A/B app 分区和独立协处理器恢复口**；
- Limitless 的 **设备 → 手机 → 云三级 store-and-forward、存满显式报错和设备静态加密**，但 Jiko 应将终点改成本地 Pi；
- 01 Light 的 **push-to-talk 事件边界和完整制造决策记录**，而不是它的未认证明文 WebSocket。

没有一个候选同时提供完整可编辑 PCB、可采购 BOM、全部固件源、纯本地语音链路、量产更新/回滚、可复现续航和热数据。后文因此把“公开”“可构建”“已发货”“可恢复”分别描述，不把它们混成一个“开源硬件”标签。

## 范围、证据和成熟度

Omi 已在 [`mature-device-systems-research.md`](./mature-device-systems-research.md) 中单独研究；本文件只处理 Omi 以外的项目，并解释 Friend/OpenGlass 与 Omi 的谱系，避免重复计数。Omi consumer 是 nRF5340 + BLE/手机/后端的边缘采集系统，4 Gbit NAND 的固件可用上限约 480 MiB；它不是 CM5 类主机，也不应把 DevKit2 的 8 GB 表述外推到 consumer。

| 项目 | 2026-09-17 状态 | 开放证据 | 工程成熟度判断 | 对 Jiko 的主要价值 |
| --- | --- | --- | --- | --- |
| FutureProofHomes Satellite1 | 有发货硬件和持续维护的 ESPHome/XMOS 仓库 | 原理图/STEP、ESP32 固件、XMOS 源与 DFU；公开硬件仓库未提供可编辑 PCB/BOM | 本组最接近可维护桌面产品，但仍有音频路由和功放热故障报告 | 音频协处理器边界、版本化刷写、恢复和实物问题库 |
| Seeed SenseCAP Watcher | 在售桌面设备；SDK 2026-07 仍有更新 | 原理图、STEP、ESP32 SDK、两颗芯片的工厂镜像；无完整 BOM/PCB 源 | 已产品化，但语音默认依赖服务，双芯片恢复复杂 | 任务流/事件模块、双固件分区与身份保护 |
| Seeed ReSpeaker 系列 | 多代量产音频模组 | 主机工具、例程、DFU 镜像；不同代际的 DSP 源与硬件开放度不同 | 音频前端成熟，不能等同于完整开源语音设备 | Jiko EVT 的即插即用声学基准和故障注入对象 |
| Mycroft Mark II | 历史产品/仓库近年基本静止 | 可编辑 KiCad、生产 BOM、Gerber、STEP、装配资料和 PCBA 测试夹具；仓库根未见明确 LICENSE | 发布包和夹具信息密度高，但不能作为新运行时依赖或直接复制授权 | 量产 artifact、serial 追踪和端到端工厂 fixture |
| Open Interpreter 01 Light | 2024-09 已停止制造，仓库 2024-11 后基本静止 | 原型 BOM、外壳、ESP32 固件、服务器、制造报告 | 失败但信息量高的硬件原型，不是可采购产品 | 打板前 PRD、电源/射频/音频取舍和停止条件 |
| OpenSQZ Glass | 2026 新发布研究平台，7 个主分支提交量级 | STEP、3MF、脱敏 BOM、ESP32 音视频固件、宿主运行时 | 研究原型；作者明确列出未验证项 | 穿戴端感知/附近主机计算拆分及诚实的成熟度台账 |
| BasedHardware OpenGlass | 仓库明确停止支持并迁入 Omi | 低成本 BOM、BLE 音视频固件、应用 | 历史原型；不是独立活跃基线 | 小型感知端约束与“没有缓存/OTA/电源测量”的反例 |
| Friend | 官方仓库 URL 已重定向到 Omi | 当前没有独立官方基线 | 不应再作为 Omi 之外的独立项目统计 | 谱系结论本身；不要从第三方旧 fork 推导当前硬件 |
| Limitless Pendant | 闭源商业产品 | 官方帮助中心只公开行为/运维事实，无 BOM/MCU/固件 | 产品行为较成熟，硬件不可复刻 | store-and-forward、隐私指示、满盘和失窃语义 |
| AudioMoth | 持续维护的低功耗声学记录器生态 | MCU 固件、HID/桌面配置/校时/刷写工具；官方硬件开放有代际延迟 | service/update 经验成熟，但不是交互语音设备 | service mode、时钟/版本查询、恢复刷写和低功耗测量 |

文中的 commit/date 是本轮实际检查的 **pinned snapshot** 或当时页面记录，不声称仍是仓库 current HEAD；未固定 commit 的动态页面会继续变化。动态帮助中心页面在 `2026-09-17` 重新核查。

“公开在 GitHub”也不等于可复制。硬件设计、代码、模型、DSP binary
和数据集要分别记录许可证、commit/hash、再分发义务与供应商条款。
本轮在 Mycroft Mark II、OpenSQZ OpenGlass 和 ReSpeaker Lite 的仓库根未
找到足以授权复制整个项目的明确 LICENSE，因此它们在许可证澄清前只
用于研究/测试，不把设计文件并入 Jiko。Satellite1 的硬件许可和 01
的软件许可也不能自动覆盖第三方芯片固件、模型或媒体资产。

## 1. Satellite1：当前最值得拆解的桌面语音硬件

### 架构与硬件分工

Satellite1 将矩形 **Core** 与圆形 **HAT** 分开。Core 是 ESP32-S3-WROOM-1-N16R8（双核 240 MHz、16 MB flash、8 MB PSRAM）；HAT 使用 XMOS XU316（16 核 xCORE、外部 flash）处理音频，板上有 4 颗 PDM 麦克风、PCM5122 线性输出、TAS2780 功放、24 颗 WS2812、FUSB302 USB-PD 控制器和环境传感器。公开产品说明明确写着现有 XMOS 固件仍只使用 4 麦中的 2 麦，不能把“焊了四颗”写成“四麦算法已验证”。来源：[`Satellite1` 产品页，核查于 2026-09-17](https://futureproofhomes.net/products/satellite1-smart-speaker)、[官方介绍](https://docs.futureproofhomes.net/satellite1-introduction/)。

硬件仓库发布各版原理图、STEP 和修订历史，使用 CERN-OHL-S-2.0；仓库最后硬件提交为 `2025-04-15`。但公开树是 PDF/STEP，不含 KiCad 源与生产 BOM，所以它是**有强开放意图的参考设计**，还不是下载后即可重打板的完整生产包。来源：[Satellite1-Hardware](https://github.com/FutureProofHomes/Satellite1-Hardware)。

### 音频链路与离线边界

典型路径是：

```text
4 x PDM mic（当前固件实际使用 2）
  -> XMOS XU316：AEC / NS / AGC、参考信号对齐
  -> I²S / SPI 控制
  -> ESP32-S3：microWakeWord、流式传输、LED/按键/静音
  -> 局域网 Home Assistant Assist / Wyoming
  -> 本地 STT、意图、TTS
  -> ESP32-S3 -> PCM5122 / TAS2780 -> 扬声器
```

官方资料称互联网不是必需条件，但 Home Assistant 和局域网仍是正常语音链路的依赖；设备没有公开的离线音频 WAL。它是“本地网络优先”，不是“网络消失仍完整完成一次 turn”。来源：[Satellite1 官方介绍](https://docs.futureproofhomes.net/satellite1-introduction/)、[Satellite1-ESPHome](https://github.com/FutureProofHomes/Satellite1-ESPHome)。

XMOS 仓库同时提供 `fixed_delay` 处理管线和 `bypass` 原始麦克风旁路。后者对 Jiko 特别重要：同一套硬件必须能输出原始和处理后信号，才能判断算法改善、削波、相位、延迟和语音失真，而不是只接受一个不可解释的“AI mic”输出。来源：[Satellite1-XMOS README，本轮检查快照](https://github.com/FutureProofHomes/Satellite1-XMOS)。

### 电源、热与声学

桌面成品要求 30 W USB-C PD，板级最高支持 20 V/5 A，主要是为 20–25 W 扬声器路径服务；它没有电池设计，不能直接推导 Jiko 随身版的续航。官方 FAQ 已把供电不足列为失真/低音量排查项。来源：[产品页](https://futureproofhomes.net/products/satellite1-smart-speaker)、[官方 FAQ](https://docs.futureproofhomes.net/satellite1-faqs/)。

真实现场报告比规格更有价值：

- `2026-05-14` 的 [#508](https://github.com/FutureProofHomes/Satellite1-ESPHome/issues/508) 报告 TAS2780 在中等音量持续播放后进入过温锁定，软件 stop 不能恢复，需较长断电；外接 line-out 不复现。它是一份用户报告，不能证明所有设备都有缺陷，但足以要求 Jiko 对功放、供电和封闭外壳做持续负载热测，而不是只播一次提示音。
- `2026-05-29` 的 [#521](https://github.com/FutureProofHomes/Satellite1-ESPHome/issues/521) 报告一次音频管线升级后，状态仍从 `responding` 回到 `idle`，实体扬声器却没有声音。Jiko 必须把“状态机完成”和“PCM 实际出声”作为两个收据。

### 升级与恢复

ESP32 侧使用 ESPHome OTA 并启用 `safe_mode`。XMOS 侧更值得借鉴：ESP32 启动时读取 XMOS 版本/状态；生产配置可携带带 MD5 的 factory image，在 XMOS 无响应或版本不符时经 SPI 首启刷写；音频输出保持静音直至协处理器可响应。XMOS 仓库分别产出：

- `factory.bin`：boot partition、factory image 和 data partition 的完整镜像；
- `upgrade.bin`：仅当设备已有带 DFU 的 factory image 时可用；
- `.xe`：开发/调试镜像。

设备还保留 USB DFU、XMOS 硬复位和外部 xTAG 开发路径。来源：[ESPHome 基线配置](https://github.com/FutureProofHomes/Satellite1-ESPHome/blob/5262560/config/satellite1.base.yaml)、[XMOS 构建与 DFU 说明](https://github.com/FutureProofHomes/Satellite1-XMOS/blob/6d3ac98/README.md)。

### Jiko 可借与不可照搬

可直接借：独立音频固件版本、启动握手、原始旁路、factory/upgrade 分离、刷写时关闭功放、失败状态可见、ESP32 与 XMOS 两侧都保留有线恢复。Jiko 的可选 MCU/AFE 也应由 Pi 查询 `firmware_version`、`audio_profile`、`boot_reason` 和 `health`，而不是只看 USB/串口是否存在。

不可照搬：Home Assistant/ESPHome 是其产品核心，不是 Jiko 的共享核心；高功率音乐播放链使其电源和热预算远大于 Jiko；局域网在线不等于一次 Jiko 会话已持久接收；“硬件静音”仍需在 Jiko 原理图上证明是切断麦克风供电/时钟还是软件状态，不能按文案推断。

## 2. SenseCAP Watcher：双芯片边缘任务设备

### 架构、BOM 可见度和音频链路

Watcher 是桌面/壁挂设备而非全天候 wearable。主控 ESP32-S3（240 MHz、8 MB PSRAM、32 MB flash）负责 1.45 英寸 412×412 触摸屏、Wi-Fi/BLE、microSD、旋钮、I²S 单麦克风和 1 W 扬声器；Himax HX6538（Cortex-M55 + Ethos-U55、16 MB flash）处理摄像头与本地视觉推理。OV5647 摄像头通过 MIPI 接入 Himax。来源：[官方硬件概览，最后标注更新 2024-10-18](https://wiki.seeedstudio.com/watcher_hardware_overview/)。

OSHW 仓库提供 v1.0 原理图、外壳 STEP、两颗芯片的 datasheet 和工厂镜像，但没有生产 BOM、布局/Gerber 或可编辑原理图；Himax 工厂镜像公开不等于其完整固件可修改。来源：[OSHW-SenseCAP-Watcher，本轮检查快照](https://github.com/Seeed-Studio/OSHW-SenseCAP-Watcher)。

语音是按住滚轮的 push-to-talk。官方建议距离麦克风仅 3–10 cm、尽量减少背景噪声；错误 `0x7002` 被定义为网络不佳导致音频服务调用失败，说明默认语音语义不是设备内闭环。Himax 可离线运行已下载视觉模型；LLM/语音服务默认来自 SenseCraft。所谓“本地部署”仍需要另一台 Windows/Mac/Linux/Jetson 主机，官方最低配置表给出 8–16 GB RAM 和 20 GB 存储，并警告性能不足时设备会长时间停在观察状态。来源：[官方操作与刷写说明](https://github.com/Seeed-Studio/OSHW-SenseCAP-Watcher#-by-voice)、[本地部署指南，页面标注更新 2025-09-11](https://wiki.seeedstudio.com/watcher_local_deploy/)。

### 任务流设计

固件把 APP、UI/交互和 task flow 分开。task flow 用 JSON 描述带版本的模块、参数和 `wires`，引擎负责注册、实例化、连接、启动和销毁；模块通过 ESP event pipeline 传递有类型的数据。这一点与 Jiko “一套事件协议、两个 runtime shell”很接近。来源：[Watcher Software Framework，页面标注更新 2024-11-05](https://wiki.seeedstudio.com/watcher_software_framework/)。

Jiko 应借的是版本化事件/模块边界，而不是通用 Node-RED 运行时。物理按键、浏览器 demo 控件和真实麦克风最终都必须生成现有 canonical 事件，例如 `session.created`、`input.recording.started`、`input.recording.stopped`、`audio.uploaded` 和 `session.reset`；三路 reading 仍由共享 core 的确定性顺序拥有。若边缘链路内部使用 `AudioFrame` 或 start/stop/cancel 控制帧，它们只是 adapter-private transport，必须在硬件边缘映射为 canonical 事件，不能进入 core 成为第二套产品协议。当前 canonical protocol 没有独立的 `cancelled` 事件；在协议正式扩展并有 reducer 测试前，适配器不得自行发明一个。

### 电源、升级与恢复

Watcher 使用 5 V/1 A，3.7 V 400 mAh 电池只被描述为 backup power，工作温度 0–45 °C；官方没有给出续航、持续推理温升或充电时运行测试，不能把 400 mAh 误写为已验证移动续航。

ESP32 当前 factory 分区表包含独立 `nvsfactory`、`nvs`、`otadata`、两个 12 MB app slot、模型和 storage 分区，具备 A/B OTA 的结构基础。来源：[factory `partitions.csv`，pinned revision `8e37f7c`](https://github.com/Seeed-Studio/SenseCAP-Watcher-Firmware/blob/8e37f7c/examples/factory_firmware/partitions.csv)。但公开材料没有给出签名、自动回滚和失败计数的完整产品契约，不能仅凭两个 slot 宣称“安全更新”。

ESP32 与 Himax 有两个串口和两套镜像。官方明确警告：写错 ESP32 分区地址会擦除 EUI/工厂身份，设备可能无法再接入 SenseCraft；刷写前必须记录设备信息。Himax 则只建议在恢复时刷写，且不建议用户修改。设备 shell 提供 OTA、factory info、reboot、factory reset、录音到 SD 和网络测试。来源：[官方刷写说明](https://github.com/Seeed-Studio/OSHW-SenseCAP-Watcher#-flash-firmware)。

### Jiko 可借与不可照搬

可借：协处理器职责独立、模块输入/输出类型、task-flow 版本、A/B app、工厂身份单独分区、双串口恢复和 SD 上的可检查 PCM。不可照搬：云账号/EUI 绑定、单麦近讲仍宣称通用语音、两颗芯片却没有统一恢复编排、把外部 PC 推理称作“on-device”，以及 400 mAh backup 数据外推为产品续航。

## 3. ReSpeaker：先把它当音频仪器，不要当完整产品

### 两代可用基线

**ReSpeaker Lite** 使用 XMOS XU316 和 2 麦阵列，可作为 USB Audio 设备，也可刷 I²S 固件连接 XIAO ESP32-S3/树莓派。公开算法能力包括 AEC、AGC、NS、干扰消除和 VNR；有 5 W speaker path 与 3.5 mm 输出。官方对比表给出 3 m 拾音、16/48 kHz 固件路径，但仓库主要发布二进制 XMOS 镜像、Arduino 控制例程和 DFU 文档，没有完整 DSP 源、BOM 或明确仓库许可证。因此“GitHub 可下载”不应写成“全栈开源”。来源：[官方入门页](https://wiki.seeedstudio.com/reSpeaker_usb_v3/)、[ReSpeaker_Lite 本轮检查快照](https://github.com/respeaker/ReSpeaker_Lite)。

较老的 **USB 4 Mic Array** 使用 XMOS XVF3000、4 颗 MP34DT01-M PDM 麦克风和 WM8960 codec/功放，能刷 1 通道 ASR 处理音频或 6 通道（处理音频 + 4 原始麦 + playback）固件。这是 Jiko 做 enclosure/AEC 基准很好的现成设备。来源：[官方硬件页](https://wiki.seeedstudio.com/ReSpeaker-USB-Mic-Array/)、[Apache-2.0 主机/DFU 仓库](https://github.com/respeaker/usb_4_mic_array)。

两者都不拥有 STT/TTS，云边界由主机决定。这正符合 Jiko 的本地策略：麦克风板只交付有版本的 PCM/音频特征，本地 Pi worker 运行 STT/TTS；不要因音频板能做 VAD 就让它拥有会话、reading 或 UI 状态。

### 真实固件坑与恢复

- ReSpeaker Lite 有 USB 和 I²S 两类互斥固件；I²S 16 kHz 例程若配 48 kHz 镜像会产生响亮静电。官方 FAQ 在 `2026-09-01` 重新验证了该边界。来源：[ReSpeaker Lite FAQ](https://wiki.seeedstudio.com/respeaker_lite_faq/)。
- Lite 的 [#6（2025-02-22）](https://github.com/respeaker/ReSpeaker_Lite/issues/6) 报告 DFU 显示成功但版本仍停在 1.0.9；[#12（2026-05-06）](https://github.com/respeaker/ReSpeaker_Lite/issues/12) 报告树莓派 I²S 设备能枚举但播放噪声、录音近乎无效。二者是未必已归因的现场报告，却准确说明“DFU 返回 0”和“ALSA card 出现”都不是验收终点。
- USB 4 Mic Array 的 flash 制程由 90 nm 变 65 nm 后 JEDEC ID 有 1 bit 差异；新板刷 `v2.0.0` 或更老镜像后会继续工作却失去后续升级能力，`v3.0.0+` 才兼容新旧硬件。来源：[官方 README 的 DFU 矩阵](https://github.com/respeaker/usb_4_mic_array/blob/master/README.md#device-firmware-update)。

ReSpeaker Lite 只支持受规约的 5 V 供电，没有公开的单节锂电直供合同；它也不是 Jiko 的移动功耗证明。来源：[官方 FAQ，最后验证 2026-09-01](https://wiki.seeedstudio.com/respeaker_lite_faq/#can-i-power-respeaker-lite-directly-from-a-single-cell-lithium-battery)。

### Jiko 可借与不可照搬

在任何自研音频 PCB 前，Jiko 应先用 ReSpeaker USB profile 完成：原始/处理音频同时录制、扬声器回放时 AEC、USB 拔插、主机休眠恢复、100 次 DFU、错误采样率、8 小时连续采集和可控 USB VBUS 断电恢复。输出 profile 必须包含 firmware hash、通道图、sample format/rate、处理开关，主机启动后实际录一段测试音，而不是只枚举设备。

不要照搬二进制 DSP 锁定、手工选择固件文件、无回滚 DFU，或把供应商的“3 m/5 m”当成 Jiko 外壳里的测量结果。

## 4. Mycroft Mark II：开放发布包和工厂夹具比旧软件更值得学

Mycroft Core 已归档，不应成为 Jiko 的运行时依赖；但固定在
[`f416bf3`](https://github.com/MycroftAI/hardware-mycroft-mark-II/tree/f416bf342547c56f575e91eb9acb2df50f1f8a16)
的 Mark II hardware tree 展示了一个硬件项目应交付什么：可编辑
KiCad、生产 BOM、Gerber、STEP、装配资料和各代原型边界，而不是只有
产品图和 PDF 原理图。

它的 [PCBA programming/test
jig](https://github.com/MycroftAI/hardware-mycroft-mark-II/blob/f416bf342547c56f575e91eb9acb2df50f1f8a16/mark-II-Rpi-devkit/code/TestingJig/mycroftPCBAprogramAndTest.py)
会烧录 ATtiny、查询 XMOS/TAS/ATtiny、检查按键/静音，并播放固定 wake
phrase 做 microphone + speaker 的端到端检查。Jiko 应借的是 fixture
形状：每台 DUT 绑定 serial、hardware revision、OS/app/model/MCU/DSP
hash、fixture/calibration version 与逐项结果；同一个 synthetic turn
仍进入 canonical event protocol。

不能照搬的是维护状态、一次短语的二值 pass/fail 和脚本中的宽泛异常
处理。单短语只能是量产测试的一项，不能替代每麦极性/幅度/自噪、扬声
器回环、物理静音、电流和更新恢复。仓库根未见明确 LICENSE，因此这些
文件在授权澄清前只能作为研究范本，不能直接复制进 Jiko PCB。

## 5. Open Interpreter 01 Light：最有价值的是停止制造的复盘

### 原型与拟量产架构

可构建原型使用 M5Stack ATOM Echo（ESP32-PICO，内置 PDM mic、扬声器、按钮）、Adafruit PowerBoost 1000、500 mAh LiPo、开关和 3D 打印外壳，公开 BOM 总计约 `$42.38`，可选 PAM8302 功放。来源：[01 Light BOM](https://github.com/OpenInterpreter/01/blob/befddaf/hardware/light/Manufacturing%20Report/Manufacturing%20-%2001%20Light%20Report.md)、[材料清单](https://github.com/OpenInterpreter/01/blob/befddaf/docs/hardware/01-light/materials.mdx)。

制造报告进一步为自研板选择 ESP32-PICO-MINI-02、SPH0645LM4H-B I²S 麦克风、MCP73871 load-sharing 充电器、buck/boost/LDO 和候选 haptic，目标包括 `<55 × 55 × 38 mm`、P0 成本 `<$70`、4 小时 BT 或 2 小时 Wi-Fi active、IP53、跌落和 75 °C 外壳上限。关键是这些多数是**要求/选型，不是已通过试验的性能**。

### 音频、主机与事件边界

设备按下按钮后发 `audio start`，以 16 kHz/16-bit raw PCM 经 WebSocket 发给 01 Server，释放按钮发 `audio end`；服务端在主机运行 STT、解释器和 TTS，再把 PCM 送回 ESP32 扬声器。Light server 可用 faster-whisper/RealtimeSTT 和本地 Coqui TTS；较新的 LiveKit 路径也有 Deepgram/OpenAI/ElevenLabs 等云选项。来源：[ESP32 client](https://github.com/OpenInterpreter/01/blob/befddaf/software/source/clients/esp32/src/client/client.ino)、[Light server](https://github.com/OpenInterpreter/01/blob/befddaf/software/source/server/server.py)、[Local profile](https://github.com/OpenInterpreter/01/blob/befddaf/software/source/server/profiles/local.py)。

这一条 `button -> start/audio/end -> server` 很适合 Jiko：实体按钮与手动 demo 控件应发送完全相同的事件，不应有一条直接改 UI 的假数据路径。

### 失败史、更新与安全缺口

官方在 `2024-09-09` 宣布退掉硬件订单、停止制造 01 Light：五人团队若继续制造会牺牲软件，ESP32 硬件带来的价值不足以覆盖智能手机已有的能力。来源：[官方复盘 “It should have been an app”](https://changes.openinterpreter.com/log/01-app)。这是 Jiko 最应吸收的 go/no-go 条件：自研硬件必须在可感知输入、隐私、可靠性或仪式性上提供手机/笔记本确实无法提供的价值。

公开固件还暴露了具体原型问题：

- 音频只有约 10 KB RAM buffer，直接发二进制帧；没有 sequence/ack、本地 WAL 或重放；
- 直连使用 `ws://`/普通 `WiFiClient`，server 显式关闭认证/ack，凭据存 ESP32 Preferences；
- mic 16 kHz，而扬声器采样率根据 Coqui 24 kHz 或 OpenAI 22.05 kHz 手改宏；
- 报告称旧 PlatformIO/ESP-IDF 的 I²S driver 与其他库产生音频问题，因此转向 ESP-IDF 5.3；
- USB-C 固件更新只列为 P1 要求，公开实现没有 A/B、签名、回滚或独立恢复镜像。

可借的是 PRD、制造报告、push-to-talk 和 host/device 分工；不可照搬的是明文未认证流、硬编码供应商采样率、没有帧身份/持久化的网络发送，以及在 P0 完成后才考虑安全。

## 6. OpenGlass：必须区分两个同名项目

### OpenSQZ Glass（2026，独立研究项目）

OpenSQZ 的新项目明确采用 sensing-computing split：眼镜端 XIAO ESP32-S3 Sense + OV5640-AF 摄像头 + 板载 PDM mic；附近用户控制的 Windows/Linux 主机运行 ASR/VLM/TTS 或 MiniCPM-o。脱敏 BOM 还列出 551050 电池、Type-C 充电模块、8 mm 自锁开关与线材；2026-07-22 发布 STEP、3MF 和 BOM。来源：[项目 README](https://github.com/OpenSQZ/OpenGlass)、[硬件状态表](https://github.com/OpenSQZ/OpenGlass/blob/main/hardware/README.md)、[脱敏 BOM](https://github.com/OpenSQZ/OpenGlass/raw/main/hardware/bom/A01_bom_public.xlsx)。

音频端用 16 kHz mono PCM16 LE、20 ms/640-byte WebSocket frame，摄像头走 MJPEG；camera DVP 与 PDM/I²S 并行，ESP32 只做 DC offset removal 和软件增益。推理在附近主机本地完成，这是比把大模型塞进穿戴端更可信的热/功耗边界。来源：[ESP32 固件](https://github.com/OpenSQZ/OpenGlass/blob/main/CameraWebServer_PDM_Audio/CameraWebServer_PDM_Audio.ino)。

但它主动列出的缺口同样重要：

- Arduino 分区选择是 `Huge APP (3MB No OTA)`，没有 OTA/回滚；
- Wi-Fi sleep 被关闭，账号仍直接写进 `.ino`，音频是局域网 `ws://`；
- clean-machine 端到端安装未通过，控制面板仍有维护者机器的绝对路径；
- wiring diagram、pin map、焊接指南、STL、完整硬件验证尚未公开；
- 电池容量/续航、充电/调试、舒适度、热和最终打印参数均标为待验证；项目明确禁止在未验证前边充电边佩戴。

来源：[公开限制清单](https://github.com/OpenSQZ/OpenGlass#known-limitations)、[硬件指南](https://github.com/OpenSQZ/OpenGlass/blob/main/hardware/README.md)、[安全与隐私边界](https://github.com/OpenSQZ/OpenGlass/blob/main/docs/safety_privacy.md)。

Jiko 可借“感知端不跑大模型”、本地 session record/replay、设备/模型/论文快照三者不混同，以及逐项公开未验证状态。不可照搬无 TLS 的持续音视频、无缓存、无 OTA、关闭 Wi-Fi sleep 和未验证的头戴电池结构。

### BasedHardware OpenGlass（2024 原型，已并入 Omi）

旧 OpenGlass 用 XIAO ESP32-S3 Sense、250 mAh LiPo 和打印夹具，目标 BOM `<$25`。PDM 麦克风支持 16 kHz PCM、8 kHz μ-law 和仍在开发的 Opus；音频帧有 16-bit frame counter，照片以约 200-byte BLE notification 分片。来源：[已停止维护的 README](https://github.com/BasedHardware/OpenGlass/blob/19f0777/README.md)、[固件](https://github.com/BasedHardware/OpenGlass/blob/19f0777/firmware/firmware.ino)。

该代码没有离线存储、确认/重放或 OTA；掉线时只停止发送。更严重的是 `updateBatteryLevel()` 仍是 TODO，电量一直报告初始化的 100。README 顶部反复声明项目已迁到 Omi、不再支持。因此它只适合作为“小端采集，大端处理”的历史原型和反例，不是当前硬件候选。

## 7. Friend：当前不是 Omi 之外的独立证据

截至 2026-09-17，`https://github.com/BasedHardware/friend` 直接重定向到 [BasedHardware/omi](https://github.com/BasedHardware/friend)，当前 Omi 仓库也保留 `friend`、`necklace` 话题。第三方 fork 仍能看到早期 XIAO nRF52840 Sense/BLE 版本，但这些不是当前官方维护基线，本文件不以它们推导 BOM、续航或协议。

结论：Friend 是 Omi 的历史谱系，不应作为“另一个成熟开源仓库”增加样本数；其可复用经验已由 Omi 专节覆盖。

## 8. Limitless Pendant：闭源，但 store-and-forward 语义值得学

Limitless 没有公开 MCU/SoC、BOM、原理图、音频 codec、固件更新或恢复机制，不能作为开源硬件复刻来源。官方资料能确认的产品行为是：

- 设备只在检测到语音时保留音频；离开手机可存约 **35 小时连续语音**；存满后停止录音并闪红；
- 回到手机附近后经 Bluetooth 自动卸载，手机无互联网时再在手机保存数周，联网后才上云；
- 配对时执行 hardware-security-module-backed key exchange，设备上音频静态加密且不在 Pendant 解密；
- 录音时白灯不可完全关闭；整日连续录音后建议每晚充电；IP54、0–45 °C；官方特别警告不要用 USB-PD 充电器；
- 正常处理仍是手机 + 云，官方隐私说明允许第三方服务参与转写/摘要。

来源：[存储与三级卸载，核查于 2026-09-17](https://help.limitless.ai/en/articles/10761340-pendant-storage)、[失窃设备加密](https://help.limitless.ai/en/articles/11071474-lost-pendant)、[硬件/电池/环境 FAQ](https://help.limitless.ai/en/articles/9124757-pendant-faq)、[录音指示与旁观者数据](https://help.limitless.ai/en/articles/13004190-talking-to-someone-wearing-the-pendant-what-to-expect-and-how-we-handle-your-information)。

Jiko 应借三级所有权转移的**语义**，但改成本地：edge ring/WAL → Pi durable session → 本地 STT/receipt。每一级只有在下一级持久确认后才能删除；空间不足必须显式失败。不可照搬 24/7 录音、手机必需、云转写、长期音频/人声身份保留或不可审计闭源固件。

## 9. AudioMoth：借 service mode，不借长期录音产品定义

[AudioMoth Basic
Firmware](https://github.com/OpenAcousticDevices/AudioMoth-Firmware-Basic/tree/c5d2b660e7c974c3ecfe5fbe8b95359949e1adba)
与独立的 desktop 配置、校时和刷写工具构成了一个成熟的设备服务面。
[AudioMoth HID](https://github.com/OpenAcousticDevices/AudioMoth-HID) 可以读取
firmware version/description、查询设备并进入 bootloader。Jiko 的电脑壳
因此不只应看 reading，也要有受控 service mode：读取设备身份、固件与
audio profile hash、时钟偏差、boot/reset reason，导出内容无关诊断并
触发恢复刷写；配置和固件都作为有版本的 artifact 留 receipt。

AudioMoth 还证明低功耗音频要以 duty-cycle、时钟、sample count 和实测
电流描述，而不是只引用 MCU data sheet。但它没有 speaker/AEC/STT/UI
latency，默认长期保存原始声学数据也违反 Jiko 的短会话隐私边界。官方
[open-source policy](https://www.openacousticdevices.info/open-source) 对硬件
开放还有代际延迟，因此“生态开源”也不能被写成“当前硬件可立即复制”。

## 跨项目后得到的 Jiko 硬件合同

### 设备到主机的最小协议

无论首版使用 USB 麦克风、ReSpeaker、I²S HAT 还是 ESP32-S3，边缘适配器至少应提供：

```text
DeviceHello {
  hardware_rev, firmware_hash, boot_reason,
  audio_profile_id, sample_rate, sample_format, channel_map,
  processing_flags, recovery_capabilities
}

AudioFrame {
  session_id, attempt_id, sequence,
  device_monotonic_ns, flags,
  pcm_or_codec_payload
}

AudioHealth {
  captured_frames, delivered_frames, overwritten_frames,
  clipping_frames, input_overruns, transport_retries,
  ring_fill, temperature, supply_mv
}
```

设备的 start/stop/reset 意图必须映射到现有 Jiko canonical 事件；实体按钮和手工 demo 只是不同 event producer。`AudioFrame`、`DeviceHello` 和 `AudioHealth` 是 adapter-private 传输/诊断包，不是新的 core 事件。当前协议没有独立的 cancel 事件，取消先按共享 reset/error 合同收口，只有在协议、reducer 和两端测试一起扩展时才新增。主机只在帧进入可重放 ring/WAL 后确认所有权。设备枚举、WebSocket connected 或状态机变 `idle` 都不是音频成功。

### 离线与云边界

- 正常 Jiko turn 的 STT/TTS、特征、reading 和结果合成都在 Pi/笔记本本地运行；MCU 只做 capture、时间戳、level/clipping、可选 VAD/AEC 和有界缓存。
- 不引入付费云音频 API；任何未来远程能力必须是显式 opt-in adapter，断网测试仍能完成核心 turn。
- 原始录音默认会话结束后删除；调试留存必须是 dev-only、可见并有期限。设备缓存只解决可靠传输，不变成全天候 lifelog。

### 更新与故障恢复

借 Satellite1 和 Watcher，但补足其缺口：

1. 主机、MCU/AFE、模型、配置分别有版本和兼容矩阵；
2. app 更新使用签名 A/B 或等价原子切换；factory/recovery 与 upgrade artifact 分开；
3. 工厂身份/校准数据在独立受保护分区，量产刷写脚本不得默认擦除；
4. 正常 OTA 之外保留无需主应用运行的 USB/串口恢复、物理 boot strap 和可控电源；
5. 刷写前后核对 hash、版本、音频 profile 和一段实际 PCM；失败计数触发回滚，不以“命令返回 0”判断成功；
6. Pi 能独立复位/断电音频边缘，音频边缘故障不能锁死共享 core。

## 自定义打板前的工程门槛

以下未全部通过前，继续使用 Pi + 现成 USB/I²S 音频板；不要进入自定义主板 EVT。

### 1. 可测的产品收益

- 用现成设备完成 Jiko 全链路并确认自研板要解决的唯一问题：体积、启动、掉帧、AEC、自噪、功耗或供应，而不是“看起来更像产品”。
- 至少在两套现成前端上测 Mandarin CER/English WER、首字丢失、削波、噪声、扬声器回声、p50/p95 latency；给出 enclosure 内的结果。
- 明确 ESP32/AFE 的 measured job；若 Linux/USB 已满足 SLO，不增加第二颗可升级芯片。

### 2. 音频与机械 EVT

- 同步保留 raw/processed profile，固定通道图、sample rate/format 和校准版本；
- 麦克风口、防尘网、扬声器腔、风扇/电感/屏幕噪声、线缆和结构传声必须用实壳 A/B 测量；
- 播放 sweep/提示音/本地 TTS 时测 AEC、残余回声和双讲，不只测安静房间近讲；
- 机械样机做按键噪声、桌面振动、跌落、线缆拉力、热区和维护口检查。

### 3. 功耗与热

- 建立 `off / standby / listening / infer / playback / charge+use / recovery` 电源表，记录平均、峰值和 brownout margin；
- 在最低/最高输入、0/25/45 °C、最长本地推理和最长扬声器输出下测 SoC、PMIC、充电器、功放、电池和外壳接触面；
- 过温必须降级并自动恢复；软件 stop 后仍锁死、只能拔电源的状态不准进入 demo 冻结版；
- wearable 先通过电芯保护、充电热、短路/反接和边充边用验证，不能用容量数字代替续航与安全试验。

### 4. 更新、恢复与 24 小时运行

- 断电发生在 erase/write/verify/switch-boot 每个阶段时，100 次注入均可回到旧版或 recovery；
- 测错误镜像、错误硬件 revision、降级、满盘、工厂数据保护和离线更新；
- 做 USB/I²S/BLE/Wi-Fi 断开重连、主机休眠、边缘重启、ring 满和 sequence gap fixture；
- 最少 24 小时 soak 记录帧丢失、延迟漂移、温度、RSSI/USB reset、内存和恢复次数。

### 5. 生产与可维修性

- 原理图 ERC、PCB DRC、PI/SI、RF/EMC、ESD、音频地/电源、麦克风 keep-out 和天线净空经过专项 review；
- 目标市场、radio/天线/外壳冻结后，在 DVT 前完成 RF/EMC/ESD pre-scan；Compute Module 或官方天线的认证资料不能自动替最终 host 产品完成合规；
- 冻结带 manufacturer part number、替代料、生命周期、MOQ/lead time 的 BOM；
- 每块板有 test pads、电流测量点、boot/recovery、唯一 ID、校准区和制造测试固件；
- 夹具能验证每颗 mic、speaker、静音、电源轨、存储、radio、温度、更新与恢复；测试结果绑定 DUT serial、硬件 revision、fixture/calibration version；
- 量产台账记录 first-pass yield、retest rate、station cycle time 与校准漂移，不用一次短语通过率代替过程能力；
- 发布包包含可编辑设计源、Gerber/装配文件、BOM、固件 hash、刷写 map、factory/recovery、known-issues ledger，以及硬件/代码/模型/binary 的 SPDX/许可证与再分发清单。

## 推荐的下一步实验

1. **不打板**：在 Pi 5 上并排测试 ReSpeaker Lite USB profile、USB 4 Mic Array raw+processed profile 和当前麦克风，产出同一批 fixed clips 与扬声器回放 AEC 数据。
2. 给现有 device adapter 增加上面的 `DeviceHello/AudioFrame/AudioHealth` 最小字段；用手工 demo 控件发同一事件，验证 shared core 不感知硬件型号。
3. 先用 labgrid 编排 Pi/CM、USB 音频、可控电源/USB hub、串口和仪表；ESP32 spike 用 pytest-embedded 管刷写、serial/JTAG 和多 DUT。做 8 小时采集和重连，注入断电、错误 sample rate、silent-but-enumerated 和通道为空；两套 harness 只编排真实 adapter，不另造产品事件协议。
4. 只有当 USB/Linux 测到具体 SLO 失败，再做 ESP32-S3 capture/control spike；先用开发板 + 外置 flash/ring，不画主板。
5. spike 通过后再写 CM5 carrier/音频前端 EVT brief；其中必须包含 recovery、factory test、热和声学验收，而不仅是原理图与 BOM。

## 仍需验证的缺口

补充的 [audio instrument and production systems study](research-audio-instrument-production-systems.md)
覆盖了本表原先缺少的两类证据：Tympan 的工厂生产包、换料和声学验收，
以及 OpenEarable 暴露的深度放电、存储噪声、身份恢复和许可证风险。
Tympan 的方法进入桌面 Jiko 的生产 gate；OpenEarable 只在未来贴身/耳戴
分支启用，不改变当前 Pi 5/CM5 方向。

- 本调研没有购买或上电这些设备；规格、更新路径与问题报告来自官方仓库/文档，现场 issue 不等于已确认根因。
- Satellite1 的公开硬件树没有生产 BOM/KiCad 源；Watcher 没有完整 BOM/layout；ReSpeaker Lite 的 DSP 镜像不是完整源；Limitless 完全闭源。
- 现有资料没有可直接迁移到 Jiko 外壳的功耗、AEC、自噪、热或续航数据；这些都必须在 Jiko 实物上重测。
- OpenSQZ Glass 与 01 Light 都明确是/曾是原型；它们提供架构和失败证据，不提供量产背书。
- “local”在不同项目中可能表示 ESP32 本地、附近 PC、本地网络 Home Assistant 或用户自建服务。当前两壳工程政策的 local/self-hosted 是用户控制的设备、笔记本或明确配置的自托管主机，且不使用付费云音频 API；长期自包含 Jiko One 的更严格目标才是正常音频不离开设备/其 Pi 或 CM 主机，WAN 被阻断仍完成核心 turn。两者都不是第三方托管音频默认路径。
