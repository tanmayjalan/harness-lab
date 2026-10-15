// The starting points on the empty screen. Each one is a message to send, the idea it shows, where
// to look while it runs, what it means, and what to try next. EXPERIMENTS is in the order they teach:
// tier by tier (GROUPS), and within a tier in the order written here.
import type { SettingsChange } from '../api/types'
import { callLimitHit, type Run, type RunModel } from '../model/derive'
import { CONCEPTS, GROUPS, type ConceptKey, type Group } from './concepts'
import type { InspectorTab } from '../store/ui'

export type Experiment = {
  id: string
  tier: Group
  title: string
  message: string
  concept: ConceptKey
  teaches: string // one line on the card
  lookAt: string // shown above the conversation while it runs, and in what it showed afterwards
  inspect?: InspectorTab // the Inspector tab lookAt points to: afterwards, a button opens it there
  takeaway: string // shown under the answer
  tryNext: string // shown under the answer
  tryNextKept?: string // instead of tryNext when a conversation keeps its start ("From your next conversation")
  tryMessage?: string // a message quoted in tryNext: shown as a button that fills the message box
  apply?: SettingsChange // settings it switches on when you pick it (with an Undo)
  switchTo?: { provider: string; model: string } // a provider and model it switches to
  needs?: string // a provider it needs to show anything, e.g. "the Anthropic API"
  notOn?: string // the provider that cannot show it (the mock, unless named here)
  predict?: Prediction // a guess to make before sending, checked against what happened
  endsAtLimit?: boolean // it is meant to stop at the call limit: that stop counts as done
}

// Guess first, then see: the banner asks before you send, and compares after the run
// `actual` reads one run: the message sent for the experiment (the newest, if it was sent again)
export type Prediction = { question: string; options: string[]; actual: (m: RunModel, run: Run) => string; why: string }

const callsOf = (run: Run) => run.callIds.length
const toolsOf = (m: RunModel, run: Run) => run.callIds.flatMap((id) => m.calls[id].toolIds.map((t) => m.tools[t])).filter(Boolean)

