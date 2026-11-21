export function readCSVLine(line, row) {
  const fields = []
  let field = '', quoted = false, closed = false, wasQuoted = false
  const push = () => {
    fields.push({ value: field.trim(), quoted: wasQuoted })
    field = ''
    wasQuoted = false
    closed = false
  }
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch !== '"') field += ch
      else if (line[i + 1] === '"') { field += '"'; i++ }
      else { quoted = false; closed = true }
    } else if (ch === ',') {
      push()
    } else if (closed) {
      if (!/\s/.test(ch)) throw Error(`Row ${row} has text after a closing quote. Follow each quoted field with a comma.`)
    } else if (ch === '"') {
      if (field.trim()) throw Error(`Row ${row} has a quote inside an unquoted field. Wrap the whole field in quotes.`)
      field = ''
      quoted = true
      wasQuoted = true
    } else {
      field += ch
    }
  }
  if (quoted) throw Error(`Row ${row} has an unclosed quoted field. Close the quote on the same line; multiline fields are unsupported.`)
  push()
  return fields
}

export function csvCell(value) {
  const text = String(value ?? '')
  return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text
}
