import AppKit

// Rasterize the editable layered-mat SVG with native alpha.
let source = CommandLine.arguments[1], output = CommandLine.arguments[2]
let size = CommandLine.arguments.count > 3 ? Int(CommandLine.arguments[3])! : 1024
guard let artwork = NSImage(contentsOfFile: source) else { fatalError("Cannot load icon SVG") }
let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
    colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
NSGraphicsContext.current?.imageInterpolation = .high
artwork.draw(in: NSRect(x: 0, y: 0, width: size, height: size))
NSGraphicsContext.restoreGraphicsState()
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: output))
