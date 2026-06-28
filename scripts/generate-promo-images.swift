#!/usr/bin/env swift

import AppKit
import CoreGraphics
import Foundation

struct Tone {
    let red: CGFloat
    let green: CGFloat
    let blue: CGFloat
    let alpha: CGFloat

    init(_ hex: UInt32, alpha: CGFloat = 1) {
        red = CGFloat((hex >> 16) & 0xff) / 255
        green = CGFloat((hex >> 8) & 0xff) / 255
        blue = CGFloat(hex & 0xff) / 255
        self.alpha = alpha
    }

    func withAlpha(_ value: CGFloat) -> Tone {
        Tone(red: red, green: green, blue: blue, alpha: value)
    }

    private init(red: CGFloat, green: CGFloat, blue: CGFloat, alpha: CGFloat) {
        self.red = red
        self.green = green
        self.blue = blue
        self.alpha = alpha
    }

    var cg: CGColor {
        CGColor(red: red, green: green, blue: blue, alpha: alpha)
    }
}

struct Palette {
    static let page = Tone(0x2b2a25)
    static let graphite = Tone(0x34322d)
    static let graphiteLight = Tone(0x4a4740)
    static let screen = Tone(0x11100d)
    static let ink = Tone(0xeae8e1)
    static let inkDim = Tone(0xbdb8aa)
    static let orange = Tone(0xb36a4a)
    static let red = Tone(0xc95f4c)
    static let amber = Tone(0xb58a45)
    static let green = Tone(0x79a56d)
}

struct Canvas {
    let width: Int
    let height: Int
    let context: CGContext
}

let repoRoot = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let outputDir = repoRoot.appendingPathComponent("docs/assets/promo", isDirectory: true)
try FileManager.default.createDirectory(at: outputDir, withIntermediateDirectories: true)

let pixelFont = NSFont(name: "Geist Pixel Square", size: 32)
let monoFont = NSFont.monospacedSystemFont(ofSize: 22, weight: .regular)
let monoBoldFont = NSFont.monospacedSystemFont(ofSize: 22, weight: .semibold)
let zhFont = NSFont(name: "Hiragino Sans GB", size: 28) ?? NSFont.systemFont(ofSize: 28, weight: .medium)

func makeCanvas(width: Int, height: Int) -> Canvas {
    let colorSpace = CGColorSpaceCreateDeviceRGB()
    let context = CGContext(
        data: nil,
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: 0,
        space: colorSpace,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    )!
    context.setAllowsAntialiasing(true)
    context.setShouldAntialias(true)
    context.translateBy(x: 0, y: CGFloat(height))
    context.scaleBy(x: 1, y: -1)
    return Canvas(width: width, height: height, context: context)
}

func save(_ canvas: Canvas, name: String) throws {
    guard let image = canvas.context.makeImage() else {
        throw NSError(domain: "jiko-promo", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not create CGImage"])
    }
    let rep = NSBitmapImageRep(cgImage: image)
    guard let data = rep.representation(using: .png, properties: [:]) else {
        throw NSError(domain: "jiko-promo", code: 2, userInfo: [NSLocalizedDescriptionKey: "Could not encode PNG"])
    }
    let url = outputDir.appendingPathComponent(name)
    try data.write(to: url)
    print(url.path)
}

func draw(_ canvas: Canvas, named name: String, render: (CGContext, CGSize) -> Void) throws {
    let size = CGSize(width: canvas.width, height: canvas.height)
    render(canvas.context, size)
    try save(canvas, name: name)
}

func fill(_ ctx: CGContext, _ rect: CGRect, _ color: Tone) {
    ctx.setFillColor(color.cg)
    ctx.fill(rect)
}

func rounded(_ rect: CGRect, radius: CGFloat) -> CGPath {
    CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil)
}

func fillRounded(_ ctx: CGContext, _ rect: CGRect, radius: CGFloat, _ color: Tone) {
    ctx.addPath(rounded(rect, radius: radius))
    ctx.setFillColor(color.cg)
    ctx.fillPath()
}

func strokeRounded(_ ctx: CGContext, _ rect: CGRect, radius: CGFloat, _ color: Tone, width: CGFloat) {
    ctx.addPath(rounded(rect, radius: radius))
    ctx.setStrokeColor(color.cg)
    ctx.setLineWidth(width)
    ctx.strokePath()
}

