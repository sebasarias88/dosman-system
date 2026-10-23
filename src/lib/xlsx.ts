import { strToU8, zipSync } from 'fflate'

/**
 * Minimal Excel (.xlsx) writer: several sheets of plain values, bold header row,
 * frozen header and column widths. An .xlsx is a zip of XML files, so with a
 * 8 KB zip library we avoid shipping a 400 KB spreadsheet library to the browser.
 * Loaded on demand (dynamic import) only when someone exports.
 */
export type Cell = string | number | null | undefined

export interface SheetData {
  /** Max 31 characters, no : \ / ? * [ ] (Excel rule). */
  name: string
  header: string[]
  rows: Cell[][]
  /** Optional width per column, in characters. */
  widths?: number[]
}

function escapeXml(value: string): string {
  return (
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      // Control characters are not allowed in XML.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
  )
}

/** 0 -> "A", 25 -> "Z", 26 -> "AA" */
function columnName(index: number): string {
  let name = ''
  let n = index + 1
  while (n > 0) {
    const rest = (n - 1) % 26
    name = String.fromCharCode(65 + rest) + name
    n = Math.floor((n - 1) / 26)
  }
  return name
}

function cellXml(value: Cell, ref: string, style: number): string {
  if (value === null || value === undefined || value === '') return ''
  const s = style ? ` s="${style}"` : ''
  if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"${s}><v>${value}</v></c>`
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`
}

function sheetXml(sheet: SheetData): string {
  const all = [sheet.header, ...sheet.rows]
  const rows = all
    .map((row, r) => {
      const cells = row
        .map((value, c) => cellXml(value, `${columnName(c)}${r + 1}`, r === 0 ? 1 : 0))
        .join('')
      return `<row r="${r + 1}">${cells}</row>`
    })
    .join('')
  const widths = sheet.header
    .map((title, c) => {
      const width = sheet.widths?.[c] ?? Math.min(Math.max(title.length + 2, 12), 48)
      return `<col min="${c + 1}" max="${c + 1}" width="${width}" customWidth="1"/>`
    })
    .join('')
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<cols>${widths}</cols><sheetData>${rows}</sheetData></worksheet>`
  )
}

function safeSheetName(name: string, used: Set<string>): string {
  let base =
    name
      .replace(/[:\\/?*[\]]/g, ' ')
      .trim()
      .slice(0, 31) || 'Hoja'
  let candidate = base
  let i = 2
  while (used.has(candidate.toLowerCase())) {
    base = base.slice(0, 28)
    candidate = `${base} ${i++}`
  }
  used.add(candidate.toLowerCase())
  return candidate
}

export function buildXlsx(sheets: SheetData[]): Uint8Array {
  const used = new Set<string>()
  const names = sheets.map((s) => safeSheetName(s.name, used))
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets
          .map(
            (_, i) =>
              `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
          )
          .join('') +
        '</Types>',
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>',
    ),
    'xl/workbook.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        names
          .map((name, i) => `<sheet name="${escapeXml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
          .join('') +
        '</sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets
          .map(
            (_, i) =>
              `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
          )
          .join('') +
        `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        '</Relationships>',
    ),
    // Style 0 = normal, style 1 = bold header with a light gray fill.
    'xl/styles.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
        '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FFE7EAEA"/><bgColor indexed="64"/></patternFill></fill></fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>' +
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
        '</styleSheet>',
    ),
  }
  sheets.forEach((sheet, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(sheet))
  })
  return zipSync(files, { level: 6 })
}

/** Builds the workbook and downloads it. */
export function downloadXlsx(fileName: string, sheets: SheetData[]): void {
  const data = buildXlsx(sheets)
  const blob = new Blob([data.slice().buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
