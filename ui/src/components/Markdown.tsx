import { createElement, memo, useMemo, type ReactNode } from 'react'
import { parseMarkdown, type Inline, type ListItem, type MdBlock } from '../lib/markdown'
import { cn } from '../lib/cn'
import { toast } from '../store/ui'

async function copyLink(href: string) {
  try {
    await navigator.clipboard.writeText(href)
    toast({ kind: 'ok', title: 'Link copied' })
  } catch {
    toast({ kind: 'error', title: "Couldn't copy", body: 'Your browser refused clipboard access.' })
  }
}

function inlines(nodes: Inline[]): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text': return n.text
      case 'code': return <code key={i}>{n.text}</code>
      case 'strong': return <strong key={i}>{inlines(n.children)}</strong>
      case 'em': return <em key={i}>{inlines(n.children)}</em>
      case 'br': return <br key={i} />
      case 'link':
        // Not opened from the lab (the model's text is untrusted): a click copies the address
        return (
          <span key={i}>
            <button type="button" title="Links aren't opened from the lab. Click to copy the address."
              onClick={() => void copyLink(n.href)} className="underline decoration-dotted">{n.text}</button>
            <span className="text-muted"> ({n.href})</span>
          </span>
        )
    }
  })
}

function itemChild(c: ListItem['children'][number], i: number): ReactNode {
  if (c.t === 'pre') return <pre key={i}><code>{c.text}</code></pre>
  if (c.t === 'list') return block(c, i)
  return inlines([c as Inline])[0] ?? null
}

function block(b: MdBlock, key: number): ReactNode {
  switch (b.t) {
    case 'p': return <p key={key}>{inlines(b.children)}</p>
    case 'h': return createElement(`h${b.level}`, { key }, inlines(b.children))
    case 'pre': return <pre key={key}><code>{b.text}</code></pre>
    case 'hr': return <hr key={key} />
    case 'quote': return <blockquote key={key}>{b.children.map(block)}</blockquote>
    case 'list': {
      const items = b.items.map((it, i) => <li key={i}>{it.children.map(itemChild)}</li>)
      return b.ordered ? <ol key={key} start={b.start}>{items}</ol> : <ul key={key}>{items}</ul>
    }
    case 'table':
      return (
        <div key={key} className="table-wrap">
          <table>
            <thead><tr>{b.head.map((c, i) => <th key={i}>{inlines(c)}</th>)}</tr></thead>
            <tbody>{b.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{inlines(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )
  }
}

export const Markdown = memo(function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text])
  return <div className={cn('md', className)}>{blocks.map(block)}</div>
})