func linearGradient(_ ctx: CGContext, rect: CGRect, colors: [Tone], start: CGPoint, end: CGPoint) {
    let gradient = CGGradient(
        colorsSpace: CGColorSpaceCreateDeviceRGB(),
        colors: colors.map(\.cg) as CFArray,
        locations: nil
    )!
    ctx.saveGState()
    ctx.clip(to: rect)
    ctx.drawLinearGradient(gradient, start: start, end: end, options: [])
    ctx.restoreGState()
}

func radialGlow(_ ctx: CGContext, center: CGPoint, radius: CGFloat, color: Tone) {
    let gradient = CGGradient(
        colorsSpace: CGColorSpaceCreateDeviceRGB(),
        colors: [color.cg, color.withAlpha(0).cg] as CFArray,
        locations: [0, 1]
    )!
    ctx.drawRadialGradient(
        gradient,
        startCenter: center,
        startRadius: 0,
        endCenter: center,
        endRadius: radius,
        options: [.drawsAfterEndLocation]
    )
}

func drawBackdrop(_ ctx: CGContext, size: CGSize, accent: Tone = Palette.orange) {
    let rect = CGRect(origin: .zero, size: size)
    fill(ctx, rect, Palette.page)
    linearGradient(
        ctx,
        rect: rect,
        colors: [Tone(0x37352f), Palette.page, Tone(0x201f1b)],
        start: CGPoint(x: size.width * 0.5, y: -size.height * 0.12),
        end: CGPoint(x: size.width * 0.5, y: size.height)
    )
    radialGlow(ctx, center: CGPoint(x: size.width * 0.52, y: size.height * 0.04), radius: size.width * 0.62, color: Palette.ink.withAlpha(0.08))
    radialGlow(ctx, center: CGPoint(x: size.width * 0.32, y: size.height * 0.72), radius: size.width * 0.42, color: accent.withAlpha(0.1))
}

func drawText(
    _ ctx: CGContext,
    _ text: String,
    at point: CGPoint,
    font: NSFont,
    color: Tone,
    width: CGFloat = 1000,
    alignment: NSTextAlignment = .left,
    lineHeight: CGFloat? = nil
) {
    let style = NSMutableParagraphStyle()
    style.alignment = alignment
    if let lineHeight {
        style.minimumLineHeight = lineHeight
        style.maximumLineHeight = lineHeight
    }
    let attrs: [NSAttributedString.Key: Any] = [
        .font: font,
        .foregroundColor: NSColor(cgColor: color.cg)!,
        .paragraphStyle: style,
        .kern: 0
    ]
    let string = NSAttributedString(string: text, attributes: attrs)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(cgContext: ctx, flipped: true)
    string.draw(in: CGRect(x: point.x, y: point.y, width: width, height: 900))
    NSGraphicsContext.restoreGraphicsState()
}

func drawCenteredText(
    _ ctx: CGContext,
    _ text: String,
    in rect: CGRect,
    font: NSFont,
    color: Tone,
    lineHeight: CGFloat? = nil
) {
    let style = NSMutableParagraphStyle()
    style.alignment = .center
    if let lineHeight {
        style.minimumLineHeight = lineHeight
        style.maximumLineHeight = lineHeight
    }
    let attrs: [NSAttributedString.Key: Any] = [
        .font: font,
        .foregroundColor: NSColor(cgColor: color.cg)!,
        .paragraphStyle: style,
        .kern: 0
    ]
    let string = NSAttributedString(string: text, attributes: attrs)
    let textSize = string.boundingRect(
        with: CGSize(width: rect.width, height: 900),
        options: [.usesLineFragmentOrigin, .usesFontLeading]
    ).size
    let drawRect = CGRect(
        x: rect.minX,
        y: rect.midY - textSize.height / 2,
        width: rect.width,
        height: textSize.height + 8
    )
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(cgContext: ctx, flipped: true)
    string.draw(in: drawRect)
    NSGraphicsContext.restoreGraphicsState()
}

func drawLine(_ ctx: CGContext, from: CGPoint, to: CGPoint, color: Tone, width: CGFloat) {
    ctx.setStrokeColor(color.cg)
    ctx.setLineWidth(width)
    ctx.move(to: from)
    ctx.addLine(to: to)
    ctx.strokePath()
}

