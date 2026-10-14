import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { parseMarkdown } from './markdown'
import { Markdown } from '../components/Markdown'

const html = (text: string) => render(<Markdown text={text} />).container.innerHTML

describe('markdown', () => {
  it('draws the common pieces', () => {
    const out = html('# Title\n\nSome **bold**, *italic* and `code`.\n\n- one\n- two\n\n1. first\n2. second')
    expect(out).toContain('<h3>Title</h3>')
    expect(out).toContain('<strong>bold</strong>')
    expect(out).toContain('<em>italic</em>')
    expect(out).toContain('<code>code</code>')
    expect(out).toContain('<ul><li>one</li><li>two</li></ul>')
    expect(out).toContain('<ol start="1"><li>first</li><li>second</li></ol>')
  })

  it('tables, quotes, code blocks and nested lists', () => {
    const blocks = parseMarkdown('| a | b |\n|---|---|\n| 1 | 2 |\n\n> quoted\n\n```\nx < y\n```\n\n- outer\n  - inner')
    expect(blocks.map((b) => b.t)).toEqual(['table', 'quote', 'pre', 'list'])
    const out = html('```\nx < y\n```')
    expect(out).toContain('<pre><code>x &lt; y</code></pre>')
  })

  it('never turns model text into HTML', () => {
    const out = html('<script>alert(1)</script> and <img src=x onerror=alert(1)>')
    expect(out).not.toContain('<script>')
    expect(out).not.toContain('<img')
    expect(out).toContain('&lt;script&gt;')
  })

  it('shows links as text with the address, never clickable', () => {
    const { container } = render(<Markdown text="see [docs](javascript:alert(1))" />)
    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).toContain('docs')
  })

  it('keeps line breaks inside a paragraph', () => {
    expect(html('line one\nline two')).toContain('line one<br>line two')
  })
})