const WRITTEN: Experiment[] = [
  {
    id: 'loop', tier: 'The loop', concept: 'loop',
    predict: {
      question: 'How many times will the harness call the model for this one message?',
      options: ['1', '2', '3', '4 or more'],
      actual: (_m, run) => { const n = callsOf(run); return n >= 4 ? '4 or more' : String(n) },
      why: 'One call to ask for the weather, one to convert it, one to answer: each tool round trip is another call.',
    },
    apply: { permissions: { get_weather: 'allow', convert_temperature: 'allow' } }, // so no approval interrupts it
    title: 'Watch the loop',
    message: "What's the weather in Paris, in Fahrenheit?",
    teaches: 'The model asks for tools and the harness runs them: how many calls to the model does one question take?',
    lookAt: 'Each numbered step is one trip to the model. Click what the model asked for to follow one round trip in Inspector → Tools.',
    inspect: 'tools',
    takeaway: 'The model never ran a tool: it asked, the harness ran it (the weather came from the internet), and the result went back in the next call.',
    tryNext: 'Ask "Weather in Paris and Tokyo?": one reply can ask for two tools at once.',
    tryMessage: 'Weather in Paris and Tokyo?',
  },
  {
    id: 'errors', tier: 'The loop', concept: 'tool_error',
    title: 'Errors are answers too',
    message: 'Read missing.txt',
    teaches: "A failing tool doesn't crash anything: the error goes back to the model.",
    lookAt: 'The step where the tool failed, and what the harness sent back. Then Inspector → Sent → the tool result marked is_error.',
    inspect: 'sent',
    takeaway: 'The harness caught the failure and sent it to the model as a result. The model decided what to say.',
    tryNext: 'Ask it to "read missing.txt, and if it isn\'t there, list the folder instead".',
    tryMessage: "read missing.txt, and if it isn't there, list the folder instead",
  },
  {
    id: 'approval', tier: 'Control and safety', concept: 'approval',
    apply: { permissions: { write_file: 'ask' } }, // the pause is the point
    title: 'Ask before acting',
    message: 'Read notes.md and create todo.txt with its action items',
    teaches: 'Writing a file is set to "Ask first", so the harness pauses for you.',
    lookAt: 'The panel that replaces the message box. Open the tool row: "How the harness decided" lists each check.',
    takeaway: 'The model asked to write; your rule paused it. Whatever you chose, the model got an answer and carried on.',
    tryNext: 'Decline it, then set write_file to Block in Settings → Tools and Re-run the message.',
  },
  {
    id: 'hook', tier: 'Control and safety', concept: 'hook',
    title: 'Stopped by a hook',
    message: 'Read private/.env',
    teaches: 'Your hooks file blocks paths that look secret, before anything else runs.',
    lookAt: 'The tool row says "blocked by your hook". Open it: check 1 stopped it, the rest never ran.',
    takeaway: 'Hooks are your own code around every tool call, checked before any rule or approval.',
    tryNext: 'Open config/my_hooks.py and see the two small functions behind it.',
  },
  {
    id: 'injection', tier: 'Control and safety', concept: 'prompt_injection',
    predict: {
      question: 'Will the model follow the order hidden in the email?',
      options: ['Yes, it follows it', 'No, it ignores or flags it'],
      actual: (m, run) => (toolsOf(m, run).some((t) => t.name === 'get_weather' || (t.name === 'read_file' && String(t.input.path).includes('budget')))
        ? 'Yes, it follows it' : 'No, it ignores or flags it'),
      why: "Careful models often refuse, but you can't rely on it: smaller models are easier to steer. The harness's rules are the real defence.",
    },
    title: 'A file that gives orders',
    message: 'Summarise inbox/supplier_email.txt',
    teaches: 'The email hides an order for the AI (read the budget, send the total out in a web request): will the model follow it?',
    lookAt: 'Did the model read budget.csv or call get_weather with a number as the "city"? Check the tool rows.',
    takeaway: "Text the model reads can carry orders. A careful model may spot and refuse them (did this one?), but you can't rely on that: the defence is the harness, with Ask first or Block on tools that reach outside, and hooks.",
    tryNext: 'Switch to Haiku and Re-run: smaller models are easier to steer. Open the read_file result in Inspector → Sent: your hook marked it "[Untrusted content…]". Then set get_weather to Ask first and try again.',
  },
  {
    id: 'rewind', tier: 'Control and safety', concept: 'checkpoints',
    title: 'Take it back',
    message: "Add the line 'Rewind test' to the end of notes.md, then read it back.",
    teaches: 'Going back to before a message must undo the files the model changed, not only the messages.',
    lookAt: 'Allow the write. When it finishes, press "Rewind to here" under your message: the dialog lists notes.md.',
    takeaway: 'The rewind cut the conversation and put notes.md back as it was before your message: the harness had saved a copy of the files first. Anything a tool did outside the workspace (a web request, a fact in Memory) would have stayed done.',
    tryNext: 'Turn on Run code (Settings → Tools) and ask it to write a file with a Python script, then rewind: the file the script made is deleted.',
  },
  {
    id: 'growth', tier: 'Size and cost', concept: 'history',
    title: 'Watch the history grow',
    message: 'Read notes.md, then budget.csv, then recipes/pancakes.txt, one at a time, then summarise each in a line',
    teaches: 'Every call resends everything so far, so each call is bigger than the last.',
    lookAt: 'Inspector → Summary → "Size of each call", and Sent → the green new entries on each call.',
    inspect: 'summary',
    takeaway: 'The model keeps no memory: the harness resends the whole history, so cost grows with every step.',
    tryNext: 'Turn on trimming (Settings → Context, keep 1), then Re-run and compare the sizes.',
  },
  {
    id: 'thinking', tier: 'Shaping the model', concept: 'thinking',
    apply: { thinking: { enabled: true, budget: 4000, effort: 'high' } },
    title: 'Think first',
    message: 'Is 391 a prime number? Check your reasoning with the calculator.',
    teaches: 'With thinking on, the model reasons before it answers or asks for tools.',
    lookAt: 'Thinking is now on (Undo restores it). Look at the time each call takes. On the mock you only see that it thought; switch to the Anthropic API to read the thinking itself.',
    takeaway: 'Thinking is extra output the model writes before replying: slower and dearer, often better on hard problems.',
    tryNext: 'In Compare, pick "Thinking off vs on": the same question with thinking off on side A and on on side B.',
  },
  {
    id: 'busy', tier: 'The loop', concept: 'retry',
    apply: { faults: { busy: true } },
    predict: {
      question: 'How many tries will call 1 take?',
      options: ['1', '2', '3'],
      actual: (m, run) => String(1 + (m.calls[run.callIds[0]]?.retries?.length ?? 0)),
      why: 'The first try fails (the practice switch makes the service look busy), the harness waits a second, and the second try works.',
    },
    title: 'A busy service',
    message: 'What is the capital of Australia?',
    teaches: 'What does the harness do when the service is too busy to answer?',
    lookAt: 'The practice switch is on (Undo restores it). Look for "tried again" on the call line, and Inspector → Summary: the wait has its own part of the time bar.',
    inspect: 'summary',
    takeaway: 'A busy service is normal. The harness waits and sends the same request again; it is still one call, just slower.',
    tryNext: 'Turn the switch off (Undo) and send it again: one try, and no waiting. Or Compare → "A calm service vs a busy one" to see both side by side.',
  },
  {
    id: 'cutoff', tier: 'The loop', concept: 'other_stop',
    predict: {
      question: 'How will the reply end?',
      options: ['It finishes the story', 'It stops part-way'],
      actual: (m, run) => (run.callIds.some((id) => m.calls[id].stopReason === 'max_tokens') ? 'It stops part-way' : 'It finishes the story'),
      why: 'A 600-word story needs about 800 tokens; the limit is 300, so the reply is cut with stop_reason "max_tokens".',
    },
    apply: { limits: { max_tokens: 300, max_turns: 20 } },
    title: 'Cut off mid-sentence',
    message: 'Write a detailed, 600-word story about a lighthouse keeper, here in your reply.',
    teaches: 'With the longest reply set to 300 tokens, how does a long story end?',
    lookAt: 'The longest reply is now 300 tokens (Undo restores it). Watch how the reply ends, and what the last step says.',
    takeaway: 'max_tokens caps each reply. The harness shows what arrived and flags why it stopped.',
    tryNext: 'Undo, then Re-run the message: the full story comes back.',
  },
  {
    id: 'runaway', tier: 'The loop', concept: 'max_turns', endsAtLimit: true,
    apply: { limits: { max_tokens: 16000, max_turns: 2 } },
    title: 'Runaway task',
    message: 'Roll a six-sided die, one roll per step, and keep rolling until you get a 6.',
    teaches: 'A cap on calls per message stops a model that keeps asking for tools.',
    lookAt: 'The limit is now 2 calls (Undo, above the message box, restores it). Watch the run stop after step 2.',
    takeaway: 'The call limit is a safety net: without it, a confused model could loop and spend forever.',
    tryNext: 'Undo, then Re-run: it rolls until the 6.',
  },
  {
    id: 'trim', tier: 'Size and cost', concept: 'trimming',
    apply: { trim: { enabled: true, keep_last: 1 } },
    needs: 'the mock or DeepSeek (the Anthropic API skips trimming)',
    notOn: 'anthropic',
    title: 'Long reading, short memory',
    message: 'Read notes.md, then budget.csv, then recipes/pancakes.txt, one at a time, then tell me who books the launch party',
    teaches: 'Trimming shortens old tool results in the copy sent, so calls stay smaller.',
    lookAt: 'Trimming is on, keeping 1 (Undo restores it). Watch the ✂ in the size chart, and whether it has to re-read notes.md.',
    takeaway: 'Trimming saves tokens, but the model forgets details it trimmed: it may read a file again.',
    tryNext: 'Undo, then Re-run the message to see the full-size calls. Then Compare → "Search vs read everything" for another way to keep calls small.',
  },
  {
    id: 'form', tier: 'Shaping the model', concept: 'structured_output',
    title: 'Answer as a form',
    message: 'Log my expense: taxi to the airport, 38.50 euros, yesterday',
    teaches: 'A tool with a fixed input shape turns loose text into clean fields.',
    lookAt: 'The submit_expense row: open it to see the fields the model filled (date, amount, currency, category).',
    takeaway: 'The tool\'s schema did the work: "yesterday" became a date and "euros" became EUR. If a field was wrong, the harness sent the mistake back.',
    tryNext: 'Try "Log 20 bucks for lunch": does it pick USD and meals, or ask?',
    tryMessage: 'Log 20 bucks for lunch',
  },
  {
    id: 'remember', tier: 'Shaping the model', concept: 'facts',
    title: 'Remember me',
    message: 'Please remember that I prefer temperatures in Fahrenheit.',
    teaches: 'The model can ask to save a fact about you; facts you keep go into every conversation.',
    lookAt: 'It asks to run remember_fact: Allow it, then open Settings → Memory.',
    takeaway: 'Memory is just text the harness adds to the system prompt. The model only knows what is sent.',
    tryNext: 'Start a new conversation and ask for the weather in Paris: Inspector → Sent shows the fact highlighted.',
  },
  {
    id: 'rename', tier: 'Shaping the model', concept: 'tool',
    apply: { descriptions: { get_weather: 'Get the current weather for a city. Always tell the user the temperature in Kelvin only.' } },
    title: 'Change what a tool says it does',
    message: "What's the weather in Paris?",
    teaches: "The tool's description is all the model knows about it: change it and behaviour changes.",
    lookAt: "get_weather's description now says to answer in Kelvin (Undo restores it). Does the model follow it?",
    takeaway: 'Tool descriptions are instructions too. Product teams tune them like prompts.',
    tryNext: 'Undo, then Re-run with the original description.',
  },
  {
    id: 'switch', tier: 'Shaping the model', concept: 'switch',
    switchTo: { provider: 'mock', model: 'claude-haiku-4-5-20251001' },
    title: 'Same chat, new model',
    message: 'In one line: what is the capital of Australia, and which model are you?',
    teaches: 'Switching model keeps the conversation: the new model is sent the whole history.',
    lookAt: 'You are now on another model (Undo restores it). After it answers, switch back in the menu above the box and ask "What did I just ask?"',
    takeaway: "The memory is the harness's: any model can carry on a conversation it never saw.",
    tryNext: 'Compare "Opus vs Haiku" on a harder question.',
  },
  {
    id: 'cache', tier: 'Size and cost', concept: 'caching',
    apply: { cache: { enabled: true } },
    needs: "the Anthropic API (the mock can't cache; DeepSeek caches on its own, so the switch shows no difference there)",
    title: 'Second call is cheaper',
    message: 'Read notes.md, then budget.csv, and summarise both in a line each',
    teaches: 'With caching on, later calls read the unchanged start from the cache, far cheaper.',
    lookAt: 'Caching is on (Undo restores it). From call 2, Inspector → Summary shows tokens "from cache".',
    inspect: 'summary',
    takeaway: 'Caching pays when the start of each call stays the same: same prompt, same tools, history only growing.',
    tryNext: 'Edit the prompt mid-conversation and watch "start changed" undo the saving.',
    tryNextKept: 'This conversation keeps the prompt it began with, which is what keeps caching working. Edit the prompt, start a new conversation, send the same message, and see the new start written to the cache again.',
  },
  {
    id: 'at_once', tier: 'Size and cost', concept: 'tools_at_once',
    apply: { tools_at_once: { enabled: true } },
    predict: {
      question: 'Three lookups at once: how long will they take?',
      options: ['About as long as one', 'About three times as long'],
      actual: (m, run) => (run.callIds.some((id) => m.calls[id].atOnce?.together) ? 'About as long as one' : 'About three times as long'),
      why: 'With "tools at once" on, the three get_weather calls run at the same time, so they take about as long as the slowest one.',
    },
    title: 'Three cities at once',
    message: "What's the weather in Paris, Tokyo and London? Look all three up in one go.",
    teaches: 'One reply asks for three lookups: does the harness have to wait for each in turn?',
    lookAt: '"Tools at once" is on (Undo restores it). Look for "3 tools at once" on the call line, and Inspector → Summary: the tools part of the time bar.',
    inspect: 'summary',
    takeaway: 'Independent, allowed tools can run together: the time is the slowest one, not the sum. Anything that needs you still waits its turn.',
    tryNext: 'Compare → "Tools one by one vs at once" to see the time saved side by side. (If the model asked for one city at a time, there was nothing to run together: try again.)',
  },
  {
    id: 'fifty_tools', tier: 'Size and cost', concept: 'tool_search',
    apply: { extra_tools: { enabled: true, mode: 'all' } },
    title: 'Fifty tools',
    message: 'Book meeting room B for 3pm tomorrow for 4 people.',
    teaches: 'Every call carries every tool description. What do 40 more tools cost?',
    lookAt: 'All 40 office tools are sent (Undo restores it). Inspector → Summary: the context-window bar and the tokens sent, compared with a normal call. Then Sent → Tools offered: over fifty descriptions, on every call.',
    inspect: 'summary',
    takeaway: 'Every description went with every call, used or not. Each call sent more tokens, and the model had over fifty tools to choose from.',
    tryNext: 'Start a new conversation and try "Find a tool first": the same message, with the office tools found on demand. (In this conversation book_room is already loaded, so there would be nothing to find.)',
  },
  {
    id: 'find_tool', tier: 'Size and cost', concept: 'tool_search',
    apply: { extra_tools: { enabled: true, mode: 'find' } },
    predict: {
      question: 'How many model calls?',
      options: ['1', '2', '3 or more'],
      actual: (_m, run) => { const n = callsOf(run); return n <= 1 ? '1' : n === 2 ? '2' : '3 or more' },
      why: 'The first call has no office tools, only find_tool, so the model finds book_room first. The next call books the room and a third one answers: usually three.',
    },
    title: 'Find a tool first',
    message: 'Book meeting room B for 3pm tomorrow for 4 people.',
    teaches: 'Send only find_tool, and load a tool when the model asks for it. Smaller calls, but how many?',
    lookAt: 'Office tools are found on demand (Undo restores it). The first call is small: only find_tool, no office tools. Open the find_tool row: it loaded book_room. The next call\'s tools grow (Sent → Tools offered marks the new ones green), and Summary says the start changed.',
    takeaway: 'Only the tools needed were sent, and only from the call after they were found. The price: one more call, and a changed start whenever a tool is loaded, so the cache stops matching from the tools onward.',
    tryNext: 'Compare → "All tools sent vs found on demand" to see the tokens and calls side by side.',
  },
  {
    id: 'helper', tier: 'Bigger jobs', concept: 'helper',
    title: 'Hand off to a helper',
    message: 'Use a helper agent to read notes.md and recipes/pancakes.txt and summarise both in two lines',
    teaches: 'A second loop with its own history; only its short report comes back.',
    lookAt: 'The helper card: how much it read, and how little it returned to the main conversation.',
    takeaway: 'Helpers keep big reading out of the main history, so later calls stay small.',
    tryNext: 'Set read_file to Block and Re-run: your rules apply to the helper too.',
  },
  {
    id: 'workflow', tier: 'Bigger jobs', concept: 'workflow',
    apply: { workflow: { enabled: true } },
    predict: {
      question: 'How many model calls will this one question take?',
      options: ['1 or 2', '3 or 4', '5 or more'],
      actual: (_m, run) => { const n = callsOf(run); return n <= 2 ? '1 or 2' : n <= 4 ? '3 or 4' : '5 or more' },
      why: 'Each step is its own loop: gathering takes a call or two (search, then read), then one to write and one to check, plus two more for each fix.',
    },
    title: 'A chain of agents',
    message: 'How many days of annual leave do I get, and can I carry any over? The handbook folder has the company policies.',
    teaches: 'Instead of one agent, your code runs fixed steps: gather facts, write, check. Who decides what happens next?',
    lookAt: 'The workflow is on (Undo restores it). Watch the Workflow card light up each step, and open "your code sent it…" to see the only text each step got. On the mock, each call takes 20 to 60 seconds, so this takes a few minutes.',
    takeaway: "Your code decided the steps; the model only decided things inside each one. The writer never saw the files, only the notes passed to it. Only the final answer joined the conversation.",
    tryNext: 'Compare → "One agent vs a workflow" to see what the extra steps cost in calls and time. Then ask a follow-up: the steps get the earlier question and answer as text.',
  },
  {
    id: 'run_code', tier: 'Bigger jobs', concept: 'run_code',
    apply: { run_code: { enabled: true } },
    predict: {
      question: 'How many times will run_python run?',
      options: ['1', '2', '3 or more'],
      actual: (m, run) => { const n = toolsOf(m, run).filter((t) => t.name === 'run_python').length; return n <= 1 ? '1' : n === 2 ? '2' : '3 or more' },
      why: 'The first run fails: int() can\'t read an amount like 18.50. The model reads the error, fixes the file with write_file, and runs it again: usually twice in all.',
    },
    title: 'Write, run, fix',
    message: 'Run scripts/totals.py. If it fails, fix it and run it again until it works.',
    teaches: 'The model can run code and read what went wrong. How many runs will it take to get it working?',
    lookAt: 'Run code is on (Undo restores it). Each run asks first and shows the code: read it, then Allow, or tick "Always allow" to stop being asked. Look for the red first run and its error, the write_file fix, then the second run.',
    takeaway: 'The error was just another tool result: the model read it, changed the file and tried again. The harness only ran the script, with a time limit and a cap on the output. It is not a sandbox, which is why it asks you first.',
    tryNext: 'Ask it to run a script that counts forever, and watch the time limit stop it.',
  },
  {
    id: 'plan', tier: 'Bigger jobs', concept: 'plan',
    title: 'Plan, then do',
    message: 'Make a plan first, then add up the amounts in budget.csv',
    teaches: 'The model keeps a checklist with the update_plan tool and ticks it off.',
    lookAt: 'The Plan card above the calls, and the update_plan tool rows that change it.',
    takeaway: 'A plan is just another tool call: the harness shows it; the model keeps it up to date.',
    tryNext: 'Ask for a bigger task with five steps and watch it tick them off.',
  },
  {
    id: 'retrieval', tier: 'Bigger jobs', concept: 'retrieval',
    predict: {
      question: 'How many files will the model read in full?',
      options: ['1', '2-5', 'All 26'],
      actual: (m, run) => { const n = toolsOf(m, run).filter((t) => t.name === 'read_file').length; return n <= 1 ? '1' : n <= 5 ? '2-5' : 'All 26' },
      why: 'With search it finds refunds.md first and reads just that one (or none: the search result may already be enough).',
    },
    title: 'Find the refund policy',
    message: "What's our refund policy for annual plans? The handbook folder has the company policies.",
    teaches: '26 policy files and one question: does the model read them all, or search first and read only what it needs?',
    lookAt: 'The search_files row and its result, then any read_file rows. Check the size chart to see how big the calls get.',
    takeaway: 'Search first, read second: the history only grows by what was relevant. That is the core of RAG.',
    tryNext: 'Compare → "Search vs read everything" to see the cost of reading without searching.',
  },
  {
    id: 'skills', tier: 'Bigger jobs', concept: 'skills',
    apply: { skills: { enabled: true, mode: 'on_demand' } },
    predict: {
      question: 'Will the model load the expenses skill before filing?',
      options: ['Yes, it loads it first', 'No, it files it straight away'],
      actual: (m, run) => (toolsOf(m, run).some((t) => t.name === 'load_skill') ? 'Yes, it loads it first' : 'No, it files it straight away'),
      why: 'The prompt lists each skill in one line. "File my expense" matches the expenses skill, so it loads the full rules, then files.',
    },
    title: 'Instructions on demand',
    message: 'File my 18 euro taxi expense from yesterday.',
    teaches: 'Does the model carry every set of instructions all the time, or fetch the one this task needs?',
    lookAt: 'Skills are on (Undo restores it). Look for the load_skill row, and Inspector → Sent → System prompt: one line per skill, not the full text.',
    inspect: 'sent',
    takeaway: 'A skill costs one line until a task needs it; then its full text arrives as a tool result, in this conversation only.',
    tryNext: 'Compare → "Skills on demand vs all in the prompt" to see what sending every skill in full costs.',
  },
  {
    id: 'mcp', tier: 'Bigger jobs', concept: 'mcp',
    title: 'Tools from another program',
    message: 'Use the word count tool to count the words in "the quick brown fox jumps"',
    teaches: 'MCP tools come from a separate program; the harness lists them beside its own.',
    lookAt: 'The tool row names text-tools as its source, and asks first: MCP tools ask by default.',
    takeaway: 'To the model an MCP tool looks like any other. The harness passes the call to the other program.',
    tryNext: 'Settings → Tools lists them under "From MCP: text-tools".',
  },
]