func drawDevice(
    _ ctx: CGContext,
    origin: CGPoint,
    scale: CGFloat,
    state: [Tone] = [Palette.red, Palette.green, Palette.amber],
    resultCopy: String = "不是所有灯都看向同处。\n你身上仍有回声。",
    showShadow: Bool = true
) {
    let body = CGRect(x: origin.x, y: origin.y, width: 380 * scale, height: 620 * scale)
    let bezel = body.insetBy(dx: 32 * scale, dy: 54 * scale)
    let screen = bezel.insetBy(dx: 9 * scale, dy: 9 * scale)
    let panel = screen.insetBy(dx: 18 * scale, dy: 16 * scale)

    if showShadow {
        ctx.saveGState()
        ctx.setShadow(offset: CGSize(width: 0, height: 42 * scale), blur: 58 * scale, color: Tone(0x000000, alpha: 0.58).cg)
    }

    fillRounded(ctx, body, radius: 46 * scale, Palette.graphite)
    linearGradient(
        ctx,
        rect: body,
        colors: [Palette.graphiteLight.withAlpha(0.82), Palette.graphite, Tone(0x24231f)],
        start: CGPoint(x: body.minX, y: body.minY),
        end: CGPoint(x: body.maxX, y: body.maxY)
    )
    if showShadow { ctx.restoreGState() }

    strokeRounded(ctx, body.insetBy(dx: 1, dy: 1), radius: 46 * scale, Tone(0xffffff, alpha: 0.08), width: 1.2 * scale)

    let strap = CGRect(x: body.midX - 55 * scale, y: body.minY + 22 * scale, width: 110 * scale, height: 13 * scale)
    fillRounded(ctx, strap, radius: 7 * scale, Tone(0x171612))

    let side = CGRect(x: body.maxX - 2 * scale, y: body.midY - 78 * scale, width: 14 * scale, height: 156 * scale)
    fillRounded(ctx, side, radius: 8 * scale, Tone(0x3a3832))
    strokeRounded(ctx, side, radius: 8 * scale, Tone(0xffffff, alpha: 0.1), width: 1 * scale)

    for point in [
        CGPoint(x: body.minX + 19 * scale, y: body.minY + 21 * scale),
        CGPoint(x: body.maxX - 19 * scale, y: body.minY + 21 * scale),
        CGPoint(x: body.minX + 19 * scale, y: body.maxY - 24 * scale),
        CGPoint(x: body.maxX - 19 * scale, y: body.maxY - 24 * scale)
    ] {
        ctx.addEllipse(in: CGRect(x: point.x - 5 * scale, y: point.y - 5 * scale, width: 10 * scale, height: 10 * scale))
        ctx.setFillColor(Tone(0x6a665d).cg)
        ctx.fillPath()
    }

    fillRounded(ctx, bezel, radius: 40 * scale, Tone(0x13120f))
    strokeRounded(ctx, bezel, radius: 40 * scale, Tone(0xffffff, alpha: 0.06), width: 1 * scale)

    fillRounded(ctx, screen, radius: 30 * scale, Tone(0x171611))
    fillRounded(ctx, panel, radius: 24 * scale, Tone(0x0f0e0b, alpha: 0.7))
    strokeRounded(ctx, panel, radius: 24 * scale, Tone(0xffffff, alpha: 0.08), width: 1 * scale)

    let strip = CGRect(
        x: screen.minX + 34 * scale,
        y: screen.minY + 24 * scale,
        width: 252 * scale,
        height: 76 * scale
    )
    fillRounded(ctx, strip, radius: 16 * scale, Palette.screen)
    strokeRounded(ctx, strip, radius: 16 * scale, Palette.orange.withAlpha(0.36), width: 1.2 * scale)
    for index in 0..<3 {
        let dotX = strip.minX + 13 * scale
        let dotY = strip.minY + CGFloat(18 + index * 19) * scale
        let dotSize = 7 * scale
        let dot = CGRect(
            x: dotX,
            y: dotY,
            width: dotSize,
            height: dotSize
        )
        ctx.addEllipse(in: dot)
        ctx.setFillColor(Palette.green.cg)
        ctx.fillPath()
    }
    drawCenteredText(
        ctx,
        resultCopy,
        in: strip.insetBy(dx: 34 * scale, dy: 6 * scale),
        font: NSFont(name: "Hiragino Sans GB", size: 15.5 * scale) ?? NSFont.systemFont(ofSize: 15.5 * scale, weight: .medium),
        color: Palette.ink,
        lineHeight: 22 * scale
    )

    let windows = [
        CGRect(x: screen.minX + 42 * scale, y: screen.minY + 116 * scale, width: 236 * scale, height: 102 * scale),
        CGRect(x: screen.minX + 42 * scale, y: screen.minY + 234 * scale, width: 236 * scale, height: 102 * scale),
        CGRect(x: screen.minX + 42 * scale, y: screen.minY + 352 * scale, width: 236 * scale, height: 102 * scale)
    ]

    for (index, window) in windows.enumerated() {
        let tone = state[index]
        fillRounded(ctx, window, radius: 23 * scale, Tone(0x15130f))
        radialGlow(ctx, center: CGPoint(x: window.midX, y: window.midY), radius: 92 * scale, color: tone.withAlpha(0.22))
        strokeRounded(ctx, window, radius: 23 * scale, tone.withAlpha(0.36), width: 1.2 * scale)

        ctx.addEllipse(in: CGRect(x: window.midX - 42 * scale, y: window.midY - 42 * scale, width: 84 * scale, height: 84 * scale))
        ctx.setFillColor(Tone(0x0d0c09).cg)
        ctx.fillPath()
        ctx.addEllipse(in: CGRect(x: window.midX - 40 * scale, y: window.midY - 40 * scale, width: 80 * scale, height: 80 * scale))
        ctx.setStrokeColor(tone.withAlpha(0.72).cg)
        ctx.setLineWidth(2.3 * scale)
        ctx.strokePath()

        drawGlyph(ctx, center: CGPoint(x: window.midX, y: window.midY), scale: scale * 1.08, tone: tone, variant: index)
    }

    drawCenteredText(
        ctx,
        "jiko",
        in: CGRect(x: body.minX, y: body.maxY - 42 * scale, width: body.width, height: 24 * scale),
        font: pixelFont?.withSize(17 * scale) ?? NSFont.monospacedSystemFont(ofSize: 17 * scale, weight: .semibold),
        color: Tone(0xffffff, alpha: 0.18)
    )
}

