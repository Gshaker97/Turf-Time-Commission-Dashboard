import { createRequire } from 'node:module'
// pdf-parse 1.1.1 is CommonJS. ESM import gives its entry no module.parent,
// accidentally running its debug harness. createRequire uses the supported
// CommonJS API without starting server.js or changing the package version.
const requirePdf = createRequire(import.meta.url)
let parse
export async function parseSignedPdfText(bytes) {
  parse ||= requirePdf('pdf-parse')
  // Bundled PDF.js substreams ignore byteOffset on pooled Node Buffers.
  // An exact-length offset-zero copy avoids reading unrelated backing-pool bytes.
  const result = await parse(Uint8Array.from(bytes))
  if (typeof result.text !== 'string') throw Error('PDF text unavailable')
  return result.text
}
