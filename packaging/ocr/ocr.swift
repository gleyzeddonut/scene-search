import Foundation
import PDFKit
import Vision
import AppKit

// Usage: scripty-ocr <pdf-path>  → recognized text, pages separated by form-feed.
guard CommandLine.arguments.count > 1,
      let doc = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1])) else { exit(2) }

var pages = [String]()
let maxPages = min(doc.pageCount, 200)
for i in 0..<maxPages {
  guard let page = doc.page(at: i) else { continue }
  let b = page.bounds(for: .mediaBox)
  let img = page.thumbnail(of: NSSize(width: b.width * 2, height: b.height * 2), for: .mediaBox)
  guard let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { continue }
  let req = VNRecognizeTextRequest()
  req.recognitionLevel = .accurate
  req.usesLanguageCorrection = false
  try? VNImageRequestHandler(cgImage: cg, options: [:]).perform([req])
  let obs = req.results ?? []
  let sorted = obs.sorted { $0.boundingBox.origin.y > $1.boundingBox.origin.y }
  pages.append(sorted.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n"))
}
print(pages.joined(separator: "\u{0C}\n"))