func drawGlyph(_ ctx: CGContext, center: CGPoint, scale: CGFloat, tone: Tone, variant: Int) {
    let cell = 6 * scale
    let gap = 2 * scale
    let patterns: [[[Int]]] = [
        [
            [0, 1, 1, 1, 0],
            [1, 0, 1, 0, 1],
            [1, 1, 1, 1, 1],
            [0, 1, 1, 1, 0],
            [0, 1, 0, 1, 0],
            [1, 1, 1, 1, 1]
        ],
        [
            [0, 0, 1, 0, 0],
            [0, 1, 1, 1, 0],
            [1, 1, 1, 1, 1],
            [0, 1, 1, 1, 0],
            [0, 0, 1, 0, 0],
            [0, 1, 1, 1, 0]
        ],
        [
            [1, 0, 0, 0, 1],
            [0, 1, 0, 1, 0],
            [0, 0, 1, 0, 0],
            [0, 1, 1, 1, 0],
            [1, 0, 1, 0, 1],
            [0, 1, 0, 1, 0]
        ]
    ]
    let pattern = patterns[variant % patterns.count]
    let width = CGFloat(pattern[0].count) * cell + CGFloat(pattern[0].count - 1) * gap
    let height = CGFloat(pattern.count) * cell + CGFloat(pattern.count - 1) * gap
    let origin = CGPoint(x: center.x - width / 2, y: center.y - height / 2)
    for (rowIndex, row) in pattern.enumerated() {
        for (colIndex, bit) in row.enumerated() where bit == 1 {
            let rect = CGRect(
                x: origin.x + CGFloat(colIndex) * (cell + gap),
                y: origin.y + CGFloat(rowIndex) * (cell + gap),
                width: cell,
                height: cell
            )
            fillRounded(ctx, rect, radius: 1.4 * scale, tone)
        }
    }
}

