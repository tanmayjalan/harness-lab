// What letting Ask-first tools run means, in words
import { plural } from '../../lib/format'
import { isMcpTool } from '../../model/permission'

export const andList = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0] ?? '')
const FILE_TOOLS = ['read_file', 'list_files', 'write_file']

// F389: what letting Ask-first tools run means, tool by tool. `codeRuns`: how many runs can use run_python
// (the sides where it asks, times the runs per side); one run can run code more than once
export function letThroughWords(tools: string[], codeRuns: number): string[] {
  const out: string[] = []
  if (tools.includes('run_python')) {
    out.push(`Code the model writes will run as you, without you seeing it first, ${codeRuns > 1 ? `in up to ${plural(codeRuns, 'run')}` : 'in one run'}`
      + ' (and more than once in a run, if the model asks again). It can reach any of your files and the internet.')
  }
  if (tools.includes('remember_fact')) out.push('remember_fact: facts the model saves about you are shared in every future conversation.')
  const mcp = tools.filter(isMcpTool)
  if (mcp.length) out.push(`${andList(mcp)}: another program decides what ${mcp.length === 1 ? 'it does' : 'they do'}.`)
  const files = tools.filter((t) => FILE_TOOLS.includes(t))
  if (files.length) out.push(`${andList(files)}: writes really happen; paths outside the workspace are still refused.`)
  return out
}
