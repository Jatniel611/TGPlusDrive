/**
 * Ofusca el BUNDLE compilado (out/main, out/preload) antes de empaquetar.
 * El código fuente en src/ NUNCA se toca: puedes seguir editándolo normal.
 * Solo se ejecuta en `npm run dist` (no en dev ni en build normal).
 */
const fs = require('node:fs')
const path = require('node:path')
const JavaScriptObfuscator = require('javascript-obfuscator')

const root = path.resolve(__dirname, '..')
const targets = [
  path.join(root, 'out', 'main', 'index.js'),
  path.join(root, 'out', 'preload', 'index.js')
]

const options = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.4,
  deadCodeInjection: false,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal',
  numbersToExpressions: true,
  renameGlobals: false,
  selfDefending: false,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 8,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayEncoding: ['base64'],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 2,
  stringArrayWrappersChainedCalls: true,
  stringArrayWrappersParametersMaxCount: 4,
  stringArrayWrappersType: 'function',
  stringArrayThreshold: 0.75,
  transformObjectKeys: true,
  unicodeEscapeSequence: false
}

let ok = 0
for (const file of targets) {
  if (!fs.existsSync(file)) {
    console.log(`[obfuscate] omitido (no existe): ${path.relative(root, file)}`)
    continue
  }
  try {
    const code = fs.readFileSync(file, 'utf8')
    const result = JavaScriptObfuscator.obfuscate(code, options).getObfuscatedCode()
    fs.writeFileSync(file, result, 'utf8')
    ok += 1
    console.log(
      `[obfuscate] ${path.relative(root, file)}: ${(code.length / 1024).toFixed(0)} KB -> ${(result.length / 1024).toFixed(0)} KB`
    )
  } catch (err) {
    console.error(`[obfuscate] error en ${file}: ${err.message}`)
    process.exitCode = 1
  }
}
console.log(`[obfuscate] ${ok} archivo(s) ofuscado(s)`)