func drawSignalBars(_ ctx: CGContext, rect: CGRect) {
    let tones = [Palette.red, Palette.green, Palette.amber]
    let labels = ["TEXT", "VOICE", "TIMING"]
    for index in 0..<3 {
        let y = rect.minY + CGFloat(index) * rect.height / 3 + 18
        let h: CGFloat = 56
        let tone = tones[index]
        fillRounded(ctx, CGRect(x: rect.minX, y: y, width: rect.width, height: h), radius: 12, Tone(0xffffff, alpha: 0.025))
        drawText(ctx, labels[index], at: CGPoint(x: rect.minX + 22, y: y + 16), font: monoBoldFont.withSize(18), color: tone, width: 180)
        for step in 0..<18 {
            let barHeight = CGFloat([12, 20, 32, 16, 44, 28, 18, 36, 24, 46, 30, 14, 22, 34, 18, 40, 26, 16][step])
            fillRounded(
                ctx,
                CGRect(
                    x: rect.minX + 168 + CGFloat(step) * 16,
                    y: y + h / 2 - barHeight / 2,
                    width: 6,
                    height: barHeight
                ),
                radius: 3,
                tone.withAlpha(0.48)
            )
        }
    }
}

func drawWordmarkBlock(_ ctx: CGContext, point: CGPoint, scale: CGFloat = 1) {
    drawText(
        ctx,
        "jiko",
        at: point,
        font: pixelFont?.withSize(72 * scale) ?? NSFont.monospacedSystemFont(ofSize: 72 * scale, weight: .semibold),
        color: Palette.ink,
        width: 420 * scale
    )
    drawText(
        ctx,
        "四窗口信号仪",
        at: CGPoint(x: point.x + 3 * scale, y: point.y + 88 * scale),
        font: zhFont.withSize(24 * scale),
        color: Palette.orange,
        width: 420 * scale
    )
}

func drawFineGrid(_ ctx: CGContext, size: CGSize, alpha: CGFloat = 0.035) {
    ctx.setStrokeColor(Tone(0xffffff, alpha: alpha).cg)
    ctx.setLineWidth(1)
    let spacing: CGFloat = 48
    var x: CGFloat = 0
    while x <= size.width {
        drawLine(ctx, from: CGPoint(x: x, y: 0), to: CGPoint(x: x, y: size.height), color: Tone(0xffffff, alpha: alpha), width: 1)
        x += spacing
    }
    var y: CGFloat = 0
    while y <= size.height {
        drawLine(ctx, from: CGPoint(x: 0, y: y), to: CGPoint(x: size.width, y: y), color: Tone(0xffffff, alpha: alpha), width: 1)
        y += spacing
    }
}

try draw(makeCanvas(width: 1600, height: 900), named: "jiko-promo-hero.png") { ctx, size in
    drawBackdrop(ctx, size: size, accent: Palette.green)
    drawFineGrid(ctx, size: size, alpha: 0.018)
    drawDevice(
        ctx,
        origin: CGPoint(x: 975, y: 112),
        scale: 0.98,
        state: [Palette.red, Palette.green, Palette.amber],
        resultCopy: "不是所有灯都看向同处。\n你身上仍有回声。"
    )
    drawWordmarkBlock(ctx, point: CGPoint(x: 130, y: 204), scale: 1.25)
    drawText(
        ctx,
        "一个会听见分歧的\n可穿戴信号仪。",
        at: CGPoint(x: 134, y: 400),
        font: zhFont.withSize(50),
        color: Palette.ink,
        width: 640,
        lineHeight: 68
    )
    drawText(
        ctx,
        "TEXT · VOICE · TIMING",
        at: CGPoint(x: 139, y: 620),
        font: monoFont.withSize(22),
        color: Palette.inkDim,
        width: 620
    )
    drawSignalBars(ctx, rect: CGRect(x: 132, y: 682, width: 540, height: 160))
}