// F408: tier by tier, so the welcome page's next three and the quiz follow the tiers (a stable sort)
export const EXPERIMENTS: Experiment[] = [...WRITTEN].sort((a, b) => GROUPS.indexOf(a.tier) - GROUPS.indexOf(b.tier))

// F407: the next one to do after `current`: the first not done yet, in teaching order, that the
// provider in use can show (null when none is left)
export function nextExperiment(done: string[], current: string | null, provider: string | null): Experiment | null {
  return EXPERIMENTS.find((x) => x.id !== current && !done.includes(x.id) && !cannotShow(x, provider)) ?? null
}

// F413: an idea taught in a later tier than the experiment you are following (none followed: false).
// It isn't explained in full yet, and labels that name it use plain words
export function laterThan(concept: ConceptKey, experimentId: string | null): boolean {
  const x = findExperiment(experimentId)
  return !!x && GROUPS.indexOf(CONCEPTS[concept].group) > GROUPS.indexOf(x.tier)
}

// Ran to the end, on a provider that can show what it is about (a stopped or failed run, or
// caching on the mock, doesn't count). F410: for one meant to stop at the call limit, that stop is the end
export function experimentDone(x: Experiment, run: Run, provider: string | null): boolean {
  const ended = run.outcome === 'answered' || (!!x.endsAtLimit && run.outcome === 'error' && callLimitHit(run) !== null)
  return ended && !cannotShow(x, provider)
}

// The provider in use cannot show what the experiment is about (it needs another one)
export const cannotShow = (x: Experiment, provider: string | null | undefined) => !!x.needs && provider === (x.notOn ?? 'mock')

export const findExperiment = (id: string | null | undefined) => EXPERIMENTS.find((x) => x.id === id) ?? null
