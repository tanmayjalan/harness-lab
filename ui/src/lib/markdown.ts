// Markdown: a small, safe subset. Headings, lists, tables, code blocks, quotes, bold, italic,
// inline code. Links are shown as text, never made clickable. The result is plain data that
// React draws, so nothing the model writes is ever treated as HTML.
// (Ported from the old page's renderer.)

export type Inline =
  | { t: 'text'; text: string }
  | { t: 'code'; text: string }
  | { t: 'strong'; children: Inline[] }
  | { t: 'em'; children: Inline[] }
  | { t: 'link'; text: string; href: string }
  | { t: 'br' }

export type MdBlock =
  | { t: 'p'; children: Inline[] }
  | { t: 'h'; level: number; children: Inline[] }
  | { t: 'pre'; text: string }
  | { t: 'hr' }
  | { t: 'quote'; children: MdBlock[] }
  | { t: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { t: 'table'; head: Inline[][]; rows: Inline[][][] }

export type ListItem = { children: (Inline | { t: 'pre'; text: string } | MdBlock)[] }

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
const TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/
const FENCE = /^\s*(```|~~~)/
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/
const blank = (s: string) => /^\s*$/.test(s)
const indentOf = (s: string) => s.match(/^\s*/)![0].replace(/\t/g, '    ').length

export function inline(text: string): Inline[] {
  const re = /(`+)([^`]|[\s\S]*?[^`])\1(?!`)|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|\*(?!\s)([\s\S]+?)(?<!\s)\*|\[([^\]]+)\]\(([^)\s]+)\)/g
  const out: Inline[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ t: 'text', text: text.slice(last, m.index) })
    if (m[1]) out.push({ t: 'code', text: m[2] })
    else if (m[3] != null || m[4] != null) out.push({ t: 'strong', children: inline(m[3] ?? m[4]) })
    else if (m[5] != null) out.push({ t: 'em', children: inline(m[5]) })
    else if (m[6] != null) out.push({ t: 'link', text: m[6], href: m[7] })
    last = re.lastIndex
  }
  if (last < text.length) out.push({ t: 'text', text: text.slice(last) })
  return out
}

function startsBlock(lines: string[], i: number) {
  const s = lines[i]
  return FENCE.test(s) || /^#{1,6}\s/.test(s) || LIST_ITEM.test(s) || /^\s*>/.test(s) || RULE.test(s) ||
    (s.includes('|') && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1]))
}

function readFence(lines: string[], i: number): [{ t: 'pre'; text: string }, number] {
  const close = lines[i].trim().slice(0, 3)
  const buf: string[] = []
  i++
  while (i < lines.length && !lines[i].trim().startsWith(close)) buf.push(lines[i++])
  return [{ t: 'pre', text: buf.join('\n') }, i + 1]
}

function readList(lines: string[], i: number, base: number): [MdBlock, number] {
  const first = lines[i].match(LIST_ITEM)!
  const ordered = /\d/.test(first[2])
  const list = { t: 'list' as const, ordered, start: ordered ? parseInt(first[2], 10) : 1, items: [] as ListItem[] }
  let li: ListItem | null = null
  while (i < lines.length) {
    const line = lines[i]
    const m = line.match(LIST_ITEM)
    if (m) {
      const ind = indentOf(line)
      if (ind < base) break
      if (ind > base + 1 && li) {
        const [sub, next] = readList(lines, i, ind)
        li.children.push(sub)
        i = next
        continue
      }
      li = { children: inline(m[3]) }
      list.items.push(li)
      i++
      continue
    }
    if (blank(line)) { // a blank line continues the list only if another item of the same kind follows
      let j = i + 1
      while (j < lines.length && blank(lines[j])) j++
      const next = j < lines.length ? lines[j].match(LIST_ITEM) : null
      if (next && indentOf(lines[j]) >= base && (indentOf(lines[j]) > base + 1 || /\d/.test(next[2]) === ordered)) {
        i = j
        continue
      }
      break
    }
    if (li && indentOf(line) > base) { // text or code that belongs to the current item
      if (FENCE.test(line)) {
        const [pre, next] = readFence(lines, i)
        li.children.push(pre)
        i = next
        continue
      }
      li.children.push({ t: 'br' }, ...inline(line.trim()))
      i++
      continue
    }
    break
  }
  return [list, i]
}

const splitRow = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())

export function parseMarkdown(text: string): MdBlock[] {
  const out: MdBlock[] = []
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    let m: RegExpMatchArray | null
    if (blank(line)) { i++; continue }
    if (FENCE.test(line)) {
      const [pre, next] = readFence(lines, i)
      out.push(pre)
      i = next
      continue
    }
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      out.push({ t: 'h', level: Math.min(6, m[1].length + 2), children: inline(m[2]) })
      i++
      continue
    }
    if (RULE.test(line)) { out.push({ t: 'hr' }); i++; continue }
    if (line.includes('|') && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1])) {
      const head = splitRow(line).map(inline)
      const rows: Inline[][][] = []
      i += 2
      while (i < lines.length && lines[i].includes('|') && !blank(lines[i])) rows.push(splitRow(lines[i++]).map(inline))
      out.push({ t: 'table', head, rows })
      continue
    }
    if (LIST_ITEM.test(line)) {
      const [list, next] = readList(lines, i, indentOf(line))
      out.push(list)
      i = next
      continue
    }
    if (/^\s*>/.test(line)) {
      const buf: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''))
      out.push({ t: 'quote', children: parseMarkdown(buf.join('\n')) })
      continue
    }
    const children: Inline[] = [] // a paragraph: keep the model's line breaks
    let firstLine = true
    while (i < lines.length && !blank(lines[i]) && (firstLine || !startsBlock(lines, i))) {
      if (!firstLine) children.push({ t: 'br' })
      children.push(...inline(lines[i].trim()))
      firstLine = false
      i++
    }
    out.push({ t: 'p', children })
  }
  return out
}