try draw(makeCanvas(width: 1080, height: 1350), named: "jiko-promo-poster.png") { ctx, size in
    drawBackdrop(ctx, size: size, accent: Palette.orange)
    drawFineGrid(ctx, size: size, alpha: 0.018)
    drawText(
        ctx,
        "jiko",
        at: CGPoint(x: 90, y: 78),
        font: pixelFont?.withSize(78) ?? NSFont.monospacedSystemFont(ofSize: 78, weight: .semibold),
        color: Palette.ink,
        width: 400
    )
    drawText(ctx, "SIGNAL INSTRUMENT / 01", at: CGPoint(x: 94, y: 177), font: monoFont.withSize(20), color: Palette.orange, width: 500)
    drawDevice(
        ctx,
        origin: CGPoint(x: 335, y: 252),
        scale: 1.08,
        state: [Palette.red, Palette.green, Palette.amber],
        resultCopy: "小路亮了一下。\n不代表你要走，但它在。"
    )
    drawText(
        ctx,
        "说出一个意图。\n让三盏灯各自作证。",
        at: CGPoint(x: 94, y: 1058),
        font: zhFont.withSize(44),
        color: Palette.ink,
        width: 780,
        lineHeight: 62
    )
    drawText(ctx, "MAINTAIN / DEVIATE / STATIC", at: CGPoint(x: 96, y: 1222), font: monoFont.withSize(20), color: Palette.inkDim, width: 700)
}

try draw(makeCanvas(width: 1200, height: 1200), named: "jiko-promo-square.png") { ctx, size in
    drawBackdrop(ctx, size: size, accent: Palette.red)
    radialGlow(ctx, center: CGPoint(x: 640, y: 650), radius: 420, color: Palette.orange.withAlpha(0.12))
    drawDevice(
        ctx,
        origin: CGPoint(x: 408, y: 212),
        scale: 0.96,
        state: [Palette.red, Palette.amber, Palette.green],
        resultCopy: "答案太整齐了。\n它们都同意，但你还在。"
    )
    drawCenteredText(
        ctx,
        "jiko",
        in: CGRect(x: 0, y: 76, width: size.width, height: 98),
        font: pixelFont?.withSize(76) ?? NSFont.monospacedSystemFont(ofSize: 76, weight: .semibold),
        color: Palette.ink
    )
    drawCenteredText(
        ctx,
        "不是答案机器，是信号仪。",
        in: CGRect(x: 0, y: 1010, width: size.width, height: 80),
        font: zhFont.withSize(38),
        color: Palette.ink
    )
    drawCenteredText(
        ctx,
        "TEXT / VOICE / TIMING",
        in: CGRect(x: 0, y: 1096, width: size.width, height: 36),
        font: monoFont.withSize(19),
        color: Palette.orange
    )
}

try draw(makeCanvas(width: 1600, height: 900), named: "jiko-promo-signal-readings.png") { ctx, size in
    drawBackdrop(ctx, size: size, accent: Palette.amber)
    drawFineGrid(ctx, size: size, alpha: 0.02)
    let left = CGRect(x: 104, y: 132, width: 610, height: 690)
    fillRounded(ctx, left, radius: 28, Tone(0x0d0c0b, alpha: 0.78))
    strokeRounded(ctx, left, radius: 28, Palette.orange.withAlpha(0.22), width: 1)
    drawText(ctx, "三种读数", at: CGPoint(x: 154, y: 190), font: zhFont.withSize(54), color: Palette.ink, width: 420)
    drawText(ctx, "同一句话，不必得出同一个方向。", at: CGPoint(x: 157, y: 278), font: zhFont.withSize(25), color: Palette.inkDim, width: 500)
    drawSignalBars(ctx, rect: CGRect(x: 154, y: 400, width: 500, height: 230))
    drawText(ctx, "RESULT COPY", at: CGPoint(x: 158, y: 685), font: monoFont.withSize(17), color: Palette.orange, width: 240)
    drawText(ctx, "信号没有站稳。\n这一轮先别相信。", at: CGPoint(x: 157, y: 724), font: zhFont.withSize(30), color: Palette.ink, width: 440, lineHeight: 43)

    drawDevice(
        ctx,
        origin: CGPoint(x: 1000, y: 126),
        scale: 0.98,
        state: [Palette.amber, Palette.red, Palette.green],
        resultCopy: "信号没有站稳。\n这一轮先别相信。"
    )

    drawText(ctx, "jiko", at: CGPoint(x: 780, y: 120), font: pixelFont?.withSize(62) ?? NSFont.monospacedSystemFont(ofSize: 62, weight: .semibold), color: Palette.ink, width: 280)
    drawText(ctx, "LOCAL FIRST · QUIET BY DESIGN", at: CGPoint(x: 784, y: 204), font: monoFont.withSize(18), color: Palette.orange, width: 460)
}
