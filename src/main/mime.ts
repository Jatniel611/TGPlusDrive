const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  avif: 'image/avif',
  jxl: 'image/jxl',
  heic: 'image/heic',
  heif: 'image/heif',
  arw: 'image/x-sony-arw',
  srf: 'image/x-sony-srf',
  sr2: 'image/x-sony-sr2',
  cr2: 'image/x-canon-cr2',
  cr3: 'image/x-canon-cr3',
  nef: 'image/x-nikon-nef',
  nrw: 'image/x-nikon-nrw',
  dng: 'image/x-adobe-dng',
  orf: 'image/x-olympus-orf',
  rw2: 'image/x-panasonic-rw2',
  raf: 'image/x-fuji-raf',
  pef: 'image/x-pentax-pef',
  srw: 'image/x-samsung-srw',
  raw: 'image/x-raw',
  rwl: 'image/x-leica-rwl',
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  mov: 'video/quicktime',
  webm: 'video/webm',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  '3gp': 'video/3gpp',
  '3g2': 'video/3gpp2',
  ogv: 'video/ogg',
  m2ts: 'video/mp2t',
  mts: 'video/mp2t',
  vob: 'video/dvd',
  divx: 'video/divx',
  asf: 'video/x-ms-asf',
  f4v: 'video/x-f4v',
  mxf: 'video/mxf',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  m4a: 'audio/mp4',
  m4b: 'audio/mp4',
  aac: 'audio/aac',
  opus: 'audio/opus',
  wma: 'audio/x-ms-wma',
  mid: 'audio/midi',
  midi: 'audio/midi',
  aiff: 'audio/aiff',
  aif: 'audio/aiff',
  alac: 'audio/alac',
  ape: 'audio/ape',
  amr: 'audio/amr',
  ac3: 'audio/ac3',
  mka: 'audio/x-matroska',
  pdf: 'application/pdf',
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  tar: 'application/x-tar',
  gz: 'application/gzip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  csv: 'text/csv',
  xml: 'application/xml',
  html: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  ts: 'text/plain',
  exe: 'application/vnd.microsoft.portable-executable',
  iso: 'application/x-iso9660-image',
  apk: 'application/vnd.android.package-archive'
}

export function guessMime(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return MIME[ext] ?? 'application/octet-stream'
}

export const IMAGE_EXT = [
  'jpg', 'jpeg', 'jfif', 'png', 'apng', 'gif', 'webp', 'bmp', 'svg',
  'heic', 'heif', 'avif', 'jxl', 'tiff', 'tif', 'ico',
  'raw', 'arw', 'srf', 'sr2', 'cr2', 'cr3', 'nef', 'nrw', 'dng', 'orf',
  'rw2', 'raf', 'pef', 'srw', 'rwl'
]

export function isImageName(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return IMAGE_EXT.includes(ext)
}

export function isRawExt(ext: string): boolean {
  return [
    'raw', 'arw', 'srf', 'sr2', 'cr2', 'cr3', 'nef', 'nrw', 'dng', 'orf',
    'rw2', 'raf', 'pef', 'srw', 'rwl'
  ].includes(ext)
}
export const VIDEO_EXT = [
  'mp4', 'm4v', 'mkv', 'avi', 'mov', 'webm', 'wmv', 'flv', 'mpg', 'mpeg',
  '3gp', '3g2', 'ogv', 'm2ts', 'mts', 'vob', 'divx', 'asf', 'rm',
  'rmvb', 'f4v', 'mxf', 'm2v'
]
export const AUDIO_EXT = [
  'mp3', 'wav', 'flac', 'ogg', 'oga', 'm4a', 'm4b', 'aac', 'opus', 'wma',
  'mid', 'midi', 'aiff', 'aif', 'alac', 'ape', 'amr', 'ac3', 'mka'
]
